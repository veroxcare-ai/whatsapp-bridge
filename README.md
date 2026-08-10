# VEROX WhatsApp bridge — free hosting, no card, no session drop

This bridge uses **Baileys** (WhatsApp **Web** protocol via Linked Devices — NOT the paid
Cloud API). It's lightweight (no Chromium) and stores its session in **Supabase**, so it
reconnects to the same WhatsApp session after any restart — **no QR re-scan**.

## Why the session never drops
The usual problem: free hosts wipe local files on restart, so the WhatsApp login is lost.
Here the login (creds + keys) is saved in the Supabase `whatsapp_auth` table, not on disk.
So restart / sleep-wake / redeploy → the bridge reads the session back → stays logged in.
(You only re-scan if YOU remove the linked device from the phone, or WhatsApp unlinks it
after the phone is offline for ~14 days.)

---

## Free setup, no bank card — step by step

**1) Create the session table (once).**
Supabase → SQL Editor → run [`supabase/whatsapp-auth.sql`](../supabase/whatsapp-auth.sql).

**2) Get your Supabase service key** (server-side secret — do NOT put it in the website):
Supabase → Project Settings → API → **`service_role`** key. Keep it for step 4.

**3) Push this `whatsapp-bridge/` folder to the GitHub repo** `veroxcare-ai/whatsapp-bridge`.

**4) Deploy on Render Free (no credit card required).**
- Render → New → **Blueprint** → pick the repo (it reads `render.yaml`), *or* New → Web Service.
- Runtime: Node · Build: `npm install` · Start: `node server.js` · Plan: **Free**.
- Environment variables:
  - `SUPABASE_URL` = `https://mjjtgmjftfberlhoogzg.supabase.co`
  - `SUPABASE_SERVICE_KEY` = *(the service_role key from step 2)*
  - `ALLOW_ORIGIN` = `https://veroxcare.net`
- Deploy. Open the service URL — you'll get `{ ok: true, status: "qr" }`.

**5) Keep it awake (free, no card).** Render Free sleeps after 15 min idle — which would drop
the live connection. Prevent it with a free pinger every ~10 minutes:
- **UptimeRobot** (free, no card): add an HTTP monitor on `https://<your-app>.onrender.com/status`, interval 5–10 min.
- or **cron-job.org** (free, no card): a job hitting the same URL every 10 min.
This keeps the process alive 24/7, so messages arrive in real time. Render Free gives 750
hours/month — enough for one always-on service.

**6) Scan once.** Open the reception **واتساب CRM** screen → it shows the QR from the bridge →
scan with the clinic's WhatsApp (Linked Devices). Done — and it stays linked after that.

---

## Notes
- **Cost:** Render Free + UptimeRobot/cron-job.org + Supabase Free = **$0, no card**.
- If later you want zero cold-starts and full 24/7 guarantees, a cheap VPS (~$4/mo) is the
  upgrade — but the free stack above works for a clinic.
- After it's deployed and reachable, send me the Render URL and I'll wire it into
  `app/whatsapp.html` (replace the demo QR with the live QR + real message stream via `/status`,
  the WebSocket, and `/send`).

## Endpoints
`GET /` and `GET /status` (state + QR), `POST /send {to, body}`, `WS /` (streams qr/status/message).
