// Federazione tra server Quadretto — PROTOTIPO (2026-11-24, punto 10 del piano). Spenta se non c'è FEDERATION_NAME.
//
// Idea (progetto completo in MEMORY/sincronizzazione/2026-11-25-Federazione-Progetto-E-Prototipo.md):
//   - ogni server ha un nome (FEDERATION_NAME, es. quadretto.esempio.ts.net:8791) e una coppia di chiavi Ed25519;
//     la chiave pubblica è a /.well-known/quadretto
//   - le richieste tra server sono firmate (Ed25519 su metodo, percorso, ora e sha256 del corpo) e valgono 5 minuti
//   - si parla solo con i server elencati in FEDERATION_PEERS (scelta dell'utente: per ora solo la sua tailnet)
//   - l'appunto vive sul server del proprietario, che resta l'autorità: l'ospite riceve un invito con un permesso
//     delegato (token casuale, scadenza) e legge passando dal SUO server, che firma la richiesta
// In questo prototipo: invito «nome@server» → «Condivisi con me» sull'altro server → lettura dell'appunto (sola lettura).
// Il live tra server (WebSocket inoltrato dal server dell'ospite) è la fase successiva, non fatta.
import crypto from 'node:crypto';

const NAME = String(process.env.FEDERATION_NAME || '').trim().toLowerCase();
const PEERS = new Set(String(process.env.FEDERATION_PEERS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
const SCHEME = process.env.FEDERATION_INSECURE === '1' ? 'http' : 'https'; // http solo per le prove in locale
const MAX_SKEW = 5 * 60;
let keys = null, VERSION = '';
const peerKeys = new Map(); // server → { key, at }

export const enabled = () => !!NAME;
export function wellKnown() {
  if (!NAME || !keys) return { app: 'quadretto', federation: false };
  return { app: 'quadretto', federation: true, version: VERSION, name: NAME, key: keys.pub, alg: 'ed25519' };
}

// Indirizzo «utente@server»: il server è un nome di host con porta facoltativa
export function parseAddress(s) {
  const m = /^([a-z0-9][a-z0-9._-]{1,31})@([a-z0-9.-]+(?::\d{2,5})?)$/.exec(String(s || '').trim().toLowerCase());
  return m ? { user: m[1], server: m[2] } : null;
}

const sha = (b) => crypto.createHash('sha256').update(b || '').digest('base64');
const toSign = (method, p, ts, body) => `${method.toUpperCase()}\n${p}\n${ts}\n${sha(body)}`;

export function sign(method, p, body = '') {
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.sign(null, Buffer.from(toSign(method, p, ts, body)), keys.priv).toString('base64');
  return `server=${NAME},ts=${ts},sig=${sig}`;
}

async function keyOf(server) {
  const c = peerKeys.get(server);
  if (c && Date.now() - c.at < 3600e3) return c.key;
  const r = await fetch(`${SCHEME}://${server}/.well-known/quadretto`, { signal: AbortSignal.timeout(8000) });
  const w = await r.json();
  if (!w.federation || w.name !== server || w.alg !== 'ed25519') throw new Error('server senza federazione');
  const key = crypto.createPublicKey({ key: Buffer.from(w.key, 'base64'), format: 'der', type: 'spki' });
  peerKeys.set(server, { key, at: Date.now() });
  return key;
}

// Controlla la firma di una richiesta arrivata da un altro server; restituisce il nome del server
export async function verify(req, body) {
  const h = String(req.headers['x-quadretto-sig'] || '');
  const f = Object.fromEntries(h.split(',').map((x) => { const i = x.indexOf('='); return [x.slice(0, i), x.slice(i + 1)]; }));
  const server = String(f.server || '').toLowerCase();
  if (!server || !PEERS.has(server)) throw Object.assign(new Error('Server non ammesso'), { status: 403 });
  const ts = Number(f.ts);
  if (!(Math.abs(Date.now() / 1000 - ts) <= MAX_SKEW)) throw Object.assign(new Error('Firma scaduta'), { status: 401 });
  const p = new URL(req.url, 'http://x').pathname;
  const ok = crypto.verify(null, Buffer.from(toSign(req.method, p, ts, body)), await keyOf(server), Buffer.from(f.sig || '', 'base64'));
  if (!ok) throw Object.assign(new Error('Firma non valida'), { status: 401 });
  return server;
}

async function call(server, method, p, obj, extra = {}) {
  if (!PEERS.has(server)) throw Object.assign(new Error(`Il server ${server} non è tra quelli ammessi (FEDERATION_PEERS)`), { status: 403 });
  const body = obj === undefined ? '' : JSON.stringify(obj);
  const r = await fetch(`${SCHEME}://${server}${p}`, {
    method, body: body || undefined, signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', 'X-Quadretto': '1', 'X-Quadretto-Sig': sign(method, p, body), ...extra },
  }).catch(() => { throw Object.assign(new Error(`Il server ${server} non risponde`), { status: 502 }); });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error(data?.error || `${server}: errore ${r.status}`), { status: r.status === 404 ? 404 : 502 });
  return data;
}

export async function init({ q, VERSION: v, route, bad, notFound, can }) {
  VERSION = v;
  if (!NAME) return;
  let row = (await q('select pub, priv from fed_keys where id = 1')).rows[0];
  if (!row) {
    const kp = crypto.generateKeyPairSync('ed25519');
    row = { pub: kp.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'), priv: kp.privateKey.export({ format: 'pem', type: 'pkcs8' }) };
    await q('insert into fed_keys (id, pub, priv) values (1, $1, $2) on conflict (id) do nothing', [row.pub, row.priv]);
    row = (await q('select pub, priv from fed_keys where id = 1')).rows[0];
  }
  keys = { pub: row.pub, priv: crypto.createPrivateKey(row.priv) };
  console.log(`[federazione] attiva come ${NAME}; server ammessi: ${[...PEERS].join(', ') || 'nessuno'}`);

  const readBody = (req) => new Promise((res, rej) => { const c = []; let n = 0; req.on('data', (d) => { n += d.length; if (n > 2e6) { rej(Object.assign(new Error('Troppo grande'), { status: 413 })); req.destroy(); } else c.push(d); }); req.on('end', () => res(Buffer.concat(c).toString('utf8'))); req.on('error', rej); });

  // 1) il proprietario invita «utente@altro-server» (solo lettura nel prototipo)
  route('POST', '/api/fed/shares', async (req) => {
    const b = JSON.parse(await readBody(req) || '{}');
    const to = parseAddress(b.address);
    if (!to) throw bad('Indirizzo non valido: scrivi nome@server, per esempio mario@quadretto.esempio.ts.net');
    if (to.server === NAME) throw bad('È questo server: condividi con il nome dell\'account e basta');
    if (b.kind !== 'note') throw bad('Nel prototipo si condivide con un altro server solo un appunto');
    await can(req.user, 'own', 'note', b.target_id);
    const n = (await q('select title from notes where id = $1', [b.target_id])).rows[0];
    const token = crypto.randomBytes(32).toString('base64url');
    const ins = await q(`insert into fed_shares (owner_id, kind, target_id, remote_user, remote_server, role, token_hash, expires_at)
      values ($1, 'note', $2, $3, $4, 'read', $5, now() + interval '30 days') returning id, expires_at`, [req.user.id, b.target_id, to.user, to.server, sha(token)]);
    try {
      await call(to.server, 'POST', '/api/fed/inbox', { type: 'invite', from: `${req.user.username}@${NAME}`, to: to.user, kind: 'note', target_id: b.target_id, title: n?.title || '', role: 'read', token, expires_at: ins.rows[0].expires_at });
    } catch (e) { await q('delete from fed_shares where id = $1', [ins.rows[0].id]); throw e; }
    return { ok: true, id: ins.rows[0].id };
  });

  // 2) il server dell'ospite riceve l'invito (richiesta firmata) e lo mette in «Condivisi con me»
  route('POST', '/api/fed/inbox', async (req) => {
    const raw = await readBody(req);
    const server = await verify(req, raw);
    const b = JSON.parse(raw || '{}');
    const from = parseAddress(b.from);
    if (b.type !== 'invite' || !from || from.server !== server) throw bad('Invito non valido');
    const u = (await q('select id from users where username = $1', [String(b.to || '')])).rows[0];
    if (!u) throw notFound('Nessun account con questo nome su questo server');
    await q(`insert into fed_inbox (user_id, from_addr, server, kind, target_id, title, role, token, expires_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      on conflict (user_id, server, target_id) do update set title = excluded.title, role = excluded.role, token = excluded.token, expires_at = excluded.expires_at`,
      [u.id, b.from, server, b.kind, b.target_id, String(b.title || '').slice(0, 300), b.role === 'edit' ? 'edit' : 'read', String(b.token || ''), b.expires_at]);
    return { ok: true };
  }, { public: true });

  route('GET', '/api/fed/inbox', async (req) => (await q(`select id, from_addr, server, kind, target_id, title, role, created_at, expires_at from fed_inbox
    where user_id = $1 and expires_at > now() order by created_at desc`, [req.user.id])).rows);

  // 3) l'ospite apre l'appunto: il SUO server firma la richiesta verso il server del proprietario, con il permesso delegato
  route('GET', '/api/fed/remote/:id', async (req, p) => {
    const inv = (await q('select server, target_id, token from fed_inbox where id = $1 and user_id = $2 and expires_at > now()', [p.id, req.user.id])).rows[0];
    if (!inv) throw notFound('Invito non trovato o scaduto');
    return call(inv.server, 'GET', `/api/fed/doc/${inv.target_id}`, undefined, { 'X-Quadretto-Grant': inv.token, 'X-Quadretto-User': req.user.username });
  });

  // 4) il server del proprietario controlla firma, server e permesso delegato, e risponde con l'appunto
  route('GET', '/api/fed/doc/:id', async (req, p) => {
    const server = await verify(req, '');
    const s = (await q(`select f.target_id, f.remote_user from fed_shares f join notes n on n.id = f.target_id and n.user_id = f.owner_id
      where f.target_id = $1 and f.remote_server = $2 and f.token_hash = $3 and f.expires_at > now() and f.revoked_at is null`, [p.id, server, sha(String(req.headers['x-quadretto-grant'] || ''))])).rows[0];
    if (!s || s.remote_user !== String(req.headers['x-quadretto-user'] || '')) throw notFound('Appunto non trovato');
    const n = (await q('select id, title, blocks, paper, updated_at from notes where id = $1 and deleted_at is null', [p.id])).rows[0];
    if (!n) throw notFound('Appunto non trovato');
    return { ...n, owner_server: NAME, role: 'read' };
  }, { public: true });

  route('DELETE', '/api/fed/shares/:id', async (req, p) => {
    const r = await q('update fed_shares set revoked_at = now() where id = $1 and owner_id = $2 and revoked_at is null', [p.id, req.user.id]);
    if (!r.rowCount) throw notFound('Condivisione non trovata');
    return { ok: true };
  });
}
