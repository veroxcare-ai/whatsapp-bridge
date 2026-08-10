/* ===========================================================================
   VEROX — WhatsApp Web bridge (scaffold)
   Emulates WhatsApp Web (QR-linked session) using whatsapp-web.js — this is the
   client's explicit requirement: WhatsApp WEB, not the paid Business API.

   This MUST run as an always-on process (Railway / Render / Fly.io / VPS).
   It CANNOT run on Netlify (serverless functions are short-lived and cannot hold
   the WhatsApp socket). Netlify hosts the static frontend, which connects here.

   What it does:
     - Boots a WhatsApp Web client with a persisted session (LocalAuth).
     - Emits the login QR as a data-URL over WebSocket → shown in app/whatsapp.html.
     - Streams inbound messages to connected CRM clients (the reception dashboard).
     - Accepts { to, body } to send outbound messages from the CRM.

   Run:
     npm install
     npm start           # then scan the QR from the reception "واتساب CRM" screen

   Env:
     PORT           default 8787
     ALLOW_ORIGIN   CORS origin of the frontend (e.g. https://veroxcare.net)
   =========================================================================== */
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import qrcode from 'qrcode';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;

const PORT = process.env.PORT || 8787;
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';

const app = express();
app.use(cors({ origin: ALLOW_ORIGIN }));
app.use(express.json());

let state = { status: 'starting', qr: null, me: null };

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }), // persists the linked session
  puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

/* ---- WebSocket: push QR + messages to the CRM frontend ---- */
const wss = new WebSocketServer({ noServer: true });
const clients = new Set();
function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload });
  for (const ws of clients) { try { ws.send(msg); } catch {} }
}

/* ---- WhatsApp Web lifecycle ---- */
client.on('qr', async (qr) => {
  state.status = 'qr';
  state.qr = await qrcode.toDataURL(qr);   // data-URL → render in app/whatsapp.html <img>
  broadcast('qr', { dataUrl: state.qr });
  console.log('[wa] QR ready — scan it from the reception WhatsApp CRM screen.');
});
client.on('authenticated', () => { state.status = 'authenticated'; broadcast('status', state); });
client.on('ready', () => {
  state.status = 'ready';
  state.me = client.info?.wid?.user || null;
  broadcast('status', state);
  console.log('[wa] connected as', state.me);
});
client.on('disconnected', (reason) => {
  state.status = 'disconnected';
  broadcast('status', { ...state, reason });
  console.log('[wa] disconnected:', reason, '— will need re-scan (normal for Web mode).');
  client.initialize();                     // attempt to relink
});
client.on('message', (m) => {
  broadcast('message', {
    id: m.id?._serialized, from: m.from, body: m.body,
    fromMe: m.fromMe, timestamp: m.timestamp, name: m._data?.notifyName || null
  });
});

/* ---- HTTP API used by the CRM ---- */
app.get('/status', (_req, res) => res.json(state));
app.post('/send', async (req, res) => {
  try {
    const { to, body } = req.body;                 // to: "2010xxxxxxxx@c.us"
    const chatId = to.includes('@') ? to : `${to.replace(/^0/, '20')}@c.us`;
    const sent = await client.sendMessage(chatId, body);
    res.json({ ok: true, id: sent.id?._serialized });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

const server = app.listen(PORT, () => console.log(`[bridge] listening on :${PORT}`));
server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'status', payload: state }));
    ws.on('close', () => clients.delete(ws));
  });
});

client.initialize();
