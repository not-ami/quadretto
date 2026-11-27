// Appunto ⇄ documento Yjs (CRDT), stesso codice nel browser e sul server (2026-11-24, punto 7 del piano «live»).
// Il modulo non importa Yjs: lo riceve da chi lo usa (il browser da /vendor/yjs/yjs.mjs, il server dal pacchetto npm),
// così le due parti usano la stessa logica con la stessa versione della libreria.
//
// Forma del documento (versione 1):
//   meta   : Y.Map   { v: 1, title: Y.Text, paper: 'grid', tags: [..] }
//   blocks : Y.Array di Y.Map, una per blocco, con i campi del blocco:
//            - testi (text, src, caption, name, stdin, title)  → Y.Text: due persone scrivono nello stesso testo
//            - strokes (inchiostro)                             → Y.Array di tratti; ogni tratto è un valore immutabile
//                                                                  con la sua chiave `k`: aggiungere e cancellare si fonde da solo
//            - files (codice, anche dei repository)             → Y.Map percorso → Y.Map { text: Y.Text, …altri campi }
//                                                                  e `forder` (ordine dei file) come valore semplice
//            - tutto il resto (opts, bg, h, open, …)            → valori semplici: vince l'ultima modifica del campo
//
// toY(doc, note) porta il documento a coincidere con l'appunto, con le modifiche più piccole possibili (prefisso e
// suffisso comuni nei testi, tratti confrontati per chiave e impronta). fromY(doc) fa il contrario.
// plainOf(note) è il testo per la ricerca (lo usano store.js e il server).

export const TEXT_KEYS = new Set(['text', 'src', 'caption', 'name', 'stdin', 'title']);

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

const rid = () => Math.random().toString(36).slice(2, 10);
// Impronta di un tratto: cambia se il tratto viene spostato, ridimensionato, ricolorato (bastano pochi numeri)
export function strokeFp(s) {
  const p = s.p || [], n = p.length;
  return `${n}|${p[0]}|${p[1]}|${p[n >> 1]}|${p[n - 3]}|${p[n - 2]}|${s.c}|${s.w}|${s.t || ''}|${s.s || ''}|${s.g || ''}|${s.gid || ''}`;
}
const plain = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

// Differenza minima tra due testi: [inizio, quanti tolti, testo messo]; non spezza le coppie surrogate (emoji)
export function textDiff(old, s) {
  if (old === s) return null;
  const m = Math.min(old.length, s.length);
  let a = 0;
  while (a < m && old.charCodeAt(a) === s.charCodeAt(a)) a++;
  if (a > 0 && a < old.length && /[\uD800-\uDBFF]/.test(old[a - 1])) a--;
  let b = 0;
  while (b < m - a && old.charCodeAt(old.length - 1 - b) === s.charCodeAt(s.length - 1 - b)) b++;
  if (b > 0 && /[\uDC00-\uDFFF]/.test(old[old.length - b])) b--;
  return [a, old.length - a - b, s.slice(a, s.length - b)];
}

