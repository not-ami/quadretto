// Live tra dispositivi e persone, lato app (2026-11-24, punti 7-8 del piano). Vedi server/live.js per il protocollo.
//
// Come si lega all'editor senza riscriverlo: l'app continua a modificare il suo oggetto `ui.note` come prima; qui
// l'appunto si confronta con il documento Yjs (ydoc.js) e le differenze diventano modifiche CRDT. Le modifiche che
// arrivano dagli altri si mettono da parte e si applicano tutte insieme in un «punto di sincronia», che aspetta la
// penna ferma (regola di BUG-006): prima l'appunto locale entra nel documento, poi entrano gli aggiornamenti arrivati,
// poi l'appunto si riscrive dal documento. Così una modifica degli altri non viene mai annullata da un confronto fatto
// con una copia vecchia.
//
// Offline: lo stato Yjs di ogni appunto aperto almeno una volta col server sta in IndexedDB (un archivio per account,
// accanto a quello di store.js); le modifiche fatte senza rete si fondono al ritorno, senza «conflitti» da mostrare.
// Un appunto che su questo dispositivo non ha ancora uno stato Yjs (mai aperto col server) si salva come prima, con il
// PUT della coda: lo converte il server, mai il client (due conversioni fuse = blocchi doppi).
import { Y, sync as syncProtocol, awareness as awp, encoding, decoding } from '/vendor/yjs/yjs.mjs';
import { makeY, textDiff, strokeFp } from './ydoc.js';

const { toY, fromY, textOf } = makeY(Y);
const MSG_SYNC = 0, MSG_AWARENESS = 1;
const LOCAL = { local: true }, REMOTE = 'remote';
export { textDiff };

// colore stabile per persona (lo stesso su tutti i dispositivi)
const HUES = ['#e2573b', '#0f9d8a', '#8b5cf6', '#c2410c', '#0369a1', '#b4235a', '#4d7c0f', '#3657e8'];
export function colorOf(id) { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return HUES[h % HUES.length]; }
export function deviceName() {
  try { const own = localStorage.getItem('quadretto-device'); if (own) return own; } catch {}
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Browser';
}

// --- archivio locale degli stati Yjs ------------------------------------------------------------------------------
let idb = null;
function openIdb(name) {
  return new Promise((res) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('docs');
    r.onsuccess = () => res(r.result);
    r.onerror = () => res(null);
  });
}
const idbReq = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const dget = (k) => (idb ? idbReq(idb.transaction('docs').objectStore('docs').get(k)) : Promise.resolve(null));
const dput = (k, v) => (idb ? idbReq(idb.transaction('docs', 'readwrite').objectStore('docs').put(v, k)) : Promise.resolve());
const ddel = (k) => (idb ? idbReq(idb.transaction('docs', 'readwrite').objectStore('docs').delete(k)) : Promise.resolve());
const dkeys = () => (idb ? idbReq(idb.transaction('docs').objectStore('docs').getAllKeys()) : Promise.resolve([]));

class Live extends EventTarget {
  rooms = new Map();     // id appunto → stanza
  owned = new Set();     // appunti con uno stato Yjs già allineato al server (su questo dispositivo)
  status = 'off';        // off | connecting | online | offline
  ws = null;
  backoff = 1000;

