// Live, presenza e condivisione nell'interfaccia (2026-11-24, punti 7-9 del piano). Sta in un file a parte per toccare
// app.js il meno possibile: app.js chiama collab.open/close/changed e passa qui le sue funzioni con initCollab().
//
// - applyRemote: le modifiche arrivate (da un altro dispositivo o da un'altra persona) entrano nell'appunto aperto
//   cambiando gli oggetti dei blocchi sul posto (gli editor del codice e degli strumenti li tengono per riferimento);
//   si ridisegna solo il blocco cambiato, il testo che stai scrivendo si aggiorna senza perdere il cursore.
// - presenza: pallini di chi c'è nella barra, cursori degli altri nel testo e nel codice, «sta scrivendo» sulla tavola.
// - annulla per persona: ⌘Z nei campi di testo annulla solo le tue modifiche (UndoManager di Yjs, live.js).
// - condivisione: «Condividi…» per appunti, quaderni e repository, link in sola lettura, «Condivisi con me» in Home.
import { live, textDiff, colorOf } from './live.js';
import { t } from './i18n.js';
import { renderMarkdown, enhance } from './md.js';
import { inkPreview } from './ink.js';
import { codePreview } from './code.js';
import { renderChart } from './charts.js';

let A = null; // le funzioni di app.js
export function initCollab(ctx) {
  A = ctx;
  live.addEventListener('changed', (e) => {
    // un appunto è cambiato altrove (o ti hanno condiviso qualcosa): gli elenchi si aggiornano col prossimo sync
    if (e.detail.t === 'changed' && A.ui.noteId === e.detail.id && live.room(e.detail.id)?.ready) return;
    clearTimeout(syncT); syncT = setTimeout(() => A.store.sync(), e.detail.t === 'shared' ? 100 : 1500);
  });
  live.addEventListener('status', () => drawPeers());
  bindTextFields();
}
let syncT;

// --- ciclo di vita dell'appunto aperto -------------------------------------------------------------------------------
export const collab = {
  open(note) {
    if (!A || !note) return;
    live.open(note, {
      get: () => (A.ui.note && A.ui.note.id === note.id ? A.ui.note : null),
      apply: (next, opts) => applyRemote(note.id, next, opts || {}),
      cursors: () => { const w = focusedField(); return w ? [w] : []; },
      presence: () => drawPresence(),
      role: (role) => { if (A.ui.note?.id === note.id && (role === 'read') !== isReadOnly(A.ui.note)) { A.ui.note.shared = { ...(A.ui.note.shared || {}), role }; A.renderEditor(); } },
      readOnly: (msg) => A.toast(msg || t('Hai solo il permesso di leggere questo appunto')),
      revoked: () => { if (A.ui.note?.id === note.id) { A.toast(t('Non hai più accesso a questo appunto: il proprietario ha tolto la condivisione')); A.closeNote({ discard: true }); } A.store.sync(); },
    });
  },
  close(id) { if (id) live.close(id); },
  // a ogni modifica dell'appunto aperto (scheduleSave)
  changed(id) { live.changed(id); },
  saved(id) { live.saved(id); },
  owns(id) { return live.owns(id); },
  inkStroke(blockId) { setTimeout(() => this.inkStrokeNow(blockId), 0); },
  inkStrokeNow(blockId) {
    const id = A.ui.noteId, b = A.ui.note?.blocks.find((x) => x.id === blockId);
    const s = b?.strokes?.[b.strokes.length - 1];
    if (!id || !s?.p?.length) return;
    live.setInk(id, { b: blockId, x: s.p[s.p.length - 3], y: s.p[s.p.length - 2] });
  },
};

export const isReadOnly = (note) => note?.shared?.role === 'read' || (note && live.readOnly(note.id));

// --- dal documento all'appunto aperto ------------------------------------------------------------------------------
const strokesSame = (a = [], b = []) => a.length === b.length && a.every((s, i) => s === b[i]);
function sameBlock(a, b) {
  if (a.type !== b.type) return false;
  const ka = Object.keys(a).filter((k) => k !== 'strokes'), kb = Object.keys(b).filter((k) => k !== 'strokes');
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
  return strokesSame(a.strokes, b.strokes);
}
function assignInPlace(o, n) { for (const k of Object.keys(o)) if (!(k in n)) delete o[k]; Object.assign(o, n); }

