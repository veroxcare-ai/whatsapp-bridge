/* ===========================================================================
   VEROX — WhatsApp Web bridge (Baileys)
   WhatsApp WEB (Linked Devices), NOT the paid Cloud API. Lightweight (no browser).
   Session is stored in Supabase → survives restart/sleep/redeploy with NO re-scan.

   Env vars (set on the host, e.g. Render dashboard):
     PORT                  default 8787
     ALLOW_ORIGIN          your frontend origin, e.g. https://veroxcare.net
     SUPABASE_URL          https://mjjtgmjftfberlhoogzg.supabase.co
     SUPABASE_SERVICE_KEY  Supabase service_role key (SECRET — dashboard only)

   Endpoints:
     GET  /            → { ok, status }        (use this for the keep-alive pinger)
     GET  /status      → connection state (+ qr data-url while linking)
     POST /send        → { to, body }          (send a WhatsApp message)
     WS   /            → streams { qr | status | message } to the CRM
   =========================================================================== */
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import qrcode from 'qrcode';
import { createClient } from '@supabase/supabase-js';
import P from 'pino';
import makeWASocket, {
  DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys';
import { useSupabaseAuthState } from './auth-supabase.js';

const PORT = process.env.PORT || 8787;
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[bridge] Missing SUPABASE_URL / SUPABASE_SERVICE_KEY env vars — session persistence needs them.');
}
const supabase = createClient(SUPABASE_URL || '', SUPABASE_KEY || '', { auth: { persistSession: false } });
const logger = P({ level: 'silent' });

const app = express();
app.use(cors({ origin: ALLOW_ORIGIN }));
app.use(express.json());

let state = { status: 'starting', qr: null, me: null };
let sock = null;
let reconnecting = false;

// ---- WebSocket to the CRM frontend ----
const wss = new WebSocketServer({ noServer: true });
const clients = new Set();
const broadcast = (type, payload) => { const m = JSON.stringify({ type, payload }); for (const ws of clients) { try { ws.send(m); } catch {} } };

async function start() {
  const auth = await useSupabaseAuthState(supabase, 'verox');
  const { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({
    version, logger,
    auth: { creds: auth.state.creds, keys: makeCacheableSignalKeyStore(auth.state.keys, logger) },
    printQRInTerminal: false,
    browser: ['VEROX CRM', 'Chrome', '2.0'],
    markOnlineOnConnect: false,
    syncFullHistory: false
  });

  sock.ev.on('creds.update', auth.saveCreds);

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) { state.status = 'qr'; state.qr = await qrcode.toDataURL(qr); broadcast('qr', { dataUrl: state.qr }); console.log('[wa] QR ready — scan from the CRM screen.'); }
    if (connection === 'open') { state.status = 'ready'; state.qr = null; state.me = sock.user?.id || null; broadcast('status', state); console.log('[wa] connected as', state.me); }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      state.status = 'disconnected'; broadcast('status', state);
      if (code === DisconnectReason.loggedOut) {
        console.log('[wa] logged out on phone — clearing stored session; a new QR will be needed.');
        await auth.clearAll();
      } else {
        console.log('[wa] connection closed, reconnecting…');
      }
      if (!reconnecting) { reconnecting = true; setTimeout(() => { reconnecting = false; start().catch(e => console.error('[wa] restart', e)); }, 3000); }
    }
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      const text = m.message?.conversation || m.message?.extendedTextMessage?.text || '';
      broadcast('message', { id: m.key.id, from: m.key.remoteJid, fromMe: m.key.fromMe, name: m.pushName || null, text, timestamp: Number(m.messageTimestamp) });
    }
  });
}

// ---- HTTP API ----
app.get('/', (_q, res) => res.json({ ok: true, service: 'verox-whatsapp-bridge', status: state.status }));
app.get('/status', (_q, res) => res.json(state));
app.post('/send', async (req, res) => {
  try {
    if (!sock) throw new Error('not connected');
    const { to, body } = req.body || {};
    const jid = String(to).includes('@') ? to : `${String(to).replace(/^0/, '20')}@s.whatsapp.net`;
    const sent = await sock.sendMessage(jid, { text: body });
    res.json({ ok: true, id: sent?.key?.id });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

const server = app.listen(PORT, () => console.log(`[bridge] listening on :${PORT}`));
server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => { clients.add(ws); ws.send(JSON.stringify({ type: 'status', payload: state })); ws.on('close', () => clients.delete(ws)); });
});

start().catch((e) => console.error('[wa] start error', e));
