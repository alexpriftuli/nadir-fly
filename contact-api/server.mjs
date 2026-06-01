// NADIR contact form — tiny Node HTTP service for EC2.
// Listens on localhost; nginx reverse-proxies POST /api/contact to it.
// Sends the message to your Gmail via Amazon SES, using the EC2 instance
// role for credentials (no keys on disk).
//
// Env vars (set in the systemd unit):
//   TO_EMAIL     your Gmail (SES-verified)
//   FROM_EMAIL   verified SES sender (e.g. alex@nodnod.studio)
//   AWS_REGION   eu-west-1
//   PORT/HOST    optional (default 127.0.0.1:3001)

import http from "node:http";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || "127.0.0.1";
const TO = process.env.TO_EMAIL;
const FROM = process.env.FROM_EMAIL;
const REGION = process.env.AWS_REGION || process.env.REGION || "eu-west-1";

const ses = new SESv2Client({ region: REGION });

const clean = (v, max) => (v == null ? "" : String(v).trim().slice(0, max));
const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const server = http.createServer((req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });

  let raw = "";
  let aborted = false;
  req.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > 20000) { aborted = true; req.destroy(); } // cap body size
  });
  req.on("end", async () => {
    if (aborted) return;
    let data;
    try { data = JSON.parse(raw || "{}"); }
    catch { return send(res, 400, { error: "Invalid JSON" }); }

    // Honeypot: bots fill this; pretend success.
    if (clean(data.company_url, 200)) return send(res, 200, { ok: true });

    const name = clean(data.name, 200);
    const email = clean(data.email, 200);
    const company = clean(data.company, 200);
    const siteType = clean(data.site_type, 100);
    const capacity = clean(data.capacity, 100);
    const target = clean(data.window, 100);
    const brief = clean(data.brief, 5000);

    if (!name || !email || !brief) return send(res, 400, { error: "Missing required fields" });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return send(res, 400, { error: "Invalid email" });

    const subject = `NADIR enquiry — ${name}${company ? " · " + company : ""}`;
    const text = [
      `Name:          ${name}`,
      `Email:         ${email}`,
      `Company:       ${company || "—"}`,
      `Site type:     ${siteType || "—"}`,
      `Capacity:      ${capacity || "—"}`,
      `Target window: ${target || "—"}`,
      "",
      "Brief:",
      brief,
    ].join("\n");

    try {
      await ses.send(new SendEmailCommand({
        FromEmailAddress: FROM,
        Destination: { ToAddresses: [TO] },
        ReplyToAddresses: [email],
        Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: text } } } },
      }));
      return send(res, 200, { ok: true });
    } catch (err) {
      console.error("SES send failed:", err);
      return send(res, 502, { error: "Send failed" });
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`contact-api listening on http://${HOST}:${PORT} (region ${REGION})`);
});
