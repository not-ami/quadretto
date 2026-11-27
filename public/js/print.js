// Quadretto — PDF «con stile» (2026.11.7): vista di stampa impaginata da noi, poi Stampa → Salva in PDF di iPadOS.
// Richiesta utente (2026-11-24): «Stampa/Esportazione di una nota PDF "con stile": copertina, design scelto dall'utente,
// armonia ed eleganza tra le pagine, contestualizzate alla scolasticità». Scelta: vista di stampa nell'app (offline) +
// versione dal server con Chromium (la seconda arriva dopo: vedi TODO).
// Le pagine A4 le facciamo noi (Safari non numera le pagine e non sa fare l'indice): così numeri di pagina, intestazioni
// e indice sono veri. La scrittura a mano diventa SVG (inkToSvg): resta vettoriale nel PDF.
// Qui t è anche una variabile locale: la traduzione si chiama T() (vedi i18n.js).
import { t as T, tn, locale } from './i18n.js';
import { renderMarkdown, enhance } from './md.js';
import { inkToSvg, inkHeight, inkCut } from './ink.js';
import { renderChart } from './charts.js';
import { renderPage } from './pdfdoc.js';

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(3)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

export const PRINT_THEMES = [
  { k: 'quaderno', label: T('Quaderno'), sub: T('quadretti leggeri e margine rosso, come il quaderno di scuola') },
  { k: 'classico', label: T('Classico'), sub: T('serif da libro, titoli centrati, filetti sottili') },
  { k: 'moderno', label: T('Moderno'), sub: T('titoli Space Grotesk, fascia di colore del corso') },
  { k: 'minimale', label: T('Minimale'), sub: T('tanto bianco, niente decorazioni') },
];
const ACCENTS = ['#3657e8', '#0f7b6c', '#b4235a', '#8b5cf6', '#c2410c', '#1c2333'];

let IMG = (att) => `/api/attachments/${att}`;
const accademico = (d = new Date()) => { const y = d.getFullYear(), m = d.getMonth(); return m >= 8 ? `${y}/${String(y + 1).slice(2)}` : `${y - 1}/${String(y).slice(2)}`; };
const oggi = () => new Date().toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' });