function applyRemote(id, next, { initial, cursors = [], undo } = {}) {
  const note = A.ui.note;
  if (!note || note.id !== id) return;
  if (isReadOnly(note)) { Object.assign(note, { title: next.title, paper: next.paper, tags: next.tags, blocks: next.blocks }); A.renderEditor(); return; }
  const focus = focusedField();
  const moved = cursors[0];
  const metaChanged = next.paper !== note.paper || JSON.stringify(next.tags || []) !== JSON.stringify(note.tags || []);
  const titleChanged = next.title !== note.title;
  const oldTitle = note.title;
  note.paper = next.paper; note.tags = next.tags; note.title = next.title;
  const byId = new Map(note.blocks.map((b) => [b.id, b]));
  const changed = [], prevInk = new Map();
  const oldText = new Map();
  const blocks = next.blocks.map((nb) => {
    const ob = byId.get(nb.id);
    if (!ob || ob.type !== nb.type) return nb;
    if (!sameBlock(ob, nb)) {
      if (ob.type === 'ink') prevInk.set(ob.id, { strokes: ob.strokes, h: ob.h });
      oldText.set(ob.id, ob.type === 'code' ? (ob.files || []).find((f) => f.path === ob.open)?.text : ob.text);
      assignInPlace(ob, nb); changed.push(ob);
    }
    return ob;
  });
  const structural = blocks.map((b) => b.id).join() !== note.blocks.map((b) => b.id).join() || blocks.some((b, i) => b !== note.blocks[i]);
  note.blocks = blocks;
  if (!changed.length && !structural && !titleChanged && !metaChanged) return;
  if (metaChanged && !initial) { A.renderEditor(); return; }
  // il cursore nel campo che stai usando: spostato da live.js (posizioni relative di Yjs) o, per l'annulla, dopo il pezzo cambiato
  const selFor = (w, before, after) => {
    if (moved && w && moved.block === w.block && moved.key === w.key && moved.path === w.path) return { a: moved.a, b: moved.b };
    const d = textDiff(before ?? '', after ?? '');
    if (!d || !w) return w ? { a: w.a, b: w.b } : null;
    if (undo) { const p = d[0] + d[2].length; return { a: p, b: p }; }
    const shift = (i) => (i <= d[0] ? i : i >= d[0] + d[1] ? i + d[2].length - d[1] : d[0] + d[2].length);
    return { a: shift(w.a), b: shift(w.b) };
  };
  if (titleChanged) {
    const ta = document.getElementById('note-title');
    if (ta) { const w = focus?.key === 'title' ? focus : null; const sel = selFor(w, oldTitle, note.title); ta.value = note.title; ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; if (w && sel) ta.setSelectionRange(sel.a, sel.b); }
  }
  if (structural) { renderKeepingFocus(focus, (w) => { const b = blocks.find((x) => x.id === w.block); const now = b?.type === 'code' ? (b.files || []).find((f) => f.path === b.open)?.text : b?.text; return selFor(w, oldText.get(w.block) ?? now, now); }); drawPresence(); return; }
  for (const b of changed) {
    const el = document.querySelector(`#blocks > .block[data-id="${b.id}"]`) || document.querySelector(`.code-proj[data-block="${b.id}"]`)?.closest('.ide-wrap, .repo-wrap, .block, #editor');
    if (b.type === 'ink') {
      const board = A.boards.get(b.id), p = prevInk.get(b.id);
      if (board) { board.block = b; board.liveApply(p?.strokes, p?.h); }
      continue;
    }
    if (b.type === 'text' && A.ui.editing === b.id) {
      const ta = el?.querySelector('.text-src');
      if (ta) {
        const w = focus?.block === b.id ? focus : null;
        const sel = selFor(w, oldText.get(b.id), b.text);
        ta.value = b.text;
        ta._refresh?.();
        if (w && sel) ta.setSelectionRange(sel.a, sel.b);
        continue;
      }
    }
    if (b.type === 'code') {
      const root = document.querySelector(`.code-proj[data-block="${b.id}"]`);
      if (root?.liveRefresh) {
        const w = focus?.block === b.id && focus.key === 'file' ? focus : null;
        const now = (b.files || []).find((f) => f.path === b.open)?.text;
        root.liveRefresh(w ? selFor(w, oldText.get(b.id), now) : null);
        continue;
      }
    }
    // gli altri blocchi (strumenti, grafici, foto, testo non in modifica) si ridisegnano
    const blockEl = document.querySelector(`#blocks > .block[data-id="${b.id}"]`);
    if (blockEl) { const i = note.blocks.indexOf(b); blockEl.replaceWith(A.renderBlock(b, i, new Map())); }
  }
  drawPresence();
}