  async init(user, { store, quiet, penDown }) {
    this.user = user; this.store = store; this.quiet = quiet; this.penDown = penDown;
    if (typeof WebSocket === 'undefined') return;
    idb = await openIdb(user.is_owner ? 'quadretto-live' : 'quadretto-live-' + user.id);
    for (const k of await dkeys()) this.owned.add(k);
    store.liveOwns = (id) => this.owned.has(id);
    addEventListener('online', () => this.connect());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && this.status !== 'online') this.connect(); });
    this.connect();
  }

  // --- connessione -------------------------------------------------------------------------------------------------
  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    clearTimeout(this.retryT);
    this.setStatus('connecting');
    let ws;
    try { ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live`); } catch { this.retry(); return; }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => { this.backoff = 1000; this.setStatus('online'); for (const r of this.rooms.values()) this.join(r); };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      for (const r of this.rooms.values()) { r.joined = false; r.peers = new Map(); this.firePresence(r); }
      this.setStatus('offline');
      this.retry(e.code === 4403 ? 300 : undefined);
    };
    ws.onerror = () => {};
    ws.onmessage = (e) => (typeof e.data === 'string' ? this.onJson(JSON.parse(e.data)) : this.onBinary(new Uint8Array(e.data)));
  }
  retry(ms) {
    clearTimeout(this.retryT);
    this.retryT = setTimeout(() => this.connect(), ms ?? this.backoff);
    this.backoff = Math.min(15000, this.backoff * 2); // al massimo 15 s tra un tentativo e l'altro
  }
  setStatus(s) { if (this.status === s) return; this.status = s; this.dispatchEvent(new CustomEvent('status', { detail: s })); }
  send(data) { if (this.ws?.readyState === 1) { this.ws.send(data); return true; } return false; }
  frame(type, id, fill) { const e = encoding.createEncoder(); encoding.writeVarUint(e, type); encoding.writeVarString(e, id); fill(e); return encoding.toUint8Array(e); }

  onJson(m) {
    const r = this.rooms.get(m.id);
    if (m.t === 'changed' || m.t === 'shared') { this.dispatchEvent(new CustomEvent('changed', { detail: m })); return; }
    if (!r) return;
    if (m.t === 'joined') {
      // il documento sul server è stato rifatto (es. database ripristinato): lo stato locale non si può fondere
      if (r.gen && m.gen && r.gen !== m.gen) { const hooks = r.hooks, note = hooks.get(); this.close(r.id, { forget: true }); if (note) this.open(note, hooks); return; }
      if (m.gen && r.gen !== m.gen) { r.gen = m.gen; if (r.ready) this.persist(r); }
      r.role = m.role; r.joined = true;
      // il passo 1 del client: «server, cosa mi manca?»
      this.send(this.frame(MSG_SYNC, r.id, (e) => syncProtocol.writeSyncStep1(e, r.doc)));
      if (r.ready) this.sendAwareness(r, [r.doc.clientID]);
      r.hooks.role?.(m.role);
    } else if (m.t === 'role') { r.role = m.role; r.hooks.role?.(m.role); }
    else if (m.t === 'revoked') { r.hooks.revoked?.(); this.close(r.id, { forget: true }); }
    else if (m.t === 'error') {
      if (m.code === 404 && r.waitSaved) return; // appunto nuovo non ancora sul server: si riprova dopo il primo salvataggio
      if (m.code === 403) r.hooks.readOnly?.(m.msg); else r.hooks.error?.(m);
    }
  }

  onBinary(data) {
    const d = decoding.createDecoder(data);
    const type = decoding.readVarUint(d), id = decoding.readVarString(d);
    const r = this.rooms.get(id);
    if (!r) return;
    if (type === MSG_SYNC) {
      const sub = decoding.readVarUint(d);
      if (sub === syncProtocol.messageYjsSyncStep1) {
        // il server chiede cosa ha il client: se l'appunto è già nostro si manda anche il lavoro fatto offline
        const sv = decoding.readVarUint8Array(d);
        if (r.ready) this.flushLocal(r);
        this.send(this.frame(MSG_SYNC, id, (e) => { encoding.writeVarUint(e, syncProtocol.messageYjsSyncStep2); encoding.writeVarUint8Array(e, Y.encodeStateAsUpdate(r.doc, sv)); }));
      } else {
        const u = decoding.readVarUint8Array(d);
        r.buffer.push(u);
        if (sub === syncProtocol.messageYjsSyncStep2) r.gotState = true;
        this.schedulePoint(r);
      }
    } else if (type === MSG_AWARENESS) {
      awp.applyAwarenessUpdate(r.aw, decoding.readVarUint8Array(d), REMOTE);
    }
  }

  // --- stanze ------------------------------------------------------------------------------------------------------
  has(id) { return this.rooms.has(id); }
  room(id) { return this.rooms.get(id); }

  // hooks: get() → l'appunto aperto; apply(next) → riscrivere l'appunto e la pagina; presence(peers); role(role);
  //        revoked(); readOnly(msg)
  async open(note, hooks) {
    if (!this.user) return null;
    const id = note.id;
    if (this.rooms.has(id)) { this.rooms.get(id).hooks = hooks; return this.rooms.get(id); }
    const r = { id, doc: new Y.Doc(), hooks, buffer: [], ready: false, joined: false, role: null, peers: new Map(), undo: new Map(), base: null, waitSaved: note.rev === 0 };
    r.aw = new awp.Awareness(r.doc);
    this.rooms.set(id, r);
    const saved = await dget(id);
    if (this.rooms.get(id) !== r) return null;
    if (saved?.state) {
      Y.applyUpdate(r.doc, saved.state, 'load');
      r.gen = saved.gen; r.ready = true;
      // l'appunto è già nostro: si riparte dal documento (contiene anche le modifiche fatte offline)
      const next = fromY(r.doc, { reuse: this.reuser(hooks.get()) });
      hooks.apply(next, { initial: true });
    } else {
      r.base = snapshotOf(note); // per capire, al primo allineamento, se nel frattempo hai scritto qualcosa
    }
    r.doc.on('update', (u, origin) => this.onDocUpdate(r, u, origin));
    r.aw.on('update', ({ added, updated, removed }, origin) => {
      if (origin === 'local') this.sendAwareness(r, [...added, ...updated, ...removed]);
      else { this.collectPeers(r); this.firePresence(r); }
    });
    r.aw.setLocalState({ user: { id: this.user.id, name: this.user.display_name || this.user.username, color: colorOf(this.user.id), device: deviceName() }, cursor: null, ink: null });
    this.join(r);
    return r;
  }

  async join(r) {
    if (!this.ws || this.ws.readyState !== 1 || r.joined || r.joining) return;
    if (r.waitSaved) return; // appunto nuovo: lo crea il primo PUT, poi si entra (vedi saved())
    r.joining = true;
    try {
      // prima la coda dei vecchi PUT di questo appunto deve essere vuota, altrimenti un PUT vecchio arriverebbe dopo
      // le modifiche Yjs e le annullerebbe
      if (!r.ready && await this.store.hasPendingPut?.(r.id)) { await this.store.flush().catch(() => {}); if (await this.store.hasPendingPut(r.id)) { setTimeout(() => { r.joining = false; this.join(r); }, 2000); return; } }
      if (this.rooms.get(r.id) !== r) return;
      this.send(JSON.stringify({ t: 'join', id: r.id }));
    } finally { r.joining = false; }
  }
  // il primo PUT di un appunto nuovo è arrivato al server: adesso si può entrare nella stanza
  saved(id) { const r = this.rooms.get(id); if (r?.waitSaved) { r.waitSaved = false; this.join(r); } }

  close(id, { forget = false } = {}) {
    const r = this.rooms.get(id);
    if (!r) return;
    this.rooms.delete(id);
    clearTimeout(r.flushT); clearTimeout(r.pointT); clearTimeout(r.persistT);
    if (r.ready && !forget) { try { this.flushLocal(r); } catch {} this.persist(r); }
    awp.removeAwarenessStates(r.aw, [r.doc.clientID], 'local');
    if (r.joined) this.send(JSON.stringify({ t: 'leave', id }));
    if (forget) { this.owned.delete(id); ddel(id); }
    r.aw.destroy();
    for (const um of r.undo.values()) um.destroy();
    setTimeout(() => r.doc.destroy(), 0);
  }

  onDocUpdate(r, u, origin) {
    if (origin === 'load') return;
    if (origin !== REMOTE && r.joined && r.role !== 'read') this.send(this.frame(MSG_SYNC, r.id, (e) => syncProtocol.writeUpdate(e, u)));
    // su IndexedDB a penna ferma (BUG-006)
    clearTimeout(r.persistT);
    r.persistT = setTimeout(function again(self) { if (!self.quiet()) { r.persistT = setTimeout(again, 800, self); return; } self.persist(r); }, 1200, this);
  }
  persist(r) {
    if (!r.ready) return;
    clearTimeout(r.persistT);
    dput(r.id, { state: Y.encodeStateAsUpdate(r.doc), gen: r.gen || null, at: Date.now() }).then(() => this.owned.add(r.id)).catch(() => {});
  }

  // --- dall'appunto locale al documento ----------------------------------------------------------------------------
  // L'app lo chiama a ogni modifica (scheduleSave): il confronto parte poco dopo, mai con la penna appoggiata.
  changed(id, { now = false } = {}) {
    const r = this.rooms.get(id);
    if (!r || !r.ready || r.role === 'read') return;
    clearTimeout(r.flushT);
    const go = () => { if (this.penDown()) { r.flushT = setTimeout(go, 120); return; } this.flushLocal(r); };
    if (now) go(); else r.flushT = setTimeout(go, 90);
  }
  flushLocal(r) {
    clearTimeout(r.flushT);
    const note = r.hooks.get();
    if (!note || !r.ready || r.role === 'read') return;
    toY(r.doc, note, LOCAL);
  }
  owns(id) { const r = this.rooms.get(id); return !!(r && r.ready) || this.owned.has(id); }
  readOnly(id) { return this.rooms.get(id)?.role === 'read'; }

  // --- punto di sincronia: gli aggiornamenti degli altri entrano a penna ferma ---------------------------------------
  schedulePoint(r) {
    if (r.pointT) return;
    const run = () => {
      if (!this.quiet()) { r.pointT = setTimeout(run, 300); return; }
      r.pointT = 0;
      this.point(r);
    };
    r.pointT = setTimeout(run, 16);
  }
  point(r) {
    if (this.rooms.get(r.id) !== r || !r.buffer.length) return;
    const note = r.hooks.get();
    if (!r.ready) {
      if (!r.gotState) return; // si aspetta lo stato completo del server
      // primo allineamento: il documento del server è la verità, a meno che tu non abbia scritto nel frattempo
      const ups = r.buffer; r.buffer = [];
      Y.transact(r.doc, () => { for (const u of ups) Y.applyUpdate(r.doc, u, REMOTE); }, REMOTE);
      r.ready = true;
      this.store.dropPendingPut?.(r.id);
      const local = note && r.base && snapshotOf(note) !== r.base;
      r.base = null;
      if (local) toY(r.doc, note, LOCAL); // le parole scritte durante l'aggancio vincono (come avrebbe fatto il PUT)
      r.hooks.apply(fromY(r.doc, { reuse: this.reuser(note) }), { initial: true });
      this.persist(r);
      this.sendAwareness(r, [r.doc.clientID]);
      return;
    }
    // 1) l'appunto locale entra nel documento  2) entrano gli aggiornamenti degli altri  3) l'appunto si riscrive
    const cursors = r.hooks.cursors?.() || [];
    // il cursore resta attaccato al carattere che ha prima (assoc −1): se l'altro scrive proprio lì, il suo testo va dopo
    const rel = cursors.map((c) => { const t = textOf(r.doc, c.block, c.key, c.path); return t ? { c, a: Y.createRelativePositionFromTypeIndex(t, c.a, -1), b: Y.createRelativePositionFromTypeIndex(t, c.b, -1) } : null; });
    this.flushLocal(r);
    const ups = r.buffer; r.buffer = [];
    Y.transact(r.doc, () => { for (const u of ups) Y.applyUpdate(r.doc, u, REMOTE); }, REMOTE);
    const moved = rel.filter(Boolean).map(({ c, a, b }) => ({ ...c, a: Y.createAbsolutePositionFromRelativePosition(a, r.doc)?.index ?? c.a, b: Y.createAbsolutePositionFromRelativePosition(b, r.doc)?.index ?? c.b }));
    r.hooks.apply(fromY(r.doc, { reuse: this.reuser(note) }), { cursors: moved });
  }
  // i tratti locali uguali a quelli del documento restano gli stessi oggetti (l'annulla della tavola li riconosce così)
  reuser(note) {
    const byK = new Map();
    for (const b of note?.blocks || []) for (const s of b.strokes || []) if (s.k) byK.set(s.k, s);
    return (ys) => { const s = byK.get(ys.k); return s && strokeFp(s) === strokeFp(ys) ? s : null; };
  }

  // --- annulla per persona (testo) ---------------------------------------------------------------------------------
  // Un UndoManager per campo di testo, limitato alle tue modifiche: ⌘Z non cancella mai quello che ha scritto un altro.
  undo(id, where, redo = false) {
    const r = this.rooms.get(id);
    if (!r || !r.ready) return false;
    this.flushLocal(r);
    const um = this.undoFor(r, where);
    if (!um) return false;
    if (!(redo ? um.redo() : um.undo())) return true; // niente da annullare: non si lascia fare al browser
    r.hooks.apply(fromY(r.doc, { reuse: this.reuser(r.hooks.get()) }), { undo: true });
    return true;
  }
  // da chiamare quando il campo prende il fuoco, prima di scrivere: tiene il conto da lì in poi
  undoFor(r, { block, key, path }) {
    const k = `${block || ''}|${key || ''}|${path || ''}`;
    if (r.undo.has(k)) return r.undo.get(k);
    const t = textOf(r.doc, block, key, path);
    if (!t) return null;
    const um = new Y.UndoManager(t, { trackedOrigins: new Set([LOCAL]), captureTimeout: 600 });
    r.undo.set(k, um);
    return um;
  }
  trackUndo(id, where) { const r = this.rooms.get(id); if (r?.ready) { this.flushLocal(r); this.undoFor(r, where); } }
  stopCapturing(id, where) { const r = this.rooms.get(id); const um = r && this.undoFor(r, where); um?.stopCapturing(); }

  // --- presenza ----------------------------------------------------------------------------------------------------
  sendAwareness(r, ids) {
    if (!r.joined) return;
    this.send(this.frame(MSG_AWARENESS, r.id, (e) => encoding.writeVarUint8Array(e, awp.encodeAwarenessUpdate(r.aw, ids))));
  }
  // cursore nel testo: { block, key: 'text'|'title'|'file', path, a, b } (indici nel testo) oppure null
  setCursor(id, c) {
    const r = this.rooms.get(id);
    if (!r || !r.ready) return;
    let cur = null;
    if (c) {
      const t = textOf(r.doc, c.block, c.key, c.path);
      if (t) cur = { block: c.block || null, key: c.key, path: c.path || null, a: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(t, c.a)), b: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(t, c.b)) };
    }
    const st = r.aw.getLocalState();
    if (JSON.stringify(st?.cursor) === JSON.stringify(cur)) return;
    r.aw.setLocalStateField('cursor', cur);
  }
  // «sta scrivendo» sulla tavola: dove è finito l'ultimo tratto (si manda a fine tratto, al massimo ogni 200 ms)
  setInk(id, ink) {
    const r = this.rooms.get(id);
    if (!r) return;
    const now = Date.now();
    if (ink && r.inkAt && now - r.inkAt < 200) { clearTimeout(r.inkT); r.inkT = setTimeout(() => this.setInk(id, ink), 200 - (now - r.inkAt)); return; }
    r.inkAt = now;
    r.aw.setLocalStateField('ink', ink ? { ...ink, at: now } : null);
  }
  collectPeers(r) {
    const peers = new Map();
    for (const [cid, st] of r.aw.getStates()) {
      if (cid === r.doc.clientID || !st?.user) continue;
      const p = { cid, user: { ...st.user, color: colorOf(st.user.id) }, ink: st.ink || null, cursor: null, self: st.user.id === this.user.id };
      if (st.cursor) {
        const t = textOf(r.doc, st.cursor.block, st.cursor.key, st.cursor.path);
        const abs = (j) => { try { return Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(j), r.doc)?.index; } catch { return null; } };
        if (t) p.cursor = { block: st.cursor.block, key: st.cursor.key, path: st.cursor.path, a: abs(st.cursor.a), b: abs(st.cursor.b) };
      }
      peers.set(cid, p);
    }
    r.peers = peers;
  }
  firePresence(r) {
    if (r.presT) return;
    const run = () => { if (!this.quiet()) { r.presT = setTimeout(run, 300); return; } r.presT = 0; if (this.rooms.get(r.id) === r) r.hooks.presence?.([...r.peers.values()]); };
    r.presT = setTimeout(run, 30);
  }
  peers(id) { return [...(this.rooms.get(id)?.peers.values() || [])]; }
}

// cosa conta per capire se hai scritto qualcosa (titolo e blocchi)
const snapshotOf = (n) => JSON.stringify([n.title || '', n.blocks || []], (k, v) => (k === 'k' ? undefined : v));

export const live = new Live();
