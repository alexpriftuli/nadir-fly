# Contact form backend — Node service on EC2 + SES

The contact form POSTs **same-origin** to `https://solar.nodnod.digital/api/contact`.
nginx reverse-proxies that to a small Node service (`server.mjs`) running under
systemd, which sends the message to your Gmail via Amazon SES using the **EC2
instance role** (no access keys on disk). Same-origin = no CORS, and no public
Lambda URL (which the account's org policy blocks).

Files:
- `server.mjs` — the Node HTTP service (no framework).
- `package.json` — one dependency, the SES SDK.
- `nadir-contact.service` — systemd unit (edit User/paths/env).
- `nginx-contact.conf` — the `location /api/contact` snippet to add to your site's server block.

> Backend code — not part of the static site; don't serve this folder from the web root.

## One-time setup

### 1. SES identities (same as before — region `eu-west-1`)
Verify the recipient Gmail and the sender, in **eu-west-1**:
```bash
aws sesv2 create-email-identity --email-identity alexandro.priftuli@gmail.com --region eu-west-1
aws sesv2 create-email-identity --email-identity alex@nodnod.studio          --region eu-west-1
# click the verify links in both inboxes; confirm:
aws sesv2 get-email-identity --email-identity alex@nodnod.studio --region eu-west-1 --query VerifiedForSendingStatus
```
Sandbox is fine since you only send to your own verified Gmail.

### 2. Give the EC2 instance role permission to send
Find the instance's role name, then attach the policy:
```bash
# role name (run on the EC2, IMDSv2):
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/iam/security-credentials/

# attach SES send permission to that role:
aws iam put-role-policy --role-name <INSTANCE_ROLE> --policy-name ses-send \
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"ses:SendEmail","Resource":"*"}]}'
```
(If the instance has no role yet, create one with this policy and attach it as an instance profile.)

### 3. Deploy the code
```bash
sudo mkdir -p /var/www/alex-contact-api
sudo cp server.mjs package.json /var/www/alex-contact-api/
cd /var/www/alex-contact-api
sudo npm install --omit=dev          # needs Node 18+ and npm on the box
sudo chown -R www-data:raffle /var/www/alex-contact-api
```

### 4. systemd service
```bash
# edit env vars in the unit first if needed (TO_EMAIL / FROM_EMAIL / AWS_REGION)
sudo cp nadir-contact.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nadir-contact
sudo systemctl status nadir-contact          # should be active (running)
# local smoke test (no email sent if SES not verified -> 502):
curl -s -X POST http://127.0.0.1:3056/ -H 'content-type: application/json' \
  -d '{"name":"Local","email":"alexandro.priftuli@gmail.com","brief":"hi"}'
```

### 5. nginx
Add the contents of `nginx-contact.conf` inside the `server { }` block that serves
`solar.nodnod.digital`, then:
```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 6. Test end-to-end (sends a real email once SES is verified)
```bash
curl -s -X POST https://solar.nodnod.digital/api/contact \
  -H 'content-type: application/json' \
  -d '{"name":"Test","email":"alexandro.priftuli@gmail.com","brief":"hello from prod"}'
# → {"ok":true}  and an email lands in your Gmail
```
The form is already wired to `/api/contact`, so the live page works once steps 1–5 are done.

## Notes
- **Reply-To** is the visitor's email — reply straight from Gmail.
- **Spam:** hidden honeypot (`company_url`) is dropped server-side; add Turnstile/hCaptcha if needed.
- **Logs:** `journalctl -u nadir-contact -f`.
- **Updating:** copy a new `server.mjs` to `/var/www/alex-contact-api/` and `sudo systemctl restart nadir-contact`.

## Deploying
```bash
rsync -avz -e "ssh -i ~/.ssh/other/nodnod.pem" --exclude ".git" --exclude "contact-api" . ubuntu@34.243.28.120:/var/www/solar
```
