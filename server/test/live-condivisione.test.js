// Prove del live (Yjs su WebSocket) e della condivisione, con un PostgreSQL vero usa e getta (2026-11-24, punti 7-10).
//   docker run -d --rm --name qlive-pg -e POSTGRES_PASSWORD=prova -p 127.0.0.1:55611:5432 postgres:17-alpine
//   docker exec qlive-pg psql -U postgres -c "create database quadretto_live"      # quadretto_fed lo crea il test
//   cd server && PGHOST=127.0.0.1 PGPORT=55611 PGUSER=postgres PGPASSWORD=prova PGDATABASE=quadretto_live node --test test/live-condivisione.test.js
// È anche la prova d'isolamento estesa: senza condivisione l'altro account non vede nulla, con «può leggere» non scrive,
// la revoca vale subito (anche sul WebSocket aperto), i link scadono e si revocano.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import WebSocket from 'ws';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { makeY } from '../../public/js/ydoc.js';

const { toY, fromY } = makeY(Y);
const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js');
const PG = ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'];
if (!process.env.PGDATABASE) throw new Error('Imposta PGHOST, PGPORT, PGUSER, PGPASSWORD e PGDATABASE di un database di prova');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function avvia(env = {}, port = 21000 + Math.floor(Math.random() * 20000)) {
  const base = Object.fromEntries(PG.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
  const proc = spawn(process.execPath, [SERVER], { env: { PATH: process.env.PATH, ...base, HOST: '127.0.0.1', PORT: String(port), OWNER_USERNAME: 'proprietario', ALLOW_SIGNUP: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) throw new Error(`Il server si è fermato:\n${log}`);
    try { if ((await fetch(`${url}/api/health`)).ok) return { url, port, proc, log: () => log }; } catch {}
    await sleep(100);
  }
  proc.kill();
  throw new Error(`Il server non risponde:\n${log}`);
}
const ferma = (s) => new Promise((r) => { if (!s || s.proc.exitCode !== null) return r(); s.proc.once('exit', r); s.proc.kill('SIGTERM'); });

function client(url) {
  const c = async (method, p, body) => {
    const headers = { 'Content-Type': 'application/json', 'X-Quadretto': '1' };
    if (c.cookie) headers.Cookie = c.cookie;
    const r = await fetch(url + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie');
    if (sc) c.cookie = sc.split(';')[0];
    const data = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
    return { status: r.status, data };
  };
  return c;
}

// Un client Yjs minimo, come quello del browser (public/js/live.js), per un appunto
function yclient(url, cookie, { origin = url } = {}) {
  const ws = new WebSocket(url.replace('http', 'ws') + '/api/live', { headers: { Cookie: cookie || '', Origin: origin } });
  const docs = new Map(), msgs = [], waiters = [];
  const frame = (type, id, fill) => { const e = encoding.createEncoder(); encoding.writeVarUint(e, type); encoding.writeVarString(e, id); fill(e); return encoding.toUint8Array(e); };
  ws.on('message', (data, bin) => {
    if (!bin) { const m = JSON.parse(String(data)); msgs.push(m); waiters.forEach((w) => w()); return; }
    const d = decoding.createDecoder(new Uint8Array(data));
    const type = decoding.readVarUint(d), id = decoding.readVarString(d);
    const doc = docs.get(id);
    if (!doc || type !== 0) return;
    const sub = decoding.readVarUint(d);
    if (sub === 0) { const sv = decoding.readVarUint8Array(d); ws.send(frame(0, id, (e) => { encoding.writeVarUint(e, 1); encoding.writeVarUint8Array(e, Y.encodeStateAsUpdate(doc, sv)); })); }
    else Y.applyUpdate(doc, decoding.readVarUint8Array(d), 'remote');
    waiters.forEach((w) => w());
  });
  const opened = new Promise((res, rej) => { ws.once('open', res); ws.once('unexpected-response', (_q, r) => rej(Object.assign(new Error('rifiutato'), { status: r.statusCode }))); ws.once('error', rej); });
  const closed = new Promise((res) => ws.once('close', (code) => res(code)));
  const until = async (fn, ms = 3000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('tempo scaduto'); await new Promise((r) => { waiters.push(r); setTimeout(r, 50); }); waiters.length = 0; } };
  return {
    ws, msgs, opened, closed, until, docs,
    async join(id) {
      const doc = new Y.Doc(); docs.set(id, doc);
      doc.on('update', (u, o) => { if (o !== 'remote' && ws.readyState === 1) ws.send(frame(0, id, (e) => { encoding.writeVarUint(e, 2); encoding.writeVarUint8Array(e, u); })); });
      ws.send(JSON.stringify({ t: 'join', id }));
      await until(() => msgs.some((m) => m.id === id && (m.t === 'joined' || m.t === 'error')));
      const m = msgs.find((x) => x.id === id && (x.t === 'joined' || x.t === 'error'));
      if (m.t === 'joined') ws.send(frame(0, id, (e) => { encoding.writeVarUint(e, 0); encoding.writeVarUint8Array(e, Y.encodeStateVector(doc)); }));
      return m;
    },
    close() { ws.close(); },
  };
}

let s, A, B, db;
const nbId = randomUUID(), noteId = randomUUID(), note2 = randomUUID();
before(async () => {
  db = new pg.Client(); await db.connect();
  for (const t of ['fed_inbox', 'fed_shares', 'links', 'shares', 'note_yupdates', 'note_ydoc', 'note_versions', 'attachments', 'notes', 'notebooks', 'sessions', 'users']) await db.query(`delete from ${t}`).catch(() => {});
  s = await avvia();
  A = client(s.url); B = client(s.url);
  assert.equal((await A('POST', '/api/auth/register', { username: 'prova-anna', password: 'password-anna', display_name: 'Anna' })).status, 200);
  assert.equal((await B('POST', '/api/auth/register', { username: 'prova-bruno', password: 'password-bruno', display_name: 'Bruno' })).status, 200);
  assert.equal((await A('POST', '/api/notebooks', { id: nbId, title: 'Sistemi Operativi' })).status, 200);
  const put = await A('PUT', `/api/notes/${noteId}`, { notebook_id: nbId, title: 'Semafori', blocks: [{ id: 'b1', type: 'text', text: 'Un semaforo conta.' }, { id: 'b2', type: 'ink', h: 800, strokes: [{ p: [10, 10, 12, 50, 50, 12], c: '#1c2333', w: 2 }] }], plain: 'Un semaforo conta.' });
  assert.equal(put.status, 200, JSON.stringify(put.data));
});
after(async () => { await ferma(s); await db.end(); });

test('isolamento: senza condivisione l\'altro account non vede nulla', async () => {
  assert.equal((await B('GET', `/api/notes/${noteId}`)).status, 404);
  assert.equal((await B('PUT', `/api/notes/${noteId}`, { title: 'rubato', blocks: [] })).status, 404);
  assert.equal((await B('PATCH', `/api/notes/${noteId}`, { title: 'rubato' })).status, 404);
  assert.equal((await B('DELETE', `/api/notes/${noteId}`)).status, 200); // come prima: «ok», ma non cancella nulla
  assert.equal((await A('GET', `/api/notes/${noteId}`)).status, 200);
  assert.equal((await B('GET', `/api/notes/${noteId}/versions`)).status, 404);
  assert.deepEqual((await B('GET', '/api/search?q=semaforo')).data, []);
  const boot = (await B('GET', '/api/bootstrap')).data;
  assert.equal(boot.notes.length, 0); assert.equal(boot.notebooks.length, 0);
  assert.equal((await B('GET', `/api/shares?kind=note&id=${noteId}`)).status, 404);
  assert.equal((await B('POST', '/api/links', { kind: 'note', target_id: noteId, days: 3 })).status, 404);
  const yb = yclient(s.url, B.cookie); await yb.opened;
  assert.equal((await yb.join(noteId)).code, 404);
  yb.close();
});

test('WebSocket: senza sessione 401, da un\'altra origine 403', async () => {
  await assert.rejects(yclient(s.url, '').opened, (e) => e.status === 401);
  await assert.rejects(yclient(s.url, A.cookie, { origin: 'http://cattivo.esempio' }).opened, (e) => e.status === 403);
});

test('live: conversione al primo accesso, due client che si fondono, colonne di notes ricavate', async () => {
  const a1 = yclient(s.url, A.cookie), a2 = yclient(s.url, A.cookie);
  await a1.opened; await a2.opened;
  assert.equal((await a1.join(noteId)).role, 'owner');
  await a1.until(() => a1.docs.get(noteId).getArray('blocks').length === 2);
  assert.equal((await db.query('select count(*)::int as n from note_ydoc where note_id = $1', [noteId])).rows[0].n, 1, 'convertito una volta');
  await a2.join(noteId);
  await a2.until(() => a2.docs.get(noteId).getArray('blocks').length === 2);
  const d1 = a1.docs.get(noteId), d2 = a2.docs.get(noteId);
  // tutte e due scrivono nello stesso momento
  const n1 = fromY(d1); n1.blocks[0].text = 'Un semaforo conta i permessi.'; n1.blocks[1].strokes.push({ p: [1, 2, 3], c: '#e2573b', w: 3 });
  const n2 = fromY(d2); n2.blocks[0].text = 'Nota: un semaforo conta.'; n2.blocks.push({ id: 'b3', type: 'text', text: 'wait e signal' });
  toY(d1, n1); toY(d2, n2);
  await a1.until(() => fromY(d1).blocks.length === 3 && fromY(d2).blocks[1].strokes.length === 2);
  assert.deepEqual(fromY(d1), fromY(d2), 'convergono');
  assert.equal(fromY(d1).blocks[0].text, 'Nota: un semaforo conta i permessi.');
  await sleep(1200); // derive
  const row = (await A('GET', `/api/notes/${noteId}`)).data;
  assert.equal(row.blocks.length, 3);
  assert.match(row.plain, /wait e signal/);
  assert.ok(row.rev > 1);
  assert.ok(a1.msgs.some((m) => m.t === 'changed' && m.id === noteId), 'avviso leggero per gli elenchi');
  // un PUT di un client vecchio si fonde nel documento (non sovrascrive le colonne a mano)
  const old = (await A('GET', `/api/notes/${noteId}`)).data;
  old.blocks[2].text = 'wait() e signal()';
  for (const st of old.blocks[1].strokes) delete st.k;
  const put = await A('PUT', `/api/notes/${noteId}`, { ...old, baseRev: old.rev });
  assert.equal(put.status, 200); assert.equal(put.data.conflict, false);
  await a1.until(() => fromY(d1).blocks[2].text === 'wait() e signal()');
  assert.equal(fromY(d1).blocks[1].strokes.length, 2, 'i tratti senza chiave si riconoscono: nessun doppione');
  assert.equal((await A('GET', '/api/search?q=signal')).data.length, 1, 'la ricerca vede il testo nuovo');
  a1.close(); a2.close();
});

test('offline: modifiche fatte senza rete si fondono al ritorno', async () => {
  const a1 = yclient(s.url, A.cookie); await a1.opened; await a1.join(noteId);
  await a1.until(() => a1.docs.get(noteId).getArray('blocks').length === 3);
  // copia «offline» dello stato, poi la connessione cade
  const off = new Y.Doc(); Y.applyUpdate(off, Y.encodeStateAsUpdate(a1.docs.get(noteId)));
  a1.close();
  const no = fromY(off); no.blocks[0].text += ' (offline)'; toY(off, no);
  // intanto un altro dispositivo modifica
  const a2 = yclient(s.url, A.cookie); await a2.opened; await a2.join(noteId);
  await a2.until(() => a2.docs.get(noteId).getArray('blocks').length === 3);
  const n2 = fromY(a2.docs.get(noteId)); n2.title = 'Semafori e mutex'; toY(a2.docs.get(noteId), n2);
  // torna la rete: il dispositivo offline si ricollega con il suo stato
  const a3 = yclient(s.url, A.cookie); await a3.opened;
  a3.docs.set('x', null);
  const m = await (async () => { const r = a3.join(noteId); return r; })();
  assert.equal(m.t, 'joined');
  Y.applyUpdate(a3.docs.get(noteId), Y.encodeStateAsUpdate(off), 'local'); // lo stato offline entra nel client → al server
  await a2.until(() => fromY(a2.docs.get(noteId)).blocks[0].text.endsWith('(offline)'));
  assert.equal(fromY(a3.docs.get(noteId)).title, 'Semafori e mutex');
  a2.close(); a3.close();
});

test('condivisione: può leggere, può modificare, revoca immediata anche sul WebSocket', async () => {
  // si cerca l'account per nome
  assert.deepEqual((await A('GET', '/api/users/find?q=prova-b')).data.map((u) => u.username), ['prova-bruno']);
  const sh = await A('POST', '/api/shares', { kind: 'note', target_id: noteId, username: 'prova-bruno', role: 'read' });
  assert.equal(sh.status, 200, JSON.stringify(sh.data));
  const got = await B('GET', `/api/notes/${noteId}`);
  assert.equal(got.status, 200); assert.equal(got.data.shared.role, 'read');
  const boot = (await B('GET', '/api/bootstrap')).data;
  assert.equal(boot.notes.length, 1); assert.equal(boot.notes[0].shared.role, 'read'); assert.equal(boot.notes[0].notebook_id, null);
  assert.equal((await B('GET', '/api/search?q=semaforo')).data.length, 1);
  assert.equal((await B('PUT', `/api/notes/${noteId}`, { ...got.data, title: 'scritto da Bruno' })).status, 403);
  assert.equal((await B('PATCH', `/api/notes/${noteId}`, { title: 'scritto da Bruno' })).status, 403);
  assert.equal((await B('PATCH', `/api/notes/${noteId}`, { pinned: true })).status, 403);
  assert.equal((await B('POST', '/api/shares', { kind: 'note', target_id: noteId, username: 'prova-anna', role: 'edit' })).status, 403);
  assert.equal((await B('GET', `/api/notes/${noteId}/versions`)).status, 200);
  // sul WebSocket con «può leggere»: vede, ma le sue modifiche vengono rifiutate
  const b = yclient(s.url, B.cookie); await b.opened;
  assert.equal((await b.join(noteId)).role, 'read');
  const db1 = b.docs.get(noteId);
  await b.until(() => db1.getArray('blocks').length === 3);
  const nb = fromY(db1); nb.blocks[0].text = 'BRUNO'; toY(db1, nb);
  await b.until(() => b.msgs.some((m) => m.t === 'error' && m.code === 403));
  await sleep(300);
  assert.notEqual((await A('GET', `/api/notes/${noteId}`)).data.blocks[0].text, 'BRUNO', 'la scrittura non è passata');
  b.close();
  // può modificare: le modifiche arrivano ad Anna in diretta
  await A('POST', '/api/shares', { kind: 'note', target_id: noteId, username: 'prova-bruno', role: 'edit' });
  const a = yclient(s.url, A.cookie); await a.opened; await a.join(noteId);
  const b2 = yclient(s.url, B.cookie); await b2.opened;
  assert.equal((await b2.join(noteId)).role, 'edit');
  const da = a.docs.get(noteId), dbb = b2.docs.get(noteId);
  await b2.until(() => dbb.getArray('blocks').length === 3 && da.getArray('blocks').length === 3);
  const nb2 = fromY(dbb); nb2.blocks.push({ id: 'b4', type: 'text', text: 'Aggiunto da Bruno' }); toY(dbb, nb2);
  await a.until(() => fromY(da).blocks.some((x) => x.text === 'Aggiunto da Bruno'));
  await sleep(1100);
  const vers = (await A('GET', `/api/notes/${noteId}/versions`)).data;
  assert.ok(vers.length >= 1);
  // revoca: Bruno riceve «revoked» e il suo WebSocket si chiude; poi non vede più nulla
  const list = (await A('GET', `/api/shares?kind=note&id=${noteId}`)).data;
  assert.equal(list.shares.length, 1);
  assert.equal((await A('DELETE', `/api/shares/${list.shares[0].id}`)).status, 200);
  await b2.until(() => b2.msgs.some((m) => m.t === 'revoked' && m.id === noteId));
  assert.equal(await b2.closed, 4403);
  assert.equal((await B('GET', `/api/notes/${noteId}`)).status, 404);
  const b3 = yclient(s.url, B.cookie); await b3.opened;
  assert.equal((await b3.join(noteId)).code, 404);
  b3.close(); a.close();
});

test('condivisione di un quaderno: vale anche per gli appunti aggiunti dopo; un appunto nuovo di chi modifica è del proprietario', async () => {
  assert.equal((await A('POST', '/api/shares', { kind: 'notebook', target_id: nbId, username: 'prova-bruno', role: 'edit' })).status, 200);
  await A('PUT', `/api/notes/${note2}`, { notebook_id: nbId, title: 'Aggiunto dopo', blocks: [{ id: 'x', type: 'text', text: 'deadlock' }], plain: 'deadlock' });
  const boot = (await B('GET', '/api/bootstrap')).data;
  assert.ok(boot.notebooks.some((n) => n.id === nbId && n.shared.role === 'edit' && n.shared.owner === 'prova-anna'));
  assert.ok(boot.notes.some((n) => n.id === note2 && n.notebook_id === nbId));
  const mine = randomUUID();
  assert.equal((await B('PUT', `/api/notes/${mine}`, { notebook_id: nbId, title: 'Scritto da Bruno nel quaderno di Anna', blocks: [] })).status, 200);
  assert.ok((await A('GET', '/api/bootstrap')).data.notes.some((n) => n.id === mine), 'Anna lo vede: è suo');
  assert.equal((await B('PATCH', `/api/notes/${note2}`, { deleted_at: new Date().toISOString() })).status, 403, 'chi modifica non cestina');
  assert.equal((await B('DELETE', `/api/notebooks/${nbId}`)).status, 403);
  // revoca del quaderno: sparisce tutto
  const sh = (await A('GET', `/api/shares?kind=notebook&id=${nbId}`)).data.shares[0];
  await A('DELETE', `/api/shares/${sh.id}`);
  const boot2 = (await B('GET', '/api/bootstrap')).data;
  assert.equal(boot2.notes.length, 0); assert.equal(boot2.notebooks.length, 0);
});

test('allegati: si leggono solo con il permesso sull\'appunto', async () => {
  const att = randomUUID();
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  const up = await fetch(`${s.url}/api/attachments`, { method: 'POST', headers: { Cookie: A.cookie, 'X-Quadretto': '1', 'Content-Type': 'image/png', 'X-Id': att, 'X-Note-Id': noteId }, body: png });
  assert.equal(up.status, 200);
  assert.equal((await fetch(`${s.url}/api/attachments/${att}`, { headers: { Cookie: B.cookie } })).status, 404);
  const sh = await A('POST', '/api/shares', { kind: 'note', target_id: noteId, username: 'prova-bruno', role: 'read' });
  assert.equal((await fetch(`${s.url}/api/attachments/${att}`, { headers: { Cookie: B.cookie } })).status, 200);
  const upB = await fetch(`${s.url}/api/attachments`, { method: 'POST', headers: { Cookie: B.cookie, 'X-Quadretto': '1', 'Content-Type': 'image/png', 'X-Id': randomUUID(), 'X-Note-Id': noteId }, body: png });
  assert.equal(upB.status, 403, 'con «può leggere» non aggiunge foto');
  await A('DELETE', `/api/shares/${sh.data.id}`);
  assert.equal((await fetch(`${s.url}/api/attachments/${att}`, { headers: { Cookie: B.cookie } })).status, 404);
});

test('link in sola lettura: si apre senza account, scade e si revoca', async () => {
  assert.equal((await A('POST', '/api/links', { kind: 'note', target_id: noteId, days: 0 })).status, 400, 'scadenza obbligatoria');
  const l = (await A('POST', '/api/links', { kind: 'note', target_id: noteId, days: 7 })).data;
  const tok = l.path.split('/').pop();
  const pub = await fetch(`${s.url}/api/public/${tok}`);
  assert.equal(pub.status, 200);
  const body = await pub.json();
  assert.equal(body.notes[0].title, 'Semafori e mutex');
  assert.equal(body.notes[0].user_id, undefined);
  assert.equal((await fetch(`${s.url}${l.path}`)).headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal((await fetch(`${s.url}/api/public/${tok}x`)).status, 404);
  // scaduto
  await db.query(`update links set expires_at = now() - interval '1 minute' where id = $1`, [l.id]);
  assert.equal((await fetch(`${s.url}/api/public/${tok}`)).status, 404);
  // revocato
  const l2 = (await A('POST', '/api/links', { kind: 'notebook', target_id: nbId, days: 1 })).data;
  const tok2 = l2.path.split('/').pop();
  assert.equal((await (await fetch(`${s.url}/api/public/${tok2}`)).json()).notes.length, 3);
  assert.equal((await B('DELETE', `/api/links/${l2.id}`)).status, 404, 'solo chi l\'ha creato lo revoca');
  assert.equal((await A('DELETE', `/api/links/${l2.id}`)).status, 200);
  assert.equal((await fetch(`${s.url}/api/public/${tok2}`)).status, 404);
});

test('federazione (prototipo): invito firmato mario@altro-server e lettura tramite il proprio server', async () => {
  const pA = 21000 + Math.floor(Math.random() * 9000), pB = pA + 10000;
  const nA = `127.0.0.1:${pA}`, nB = `127.0.0.1:${pB}`;
  // il secondo server vuole un database suo: lo crea il test (in CI esiste solo quello di PGDATABASE)
  await db.query('create database quadretto_fed').catch((e) => { if (e.code !== '42P04') throw e; }); // 42P04: c'è già
  let fa, fb;
  try {
    // dentro il try: se il secondo non parte, il primo va spento lo stesso (se resta acceso, i test non finiscono mai)
    fa = await avvia({ FEDERATION_NAME: nA, FEDERATION_PEERS: nB, FEDERATION_INSECURE: '1' }, pA);
    fb = await avvia({ PGDATABASE: 'quadretto_fed', FEDERATION_NAME: nB, FEDERATION_PEERS: nA, FEDERATION_INSECURE: '1' }, pB);
    const wk = await (await fetch(`${fa.url}/.well-known/quadretto`)).json();
    assert.equal(wk.federation, true); assert.equal(wk.alg, 'ed25519');
    const FA = client(fa.url), FB = client(fb.url);
    await FA('POST', '/api/auth/login', { username: 'prova-anna', password: 'password-anna' });
    const reg = await FB('POST', '/api/auth/register', { username: 'mario', password: 'password-mario' });
    if (reg.status !== 200) await FB('POST', '/api/auth/login', { username: 'mario', password: 'password-mario' });
    const inv = await FA('POST', '/api/fed/shares', { kind: 'note', target_id: noteId, address: `mario@${nB}` });
    assert.equal(inv.status, 200, JSON.stringify(inv.data));
    const inbox = (await FB('GET', '/api/fed/inbox')).data;
    assert.equal(inbox[0].title, 'Semafori e mutex'); assert.equal(inbox[0].from_addr, `prova-anna@${nA}`);
    const doc = await FB('GET', `/api/fed/remote/${inbox[0].id}`);
    assert.equal(doc.status, 200, JSON.stringify(doc.data)); assert.equal(doc.data.owner_server, nA); assert.ok(doc.data.blocks.length >= 3);
    // una richiesta non firmata (o con firma falsa) al server del proprietario non passa
    assert.equal((await fetch(`${fa.url}/api/fed/doc/${noteId}`)).status, 403);
    const fake = await fetch(`${fa.url}/api/fed/doc/${noteId}`, { headers: { 'X-Quadretto-Sig': `server=${nB},ts=${Math.floor(Date.now() / 1000)},sig=AAAA` } });
    assert.equal(fake.status, 401);
    // un server non ammesso non può mandare inviti
    assert.equal((await FA('POST', '/api/fed/shares', { kind: 'note', target_id: noteId, address: 'mario@altro.esempio' })).status, 403);
  } finally { await ferma(fa); await ferma(fb); }
});

test('uscire (o cambiare password) chiude subito i WebSocket di quella sessione', async () => {
  const C = client(s.url);
  assert.equal((await C('POST', '/api/auth/login', { username: 'prova-bruno', password: 'password-bruno' })).status, 200);
  const y = yclient(s.url, C.cookie); await y.opened;
  const altro = yclient(s.url, B.cookie); await altro.opened; // un'altra sessione dello stesso account resta aperta
  assert.equal((await C('POST', '/api/auth/logout')).status, 200);
  assert.equal(await y.closed, 4401);
  assert.equal(altro.ws.readyState, 1);
  altro.close();
});
