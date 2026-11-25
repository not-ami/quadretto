// Archivio locale (IndexedDB) + sincronizzazione con il server Postgres.
// Ogni modifica viene prima scritta sul dispositivo, poi inviata al server da una coda:
// se la rete cade non si perde nulla, e la coda riparte da sola.
import * as i18n from './i18n.js';

// Un archivio locale per account: il proprietario tiene quello storico, gli altri uno proprio
let DB_NAME = 'quadretto';
let idb;
export function setLocalUser(u) { DB_NAME = u.is_owner ? 'quadretto' : 'quadretto-' + u.id; }

function openIdb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('kv');
      d.createObjectStore('notes', { keyPath: 'id' });
      d.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function tx(store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = idb.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((v) => { out = v; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const idbGet = (store, key) => tx(store, 'readonly', (s) => req(s.get(key)));
const idbPut = (store, val, key) => tx(store, 'readwrite', (s) => req(key === undefined ? s.put(val) : s.put(val, key)));
const idbDel = (store, key) => tx(store, 'readwrite', (s) => req(s.delete(key)));
const idbAll = (store) => tx(store, 'readonly', (s) => req(s.getAll()));

export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

export async function api(method, url, body, headers = {}, { timeout = 20000 } = {}) {
  const opts = { method, headers: { 'X-Quadretto': '1', 'X-Lang': i18n.getLang(), ...headers }, credentials: 'same-origin' };
  if (body instanceof Blob) opts.body = body;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  opts.signal = ctrl.signal;
  let r;
  try { r = await fetch(url, opts); } catch (e) { throw Object.assign(new Error(i18n.t('Server non raggiungibile')), { offline: true }); } finally { clearTimeout(t); }
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
  if (r.status === 401 && !url.startsWith('/api/auth/')) dispatchEvent(new CustomEvent('quadretto-auth'));
  if (!r.ok) throw Object.assign(new Error(data?.error || `Errore ${r.status}`), { status: r.status, auth: r.status === 401 });
  return data;
}

// Testo semplice di un appunto, per ricerca e anteprime
export function plainOf(note) {
  const parts = [];
  for (const b of note.blocks || []) {
    if (b.type === 'text') parts.push(b.text || '');
    else if (b.type === 'image' && b.caption) parts.push(b.caption);
    else if (b.type === 'ink' && b.ptext) parts.push(b.ptext); // testo della pagina PDF (per la ricerca)
    else if (b.type === 'tool') parts.push(String(b.src || '').slice(0, 20000));
    else if (b.type === 'chart') parts.push([b.title || '', String(b.src || '').slice(0, 8000)].join('\n'));
    else if (b.type === 'code') parts.push([b.name || '', ...(b.files || []).map((f) => f.path + '\n' + (f.text || '').slice(0, 4000))].join('\n').slice(0, 20000));
  }
  return parts.join('\n').trim();
}

class Store extends EventTarget {
  notebooks = [];
  notes = new Map(); // id -> meta (senza blocks)
  status = 'loading'; // loading | synced | syncing | offline | error
  pending = 0;
  attUrls = new Map();
  lastError = '';
  settings = {};          // impostazioni dell'utente sul server (orario delle lezioni, …)
  study = [];             // tempo di studio dal server: [{ notebook_id, day, seconds }]
  studyPending = new Map(); // 'giorno|quaderno' -> secondi ancora in coda
  run = { available: false }; // compilazione C/C++ sul server

  emit(what) { this.dispatchEvent(new CustomEvent('change', { detail: what })); }

  async init() {
    try { idb = await openIdb(); } catch { idb = null; }
    if (idb) {
      const cached = await idbGet('kv', 'bootstrap');
      if (cached) this.applyBootstrap(cached, true);
      const ob = await idbAll('outbox');
      this.pending = ob.length;
      for (const op of ob) if (op.kind === 'att') this.attUrls.set(op.id, URL.createObjectURL(op.blob));
      for (const op of ob) if (op.kind === 'study') this.pendStudy(op.items, 1);
      const st = ob.filter((o) => o.kind === 'settings').pop();
      if (st) this.settings = st.settings;
      const full = await idbAll('notes');
      for (const n of full) if (n._dirty) this.notes.set(n.id, this.metaOf(n));
    }
    this.emit('all');
    addEventListener('online', () => this.sync());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.sync(); });
    setInterval(() => this.sync(), 60000);
    await this.sync();
  }

  metaOf(n) {
    const { blocks, _dirty, ...meta } = n;
    return meta;
  }

  applyBootstrap(data, fromCache = false) {
    this.notebooks = data.notebooks;
    if (data.settings && !this.settingsDirty) this.settings = data.settings;
    if (data.study) this.study = data.study;
    if (data.run) this.run = data.run;
    const dirty = new Set([...this.notes.values()].filter((m) => m._local).map((m) => m.id));
    const next = new Map();
    for (const m of data.notes) next.set(m.id, m);
    for (const id of dirty) if (this.notes.has(id)) next.set(id, this.notes.get(id));
    this.notes = next;
    if (!fromCache) this.serverTime = data.serverTime;
  }

  async refresh() {
    const data = await api('GET', '/api/bootstrap');
    const ob = idb ? await idbAll('outbox') : [];
    const pendingIds = new Set(ob.filter((o) => o.kind !== 'att').map((o) => o.id));
    // non sovrascrivere gli appunti che hanno modifiche ancora in coda
    for (const id of pendingIds) {
      const local = this.notes.get(id);
      if (local) { local._local = true; }
    }
    this.applyBootstrap(data);
    // butta la copia completa locale se il server ne ha una più recente
    if (idb) {
      for (const full of await idbAll('notes')) {
        const m = this.notes.get(full.id);
        if (!full._dirty && (!m || m.rev > full.rev)) await idbDel('notes', full.id);
      }
      await idbPut('kv', { notebooks: data.notebooks, notes: [...this.notes.values()], settings: this.settings, study: data.study, run: data.run }, 'bootstrap');
    }
  }

  busy = () => false; // l'app lo imposta: true mentre la penna scrive (BUG-006)

  async sync() {
    // mentre la penna scrive niente rete, IndexedDB né ridisegni: si riprova appena è ferma
    if (this.busy()) { clearTimeout(this.syncRetry); this.syncRetry = setTimeout(() => this.sync(), 2500); return; }
    if (this.syncing) { this.again = true; return; }
    this.syncing = true;
    try {
      do {
        this.again = false;
        await this.flush();
        await this.refresh();
      } while (this.again);
      this.status = this.pending ? 'syncing' : 'synced';
      this.lastError = '';
    } catch (e) {
      this.status = e.offline ? 'offline' : e.auth ? 'auth' : 'error';
      this.lastError = e.message;
    } finally {
      this.syncing = false;
      this.emit('all');
    }
  }

  // --- coda ------------------------------------------------------------------
  async enqueue(op) {
    if (!idb) return this.runOp(op); // senza IndexedDB si va direttamente al server
    if (op.kind === 'settings') {
      // impostazioni: vale solo l'ultima
      for (const o of await idbAll('outbox')) if (o.kind === 'settings') await idbDel('outbox', o.seq);
    }
    if (op.kind === 'put' || op.kind === 'patch') {
      // una sola "put" in coda per appunto: l'ultima vince
      const ob = await idbAll('outbox');
      for (const o of ob) if (o.kind === 'put' && o.id === op.id && op.kind === 'put') await idbDel('outbox', o.seq);
    }
    await idbPut('outbox', op);
    this.pending = (await idbAll('outbox')).length;
    this.status = 'syncing';
    this.emit('status');
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flushSoon(), 700);
  }

  async flushSoon() {
    if (this.busy()) { clearTimeout(this.flushTimer); this.flushTimer = setTimeout(() => this.flushSoon(), 1500); return; }
    try { await this.flush(); this.status = this.pending ? 'syncing' : 'synced'; }
    catch (e) { this.status = e.offline ? 'offline' : 'error'; this.lastError = e.message; }
    this.emit('status');
  }

  async flush() {
    if (!idb) return;
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      const ob = await idbAll('outbox');
      for (const op of ob) {
        try { await this.runOp(op); }
        catch (e) {
          if (e.offline || e.auth || e.status >= 500 || e.status === 429) throw e;
          console.warn('Operazione scartata', op, e); // errore definitivo (es. dati non validi): non bloccare la coda
          this.lastError = e.message;
        }
        await idbDel('outbox', op.seq);
        this.pending = Math.max(0, this.pending - 1);
      }
      this.pending = (await idbAll('outbox')).length;
    })();
    try { await this.flushing; } finally { this.flushing = null; }
  }

  async runOp(op) {
    if (op.kind === 'put') {
      const full = await idbGet('notes', op.id) || op.note;
      if (!full) return;
      const { _dirty, conflict, ...body } = full;
      const saved = await api('PUT', `/api/notes/${op.id}`, { ...body, baseRev: full.rev });
      const now = await idbGet('notes', op.id);
      if (now && now._dirty && now._ver === full._ver) { now._dirty = false; now.rev = saved.rev; await idbPut('notes', now); }
      else if (now) { now.rev = saved.rev; await idbPut('notes', now); }
      const m = this.notes.get(op.id);
      if (m) { m.rev = saved.rev; delete m._local; }
      this.dispatchEvent(new CustomEvent('saved', { detail: { id: op.id, rev: saved.rev } }));
      if (saved.conflict) this.dispatchEvent(new CustomEvent('conflict', { detail: op.id }));
    } else if (op.kind === 'patch') {
      const saved = await api('PATCH', `/api/notes/${op.id}`, op.fields);
      const m = this.notes.get(op.id);
      if (m) { m.rev = saved.rev; delete m._local; }
      this.dispatchEvent(new CustomEvent('saved', { detail: { id: op.id, rev: saved.rev } }));
      const full = await idbGet('notes', op.id);
      if (full) { Object.assign(full, op.fields, { rev: saved.rev }); await idbPut('notes', full); }
    } else if (op.kind === 'del') {
      await api('DELETE', `/api/notes/${op.id}`);
    } else if (op.kind === 'settings') {
      await api('PUT', '/api/settings', { settings: op.settings });
      this.settingsDirty = false;
    } else if (op.kind === 'study') {
      await api('POST', '/api/study', { items: op.items });
      // passano dal «in coda» al dato del server, che arriva col prossimo bootstrap
      for (const it of op.items) this.study.push({ notebook_id: it.notebook_id, day: it.day, seconds: it.seconds });
      this.pendStudy(op.items, -1);
    } else if (op.kind === 'att') {
      await api('POST', '/api/attachments', op.blob, { 'Content-Type': op.mime, 'X-Id': op.id, 'X-Note-Id': op.noteId || '' });
      // 2026.11.6: la copia arrivata al server entra subito nella cache delle foto, così resta leggibile offline
      // anche dopo aver chiuso l'app (prima ci entrava solo alla prima lettura dal server)
      try { (await caches.open('quadretto-img')).put(`/api/attachments/${op.id}`, new Response(op.blob, { headers: { 'Content-Type': op.mime } })); } catch { /* niente cache: si legge dal server */ }
    }
  }

  // --- appunti ---------------------------------------------------------------
  async getNote(id) {
    const local = idb && await idbGet('notes', id);
    const meta = this.notes.get(id);
    if (local && (local._dirty || !meta || local.rev >= meta.rev)) return local;
    try {
      const full = await api('GET', `/api/notes/${id}`);
      if (idb) await idbPut('notes', full);
      return full;
    } catch (e) {
      if (local) return local;
      throw e;
    }
  }

  newNote(notebookId, kind = 'note') {
    const now = new Date().toISOString();
    return { id: uuid(), notebook_id: notebookId || null, kind, title: '', blocks: [], plain: '', tags: [], pinned: false, paper: 'grid', has_ink: false, rev: 0, created_at: now, updated_at: now, deleted_at: null };
  }

  async saveNote(note) {
    note.plain = plainOf(note);
    note.has_ink = note.blocks.some((b) => b.type === 'ink' && b.strokes?.length);
    note.updated_at = new Date().toISOString();
    note._dirty = true;
    note._ver = (note._ver || 0) + 1;
    const copy = structuredClone(note);
    if (idb) await idbPut('notes', copy);
    const meta = this.metaOf(copy); meta._local = true;
    this.notes.set(note.id, meta);
    this.emit('notes');
    await this.enqueue({ kind: 'put', id: note.id, note: idb ? undefined : copy });
  }

  async patchNote(id, fields) {
    const m = this.notes.get(id);
    if (m) Object.assign(m, fields, { updated_at: new Date().toISOString(), _local: true });
    const full = idb && await idbGet('notes', id);
    if (full) { Object.assign(full, fields); await idbPut('notes', full); }
    this.emit('notes');
    await this.enqueue({ kind: 'patch', id, fields });
  }

  async destroyNote(id) {
    this.notes.delete(id);
    if (idb) await idbDel('notes', id);
    this.emit('notes');
    await this.enqueue({ kind: 'del', id });
  }

  async emptyTrash() {
    const ids = [...this.notes.values()].filter((n) => n.deleted_at).map((n) => n.id);
    for (const id of ids) await this.destroyNote(id);
  }

  async addImage(blob, noteId) { return this.addAttachment(blob, noteId, blob.type || 'image/jpeg'); }
  async addAttachment(blob, noteId, mime) {
    const id = uuid();
    this.attUrls.set(id, URL.createObjectURL(blob));
    await this.enqueue({ kind: 'att', id, noteId, blob, mime });
    return id;
  }
  imageUrl(id) { return this.attUrls.get(id) || `/api/attachments/${id}`; }

  // --- impostazioni e tempo di studio (passano dalla coda: funzionano anche offline) ------------
  async saveSettings(settings) {
    this.settings = settings;
    this.settingsDirty = true;
    this.emit('settings');
    await this.enqueue({ kind: 'settings', settings });
  }
  pendStudy(items, sign) {
    for (const it of items) {
      const k = it.day + '|' + it.notebook_id;
      const v = (this.studyPending.get(k) || 0) + sign * it.seconds;
      if (v > 0) this.studyPending.set(k, v); else this.studyPending.delete(k);
    }
  }
  async addStudy(items) {
    if (!items.length) return;
    this.pendStudy(items, 1);
    await this.enqueue({ kind: 'study', items });
  }
  // secondi di studio per quaderno dal giorno `from` (AAAA-MM-GG) in poi
  studySince(from) {
    const tot = new Map();
    const add = (nb, day, sec) => { if (day >= from) tot.set(nb, (tot.get(nb) || 0) + sec); };
    for (const r of this.study) add(r.notebook_id, r.day, r.seconds);
    for (const [k, sec] of this.studyPending) { const [day, nb] = k.split('|'); add(nb, day, sec); }
    return tot;
  }

  versions(id) { return api('GET', `/api/notes/${id}/versions`); }
  version(vid) { return api('GET', `/api/versions/${vid}`); }
  search(term) { return api('GET', `/api/search?q=${encodeURIComponent(term)}`); }

  // --- quaderni (richiedono la connessione) -----------------------------------
  async createNotebook(nb) {
    const saved = await api('POST', '/api/notebooks', nb);
    this.notebooks.push(saved);
    this.emit('notebooks');
    return saved;
  }
  async createNotebooks(items) {
    const saved = await api('POST', '/api/notebooks/bulk', { items });
    this.notebooks.push(...saved);
    this.emit('notebooks');
    return saved;
  }
  async updateNotebook(id, fields) {
    const saved = await api('PATCH', `/api/notebooks/${id}`, fields);
    const i = this.notebooks.findIndex((n) => n.id === id);
    if (i >= 0) this.notebooks[i] = saved;
    this.emit('notebooks');
    return saved;
  }
  async reorderNotebooks(ids) {
    const pos = new Map(ids.map((id, i) => [id, i + 1]));
    this.notebooks.sort((a, b) => (pos.get(a.id) ?? 999) - (pos.get(b.id) ?? 999));
    this.notebooks.forEach((n) => { n.position = pos.get(n.id) ?? n.position; });
    this.emit('notebooks');
    await api('POST', '/api/notebooks/reorder', { ids });
  }
  async deleteNotebook(id) {
    await api('DELETE', `/api/notebooks/${id}`);
    this.notebooks = this.notebooks.filter((n) => n.id !== id);
    for (const m of this.notes.values()) if (m.notebook_id === id) { m.deleted_at = new Date().toISOString(); m.notebook_id = null; }
    this.emit('all');
    this.sync();
  }
}

export const store = new Store();
