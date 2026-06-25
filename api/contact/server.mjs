// NADIR contact form — tiny Node HTTP service for EC2.
// Listens on localhost; nginx reverse-proxies POST /api/contact to it.
// Sends the message to your Gmail via Amazon SES, using the EC2 instance
// role for credentials (no keys on disk).
//
// Env vars (set in the systemd unit):
//   TO_EMAIL            your Gmail (SES-verified)
//   FROM_EMAIL          verified SES sender (e.g. alex@nadir-fly.com)
//   AWS_REGION          eu-west-1
//   RECAPTCHA_SECRET    reCAPTCHA v3 secret key (optional; if unset, bot check is skipped)
//   RECAPTCHA_MIN_SCORE minimum v3 score to accept (optional, default 0.5)
//   PORT/HOST           optional (default 127.0.0.1:3001)

import http from "node:http";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || "127.0.0.1";
const TO = process.env.TO_EMAIL;
const FROM = process.env.FROM_EMAIL;
const REGION = process.env.AWS_REGION || process.env.REGION || "eu-west-1";

const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET;
const RECAPTCHA_MIN_SCORE = Number(process.env.RECAPTCHA_MIN_SCORE || 0.5);

const ses = new SESv2Client({ region: REGION });

const clean = (v, max) => (v == null ? "" : String(v).trim().slice(0, max));

// reCAPTCHA v3 server-side verification. Returns true when the token is valid,
// the action matches, and the bot-likelihood score clears the threshold.
// If no secret is configured the check is skipped (returns true).
async function verifyRecaptcha(token, ip) {
  if (!RECAPTCHA_SECRET) return true;
  if (!token) return false;
  const params = new URLSearchParams({ secret: RECAPTCHA_SECRET, response: token });
  if (ip) params.set("remoteip", ip);
  try {
    const r = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params,
    });
    const j = await r.json();
    return j.success === true
      && (j.action === undefined || j.action === "contact")
      && typeof j.score === "number"
      && j.score >= RECAPTCHA_MIN_SCORE;
  } catch (err) {
    // Fail OPEN on infrastructure error (Google/network unreachable) so a transient
    // blip doesn't drop real B2B leads. The honeypot still guards. A definitive
    // bad/low-score token above still fails closed.
    console.error("reCAPTCHA verify unreachable — allowing through:", err);
    return true;
  }
}
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

    // reCAPTCHA v3 — verify before doing any work (skipped if no secret set).
    const xff = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    const clientIp = xff || req.socket.remoteAddress || "";
    if (!(await verifyRecaptcha(clean(data.recaptcha_token, 5000), clientIp))) {
      return send(res, 400, { error: "Failed bot check" });
    }

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