// ctx: { notes: [nota completa], notebook, user, track, prefs, savePrefs(), imageUrl(att), toast(), quiet() }
export async function openPrint(ctx) {
  if (ctx.imageUrl) IMG = ctx.imageUrl;
  const P = { theme: 'classico', accent: ctx.notebook?.color || ACCENTS[0], cover: true, index: true, numbers: true, paper: true, ...(ctx.prefs.print || {}) };
  if (!P.accentSet && ctx.notebook?.color) P.accent = ctx.notebook.color;
  document.querySelector('.pv-root')?.remove();
  const root = h('div', { class: 'pv-root', role: 'dialog', 'aria-label': T('Esporta in PDF') });
  const pagesEl = h('div', { class: 'pv-pages' });
  const status = h('span', { class: 'pv-status' }, T('Impagino…'));
  const seg = (list, cur, fn) => { const el = h('div', { class: 'seg' }, list.map(([k, l]) => h('button', { type: 'button', class: cur === k ? 'on' : '', onclick: () => { el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.textContent === l)); fn(k); } }, l))); return el; };
  const check = (key, label) => { const i = h('input', { type: 'checkbox', checked: P[key] || null }); i.addEventListener('change', () => { P[key] = i.checked; save(); build(); }); return h('label', { class: 'pv-check' }, i, label); };
  const save = () => { ctx.prefs.print = { ...P }; ctx.savePrefs(); };
  const swatches = h('div', { class: 'pv-swatches' }, [...new Set([ctx.notebook?.color, ...ACCENTS].filter(Boolean))].map((c) => h('button', { type: 'button', class: 'pv-sw' + (c === P.accent ? ' on' : ''), style: `--c:${c}`, 'aria-label': T('Colore') + ' ' + c, onclick: (e) => { P.accent = c; P.accentSet = true; save(); swatches.querySelectorAll('.pv-sw').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); build(); } })));
  const bar = h('div', { class: 'pv-bar' },
    h('div', { class: 'pv-bar-row' },
      h('strong', {}, ctx.notes.length > 1 ? T('PDF del quaderno') + ' · ' + tn(ctx.notes.length, '{n} appunto', '{n} appunti') : T('Esporta in PDF')),
      status,
      h('button', { type: 'button', class: 'btn', onclick: () => close() }, T('Chiudi')),
      h('button', { type: 'button', class: 'btn primary', onclick: () => { ctx.toast?.(T('Nella finestra di stampa: «Salva su File» o Condividi per avere il PDF')); setTimeout(() => window.print(), 50); } }, T('Stampa o salva PDF'))),
    h('div', { class: 'pv-bar-row pv-opts' },
      h('span', { class: 'pv-lab' }, T('Stile')), seg(PRINT_THEMES.map((t) => [t.k, t.label]), P.theme, (k) => { P.theme = k; save(); build(); }),
      h('span', { class: 'pv-lab' }, T('Colore')), swatches,
      check('cover', T('Copertina')), check('index', T('Indice')), check('numbers', T('Numeri di pagina')), check('paper', T('Carta della scrittura a mano'))));
  const measure = h('div', { class: 'pv-measure', 'aria-hidden': 'true' });
  root.append(bar, pagesEl, measure);
  document.body.append(root);
  document.documentElement.classList.add('pv-open');
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  function close() { document.removeEventListener('keydown', onKey); document.documentElement.classList.remove('pv-open'); root.remove(); }
  const fit = () => { const w = pagesEl.clientWidth - 32; pagesEl.style.setProperty('--z', Math.min(1, w / (210 * 3.7795))); };
  window.addEventListener('resize', fit, { once: true });

  // le pagine dei PDF annotati diventano immagini una volta sola (sono lente da disegnare)
  const pdfImgs = new Map();
  for (const n of ctx.notes) for (const b of n.blocks) if (b.type === 'ink' && b.bg && !pdfImgs.has(b.id)) {
    status.textContent = T('Preparo le pagine dei PDF…');
    // eslint-disable-next-line no-await-in-loop
    pdfImgs.set(b.id, await new Promise((res) => renderPage(b.bg, ctx.imageUrl(b.bg.att), 900, 2, (c) => { try { res(c ? c.toDataURL('image/jpeg', 0.88) : null); } catch { res(null); } })));
  }
  let building = 0;
  async function build() {
    const my = ++building;
    status.textContent = T('Impagino…');
    root.dataset.theme = P.theme;
    root.style.setProperty('--pv-accent', P.accent);
    await new Promise((r) => requestAnimationFrame(r));
    if (my !== building) return;
    const pages = paginate(ctx, P, measure, pdfImgs);
    pagesEl.replaceChildren(...pages);
    fit();
    status.textContent = tn(pages.length, '{n} pagina A4', '{n} pagine A4');
  }
  await build();
}

// --- impaginazione ---------------------------------------------------------------------------------------------
const MM = 3.7795; // px per mm (CSS)
const PAGE_W = 210, PAGE_H = 297, M_X = 22, M_TOP = 24, M_BOT = 22;
// 3 % di margine: in stampa i caratteri possono andare a capo un filo diversamente dalla misura sullo schermo
const CONTENT_H = (PAGE_H - M_TOP - M_BOT) * MM * 0.97;