export function makeY(Y) {
  function setText(yt, s) {
    const d = textDiff(yt.toString(), String(s ?? ''));
    if (!d) return false;
    if (d[1]) yt.delete(d[0], d[1]);
    if (d[2]) yt.insert(d[0], d[2]);
    return true;
  }
  const newText = (s) => { const t = new Y.Text(); if (s) t.insert(0, String(s)); return t; };

  // --- tratti ---------------------------------------------------------------------------------------------------
  // I tratti locali senza chiave la ricevono qui (si scrive dentro il tratto: resta con l'appunto).
  function syncStrokes(ya, strokes) {
    const local = strokes || [];
    const cur = ya.toArray();
    const byK = new Map(), byFp = new Map();
    cur.forEach((s, i) => { if (s?.k) byK.set(s.k, i); });
    // i tratti senza chiave (da un client vecchio, via PUT) si riconoscono dall'impronta
    if (local.some((s) => !s.k || !byK.has(s.k))) cur.forEach((s, i) => { const f = strokeFp(s); if (!byFp.has(f)) byFp.set(f, []); byFp.get(f).push(i); });
    const want = new Map(); // indice nel documento → tratto locale
    const used = new Set();
    for (const s of local) {
      let i;
      const own = s.k && !used.has(s.k) && byK.has(s.k);
      if (own) { i = byK.get(s.k); if (want.has(i)) i = undefined; }
      if (i === undefined && !own) {
        const l = byFp.get(strokeFp(s));
        while (l?.length) { const j = l.shift(); if (!want.has(j)) { i = j; s.k = cur[j].k; break; } }
      }
      if (i !== undefined) want.set(i, s);
      if (!s.k || (used.has(s.k) && want.get(i) !== s)) s.k = rid(); // nuovo, o chiave doppia dopo un «duplica»
      used.add(s.k);
    }
    // via dal fondo: i tratti che non ci sono più o sono cambiati
    for (let i = cur.length - 1; i >= 0; i--) {
      const s = want.get(i);
      if (!s || strokeFp(s) !== strokeFp(cur[i])) ya.delete(i, 1);
    }
    // poi si inseriscono i nuovi e i cambiati, al loro posto rispetto ai vicini già presenti
    const kept = ya.toArray().map((s) => s.k);
    const pos = new Map(kept.map((k, i) => [k, i]));
    let at = 0, shift = 0, pend = [];
    const put = () => { if (pend.length) { ya.insert(at + shift, pend.map(plain)); shift += pend.length; pend = []; } };
    for (const s of local) {
      const i = pos.get(s.k);
      if (i !== undefined) { put(); at = i + 1; } else pend.push(s);
    }
    put();
  }

  // --- file del codice ------------------------------------------------------------------------------------------
  function syncFiles(ym, files, bmap) {
    const list = files || [];
    const seen = new Set();
    for (const f of list) {
      if (!f?.path || seen.has(f.path)) continue;
      seen.add(f.path);
      let fm = ym.get(f.path);
      if (!(fm instanceof Y.Map)) { fm = new Y.Map(); ym.set(f.path, fm); }
      for (const [k, v] of Object.entries(f)) {
        if (k === 'path') continue;
        if (k === 'text') {
          const t = fm.get('text');
          if (t instanceof Y.Text) setText(t, v); else fm.set('text', newText(v));
        } else if (!same(fm.get(k), v)) fm.set(k, plain(v));
      }
      for (const k of [...fm.keys()]) if (k !== 'text' && !(k in f)) fm.delete(k);
      if (!('text' in f) && fm.has('text')) fm.delete('text');
    }
    for (const p of [...ym.keys()]) if (!seen.has(p)) ym.delete(p);
    const order = [...seen];
    if (!same(bmap.get('forder'), order)) bmap.set('forder', order);
  }

  // --- un blocco ----------------------------------------------------------------------------------------------
  function syncBlock(m, b) {
    for (const [k, v] of Object.entries(b)) {
      if (k === 'strokes' && Array.isArray(v)) {
        let a = m.get('strokes');
        if (!(a instanceof Y.Array)) { a = new Y.Array(); m.set('strokes', a); }
        syncStrokes(a, v);
      } else if (k === 'files' && Array.isArray(v)) {
        let fm = m.get('files');
        if (!(fm instanceof Y.Map)) { fm = new Y.Map(); m.set('files', fm); }
        syncFiles(fm, v, m);
      } else if (TEXT_KEYS.has(k) && typeof v === 'string') {
        const t = m.get(k);
        if (t instanceof Y.Text) setText(t, v); else m.set(k, newText(v));
      } else if (v === undefined) {
        if (m.has(k)) m.delete(k);
      } else {
        const cur = m.get(k);
        if (cur instanceof Y.AbstractType || !same(cur, v)) m.set(k, plain(v));
      }
    }
    for (const k of [...m.keys()]) if (!(k in b) && k !== 'forder') m.delete(k);
    if (!('files' in b) && m.has('forder')) m.delete('forder');
  }
  const blockMap = (b) => { const m = new Y.Map(); syncBlockLater.push([m, b]); return m; };
  let syncBlockLater = [];

  // Porta il documento a coincidere con l'appunto (dentro una sola transazione, con l'origine data)
  function toY(doc, note, origin = null) {
    doc.transact(() => {
      const meta = doc.getMap('meta');
      if (meta.get('v') !== 1) meta.set('v', 1);
      const t = meta.get('title');
      if (t instanceof Y.Text) setText(t, note.title || ''); else meta.set('title', newText(note.title || ''));
      if (!same(meta.get('paper'), note.paper || 'grid')) meta.set('paper', note.paper || 'grid');
      if (!same(meta.get('tags'), note.tags || [])) meta.set('tags', plain(note.tags || []));

      const ya = doc.getArray('blocks');
      const local = (note.blocks || []).filter((b) => b && b.id);
      const want = new Set(local.map((b) => b.id));
      // 1) via i blocchi tolti (e i doppioni)
      const seen = new Set();
      for (let i = ya.length - 1; i >= 0; i--) {
        const id = ya.get(i).get('id');
        if (!want.has(id) || seen.has(id)) ya.delete(i, 1); else seen.add(id);
      }
      // 2) ordine: si tiene la sottosequenza crescente più lunga, gli altri blocchi si ricreano al posto giusto
      //    (Yjs non sa spostare un elemento: spostare = togliere e rimettere)
      const idx = new Map(local.map((b, i) => [b.id, i]));
      const ids = ya.toArray().map((m) => m.get('id'));
      const keep = lis(ids.map((id) => idx.get(id)));
      for (let i = ids.length - 1; i >= 0; i--) if (!keep.has(i)) ya.delete(i, 1);
      // 3) adesso il documento è una sottosequenza dell'appunto: si aggiornano i presenti e si inseriscono i mancanti
      syncBlockLater = [];
      let yi = 0;
      for (const b of local) {
        const m = yi < ya.length ? ya.get(yi) : null;
        if (m && m.get('id') === b.id) { syncBlock(m, b); yi++; }
        else { ya.insert(yi, [blockMap(b)]); yi++; }
      }
      for (const [m, b] of syncBlockLater) syncBlock(m, b); // dopo l'inserimento (i tipi Yjs vanno riempiti da agganciati)
      syncBlockLater = [];
    }, origin);
  }

  // Indici della sottosequenza crescente più lunga (per tenere fermi più blocchi possibile)
  function lis(arr) {
    const tails = [], prev = new Array(arr.length), tIdx = [];
    arr.forEach((v, i) => {
      let lo = 0, hi = tails.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < v) lo = mid + 1; else hi = mid; }
      tails[lo] = v; tIdx[lo] = i; prev[i] = lo ? tIdx[lo - 1] : -1;
    });
    const out = new Set();
    for (let i = tIdx[tails.length - 1] ?? -1; i >= 0; i = prev[i]) out.add(i);
    return out;
  }

  // Documento → appunto. reuse(k, tratto del documento) può restituire il tratto locale già uguale (stessa chiave e
  // impronta) per non cambiare gli oggetti: l'annulla della tavola li riconosce per identità.
  function fromY(doc, { reuse } = {}) {
    const meta = doc.getMap('meta');
    const blocks = [];
    for (const m of doc.getArray('blocks')) {
      const b = {};
      for (const [k, v] of m.entries()) {
        if (k === 'forder') continue;
        if (v instanceof Y.Text) b[k] = v.toString();
        else if (k === 'strokes' && v instanceof Y.Array) b.strokes = v.toArray().map((s) => reuse?.(s) || structuredClone(s));
        else if (k === 'files' && v instanceof Y.Map) {
          const order = m.get('forder') || [];
          const paths = [...v.keys()];
          paths.sort((a, c) => { const ia = order.indexOf(a), ic = order.indexOf(c); return (ia < 0 ? 1e9 : ia) - (ic < 0 ? 1e9 : ic) || (a < c ? -1 : 1); });
          b.files = paths.map((p) => {
            const fm = v.get(p), f = { path: p };
            for (const [fk, fv] of fm.entries()) f[fk] = fv instanceof Y.Text ? fv.toString() : structuredClone(fv);
            return f;
          });
        } else b[k] = v instanceof Y.AbstractType ? v.toJSON() : structuredClone(v);
      }
      if (b.id) blocks.push(b);
    }
    const t = meta.get('title');
    return { title: t instanceof Y.Text ? t.toString() : String(t || ''), paper: meta.get('paper') || 'grid', tags: meta.get('tags') || [], blocks };
  }

  // Il tipo Yjs di un campo di testo, per cursori e annulla: (blocco, campo) o (blocco, 'file', percorso); null = titolo
  function textOf(doc, blockId, key, path) {
    if (!blockId) return doc.getMap('meta').get('title') || null;
    for (const m of doc.getArray('blocks')) {
      if (m.get('id') !== blockId) continue;
      if (key === 'file') { const f = m.get('files')?.get(path); return f?.get('text') || null; }
      const t = m.get(key);
      return t instanceof Y.Text ? t : null;
    }
    return null;
  }

  return { toY, fromY, textOf, setText, syncStrokes };
}
