/* ===========================================================================
   VEROX bridge — Baileys auth state stored in Supabase.
   This is what keeps the WhatsApp session alive: the credentials/keys live in
   the `whatsapp_auth` table (jsonb), not on the server's disk. So when the host
   restarts, sleeps/wakes, or redeploys, the bridge reconnects to the SAME
   WhatsApp session — no QR re-scan.
   The table is written with the SERVICE key (server-side only) and is NOT
   readable by the public anon key (see supabase/whatsapp-auth.sql).
   =========================================================================== */
import { initAuthCreds, BufferJSON, proto } from '@whiskeysockets/baileys';

export async function useSupabaseAuthState(supabase, sessionId = 'verox') {
  const TABLE = 'whatsapp_auth';
  const rowId = (k) => `${sessionId}:${k}`;

  const readData = async (k) => {
    const { data, error } = await supabase.from(TABLE).select('data').eq('id', rowId(k)).maybeSingle();
    if (error || !data) return null;
    return JSON.parse(JSON.stringify(data.data), BufferJSON.reviver);
  };
  const writeData = async (k, value) => {
    const data = JSON.parse(JSON.stringify(value, BufferJSON.replacer));
    const { error } = await supabase.from(TABLE).upsert({ id: rowId(k), data, updated_at: new Date().toISOString() });
    if (error) console.warn('[auth] write', k, error.message);
  };
  const removeData = async (k) => { await supabase.from(TABLE).delete().eq('id', rowId(k)); };

  const creds = (await readData('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const out = {};
          await Promise.all(ids.map(async (id) => {
            let value = await readData(`${type}-${id}`);
            if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
            out[id] = value || undefined;
          }));
          return out;
        },
        set: async (data) => {
          const tasks = [];
          for (const type in data) {
            for (const id in data[type]) {
              const value = data[type][id];
              const k = `${type}-${id}`;
              tasks.push(value ? writeData(k, value) : removeData(k));
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: () => writeData('creds', creds),
    clearAll: async () => { await supabase.from(TABLE).delete().like('id', `${sessionId}:%`); }
  };
}