function renderKeepingFocus(focus, selOf) {
  const scroll = document.getElementById('ed-scroll'), top = scroll?.scrollTop;
  A.renderBlocks();
  if (scroll) scroll.scrollTop = top;
  if (!focus?.block) return;
  const sel = selOf(focus);
  const ta = focus.key === 'file'
    ? document.querySelector(`.code-proj[data-block="${focus.block}"]`)?.codeTa
    : document.querySelector(`#blocks > .block[data-id="${focus.block}"] .text-src`);
  if (ta && sel) { ta.focus({ preventScroll: true }); try { ta.setSelectionRange(sel.a, sel.b); } catch {} }
}

// --- campi di testo: dove sei (per la presenza) e annulla per persona ----------------------------------------------
// Il campo con il fuoco: { block, key: 'text' | 'title' | 'file', path, a, b, el }
function whereOf(el) {
  if (!el || el.tagName !== 'TEXTAREA' || !A?.ui.note) return null;
  if (el.id === 'note-title') return { block: null, key: 'title', path: null, a: el.selectionStart, b: el.selectionEnd, el };
  if (el.classList.contains('text-src')) { const id = el.closest('.block')?.dataset.id; return id ? { block: id, key: 'text', path: null, a: el.selectionStart, b: el.selectionEnd, el } : null; }
  if (el.classList.contains('code-src')) { const root = el.closest('.code-proj'); const id = root?.dataset.block; const path = root?.codeFile?.(); return id && path ? { block: id, key: 'file', path, a: el.selectionStart, b: el.selectionEnd, el } : null; }
  return null;
}
const focusedField = () => whereOf(document.activeElement);
const TYPING = new Set(['insertText', 'deleteContentBackward', 'deleteContentForward', 'insertCompositionText', 'deleteCompositionText', 'insertFromComposition']);

function bindTextFields() {
  const ready = () => A.ui.noteId && live.room(A.ui.noteId)?.ready && !isReadOnly(A.ui.note);
  document.addEventListener('focusin', (e) => { const w = whereOf(e.target); if (w && ready()) live.trackUndo(A.ui.noteId, w); cursorSoon(); });
  document.addEventListener('focusout', () => cursorSoon());
  document.addEventListener('selectionchange', () => { if (whereOf(document.activeElement)) cursorSoon(); });
  // ⌘Z / ⌘⇧Z e il pulsante annulla della tastiera dell'iPad (beforeinput historyUndo)
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== 'z') return;
    const w = whereOf(e.target);
    if (!w || !ready()) return;
    e.preventDefault(); e.stopPropagation();
    live.undo(A.ui.noteId, w, e.shiftKey);
  }, true);
  document.addEventListener('beforeinput', (e) => {
    const w = whereOf(e.target);
    if (!w || !ready()) return;
    if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') { e.preventDefault(); live.undo(A.ui.noteId, w, e.inputType === 'historyRedo'); return; }
    // un comando (formattazione, incolla, a capo automatico) è un passo d'annulla a sé
    if (!TYPING.has(e.inputType)) { live.changed(A.ui.noteId, { now: true }); live.stopCapturing(A.ui.noteId, w); }
  }, true);
  document.addEventListener('input', (e) => {
    const w = whereOf(e.target);
    if (!w || !ready() || TYPING.has(e.inputType)) return;
    setTimeout(() => { live.changed(A.ui.noteId, { now: true }); live.stopCapturing(A.ui.noteId, w); }, 0);
  }, true);
}
let cursorT = 0;
function cursorSoon() {
  if (cursorT) return;
  cursorT = setTimeout(function again() {
    if (!A.penQuiet()) { cursorT = setTimeout(again, 400); return; }
    cursorT = 0;
    if (!A.ui.noteId) return;
    const w = focusedField();
    live.setCursor(A.ui.noteId, w && { block: w.block, key: w.key, path: w.path, a: w.a, b: w.b });
    drawCursors();
  }, 150);
}