function paginate(ctx, P, measure, pdfImgs) {
  measure.replaceChildren();
  measure.style.width = `${(PAGE_W - 2 * M_X)}mm`;
  const many = ctx.notes.length > 1;
  const nb = ctx.notebook;
  const courseLine = nb ? [nb.code, nb.title].filter(Boolean).join(' · ') : '';
  // 1) i pezzi da impaginare, nell'ordine, con le informazioni per l'indice
  const items = [];
  const toc = [];
  for (const [ni, note] of ctx.notes.entries()) {
    if (many) items.push({ el: h('h1', { class: 'pv-note-title' }, note.title || T('Senza titolo')), keep: true, newPage: ni > 0 || !P.index, toc: { lvl: 0, text: note.title || T('Senza titolo') }, note });
    for (const b of note.blocks) items.push(...blockItems(b, note, P, pdfImgs, many));
  }
  // 2) misura e distribuisci
  const pages = [];
  let cur = null, used = 0;
  const header = (note) => h('div', { class: 'pv-head' }, h('span', {}, courseLine || T('Quadretto')), h('span', {}, many ? '' : (note?.title || '')));
  const newPage = (note) => { cur = { body: h('div', { class: 'pv-body' }), note }; pages.push(cur); used = 0; };
  const height = (el) => { measure.append(el); const r = el.getBoundingClientRect().height + parseFloat(getComputedStyle(el).marginTop) + parseFloat(getComputedStyle(el).marginBottom); el.remove(); return r; };
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!cur || it.newPage) newPage(it.note);
    if (it.ink) {
      // la scrittura a mano si taglia a fette alte quanto lo spazio che resta
      let y = 0;
      const total = it.ink.h;
      const k = ((PAGE_W - 2 * M_X) * MM) / 1000; // px per unità della tavola
      while (y < total - 1) {
        let room = (CONTENT_H - used) / k;
        if (room < 160 && used > 0) { newPage(it.note); room = CONTENT_H / k; }
        // si taglia dove non passa nessun tratto (risalendo al massimo di un terzo della fetta)
        const y1 = y + room >= total ? total : inkCut(it.ink.block, y + room * 0.66, y + room);
        const slice = h('div', { class: 'pv-ink', html: inkToSvg(it.ink.block, y, y1, { paper: P.paper ? it.ink.paper : 'blank', bgHref: it.ink.bgHref, color: 'rgba(54, 87, 232, 0.18)' }) });
        slice.style.height = `${(y1 - y) * k}px`;
        cur.body.append(slice);
        used += (y1 - y) * k + 6;
        y = y1;
        if (y < total - 1) newPage(it.note);
      }
      continue;
    }
    let hgt = height(it.el);
    // elenchi, tabelle e codice che non stanno nello spazio rimasto: si riempie questa pagina e si continua nella prossima
    if (!it.part && hgt > CONTENT_H - used) {
      const parts = split(it.el, measure, used > 0 ? CONTENT_H - used : CONTENT_H);
      if (parts && parts.length > 1) { items.splice(i, 1, ...parts.map((el, k) => ({ ...it, el, part: true, newPage: false, toc: k === 0 ? it.toc : null }))); i--; continue; }
    }
    // un titolo non resta da solo in fondo alla pagina: va con quello che segue
    const next = items[i + 1];
    const need = it.keep && next && !next.ink && !next.newPage ? hgt + Math.min(height(next.el), 80) : hgt;
    if (used > 0 && used + need > CONTENT_H) newPage(it.note);
    if (hgt > CONTENT_H) {
      it.el.classList.add('pv-shrink');
      it.el.style.setProperty('--s', (CONTENT_H / hgt).toFixed(3));
      hgt = CONTENT_H;
    }
    if (it.toc) { it.toc.page = pages.length; toc.push(it.toc); }
    cur.body.append(it.el);
    used += hgt;
  }
  // titoli dentro i blocchi di testo → indice (pagina già nota)
  pages.forEach((pg, pi) => pg.body.querySelectorAll('h1:not(.pv-note-title), h2').forEach((x) => { if (toc.length < 80) toc.push({ lvl: x.tagName === 'H1' ? 1 : 2, text: x.textContent, page: pi + 1, order: pi * 1000 + toc.length }); }));
  // 3) copertina e indice davanti
  const front = [];
  if (P.cover) front.push(cover(ctx, P, courseLine));
  const tocList = toc.filter((t) => t.text).map((t) => ({ ...t })).sort((a, b) => a.page - b.page || (a.order || 0) - (b.order || 0));
  const tocPages = P.index && tocList.length > 1 ? Math.ceil(tocList.length / 32) : 0;
  const offset = front.length + tocPages;
  for (let k = 0; k < tocPages; k++) front.push(tocPage(tocList.slice(k * 32, k * 32 + 32), offset, k === 0));
  const total = front.length + pages.length;
  const out = [];
  front.forEach((f, k) => out.push(sheet(f, null, k + 1, total, P, ctx, true)));
  pages.forEach((pg, k) => out.push(sheet(pg.body, header(pg.note), offset + k + 1, total, P, ctx, false)));
  return out;
}

