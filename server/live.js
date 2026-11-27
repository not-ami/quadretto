// Live tra dispositivi e persone (2026-11-24, punti 7-9 del piano): WebSocket sulla stessa porta del server,
// un documento Yjs per appunto aperto («stanza»), presenza (awareness) e avvisi leggeri per gli elenchi.
//
// Protocollo (un solo WebSocket per scheda, su /api/live):
//   testo JSON  client → server  { t:'join', id } · { t:'leave', id }
//               server → client  { t:'joined', id, role } · { t:'error', id, code, msg } · { t:'revoked', id }
//                                { t:'role', id, role } · { t:'changed', id, rev }   ← l'appunto è cambiato (elenchi)
//   binario     [varUint tipo][varString id appunto][contenuto]
//               tipo 0 = sync di Yjs (y-protocols: passo 1, passo 2, aggiornamento) · tipo 1 = awareness (presenza)
//
// Il server è l'unico che converte un appunto vecchio (blocks JSON) in documento Yjs: se lo facessero due client,
// fondendo le due conversioni ogni blocco comparirebbe due volte.
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { WebSocketServer } from 'ws';
import { makeY, plainOf } from '../public/js/ydoc.js';

const { toY, fromY } = makeY(Y);
const MSG_SYNC = 0, MSG_AWARENESS = 1;
const DERIVE_MS = 800;          // dopo quanto si aggiornano blocks/plain di notes
const COMPACT_EVERY = 200;      // aggiornamenti dopo i quali si compatta lo stato
const IDLE_MS = 60_000;         // stanza senza nessuno: si salva e si chiude
const VERSION_MS = 10 * 60e3;   // cronologia: una copia ogni 10 minuti di lavoro
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function startLive({ server, q, userFromRequest, noteRole, originOk, log = console }) {
  const rooms = new Map();   // id appunto → stanza
  const conns = new Set();   // connessioni aperte
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });

  // --- stanze ---------------------------------------------------------------------------------------------------
  function getRoom(id) {
    let r = rooms.get(id);
    if (r) { clearTimeout(r.idleT); return r.ready; }
    r = { id, doc: new Y.Doc({ gc: true }), conns: new Set(), lastSeq: 0, sinceCompact: 0, queue: Promise.resolve(), lastAuthor: null, deriveT: 0, idleT: 0 };
    r.aw = new awarenessProtocol.Awareness(r.doc);
    r.aw.setLocalState(null); // il server non è un partecipante
    rooms.set(id, r);
    r.ready = load(r).then(() => r, (e) => { rooms.delete(id); r.aw.destroy(); throw e; });
    return r.ready;
  }

  async function load(r) {
    const st = (await q('select state, seq, gen from note_ydoc where note_id = $1', [r.id])).rows[0];
    if (st) {
      Y.applyUpdate(r.doc, st.state, 'load');
      r.lastSeq = Number(st.seq); r.gen = st.gen;
      const ups = await q('select seq, update from note_yupdates where note_id = $1 and seq > $2 order by seq', [r.id, r.lastSeq]);
      for (const u of ups.rows) { Y.applyUpdate(r.doc, u.update, 'load'); r.lastSeq = Number(u.seq); }
      r.sinceCompact = ups.rowCount;
    } else {
      // migrazione: appunto vecchio → documento Yjs, la prima volta che qualcuno lo apre
      const n = (await q('select title, blocks, paper, tags from notes where id = $1', [r.id])).rows[0];
      if (!n) throw Object.assign(new Error('Appunto non trovato'), { status: 404 });
      toY(r.doc, n, 'load');
      r.gen = (await q('insert into note_ydoc (note_id, state, seq) values ($1, $2, 0) on conflict (note_id) do update set note_id = excluded.note_id returning gen', [r.id, Buffer.from(Y.encodeStateAsUpdate(r.doc))])).rows[0].gen;
      log.log(`[live] appunto ${r.id} convertito in documento Yjs`);
    }
    r.doc.on('update', (update, origin) => onUpdate(r, update, origin));
    r.aw.on('update', (chg, origin) => onAwareness(r, chg, origin));
  }

  function onUpdate(r, update, origin) {
    if (origin === 'load') return;
    const conn = origin && origin.ws ? origin : null;
    const uid = conn ? conn.user.id : origin?.userId || null;
    if (uid) r.lastAuthor = uid;
    // in ordine: prima si scrive, poi si compatta
    r.queue = r.queue.then(async () => {
      const ins = await q('insert into note_yupdates (note_id, update, user_id) values ($1, $2, $3) returning seq', [r.id, Buffer.from(update), uid]);
      r.lastSeq = Number(ins.rows[0].seq);
      if (++r.sinceCompact >= COMPACT_EVERY) await compact(r);
    }).catch((e) => log.error('[live] salvataggio', r.id, e.message));
    const msg = frame(MSG_SYNC, r.id, (enc) => syncProtocol.writeUpdate(enc, update));
    for (const c of r.conns) if (c !== conn) sendBin(c, msg);
    clearTimeout(r.deriveT);
    r.deriveT = setTimeout(() => derive(r).catch((e) => log.error('[live] derive', r.id, e.message)), DERIVE_MS);
  }

  async function compact(r) {
    const state = Buffer.from(Y.encodeStateAsUpdate(r.doc));
    const seq = r.lastSeq;
    await q(`insert into note_ydoc (note_id, state, seq, updated_at) values ($1, $2, $3, now())
      on conflict (note_id) do update set state = excluded.state, seq = excluded.seq, updated_at = now()`, [r.id, state, seq]);
    await q('delete from note_yupdates where note_id = $1 and seq <= $2', [r.id, seq]);
    r.sinceCompact = 0;
  }

  // Dal documento Yjs alle colonne di notes: ricerca, cronologia, cestino, backup ed esportazioni restano come prima
  async function derive(r) {
    clearTimeout(r.deriveT); r.deriveT = 0;
    const n = fromY(r.doc);
    const blocks = JSON.stringify(n.blocks);
    const cur = (await q('select rev, title, blocks, (select max(saved_at) from note_versions v where v.note_id = notes.id) as last_v from notes where id = $1', [r.id])).rows[0];
    if (!cur) return null;
    if (cur.title === n.title.slice(0, 300) && JSON.stringify(cur.blocks) === blocks) return null; // niente di nuovo (es. solo chiavi dei tratti)
    if (!cur.last_v || Date.now() - new Date(cur.last_v) > VERSION_MS) {
      await q('insert into note_versions (note_id, rev, title, blocks, user_id) values ($1,$2,$3,$4,$5)', [r.id, cur.rev, cur.title, JSON.stringify(cur.blocks), r.lastAuthor]);
      await q(`delete from note_versions where note_id = $1 and id not in (select id from note_versions where note_id = $1 order by saved_at desc limit 50)`, [r.id]);
    }
    const has_ink = n.blocks.some((b) => b.type === 'ink' && b.strokes?.length);
    const up = await q(`update notes set title = $2, blocks = $3, plain = $4, has_ink = $5, paper = $6, tags = $7, updated_at = now(), rev = rev + 1
      where id = $1 returning rev, user_id`, [r.id, n.title.slice(0, 300), blocks, plainOf(n).slice(0, 200000), has_ink, n.paper || 'grid', (n.tags || []).slice(0, 30).map(String)]);
    const row = up.rows[0];
    if (row) notifyReaders(r.id, { t: 'changed', id: r.id, rev: row.rev });
    return row;
  }

  async function readersOf(noteId) {
    const r = await q(`select n.user_id as id from notes n where n.id = $1
      union select s.grantee_id from shares s join notes n on n.user_id = s.owner_id
        and ((s.kind in ('note','repo') and s.target_id = n.id) or (s.kind = 'notebook' and s.target_id = n.notebook_id))
       where n.id = $1`, [noteId]);
    return new Set(r.rows.map((x) => x.id));
  }
  async function notifyReaders(noteId, msg) {
    try { notify(await readersOf(noteId), msg); } catch (e) { log.error('[live] avviso', e.message); }
  }
  function notify(userIds, msg) {
    const s = JSON.stringify(msg);
    for (const c of conns) if (userIds.has(c.user.id) && c.ws.readyState === 1) c.ws.send(s);
  }

  function onAwareness(r, { added, updated, removed }, origin) {
    const conn = origin && origin.ws ? origin : null;
    if (conn) {
      const mine = conn.awIds.get(r.id) || new Set();
      conn.awIds.set(r.id, mine);
      for (const id of added) mine.add(id);
      for (const id of removed) mine.delete(id);
      // chi sei lo dice il server, non il client: nome e id vengono dalla sessione
      for (const id of [...added, ...updated]) {
        const st = r.aw.getStates().get(id);
        if (st) st.user = { ...(st.user || {}), id: conn.user.id, name: conn.user.display_name || conn.user.username, username: conn.user.username, role: conn.rooms.get(r.id) || 'read' };
      }
    }
    const changed = [...added, ...updated, ...removed];
    const msg = frame(MSG_AWARENESS, r.id, (enc) => encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(r.aw, changed)));
    for (const c of r.conns) if (c !== conn) sendBin(c, msg);
  }

  function leave(conn, id) {
    const r = rooms.get(id);
    conn.rooms.delete(id);
    if (!r) return;
    r.conns.delete(conn);
    const ids = conn.awIds.get(id);
    conn.awIds.delete(id);
    if (ids?.size) awarenessProtocol.removeAwarenessStates(r.aw, [...ids], null);
    if (!r.conns.size) r.idleT = setTimeout(() => unload(r), IDLE_MS);
  }

  async function unload(r) {
    if (r.conns.size) return;
    rooms.delete(r.id);
    try {
      if (r.deriveT) await derive(r);
      await r.queue;
      if (r.sinceCompact) await compact(r);
    } catch (e) { log.error('[live] chiusura stanza', r.id, e.message); }
    r.aw.destroy(); r.doc.destroy();
  }

  // --- messaggi ---------------------------------------------------------------------------------------------------
  function frame(type, id, fill) {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, type);
    encoding.writeVarString(enc, id);
    fill(enc);
    return encoding.toUint8Array(enc);
  }
  const sendBin = (c, data) => { if (c.ws.readyState === 1) c.ws.send(data, { binary: true }); };
  const sendJson = (c, obj) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(obj)); };

  async function join(conn, id) {
    if (!UUID.test(id || '')) return sendJson(conn, { t: 'error', id, code: 400, msg: 'Id non valido' });
    const role = await noteRole(conn.user.id, id);
    if (!role) return sendJson(conn, { t: 'error', id, code: 404, msg: 'Appunto non trovato' });
    const r = await getRoom(id);
    if (conn.ws.readyState !== 1) return;
    conn.rooms.set(id, role);
    r.conns.add(conn);
    sendJson(conn, { t: 'joined', id, role, gen: r.gen });
    // il server manda il suo stato (passo 1: «cosa ti manca?») e chi c'è già
    sendBin(conn, frame(MSG_SYNC, id, (enc) => syncProtocol.writeSyncStep1(enc, r.doc)));
    const ids = [...r.aw.getStates().keys()];
    if (ids.length) sendBin(conn, frame(MSG_AWARENESS, id, (enc) => encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(r.aw, ids))));
  }

  async function onBinary(conn, data) {
    const dec = decoding.createDecoder(new Uint8Array(data));
    const type = decoding.readVarUint(dec);
    const id = decoding.readVarString(dec);
    const role = conn.rooms.get(id);
    const r = rooms.get(id);
    if (!role || !r) return; // non sei nella stanza (o ti è stato tolto il permesso)
    await r.ready;
    if (type === MSG_SYNC) {
      const sub = decoding.readVarUint(dec);
      if (sub === syncProtocol.messageYjsSyncStep1) {
        const sv = decoding.readVarUint8Array(dec);
        sendBin(conn, frame(MSG_SYNC, id, (enc) => { encoding.writeVarUint(enc, syncProtocol.messageYjsSyncStep2); encoding.writeVarUint8Array(enc, Y.encodeStateAsUpdate(r.doc, sv)); }));
      } else if (sub === syncProtocol.messageYjsSyncStep2 || sub === syncProtocol.messageYjsUpdate) {
        const update = decoding.readVarUint8Array(dec);
        if (role === 'read') return sendJson(conn, { t: 'error', id, code: 403, msg: 'Hai solo il permesso di leggere questo appunto' });
        Y.applyUpdate(r.doc, update, conn);
      }
    } else if (type === MSG_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(r.aw, decoding.readVarUint8Array(dec), conn);
    }
  }

  server.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/api/live') { socket.destroy(); return; }
    const refuse = (code, msg) => { socket.write(`HTTP/1.1 ${code} ${msg}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); socket.destroy(); };
    // difesa CSRF del WebSocket: il browser manda sempre Origin, e deve essere l'app stessa
    if (!originOk(req)) return refuse(403, 'Forbidden');
    let user;
    try { user = await userFromRequest(req); } catch { return refuse(500, 'Error'); }
    if (!user) return refuse(401, 'Unauthorized');
    wss.handleUpgrade(req, socket, head, (ws) => {
      const conn = { ws, user, rooms: new Map(), awIds: new Map(), alive: true };
      conns.add(conn);
      ws.on('pong', () => { conn.alive = true; });
      ws.on('message', (data, isBinary) => {
        if (isBinary) { onBinary(conn, data).catch((e) => log.error('[live] messaggio', e.message)); return; }
        let m; try { m = JSON.parse(String(data)); } catch { return; }
        if (m.t === 'join') join(conn, m.id).catch((e) => sendJson(conn, { t: 'error', id: m.id, code: e.status || 500, msg: e.status ? e.message : 'Errore del server' }));
        else if (m.t === 'leave') leave(conn, m.id);
      });
      ws.on('close', () => { conns.delete(conn); for (const id of [...conn.rooms.keys()]) leave(conn, id); });
      ws.on('error', () => {});
    });
  });
  // le connessioni morte (iPad in standby, rete persa) si chiudono da sole
  const ping = setInterval(() => { for (const c of conns) { if (!c.alive) { c.ws.terminate(); continue; } c.alive = false; try { c.ws.ping(); } catch {} } }, 30_000);
  ping.unref?.();

  // --- per le API -------------------------------------------------------------------------------------------------
  return {
    // l'appunto ha già il documento Yjs? (allora un PUT si fonde nel documento invece di sovrascrivere le colonne)
    async isY(id) { return rooms.has(id) || (await q('select 1 from note_ydoc where note_id = $1', [id])).rowCount > 0; },
    // PUT di un client vecchio (o della coda offline): l'appunto intero si fonde nel documento come modifiche minime
    async applyJson(id, note, userId) {
      const r = await getRoom(id);
      toY(r.doc, { title: note.title || '', paper: note.paper || 'grid', tags: Array.isArray(note.tags) ? note.tags : [], blocks: Array.isArray(note.blocks) ? note.blocks : [] }, { userId });
      if (!r.conns.size) r.idleT = setTimeout(() => unload(r), IDLE_MS);
      await r.queue;
      return derive(r);
    },
    // PATCH del titolo o delle etichette: anche nel documento, altrimenti il prossimo derive li rimetterebbe com'erano
    async patchMeta(id, fields, userId) {
      const r = await getRoom(id);
      const cur = fromY(r.doc);
      toY(r.doc, { ...cur, ...('title' in fields ? { title: String(fields.title || '') } : {}), ...('tags' in fields ? { tags: fields.tags || [] } : {}) }, { userId });
      if (!r.conns.size) r.idleT = setTimeout(() => unload(r), IDLE_MS);
      await r.queue;
      await derive(r);
    },
    // dopo un cambio di condivisione: chi non può più leggere esce subito (e il suo WebSocket si chiude)
    async recheck(userId) {
      for (const c of [...conns]) {
        if (c.user.id !== userId) continue;
        let kicked = false;
        for (const [id, role] of [...c.rooms]) {
          const now = await noteRole(userId, id);
          if (!now) { sendJson(c, { t: 'revoked', id }); leave(c, id); kicked = true; }
          else if (now !== role) { c.rooms.set(id, now); sendJson(c, { t: 'role', id, role: now }); }
        }
        if (kicked) setTimeout(() => c.ws.close(4403, 'revoked'), 50);
      }
    },
    // sessione chiusa (Esci, cambio password): i suoi WebSocket si chiudono subito
    dropSessions(match) { for (const c of [...conns]) if (match(c.user.session, c.user.id)) c.ws.close(4401, 'logout'); },
    notify, notifyReaders, readersOf,
    forget(id) { const r = rooms.get(id); if (!r) return; for (const c of r.conns) { sendJson(c, { t: 'revoked', id }); c.rooms.delete(id); } rooms.delete(id); clearTimeout(r.deriveT); clearTimeout(r.idleT); r.aw.destroy(); r.doc.destroy(); },
    stats: () => ({ rooms: rooms.size, conns: conns.size }),
    async close() {
      clearInterval(ping);
      for (const c of conns) c.ws.close(1001, 'restart');
      await Promise.all([...rooms.values()].map(async (r) => { r.conns.clear(); clearTimeout(r.idleT); await unload(r); }));
    },
  };
}