// --- presenza ------------------------------------------------------------------------------------------------------
const initials = (s) => String(s || '?').trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase() || '?';
function drawPresence() { drawPeers(); drawCursors(); drawInk(); }

// pallini nella barra dell'appunto: chi c'è (nome e colore); i tuoi altri dispositivi come «Tu · iPad»
function drawPeers() {
  const slot = document.querySelector('#editor .ed-peers');
  if (!slot || !A.ui.noteId) return;
  const peers = live.peers(A.ui.noteId);
  const byUserDev = new Map();
  for (const p of peers) byUserDev.set(`${p.user.id}|${p.user.device}`, p);
  const list = [...byUserDev.values()];
  const on = live.status === 'online';
  slot.replaceChildren(...list.map((p) => {
    const who = p.self ? t('Tu · {dispositivo}', { dispositivo: p.user.device || '' }) : `${p.user.name}${p.user.device ? ' · ' + p.user.device : ''}`;
    const el = A.h('span', { class: 'peer' + (p.self ? ' self' : ''), title: who, 'aria-label': who, '--c': p.user.color }, p.self ? (p.user.device || '?').slice(0, 2) : initials(p.user.name));
    return el;
  }));
  slot.title = on ? (list.length ? t('In diretta') : t('In diretta: le modifiche arrivano subito agli altri dispositivi')) : t('Non in diretta: le modifiche restano su questo dispositivo e partono al ritorno della rete');
  slot.dataset.live = on ? 'on' : 'off';
}

