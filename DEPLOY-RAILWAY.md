# Deploy the VEROX WhatsApp bridge on Railway (~$5/mo Hobby)

Railway runs the bridge 24/7 and gives you a ready `https` URL — no tunnel needed.

## 0) One-time in Supabase (if not done)
Run these in the Supabase SQL Editor:
- `supabase/schema.sql`  (main tables — already done)
- `supabase/whatsapp-auth.sql`  (WhatsApp session + numbers tables)

## 1) Update the GitHub repo (IMPORTANT)
The repo currently has the OLD bridge. Push the **latest** `whatsapp-bridge/` files
(server.js, auth-supabase.js, package.json, railway.json, Dockerfile, etc.) to
`github.com/veroxcare-ai/whatsapp-bridge`.

## 2) Create the Railway project
1. railway.com → **New Project** → **Deploy from GitHub repo** → pick `veroxcare-ai/whatsapp-bridge`.
2. Railway auto-detects Node and builds (Nixpacks + `node server.js`). No config needed.

## 3) Add environment variables
Project → **Variables** → add:
| Key | Value |
|-----|-------|
| `SUPABASE_URL` | `https://mjjtgmjftfberlhoogzg.supabase.co` |
| `SUPABASE_SERVICE_KEY` | *(your Supabase service_role key — secret)* |
| `ALLOW_ORIGIN` | `https://veroxcare.net` |

> Do NOT set `PORT` — Railway injects it automatically and the app already reads it.

## 4) Get the public URL
Project → **Settings → Networking → Generate Domain**. You get something like
`https://whatsapp-bridge-production.up.railway.app`. **That is your Bridge URL.**

## 5) Connect it in the system (no code)
Open the site → **الإعدادات → 🔗 رابط خادم الواتساب** → paste the Railway URL → save.
Then **واتساب CRM** → the status turns 🟢 متصل → **➕ إضافة رقم** → scan the QR.

That's it. Add a number per employee and assign each to its staff member.
Keep `SUPABASE_SERVICE_KEY` only in Railway's Variables — never in the website or the repo.
