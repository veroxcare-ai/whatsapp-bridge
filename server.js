/* ===========================================================================
   VEROX — WhatsApp Web bridge (Baileys) — MULTI-NUMBER
   WhatsApp WEB (Linked Devices), NOT the paid Cloud API. Lightweight, no browser.
   Supports MANY WhatsApp numbers at once. Each number is its own session, stored
   separately in Supabase (`whatsapp_auth`, namespaced by session id) so it
   survives restarts with NO re-scan. The admin can add / list / remove numbers.

   Env (host secrets):
     PORT (default 8787), ALLOW_ORIGIN, SUPABASE_URL, SUPABASE_SERVICE_KEY

   API:
     GET    /                       → health
     GET    /sessions               → [{ id, label, status, me, qr }]
     POST   /sessions {label}       → add a number (starts it; QR comes via /sessions/:id + WS)
     GET    /sessions/:id           → { id, label, status, me, qr }
     DELETE /sessions/:id           → unlink + remove the number
     POST   /sessions/:id/send {to, body}
     WS     /                       → streams { type:'session'|'message', ... } for all numbers
   =========================================================================== */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
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
if (!SUPABASE_URL || !SUPABASE_KEY) console.error('[bridge] Missing SUPABASE_URL / SUPABASE_SERVICE_KEY.');
// Provide the "ws" WebSocket to Supabase realtime (required on Node < 22).
const supabase = createClient(SUPABASE_URL || '', SUPABASE_KEY || '', {
  auth: { persistSession: false },
  realtime: { transport: WebSocket }
});
const logger = P({ level: 'silent' });

// ---- message persistence (so history + conversations survive navigation/restart) ----
const textOf = (m) => m.message?.conversation || m.message?.extendedTextMessage?.text || m.message?.imageMessage?.caption || m.message?.videoMessage?.caption || '';
async function persist(rows) {
  rows = (rows || []).filter(Boolean);
  if (!rows.length) return;
  try { await supabase.from('wa_messages').upsert(rows, { onConflict: 'id' }); }
  catch (e) { console.warn('[wa] persist', e.message || e); }
}
function rowOf(sid, m) {
  const jid = m.key?.remoteJid;
  if (!jid || jid === 'status@broadcast') return null;
  const body = textOf(m);
  if (!body) return null;
  const waid = m.key.id || ('x' + Math.random().toString(36).slice(2));
  return { id: sid + '_' + waid, msg_id: waid, session_id: sid, chat_jid: jid, from_me: !!m.key.fromMe, name: m.pushName || null, body, ts: Number(m.messageTimestamp) || Math.floor(Date.now() / 1000) };
}

const app = express();
app.use(cors({ origin: ALLOW_ORIGIN }));
app.use(express.json());

// ---- WebSocket fan-out to the CRM ----
const wss = new WebSocketServer({ noServer: true });
const clients = new Set();
const broadcast = (type, payload) => { const m = JSON.stringify({ type, payload }); for (const ws of clients) { try { ws.send(m); } catch {} } };

// ---- session manager: one entry per WhatsApp number ----
const sessions = new Map(); // id -> { id, label, assigned_to, status, qr, me, sock, auth, reconnecting }
const view = (e) => ({ id: e.id, label: e.label, assigned_to: e.assigned_to || null, status: e.status, me: e.me, qr: e.qr });

async function startSession(id, label, assignedTo) {
  let e = sessions.get(id);
  if (!e) { e = { id, label: label || id, assigned_to: assignedTo || null, status: 'starting', qr: null, me: null, sock: null, reconnecting: false }; sessions.set(id, e); }
  if (label) e.label = label;
  if (assignedTo !== undefined) e.assigned_to = assignedTo;
  if (e.sock) return e;

  const auth = await useSupabaseAuthState(supabase, id);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version, logger,
    auth: { creds: auth.state.creds, keys: makeCacheableSignalKeyStore(auth.state.keys, logger) },
    printQRInTerminal: false, browser: ['VEROX CRM', 'Chrome', '2.0'],
    markOnlineOnConnect: false, syncFullHistory: true
  });
  e.sock = sock; e.auth = auth;

  sock.ev.on('creds.update', auth.saveCreds);
  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) { e.status = 'qr'; e.qr = await qrcode.toDataURL(qr); broadcast('session', view(e)); }
    if (connection === 'open') { e.status = 'ready'; e.qr = null; e.me = sock.user?.id || null; broadcast('session', view(e)); console.log(`[wa:${id}] connected as`, e.me); }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      e.sock = null;
      if (code === DisconnectReason.loggedOut) { e.status = 'logged_out'; e.me = null; await e.auth.clearAll(); broadcast('session', view(e)); return; }
      e.status = 'disconnected'; broadcast('session', view(e));
      if (!e.reconnecting) { e.reconnecting = true; setTimeout(() => { e.reconnecting = false; startSession(id).catch(err => console.error(`[wa:${id}] restart`, err)); }, 3000); }
    }
  });
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify' && type !== 'append') return;
    const rows = [];
    for (const m of messages) {
      const text = textOf(m); const jid = m.key?.remoteJid;
      if (!jid || jid === 'status@broadcast' || !text) continue;
      broadcast('message', { sessionId: id, id: m.key.id, from: jid, fromMe: !!m.key.fromMe, name: m.pushName || null, text, timestamp: Number(m.messageTimestamp) });
      rows.push(rowOf(id, m));
    }
    persist(rows);
  });

  // recent history WhatsApp syncs to a newly-linked device
  sock.ev.on('messaging-history.set', ({ messages }) => {
    if (!messages || !messages.length) return;
    persist(messages.map(m => rowOf(id, m))).then(() => broadcast('history', { sessionId: id }));
  });
  return e;
}