// cursori degli altri nel testo in modifica e nel codice; sui blocchi non in modifica un'etichetta col nome
const mirror = document.createElement('div');
function caretXY(ta, i) {
  const cs = getComputedStyle(ta);
  for (const k of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderLeftWidth', 'boxSizing', 'whiteSpace', 'wordWrap', 'overflowWrap', 'tabSize', 'textIndent', 'wordBreak']) mirror.style[k] = cs[k];
  Object.assign(mirror.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', width: ta.clientWidth + 'px', overflow: 'hidden', height: 'auto' });
  if (cs.whiteSpace === 'pre') mirror.style.width = 'auto';
  mirror.textContent = ta.value.slice(0, i);
  const mark = document.createElement('span'); mark.textContent = ta.value.slice(i, i + 1) || '​';
  mirror.append(mark);
  document.body.append(mirror);
  const r = { x: mark.offsetLeft - ta.scrollLeft, y: mark.offsetTop - ta.scrollTop, h: parseFloat(cs.lineHeight) || mark.offsetHeight };
  mirror.remove();
  return r;
}
function drawCursors() {
  document.querySelectorAll('.peer-caret, .peer-tags').forEach((x) => x.remove());
  if (!A.ui.noteId) return;
  for (const p of live.peers(A.ui.noteId)) {
    const c = p.cursor;
    if (!c || c.a == null) continue;
    const label = p.self ? t('Tu · {dispositivo}', { dispositivo: p.user.device || '' }) : p.user.name;
    let ta = null;
    if (c.key === 'title') ta = document.getElementById('note-title');
    else if (c.key === 'text') ta = document.querySelector(`#blocks > .block[data-id="${c.block}"] .text-src`);
    else if (c.key === 'file') { const root = document.querySelector(`.code-proj[data-block="${c.block}"]`); if (root?.codeFile?.() === c.path) ta = root.codeTa; }
    if (ta && ta.offsetParent) {
      const xy = caretXY(ta, Math.min(c.b ?? c.a, ta.value.length));
      if (xy.y < -4 || xy.y > ta.clientHeight) continue;
      const host = ta.offsetParent;
      const el = A.h('div', { class: 'peer-caret', 'aria-hidden': 'true', '--c': p.user.color, style: { left: `${ta.offsetLeft + xy.x}px`, top: `${ta.offsetTop + xy.y}px`, height: `${xy.h}px` } }, A.h('span', {}, label));
      host.append(el);
    } else {
      const blk = c.block && (document.querySelector(`#blocks > .block[data-id="${c.block}"]`));
      if (!blk) continue;
      let row = blk.querySelector(':scope > .peer-tags');
      if (!row) { row = A.h('div', { class: 'peer-tags', 'aria-hidden': 'true' }); blk.append(row); }
      row.append(A.h('span', { class: 'peer-tag', '--c': p.user.color }, t('{nome} sta scrivendo qui', { nome: label })));
    }
  }
}
// «Mario sta scrivendo» sulla tavola, dove è finito il suo ultimo tratto (per 4 secondi)
let inkT = 0;
function drawInk() {
  if (!A.ui.noteId) return;
  const now = Date.now(), seen = new Set();
  let next = Infinity;
  for (const p of live.peers(A.ui.noteId)) {
    const k = p.ink;
    if (!k || now - k.at > 4000) continue;
    const board = A.boards.get(k.b);
    if (!board) continue;
    seen.add(`${k.b}|${p.cid}`);
    board.peerMark(p.cid, { label: p.self ? t('Tu · {dispositivo}', { dispositivo: p.user.device || '' }) : t('{nome} sta scrivendo', { nome: p.user.name }), color: p.user.color, x: k.x, y: k.y });
    next = Math.min(next, k.at + 4000 - now);
  }
  for (const [id, board] of A.boards) for (const cid of [...(board.marks?.keys() || [])]) if (!seen.has(`${id}|${cid}`)) board.peerMark(cid, null);
  clearTimeout(inkT);
  if (next < Infinity) inkT = setTimeout(drawInk, next + 50);
}

// la barra dell'appunto: posto per i pallini; per un appunto condiviso, di chi è
export function decorateBar(bar, note) {
  const spacer = bar.querySelector('.spacer');
  const peers = A.h('span', { class: 'ed-peers', role: 'group', 'aria-label': t('Chi c\'è') });
  spacer?.after(peers);
  if (note.shared) spacer?.before(A.h('span', { class: 'shared-chip', title: t('Condiviso con te') }, note.shared.role === 'read' ? t('Sola lettura') : t('Puoi modificare'), note.shared.owner_name ? ` · ${note.shared.owner_name}` : ''));
  requestAnimationFrame(drawPeers);
}

// --- appunto in sola lettura ---------------------------------------------------------------------------------------
export function renderReadOnly(ed, bar, note) {
  const page = A.h('div', { class: 'page readonly' + (A.prefs?.wide ? ' wide' : '') },
    A.h('h1', { class: 'title-input ro-title' }, note.title || t('Senza titolo')),
    A.h('p', { class: 'ro-banner' }, t('Sola lettura: vedi le modifiche in diretta, ma non puoi cambiare l\'appunto.')));
  for (const b of note.blocks) {
    let el = null;
    if (b.type === 'text' && b.text.trim()) { el = A.h('div', { class: 'md' }); el.innerHTML = renderMarkdown(b.text); enhance(el); el.querySelectorAll('input').forEach((i) => { i.disabled = true; }); }
    else if (b.type === 'ink' && b.strokes?.length) el = A.h('div', { class: 'prev-ink ro-ink' }, inkPreview(b, 1000, 4000));
    else if (b.type === 'code') el = codePreview(b);
    else if (b.type === 'chart') el = renderChart(b);
    else if (b.type === 'image') el = A.h('img', { class: 'prev-img', src: A.store.imageUrl(b.att), alt: b.caption || '' });
    else if (b.type === 'tool') el = A.h('p', { class: 'ro-tool' }, t('Strumento: {nome}', { nome: b.tool || '' }));
    if (el) page.append(A.h('div', { class: 'block ro-block', 'data-id': b.id }, el));
  }
  ed.replaceChildren(bar, A.h('div', { class: 'ed-scroll', id: 'ed-scroll' }, page));
}

// --- condivisione --------------------------------------------------------------------------------------------------
const ROLE = () => [['read', t('Può leggere')], ['edit', t('Può modificare')]];
const kindLabel = (k) => (k === 'notebook' ? t('il quaderno') : k === 'repo' ? t('il repository') : t('l\'appunto'));

// «Condividi…»: con chi è condiviso, aggiungi un account (cercato per nome), link in sola lettura con scadenza
export async function shareSheet(kind, target) {
  const { h, openSheet, closeSheet, toast, api } = A;
  const title = target.title || t('Senza titolo');
  openSheet([h('h2', {}, t('Condividi «{titolo}»', { titolo: title })), h('p', { class: 'lead' }, t('Caricamento…'))]);
  let data;
  try { data = await api('GET', `/api/shares?kind=${kind}&id=${target.id}`); }
  catch (e) { openSheet([h('h2', {}, t('Condividi «{titolo}»', { titolo: title })), h('p', { class: 'lead' }, t('Serve la connessione al server: {errore}', { errore: e.message })), h('div', { class: 'sheet-actions' }, h('button', { class: 'btn', onclick: closeSheet }, t('Chiudi')))]); return; }
  const again = () => shareSheet(kind, target);
  let role = 'edit', picked = null;
  const input = h('input', { type: 'search', placeholder: t('Nome dell\'account, es. mario'), autocomplete: 'off', autocapitalize: 'off', 'aria-label': t('Account con cui condividere') });
  const hits = h('div', { class: 'share-hits' });
  const roleSeg = h('div', { class: 'seg' }, ROLE().map(([k, l]) => h('button', { type: 'button', class: k === role ? 'on' : '', onclick: (e) => { role = k; roleSeg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === e.currentTarget)); } }, l)));
  let findT;
  input.addEventListener('input', () => {
    picked = null; clearTimeout(findT);
    findT = setTimeout(async () => {
      const qv = input.value.trim();
      if (qv.length < 2) { hits.replaceChildren(); return; }
      const list = await api('GET', `/api/users/find?q=${encodeURIComponent(qv)}`).catch(() => []);
      hits.replaceChildren(...(list.length ? list.map((u) => h('button', { type: 'button', class: 'share-hit', onclick: () => { picked = u.username; input.value = u.username; hits.replaceChildren(); } }, h('strong', {}, u.display_name), h('small', {}, '@' + u.username)))
        : [h('small', { class: 'muted' }, t('Nessun account con questo nome su questo server'))]));
    }, 220);
  });
  const add = async () => {
    const username = picked || input.value.trim();
    if (!username) { input.focus(); return; }
    try { await api('POST', '/api/shares', { kind, target_id: target.id, username, role }); toast(t('Condiviso con {nome}', { nome: username })); again(); }
    catch (e) { toast(e.message); }
  };
  const rows = data.shares.map((s) => h('div', { class: 'share-row' },
    h('span', { class: 'peer', '--c': colorOf(s.username) }, initials(s.display_name)),
    h('span', { class: 'share-who' }, h('strong', {}, s.display_name), h('small', {}, '@' + s.username)),
    h('select', { 'aria-label': t('Permesso di {nome}', { nome: s.display_name }), onchange: async (e) => { try { await api('PATCH', `/api/shares/${s.id}`, { role: e.target.value }); toast(t('Permesso cambiato')); } catch (er) { toast(er.message); again(); } } },
      ROLE().map(([k, l]) => h('option', { value: k, selected: s.role === k || null }, l))),
    h('button', { type: 'button', class: 'btn small danger', onclick: async () => { try { await api('DELETE', `/api/shares/${s.id}`); toast(t('Condivisione tolta: {nome} non vede più {cosa}', { nome: s.display_name, cosa: kindLabel(kind) })); again(); } catch (e) { toast(e.message); } } }, t('Togli'))));
  const days = h('select', { 'aria-label': t('Scadenza del link') }, [[1, t('1 giorno')], [7, t('7 giorni')], [30, t('30 giorni')], [90, t('90 giorni')]].map(([d, l]) => h('option', { value: d, selected: d === 7 || null }, l)));
  const linkRows = (data.links || []).map((l) => h('div', { class: 'share-row' },
    h('span', { class: 'share-who' }, h('strong', {}, t('Link in sola lettura')), h('small', {}, t('scade il {data}', { data: new Date(l.expires_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long' }) }))),
    h('button', { type: 'button', class: 'btn small danger', onclick: async () => { try { await api('DELETE', `/api/links/${l.id}`); toast(t('Link revocato: non si apre più')); again(); } catch (e) { toast(e.message); } } }, t('Revoca'))));
  const canLink = kind === 'note' || kind === 'notebook';
  openSheet([
    h('h2', {}, t('Condividi «{titolo}»', { titolo: title })),
    h('p', { class: 'lead' }, kind === 'notebook' ? t('Chi riceve il quaderno vede anche gli appunti che aggiungerai dopo.') : kind === 'repo' ? t('Il codice si modifica insieme; ognuno lo esegue per conto suo.') : t('Le modifiche si vedono in diretta su tutti i dispositivi.')),
    h('div', { class: 'field' }, h('span', {}, t('Aggiungi una persona di questo server')), input, hits, roleSeg,
      h('button', { type: 'button', class: 'btn primary', onclick: add }, t('Condividi'))),
    rows.length ? h('div', { class: 'field' }, h('span', {}, t('Condiviso con')), ...rows) : null,
    canLink ? h('div', { class: 'field' }, h('span', {}, t('Link in sola lettura')),
      h('p', { class: 'muted' }, t('Chi ha il link vede {cosa} come pagina da leggere o stampare, senza account. Funziona solo da dove questo server è raggiungibile.', { cosa: kindLabel(kind) })),
      h('div', { class: 'share-row' }, days, h('button', { type: 'button', class: 'btn', onclick: async () => {
        try {
          const l = await api('POST', '/api/links', { kind, target_id: target.id, days: Number(days.value) });
          const url = location.origin + l.path;
          try { await navigator.clipboard.writeText(url); toast(t('Link copiato: scade tra {n} giorni', { n: days.value })); } catch { prompt(t('Copia il link'), url); }
          again();
        } catch (e) { toast(e.message); }
      } }, t('Crea e copia il link'))), ...linkRows) : null,
    h('div', { class: 'sheet-actions' }, h('button', { class: 'btn', onclick: closeSheet }, t('Fatto'))),
  ].filter(Boolean));
  setTimeout(() => input.focus(), 50);
}

// un quaderno condiviso con te: di chi è, il tuo permesso, «Esci dalla condivisione»
export async function sharedNotebookSheet(nb) {
  const { h, openSheet, closeSheet, toast, api, store } = A;
  const s = nb.shared;
  openSheet([
    h('h2', {}, nb.title),
    h('p', { class: 'lead' }, t('Quaderno di {nome}, condiviso con te: {permesso}.', { nome: s.owner_name, permesso: s.role === 'edit' ? t('puoi modificare') : t('puoi leggere') })),
    h('div', { class: 'menu-list' }, h('button', { class: 'danger', onclick: async () => {
      try {
        const mine = (await api('GET', '/api/shares')).find((x) => x.kind === 'notebook' && x.target_id === nb.id && !x.mine);
        if (mine) await api('DELETE', `/api/shares/${mine.id}`);
        closeSheet(); toast(t('Non vedi più «{titolo}»', { titolo: nb.title })); store.sync();
      } catch (e) { toast(e.message); }
    } }, t('Esci dalla condivisione'))),
    h('div', { class: 'sheet-actions' }, h('button', { class: 'btn', onclick: closeSheet }, t('Chiudi'))),
  ]);
}

// Home: «Condivisi con me» (quaderni e appunti che altri ti hanno condiviso)
export function homeSection() {
  const { h, store, go, openNote, nbCode } = A;
  const nbs = store.notebooks.filter((n) => n.shared);
  const notes = [...store.notes.values()].filter((n) => n.shared && !n.deleted_at && !nbs.some((b) => b.id === n.notebook_id))
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).slice(0, 12);
  if (!nbs.length && !notes.length) return null;
  return h('section', { class: 'home-sec shared-sec' },
    h('h2', { class: 'home-label' }, t('Condivisi con me')),
    h('div', { class: 'shared-list' },
      nbs.map((nb) => h('button', { class: 'shared-item', onclick: () => go({ kind: 'notebook', id: nb.id }) },
        nbCode(nb), h('span', { class: 'shared-name' }, nb.title), h('small', {}, `${nb.shared.owner_name} · ${nb.shared.role === 'edit' ? t('puoi modificare') : t('sola lettura')}`))),
      notes.map((n) => h('button', { class: 'shared-item', onclick: () => openNote(n.id) },
        h('span', { class: 'nb-code', '--c': 'var(--faint)' }, n.kind === 'repo' ? '</>' : '¶'), h('span', { class: 'shared-name' }, n.title || t('Senza titolo')), h('small', {}, `${n.shared.owner_name || ''} · ${n.shared.role === 'edit' ? t('puoi modificare') : t('sola lettura')}`)))));
}