function sheet(body, head, n, total, P, ctx, front) {
  const foot = front && n === 1 && P.cover ? null : h('div', { class: 'pv-foot' }, h('span', {}, ctx.user?.display_name || ctx.user?.username || ''), h('span', {}, P.numbers && !(front && n === 1 && P.cover) ? `${n} / ${total}` : ''), h('span', {}, front ? '' : oggi()));
  return h('section', { class: 'pv-page' + (front ? ' pv-front' : '') + (P.paper && P.theme === 'quaderno' && !front ? ' pv-grid' : '') }, head, body, foot);
}

function cover(ctx, P, courseLine) {
  const nb = ctx.notebook;
  const title = ctx.notes.length > 1 ? (nb?.title || T('Quaderno')) : (ctx.notes[0]?.title || T('Senza titolo'));
  return h('div', { class: 'pv-cover' },
    h('div', { class: 'pv-cover-band' }),
    h('div', { class: 'pv-cover-top' }, ctx.track || '', ctx.track ? h('br') : null, T('Anno accademico {a}', { a: accademico() })),
    h('div', { class: 'pv-cover-mid' },
      nb?.code ? h('div', { class: 'pv-cover-code' }, nb.code) : null,
      h('h1', { class: 'pv-cover-title' }, title),
      ctx.notes.length === 1 && courseLine ? h('p', { class: 'pv-cover-course' }, courseLine) : null,
      ctx.notes.length > 1 ? h('p', { class: 'pv-cover-course' }, tn(ctx.notes.length, '{n} appunto', '{n} appunti')) : null),
    h('div', { class: 'pv-cover-bot' },
      h('div', {}, h('small', {}, T('Appunti di')), h('strong', {}, ctx.user?.display_name || ctx.user?.username || '')),
      h('div', {}, h('small', {}, T('Data')), h('strong', {}, oggi()))));
}
function tocPage(list, offset, first) {
  return h('div', { class: 'pv-toc' }, first ? h('h2', {}, T('Indice')) : null,
    h('ol', {}, list.map((t) => h('li', { class: 'lvl' + t.lvl }, h('span', { class: 'pv-toc-t' }, t.text), h('span', { class: 'pv-toc-dots' }), h('span', { class: 'pv-toc-n' }, String(t.page + offset))))));
}