async function loadRegistry() {
  const { data, error } = await supabase.from('whatsapp_numbers').select('*');
  if (error) { console.warn('[bridge] registry load:', error.message); return; }
  for (const r of (data || [])) startSession(r.id, r.label, r.assigned_to).catch(e => console.error('[wa] start', r.id, e));
}

// ---- HTTP API ----
app.get('/', (_q, res) => res.json({ ok: true, service: 'verox-whatsapp-bridge', numbers: sessions.size }));

app.get('/sessions', (_q, res) => res.json([...sessions.values()].map(view)));

app.post('/sessions', async (req, res) => {
  try {
    const label = (req.body?.label || 'رقم واتساب').toString().slice(0, 60);
    const assigned_to = req.body?.assigned_to || null;
    const id = 'wa_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const { error } = await supabase.from('whatsapp_numbers').insert({ id, label, assigned_to });
    if (error) throw new Error(error.message);
    const e = await startSession(id, label, assigned_to);
    res.json({ ok: true, session: view(e) });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// reassign / rename a number
app.patch('/sessions/:id', async (req, res) => {
  try {
    const patch = {};
    if (req.body?.label !== undefined) patch.label = String(req.body.label).slice(0, 60);
    if (req.body?.assigned_to !== undefined) patch.assigned_to = req.body.assigned_to || null;
    const { error } = await supabase.from('whatsapp_numbers').update(patch).eq('id', req.params.id);
    if (error) throw new Error(error.message);
    const e = sessions.get(req.params.id);
    if (e) { if (patch.label !== undefined) e.label = patch.label; if (patch.assigned_to !== undefined) e.assigned_to = patch.assigned_to; broadcast('session', view(e)); }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.get('/sessions/:id', (req, res) => {
  const e = sessions.get(req.params.id);
  if (!e) return res.status(404).json({ error: 'not found' });
  res.json(view(e));
});

app.delete('/sessions/:id', async (req, res) => {
  try {
    const e = sessions.get(req.params.id);
    if (e) { try { await e.sock?.logout(); } catch {} try { await e.auth?.clearAll(); } catch {} sessions.delete(e.id); }
    await supabase.from('whatsapp_numbers').delete().eq('id', req.params.id);
    broadcast('session_removed', { id: req.params.id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.post('/sessions/:id/send', async (req, res) => {
  try {
    const e = sessions.get(req.params.id);
    if (!e || !e.sock) throw new Error('number not connected');
    const { to, body } = req.body || {};
    const jid = String(to).includes('@') ? to : `${String(to).replace(/^0/, '20')}@s.whatsapp.net`;
    const sent = await e.sock.sendMessage(jid, { text: body });
    const waid = sent?.key?.id || ('s' + Date.now());
    persist([{ id: e.id + '_' + waid, msg_id: waid, session_id: e.id, chat_jid: jid, from_me: true, name: null, body, ts: Math.floor(Date.now() / 1000) }]);
    res.json({ ok: true, id: waid });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// stored messages for a number (history + persistence)
app.get('/messages', async (req, res) => {
  try {
    const session = req.query.session;
    const limit = Math.min(parseInt(req.query.limit) || 1000, 5000);
    let q = supabase.from('wa_messages').select('*').order('ts', { ascending: true }).limit(limit);
    if (session) q = q.eq('session_id', session);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

const server = app.listen(PORT, () => console.log(`[bridge] listening on :${PORT}`));
server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'sessions', payload: [...sessions.values()].map(view) }));
    ws.on('close', () => clients.delete(ws));
  });
});

loadRegistry().catch((e) => console.error('[bridge] registry', e));
