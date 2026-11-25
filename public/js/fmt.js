// Formattazione del testo da tastiera (2026.11.7): barra sopra la tastiera, scorciatoie e autoformato.
// Sotto resta Markdown: la barra scrive i simboli al posto dell'utente, che non deve ricordarli
// (utente, 2026-11-24: «faciliti la scrittura dei documenti da tastiera e non obblighi gli utenti a ricordare o
// cercare comandi md»). Nei testi dell'interfaccia non si nomina nessun programma di videoscrittura.

// Qui t è anche una variabile locale: la traduzione si chiama T() (vedi i18n.js).
import { t as T, tp } from './i18n.js';

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
};

const MOD = /Mac|iPad|iPhone/.test(navigator.platform) || navigator.maxTouchPoints > 1 ? '⌘' : 'Ctrl';

// Prefissi di riga: ogni famiglia esclude le altre della stessa famiglia (un titolo non è anche un elenco)
const LINE = {
  h1: { re: /^# /, add: '# ', fam: 'block' },
  h2: { re: /^## /, add: '## ', fam: 'block' },
  h3: { re: /^### /, add: '### ', fam: 'block' },
  ul: { re: /^\s*[-*+] (?!\[[ xX]\] )/, add: '- ', fam: 'block', list: true },
  ol: { re: /^\s*\d+[.)] /, add: '1. ', fam: 'block', list: true },
  task: { re: /^\s*[-*+] \[[ xX]\] /, add: '- [ ] ', fam: 'block', list: true },
  // riquadri: si riconoscono in tutte e due le lingue, si scrivono in quella dell'interfaccia (md.js li colora)
  quote: { re: /^> (?!\*\*(Def\.|Teorema\.|Theorem\.|Attenzione\.|Warning\.)\*\*)/, add: '> ', fam: 'block' },
  def: { re: /^> \*\*Def\.\*\* ?/, add: '> **Def.** ', fam: 'block' },
  thm: { re: /^> \*\*(Teorema|Theorem)\.\*\* ?/, add: `> **${T('Teorema.')}** `, fam: 'block' },
  warn: { re: /^> \*\*(Attenzione|Warning)\.\*\* ?/, add: `> **${T('Attenzione.')}** `, fam: 'block' },
};
// Marcatori in riga
const WRAP = { bold: '**', italic: '*', strike: '~~', code: '`', math: '$' };

// L'elenco dei pulsanti della barra, nell'ordine in cui compaiono
export const FORMATS = [
  { k: 'title', label: tp('formato', 'Titolo'), aria: T('Titolo (tocca di nuovo per cambiarne la grandezza)'), keys: `${MOD} 1…3` },
  { k: 'bold', label: h('b', {}, tp('lettera', 'G')), aria: T('Grassetto'), keys: `${MOD} B` },
  { k: 'italic', label: h('i', {}, tp('lettera', 'C')), aria: T('Corsivo'), keys: `${MOD} I` },
  { k: 'strike', label: h('s', {}, 'S'), aria: T('Barrato'), keys: `${MOD} ⇧ X` },
  { sep: true },
  { k: 'ul', label: '• ' + T('Elenco'), aria: T('Elenco puntato'), keys: `${MOD} ⇧ 8` },
  { k: 'ol', label: '1. ' + T('Elenco'), aria: T('Elenco numerato'), keys: `${MOD} ⇧ 7` },
  { k: 'task', label: '☐ ' + T('Da fare'), aria: T('Elenco di cose da fare'), keys: `${MOD} ⇧ 9` },
  { k: 'quote', label: '❝ ' + T('Citazione'), aria: T('Citazione'), keys: `${MOD} ⇧ .` },
  { sep: true },
  { k: 'def', label: 'Def.', aria: T('Riquadro Definizione') },
  { k: 'thm', label: T('Teorema'), aria: T('Riquadro Teorema') },
  { k: 'warn', label: T('Attenzione'), aria: T('Riquadro Attenzione') },
  { sep: true },
  { k: 'link', label: '🔗 Link', aria: T('Collegamento a una pagina web'), keys: `${MOD} K` },
  { k: 'wiki', label: '[[ ' + T('Collega'), aria: T('Collegamento a un altro appunto') },
  { k: 'code', label: h('code', {}, '{ }'), aria: T('Codice nella riga'), keys: `${MOD} E` },
  { k: 'codeblock', label: '{ } ' + T('Codice'), aria: T('Blocco di codice') },
  { k: 'python', label: '▶ Python', aria: T('Codice Python da eseguire') },
  { k: 'math', label: '$x$', aria: T('Formula nella riga'), keys: `${MOD} M` },
  { k: 'mathblock', label: '$$ ' + T('Formula'), aria: T('Formula a blocco'), keys: `${MOD} ⇧ M` },
  { k: 'table', label: '▦ ' + T('Tabella'), aria: T('Inserisci una tabella') },
  { k: 'hr', label: '— ' + tp('formato', 'Riga'), aria: T('Linea di separazione') },
];

// Le scorciatoie da mostrare nella schermata delle scorciatoie
export const FORMAT_SHORTCUTS = [
  [`${MOD} B`, T('Grassetto')], [`${MOD} I`, T('Corsivo')], [`${MOD} ⇧ X`, T('Barrato')], [`${MOD} K`, T('Collegamento')],
  [`${MOD} 1 | ${MOD} 2 | ${MOD} 3`, T('Titolo grande, medio, piccolo')], [`${MOD} 0`, T('Testo normale (toglie titolo, elenco, citazione)')],
  [`${MOD} ⇧ 8`, T('Elenco puntato')], [`${MOD} ⇧ 7`, T('Elenco numerato')], [`${MOD} ⇧ 9`, T('Cose da fare')], [`${MOD} ⇧ .`, T('Citazione')],
  [`${MOD} E`, T('Codice nella riga')], [`${MOD} M`, T('Formula nella riga')], [`${MOD} ⇧ M`, T('Formula a blocco')],
  [T('Invio'), T('Continua l\'elenco (due volte: lo chiude)')], ['Tab | ⇧ Tab', T('Rientra o togli rientro nell\'elenco')],
];

// --- modifiche che entrano nell'annulla (⌘Z) ----------------------------------------------------------------
let quiet = false; // le nostre modifiche non devono rilanciare l'autoformato
function edit(ta, from, to, text, selA, selB) {
  ta.focus();
  ta.setSelectionRange(from, to);
  quiet = true;
  let ok = false;
  try { ok = text ? document.execCommand('insertText', false, text) : (from === to || document.execCommand('delete')); } catch { ok = false; }
  if (!ok || ta.value.slice(from, from + text.length) !== text) { ta.setRangeText(text, from, to, 'end'); ta.dispatchEvent(new Event('input')); }
  quiet = false;
  if (selA != null) ta.setSelectionRange(selA, selB ?? selA);
}

const lineBounds = (v, a, b = a) => {
  const s = v.lastIndexOf('\n', a - 1) + 1;
  let e = v.indexOf('\n', b > a && v[b - 1] === '\n' ? b - 1 : b);
  if (e < 0) e = v.length;
  return [s, e];
};

// --- prefissi di riga ------------------------------------------------------------------------------------------
function stripBlock(line) {
  for (const def of Object.values(LINE)) if (def.re.test(line)) return line.replace(def.re, (m) => (def.list ? m.match(/^\s*/)[0] : ''));
  return line;
}
function toggleLine(ta, k) {
  const v = ta.value, st = ta.selectionStart, en = ta.selectionEnd;
  const [s, e] = lineBounds(v, st, en);
  const lines = v.slice(s, e).split('\n');
  const def = LINE[k];
  const all = lines.every((l) => !l.trim() || def.re.test(l));
  let n = 0;
  const out = lines.map((l) => {
    if (!l.trim() && lines.length > 1) return l;
    const bare = stripBlock(l);
    if (all) return bare;
    const ind = def.list ? bare.match(/^\s*/)[0] : '';
    const add = k === 'ol' ? `${++n}. ` : def.add;
    return ind + add + bare.slice(ind.length);
  }).join('\n');
  const delta = out.length - (e - s);
  edit(ta, s, e, out, lines.length > 1 ? s : Math.max(s, en + delta), lines.length > 1 ? s + out.length : undefined);
}
function cycleTitle(ta) {
  const v = ta.value;
  const [s, e] = lineBounds(v, ta.selectionStart);
  const line = v.slice(s, e);
  const next = LINE.h1.re.test(line) ? 'h2' : LINE.h2.re.test(line) ? 'h3' : LINE.h3.re.test(line) ? null : 'h1';
  setBlock(ta, next);
}
function setBlock(ta, k) {
  const v = ta.value;
  const [s, e] = lineBounds(v, ta.selectionStart, ta.selectionEnd);
  const lines = v.slice(s, e).split('\n');
  const out = lines.map((l) => { const bare = stripBlock(l); return k ? LINE[k].add + bare.trimStart() : bare; }).join('\n');
  const caret = ta.selectionEnd + (out.length - (e - s));
  edit(ta, s, e, out, Math.max(s, Math.min(caret, s + out.length)));
}

// --- marcatori in riga -----------------------------------------------------------------------------------------
// la parola sotto il cursore, se non c'è una selezione
function wordAt(v, p) {
  let a = p, b = p;
  while (a > 0 && /[\p{L}\p{N}_'’-]/u.test(v[a - 1])) a--;
  while (b < v.length && /[\p{L}\p{N}_'’-]/u.test(v[b])) b++;
  return [a, b];
}
function toggleWrap(ta, k) {
  const mk = WRAP[k];
  const v = ta.value;
  let st = ta.selectionStart, en = ta.selectionEnd;
  // già marcato attorno alla selezione (o al cursore)? lo si toglie
  const around = enclosing(v, st, en, mk);
  if (around) {
    const [a, b] = around;
    const inner = v.slice(a + mk.length, b - mk.length);
    edit(ta, a, b, inner, st - mk.length, en - mk.length);
    return;
  }
  if (st === en) {
    const [a, b] = wordAt(v, st);
    if (b > a) { st = a; en = b; }
  }
  const sel = v.slice(st, en);
  if (!sel) { edit(ta, st, en, mk + mk, st + mk.length); return; }
  // gli spazi ai bordi restano fuori dai marcatori, altrimenti il Markdown non li riconosce
  const lead = sel.match(/^\s*/)[0], trail = sel.match(/\s*$/)[0];
  const core = sel.slice(lead.length, sel.length - trail.length);
  edit(ta, st, en, lead + mk + core + mk + trail, st + lead.length + mk.length, st + lead.length + mk.length + core.length);
}
// cerca nella riga una coppia di marcatori che contiene [st, en]
function enclosing(v, st, en, mk) {
  const [s, e] = lineBounds(v, st);
  const line = v.slice(s, e);
  const esc = mk.replace(/[*$~`]/g, '\\$&');
  const re = mk === '*' ? /(?<!\*)\*(?!\*)([^*\n]+?)(?<!\*)\*(?!\*)/g : new RegExp(`${esc}([^\\n]+?)${esc}`, 'g');
  for (const m of line.matchAll(re)) {
    const a = s + m.index, b = a + m[0].length;
    if (st >= a && en <= b) return [a, b];
  }
  return null;
}

// --- inserimenti ----------------------------------------------------------------------------------------------
function insertBlock(ta, open, close, placeholder = '') {
  const v = ta.value, st = ta.selectionStart, en = ta.selectionEnd;
  const sel = v.slice(st, en) || placeholder;
  const pre = st > 0 && v[st - 1] !== '\n' ? '\n' : '';
  const post = en < v.length && v[en] !== '\n' ? '\n' : '';
  const text = pre + open + sel + close + post;
  const a = st + pre.length + open.length;
  edit(ta, st, en, text, a, a + sel.length);
}
function insertLink(ta) {
  const v = ta.value, st = ta.selectionStart, en = ta.selectionEnd;
  const sel = v.slice(st, en);
  if (/^https?:\/\/\S+$/.test(sel)) { edit(ta, st, en, `[testo](${sel})`, st + 1, st + 6); return; }
  const label = sel || T('testo');
  const text = `[${label}](https://)`;
  if (sel) edit(ta, st, en, text, st + label.length + 3, st + text.length - 1);
  else edit(ta, st, en, text, st + 1, st + 1 + label.length);
}
export function tableMd(rows, cols) {
  const head = '| ' + Array.from({ length: cols }, (_, i) => T('Colonna {n}', { n: i + 1 })).join(' | ') + ' |';
  const sep = '|' + Array.from({ length: cols }, () => '---').join('|') + '|';
  const row = '| ' + Array.from({ length: cols }, () => '   ').join(' | ') + ' |';
  return [head, sep, ...Array.from({ length: rows }, () => row)].join('\n');
}

export function applyFormat(ta, k) {
  if (k === 'title') return cycleTitle(ta);
  if (k === 'h1' || k === 'h2' || k === 'h3') return setBlock(ta, LINE[k].re.test(lineOf(ta)) ? null : k);
  if (k === 'plain') return setBlock(ta, null);
  if (LINE[k]) return toggleLine(ta, k);
  if (WRAP[k]) return toggleWrap(ta, k);
  if (k === 'link') return insertLink(ta);
  if (k === 'wiki') { const st = ta.selectionStart, en = ta.selectionEnd, sel = ta.value.slice(st, en); return edit(ta, st, en, `[[${sel}${sel ? ']]' : ''}`, st + 2 + sel.length + (sel ? 2 : 0)); }
  if (k === 'codeblock') return insertBlock(ta, '```c\n', '\n```');
  if (k === 'python') return insertBlock(ta, '```python\n', '\n```');
  if (k === 'mathblock') return insertBlock(ta, '$$\n', '\n$$');
  if (k === 'hr') return insertBlock(ta, '\n---\n', '');
}
const lineOf = (ta) => { const [s, e] = lineBounds(ta.value, ta.selectionStart); return ta.value.slice(s, e); };

// Quali pulsanti sono «accesi» dove sta il cursore
export function activeFormats(ta) {
  const on = new Set();
  const line = lineOf(ta);
  for (const [k, def] of Object.entries(LINE)) if (def.re.test(line)) on.add(k);
  if (on.has('h1') || on.has('h2') || on.has('h3')) on.add('title');
  for (const k of Object.keys(WRAP)) if (enclosing(ta.value, ta.selectionStart, ta.selectionEnd, WRAP[k])) on.add(k);
  return on;
}

// --- scorciatoie ----------------------------------------------------------------------------------------------
export function formatKeys(e, ta) {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod || e.altKey) return false;
  const k = e.key.toLowerCase();
  const map = e.shiftKey
    ? { x: 'strike', 8: 'ul', '*': 'ul', 7: 'ol', '/': 'ol', '&': 'ol', 9: 'task', '(': 'task', ')': 'task', '.': 'quote', ':': 'quote', '>': 'quote', m: 'mathblock' }
    : { b: 'bold', i: 'italic', k: 'link', e: 'code', m: 'math', 1: 'h1', 2: 'h2', 3: 'h3', 0: 'plain' };
  let f = map[k];
  if (!f && e.shiftKey && /^Digit[789]$/.test(e.code)) f = { Digit7: 'ol', Digit8: 'ul', Digit9: 'task' }[e.code];
  if (!f && e.shiftKey && e.code === 'Period') f = 'quote';
  if (!f) return false;
  e.preventDefault(); e.stopPropagation();
  applyFormat(ta, f);
  return true;
}

// Tab e ⇧Tab dentro un elenco: rientro dell'intera voce
export function listIndent(e, ta) {
  if (e.key !== 'Tab') return false;
  const line = lineOf(ta);
  if (!/^\s*([-*+] |\d+[.)] )/.test(line)) return false;
  e.preventDefault();
  const [s, e2] = lineBounds(ta.value, ta.selectionStart, ta.selectionEnd);
  const lines = ta.value.slice(s, e2).split('\n');
  const out = lines.map((l) => (e.shiftKey ? l.replace(/^( {1,4}|\t)/, '') : '    ' + l)).join('\n');
  const caret = ta.selectionStart + (out.split('\n')[0].length - lines[0].length);
  edit(ta, s, e2, out, Math.max(s, caret));
  return true;
}

// --- autoformato mentre si scrive ------------------------------------------------------------------------------
// Solo conversioni che non sorprendono e si annullano con ⌘Z (entrano nell'annulla come le altre modifiche).
const inCode = (v, p) => ((v.slice(0, p).match(/^```/gm) || []).length % 2 === 1);
export function autoFormat(ta, ev) {
  if (quiet || !ev || ev.inputType !== 'insertText' || ev.data !== ' ') return;
  const v = ta.value, p = ta.selectionStart;
  if (p !== ta.selectionEnd || inCode(v, p)) return;
  const s = v.lastIndexOf('\n', p - 1) + 1;
  const before = v.slice(s, p);
  const rules = [
    [/^(\s*)\* $/, (m) => `${m[1]}- `],            // «* » → elenco puntato
    [/^(\s*)\[\] $/, (m) => `${m[1]}- [ ] `],      // «[] » → cosa da fare
    [/^(\s*)- \[\] $/, (m) => `${m[1]}- [ ] `],
    [/^(\s*)(\d+)\) $/, (m) => `${m[1]}${m[2]}. `], // «1) » → elenco numerato
  ];
  for (const [re, fn] of rules) {
    const m = before.match(re);
    if (m) { const out = fn(m); edit(ta, s, p, out, s + out.length); return; }
  }
  // «-- » → lineetta, fuori dalle formule
  if (/(^|[^-])-- $/.test(before) && (before.match(/\$/g) || []).length % 2 === 0) edit(ta, p - 3, p, '— ', p - 1);
}

// --- la barra -------------------------------------------------------------------------------------------------
// opts: { onChange(), preview: bool, onPreview(bool) }
export function formatBar(ta, opts = {}) {
  const bar = h('div', { class: 'fmt-bar', role: 'toolbar', 'aria-label': T('Formattazione del testo') });
  const btns = new Map();
  const press = (k) => (e) => {
    e.preventDefault();
    if (k === 'table') { tablePicker(ta, bar, opts); return; }
    applyFormat(ta, k);
    opts.onChange?.();
    refresh();
  };
  const items = FORMATS.map((f) => {
    if (f.sep) return h('span', { class: 'fmt-sep' });
    const b = h('button', { type: 'button', class: 'fmt-btn fmt-' + f.k, 'aria-label': f.aria, title: f.keys ? `${f.aria} (${f.keys})` : f.aria, onpointerdown: press(f.k) }, f.label);
    btns.set(f.k, b);
    return b;
  });
  const prev = h('button', { type: 'button', class: 'fmt-btn fmt-prev', 'aria-label': T('Anteprima sotto il testo'), title: T('Anteprima sotto il testo'),
    onpointerdown: (e) => { e.preventDefault(); opts.preview = !opts.preview; prev.classList.toggle('on', opts.preview); opts.onPreview?.(opts.preview); } }, '👁 Anteprima');
  prev.classList.toggle('on', !!opts.preview);
  const tools = h('div', { class: 'fmt-tools' }, ...items, h('span', { class: 'fmt-sep' }), prev);
  bar.append(tools);
  const refresh = () => {
    const on = activeFormats(ta);
    for (const [k, b] of btns) b.classList.toggle('on', on.has(k));
    const t = btns.get('title');
    if (t) t.textContent = on.has('h1') ? T('Titolo 1') : on.has('h2') ? T('Titolo 2') : on.has('h3') ? T('Titolo 3') : tp('formato', 'Titolo');
  };
  bar.refresh = refresh;
  bar.tools = tools;
  refresh();
  return bar;
}

function tablePicker(ta, bar, opts) {
  bar.querySelector('.fmt-table-pick')?.remove();
  let rows = 2, cols = 3;
  const out = h('span', { class: 'fmt-tp-size' });
  const grid = h('div', { class: 'fmt-tp-grid' });
  const draw = () => {
    out.textContent = T('{r} righe × {c} colonne', { r: rows, c: cols });
    grid.style.setProperty('--c', cols);
    grid.replaceChildren(...Array.from({ length: (rows + 1) * cols }, (_, i) => h('i', { class: i < cols ? 'head' : '' })));
  };
  const step = (lab, fn) => h('button', { type: 'button', class: 'btn small', onpointerdown: (e) => { e.preventDefault(); fn(); draw(); } }, lab);
  const box = h('div', { class: 'fmt-table-pick' },
    grid, out,
    h('div', { class: 'fmt-tp-row' }, tp('tabella', 'Righe'), step('−', () => { rows = Math.max(1, rows - 1); }), step('+', () => { rows = Math.min(30, rows + 1); })),
    h('div', { class: 'fmt-tp-row' }, T('Colonne'), step('−', () => { cols = Math.max(1, cols - 1); }), step('+', () => { cols = Math.min(10, cols + 1); })),
    h('div', { class: 'fmt-tp-row' },
      h('button', { type: 'button', class: 'btn small', onpointerdown: (e) => { e.preventDefault(); box.remove(); } }, T('Annulla')),
      h('button', { type: 'button', class: 'btn small primary', onpointerdown: (e) => {
        e.preventDefault(); box.remove();
        const from = ta.selectionStart;
        insertBlock(ta, tableMd(rows, cols), '\n');
        // si seleziona la prima intestazione, pronta da riscrivere
        const i = ta.value.indexOf('Colonna 1', from);
        if (i >= 0) ta.setSelectionRange(i, i + 9);
        opts.onChange?.();
      } }, T('Inserisci'))));
  draw();
  bar.prepend(box);
}
