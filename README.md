# VEROX WhatsApp bridge — free, no bank card

Uses **Baileys** (WhatsApp **Web**, not the paid API). The session is stored in **Supabase**, so it
reconnects to the same WhatsApp after any restart/reboot — **no QR re-scan** (you only re-scan if you
unlink the device on the phone, or the phone is offline ~14 days).

> The reality in 2026: free, no-card, 24/7 **cloud** hosting is basically gone (Render/Railway/Fly want
> a card; Hugging Face now charges for Docker Spaces). The reliable free path is to run it on a device
> you already have. It's simpler than it sounds.

---

## 🥇 Simplest — run it on the reception PC (free, no card, no tunnel)
The reception uses the WhatsApp CRM on their PC anyway, so run the bridge on that same PC. The CRM page
(from veroxcare.net) talks to `ws://localhost:8787` on the same machine — no public tunnel needed.

1. Install **Node.js 20+** from nodejs.org.
2. Put the `whatsapp-bridge` folder on the PC. Copy `.env.example` → `.env` and fill your keys
   (`SUPABASE_SERVICE_KEY` = your Supabase service_role key).
3. Double-click **`start.bat`**. First run installs everything and shows the bridge on `localhost:8787`.
4. Open the reception **واتساب CRM** screen → scan the QR once.
5. **Auto-start:** put a shortcut to `start.bat` in the Startup folder
   (`Win+R` → `shell:startup` → drop the shortcut). Now every morning the PC turns on, the bridge
   starts and **reconnects from Supabase automatically — no QR**.

Trade-offs (fine for a clinic): the WhatsApp screen works on that reception PC; while the PC is off at
night, messages simply arrive the next morning when it reconnects (WhatsApp holds them).

## 🥈 Always-on / from anywhere — an old Android phone (free)
Want it running 24/7 and reachable from any device (e.g. admin at home)? Use a spare **Android phone**
left plugged in — it never “turns off” like a PC.

1. Install **Termux** (from F-Droid). Then:
   ```bash
   pkg update && pkg install nodejs git -y
   git clone https://github.com/veroxcare-ai/whatsapp-bridge && cd whatsapp-bridge
   cp .env.example .env && nano .env      # fill your keys
   bash start.sh
   ```
2. Give it a public URL with a **free Cloudflare Tunnel** (no card):
   ```bash
   pkg install cloudflared -y
   cloudflared tunnel --url http://localhost:8787
   ```
   It prints an `https://…` URL → that's the bridge URL. (A *named* tunnel on your Cloudflare account
   gives a fixed URL like `bridge.veroxcare.net` — nicer, set up once.)
3. Keep the phone awake: disable battery optimization for Termux; `start.sh` already grabs a wake-lock.

## When you're ready to pay a little
A cheap **VPS (~$4/month)** is the clean, worry-free long-term home for a 24/7 WhatsApp bridge.
Same files, `bash start.sh`, done. (Most VPS still want a card, but it's the proper upgrade.)

---

## What I need from you
Tell me which path you picked. If it's the **reception PC (localhost)**, I wire the CRM to
`ws://localhost:8787`. If it's the **phone + tunnel**, send me the tunnel URL. Either way I then replace
the demo connect in `app/whatsapp.html` with the live QR + real messages. Keep `SUPABASE_SERVICE_KEY`
secret (in `.env`), don't send it to me.

## Endpoints
`GET /` · `GET /status` (state + QR) · `POST /send {to, body}` · `WS /` (streams qr/status/message).