// I pezzi di un blocco. Il testo si spezza nei suoi paragrafi (così si va a capo pagina tra un paragrafo e l'altro).
function blockItems(b, note, P, pdfImgs) {
  const base = { note };
  if (b.type === 'text') {
    if (!b.text.trim()) return [];
    const md = h('div', { class: 'md' });
    md.innerHTML = renderMarkdown(b.text);
    enhance(md);
    md.querySelectorAll('input').forEach((i) => { i.disabled = true; });
    md.querySelectorAll('.run-box, button').forEach((x) => x.remove());
    return [...md.children].map((c) => {
      const wrap = h('div', { class: 'md pv-md' }, c);
      return { ...base, el: wrap, keep: /^H[1-4]$/.test(c.tagName) };
    });
  }
  if (b.type === 'ink') {
    if (!b.strokes?.length && !b.bg) return [];
    return [{ ...base, ink: { block: b, h: inkHeight(b), paper: note.paper || 'grid', bgHref: b.bg ? pdfImgs.get(b.id) : null } }];
  }
  if (b.type === 'image') return [{ ...base, el: h('figure', { class: 'pv-fig' }, h('img', { src: IMG(b.att), alt: b.caption || '' }), b.caption ? h('figcaption', {}, b.caption) : null) }];
  if (b.type === 'chart') return [{ ...base, el: h('div', { class: 'pv-chart' }, renderChart(b)) }];
  if (b.type === 'code') {
    return (b.files || []).map((f) => ({ ...base, el: codeBox(f.path, f.text || '') }));
  }
  if (b.type === 'tool') {
    const name = { sched: T('Scheduling della CPU'), race: T('Race condition'), quiz: T('Quiz'), mutex: T('Simulatore di mutex'), starve: T('Simulatore di starvation') }[b.tool] || T('Strumento');
    return [{ ...base, el: codeBox(name, b.src || '', true) }];
  }
  return [];
}
function codeBox(title, text, plain = false) {
  const ext = (title.split('.').pop() || '').toLowerCase();
  const lang = { c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', py: 'python', js: 'javascript', mjs: 'javascript', java: 'java', sh: 'bash', md: 'markdown' }[ext];
  const code = h('code', { class: lang ? 'language-' + lang : '' });
  code.textContent = text;
  if (window.hljs && lang && !plain) { try { window.hljs.highlightElement(code); } catch {} }
  const pre = h('pre', { class: 'pv-code' }, code);
  return h('div', { class: 'pv-codebox' }, h('div', { class: 'pv-code-t' }, title), pre);
}

// Pezzi più alti di una pagina: elenchi per voce, codice per righe, tabelle per righe (rifacendo l'intestazione)
function split(el, measure, firstRoom = CONTENT_H) {
  const inner = el.classList.contains('pv-md') ? el.firstElementChild : el;
  // il primo pezzo riempie lo spazio rimasto (firstRoom), gli altri una pagina intera
  const pageFit = (make, units) => {
    const out = [];
    let start = 0;
    while (start < units) {
      const room = (out.length || start ? CONTENT_H : firstRoom) * 0.96;
      let end = start + 1;
      while (end <= units) { const t = make(start, end); measure.append(t); const hh = t.getBoundingClientRect().height; t.remove(); if (hh > room) break; end++; }
      end -= 1;
      if (end <= start) { if (!out.length && start === 0 && room < CONTENT_H * 0.9) { out.push(null); firstRoom = CONTENT_H; continue; } end = start + 1; }
      out.push(make(start, end)); start = end;
    }
    return out.filter(Boolean);
  };
  if (inner && (inner.tagName === 'UL' || inner.tagName === 'OL')) {
    const lis = [...inner.children];
    return pageFit((a, z) => { const l = h(inner.tagName.toLowerCase(), inner.tagName === 'OL' ? { start: (Number(inner.getAttribute('start')) || 1) + a } : {}, lis.slice(a, z).map((x) => x.cloneNode(true))); return h('div', { class: 'md pv-md' }, l); }, lis.length);
  }
  if (inner && inner.tagName === 'TABLE') {
    const head = inner.querySelector('thead'), rows = [...inner.querySelectorAll('tbody tr')];
    return pageFit((a, z) => h('div', { class: 'md pv-md' }, h('table', {}, head?.cloneNode(true), h('tbody', {}, rows.slice(a, z).map((r) => r.cloneNode(true))))), rows.length);
  }
  const pre = el.querySelector('pre');
  if (pre) {
    const title = el.querySelector('.pv-code-t')?.textContent || '';
    const linesHtml = pre.querySelector('code').innerHTML.split('\n');
    return pageFit((a, z) => { const c = h('code', { class: pre.querySelector('code').className, html: linesHtml.slice(a, z).join('\n') }); return el.classList.contains('pv-codebox') ? h('div', { class: 'pv-codebox' }, h('div', { class: 'pv-code-t' }, a ? `${title} (continua)` : title), h('pre', { class: 'pv-code' }, c)) : h('div', { class: 'md pv-md' }, h('pre', {}, c)); }, linesHtml.length);
  }
  return null;
}
