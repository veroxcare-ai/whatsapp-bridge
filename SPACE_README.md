---
title: VEROX WhatsApp Bridge
emoji: 🟢
colorFrom: green
colorTo: gray
sdk: docker
app_port: 8787
pinned: false
---

# VEROX WhatsApp Bridge (Baileys)

WhatsApp Web bridge for the VEROX reception CRM. The WhatsApp session is stored in Supabase,
so it survives restarts with no QR re-scan.

## Set these as Space **Secrets** (Settings → Variables and secrets):
- `SUPABASE_URL` = https://mjjtgmjftfberlhoogzg.supabase.co
- `SUPABASE_SERVICE_KEY` = *(your Supabase service_role key — secret)*
- `ALLOW_ORIGIN` = https://veroxcare.net

The public URL of this Space is the bridge URL to give to the CRM.
