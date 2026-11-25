// Quadretto — codice eseguibile (S5).
// Python (Pyodide) e JavaScript girano sull'iPad, in worker separati dal thread della penna, anche senza rete.
// C e C++ si compilano sul server, in una gabbia (server/run.js). Un blocco «Progetto» tiene più file,
// si importa da uno zip o da un repository GitHub pubblico e si esporta in zip.
import { store, api } from './store.js';
import { lint, explain } from './explain.js';
import { REF, refAt } from './posix-ref.js';
import { renderXray, renderStress } from './xray.js';
import { renderMarkdown, enhance } from './md.js';
import { attachCompletion } from './complete.js';
// Qui t è anche una variabile locale: la traduzione si chiama T() (vedi i18n.js).
import { t as T, tp, tn } from './i18n.js';

// --- colori del codice e temi (2026.11.4) ------------------------------------------------------------
// Il testo si scrive in una textarea trasparente; sotto, uno strato con lo stesso testo colorato da highlight.js.
const HL_LANG = { c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', py: 'python', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', java: 'java', kt: 'kotlin', go: 'go', rs: 'rust', rb: 'ruby', php: 'php', cs: 'csharp', swift: 'swift', lua: 'lua', r: 'r', pl: 'perl',
  sh: 'bash', bash: 'bash', zsh: 'bash', json: 'json', yml: 'yaml', yaml: 'yaml', xml: 'xml', html: 'xml', htm: 'xml', svg: 'xml', css: 'css', scss: 'scss', less: 'less',
  sql: 'sql', md: 'markdown', ini: 'ini', cfg: 'ini', toml: 'ini', conf: 'ini', diff: 'diff', patch: 'diff', graphql: 'graphql', proto: 'c' };
export function hlLangOf(path) {
  const base = (path || '').split('/').pop();
  if (/^(makefile|gnumakefile)$/i.test(base) || /\.mk$/i.test(base)) return 'makefile';
  if (/^dockerfile$/i.test(base) || /^\.(env|gitignore|bashrc)$/i.test(base)) return 'bash';
  const ext = /\.([^.]+)$/.exec(base)?.[1]?.toLowerCase();
  return HL_LANG[ext] || null;
}
export const CODE_THEMES = [
  ['auto', T('Automatico')], ['chiaro', T('Chiaro')], ['carta', T('Carta')], ['notte', T('Notte')], ['grafite', T('Grafite')], ['contrasto', T('Contrasto')],
];
const codeTheme = () => store.settings?.codeTheme || 'auto';
function setCodeTheme(k) {
  store.saveSettings({ ...store.settings, codeTheme: k });
  document.querySelectorAll('.code-edit').forEach((el) => { el.dataset.theme = k; });
}
const isMac = /Mac|iPhone|iPad/.test(navigator.platform) || navigator.maxTouchPoints > 1;
export const MOD = isMac ? '⌘' : 'Ctrl';

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
}

// --- linguaggi ------------------------------------------------------------------------------
export const LANGS = {
  c: { label: 'C', main: 'main.c', hello: '#include <stdio.h>\n\nint main(void) {\n    printf("Ciao, Quadretto!\\n");\n    return 0;\n}\n' },
  cpp: { label: 'C++', main: 'main.cpp', hello: '#include <iostream>\n\nint main() {\n    std::cout << "Ciao, Quadretto!" << std::endl;\n    return 0;\n}\n' },
  python: { label: 'Python', main: 'main.py', hello: T('print("Ciao, Quadretto!")\n') },
  js: { label: 'JavaScript', main: 'main.js', hello: T('console.log("Ciao, Quadretto!");\n') },
};
const extLang = (p) => (/\.py$/i.test(p) ? 'python' : /\.m?js$/i.test(p) ? 'js' : /\.(cpp|cc|cxx|c\+\+|hpp|hh)$/i.test(p) ? 'cpp' : /\.[ch]$/i.test(p) ? 'c' : null);
// Il linguaggio del progetto: quello del file aperto se è Python o JS, altrimenti C++ se c'è un sorgente C++, poi C
export function projectLang(b) {
  const open = extLang(b.open || '');
  if (open === 'python' || open === 'js') return open;
  const files = b.files || [];
  if (files.some((f) => /\.(cpp|cc|cxx|c\+\+)$/i.test(f.path))) return 'cpp';
  if (files.some((f) => /\.c$/i.test(f.path))) return 'c';
  const py = files.find((f) => /\.py$/i.test(f.path));
  if (py) return 'python';
  return files.some((f) => /\.m?js$/i.test(f.path)) ? 'js' : null;
}
const fenceLang = (cls) => { const m = /language-([\w+#-]+)/.exec(cls || ''); const l = m?.[1].toLowerCase(); return { python: 'python', py: 'python', js: 'js', javascript: 'js', c: 'c', cpp: 'cpp', 'c++': 'cpp', cc: 'cpp' }[l] || null; };

export function newProject(lang, uuid) {
  const L = LANGS[lang];
  return { id: uuid(), type: 'code', name: '', files: [{ path: L.main, text: L.hello }], open: L.main, stdin: '' };
}

// --- esecuzione ---------------------------------------------------------------------------------
const workers = {};
let seq = 0;
function workerFor(lang) {
  return (workers[lang] ||= lang === 'python' ? new Worker('/js/py-worker.js', { type: 'module' }) : new Worker('/js/js-worker.js'));
}
// «file» in italiano non cambia al plurale, in inglese sì: il singolare ha il suo contesto nel dizionario
const quantiFile = (n) => (n === 1 ? tp('uno', '{n} file', { n }) : T('{n} file', { n }));
const PY_INPUT_HINT = 'Il programma chiede un input: scrivilo nel riquadro «Input (stdin)».'; // uguale in py-worker.js
// on: { out(s), err(s), status(s) } → { done: Promise<{ok, ms, note}>, stop() }
export function run({ lang, files, main, stdin }, on) {
  const t0 = performance.now();
  if (lang === 'python' || lang === 'js') {
    const w = workerFor(lang);
    const id = ++seq;
    let finish;
    const done = new Promise((r) => { finish = r; });
    const onMsg = (e) => {
      if (e.data.id !== id) return;
      const { k, s } = e.data;
      // il worker non sa la lingua: i suoi testi (italiani) si traducono qui
      if (k === 'out') on.out(s); else if (k === 'err') on.err(s.replace(PY_INPUT_HINT, T(PY_INPUT_HINT))); else if (k === 'status') on.status(T(s));
      else if (k === 'done') { w.removeEventListener('message', onMsg); finish({ ok: s === 'ok', ms: performance.now() - t0 }); }
    };
    w.addEventListener('message', onMsg);
    w.addEventListener('error', (e) => { on.err((e.message || T('Errore nel worker')) + '\n'); finish({ ok: false, ms: 0 }); }, { once: true });
    w.postMessage({ id, files, main, stdin });
    return { done, stop: () => { w.terminate(); delete workers[lang]; on.err('\nFermato.\n'); finish({ ok: false, ms: performance.now() - t0, stopped: true }); } };
  }
  // C e C++: sul server
  const done = (async () => {
    on.status(T('Compilazione {linguaggio} sul server…', { linguaggio: LANGS[lang].label }));
    try {
      const r = await api('POST', '/api/run', { lang, files, stdin }, {}, { timeout: 90000 });
      const c = r.compile;
      if (c.stderr || c.stdout) on.err(c.stdout + c.stderr);
      if (!r.ok) { on.err(c.timedOut ? T('Compilazione troppo lunga: interrotta.\n') : T('Compilazione non riuscita (codice {codice}).\n', { codice: c.code })); return { ok: false, ms: c.ms, raw: r }; }
      const x = r.run;
      if (x.stdout) on.out(x.stdout);
      if (x.stderr) on.err(x.stderr);
      if (x.cut) on.err(T('\n[uscita tagliata: oltre 64 KB]\n'));
      const SIG = { SIGSEGV: T('segmentation fault: accesso a memoria non valida'), SIGXCPU: T('tempo di CPU esaurito (8 s): ciclo infinito?'), SIGABRT: T('abort: assert fallita o errore della libreria'), SIGFPE: T('errore aritmetico (divisione per zero?)'), SIGKILL: T('fermato: troppa memoria o troppo tempo') };
      const note = x.stuck ? T('bloccato: tutti i processi e i thread erano fermi (vedi la radiografia)') : x.timedOut ? T('tempo scaduto (10 s): interrotto') : x.signal ? (SIG[x.signal] || T('terminato dal segnale {segnale}', { segnale: x.signal })) : T('uscita {codice}', { codice: x.code });
      return { ok: !x.timedOut && x.code === 0, ms: c.ms + x.ms, note, raw: r };
    } catch (e) {
      on.err((e.offline ? T('Per compilare C e C++ serve la connessione al server.') : e.message) + '\n');
      return { ok: false, ms: 0 };
    }
  })();
  return { done, stop: null };
}

// Pannello di uscita sotto un codice: stato, output, pulsanti Esegui/Ferma; per C e C++ anche il controllo del
// codice, la radiografia (programmi con fork, thread, semafori, code) e la prova di stress.
// opts: { onLoc(path, line) } — gli errori «file.c:12» diventano tocchi che aprono il file alla riga.
const LOC_RE = /((?:\.\/|\/work\/|\/home\/pyodide\/)?([\w.+\-/]+\.(?:c|h|cc|cpp|cxx|hpp|hh|py|js|mjs))):(\d+)(?::(\d+))?|File "([^"]+)", line (\d+)/g;
export const USES_SYNC = /\b(fork|pthread_create|sem_(open|init|wait|post)|shm_open|mq_(open|send|receive)|waitpid|std::thread)\b/;
function linkify(span, s, onLoc) {
  if (!onLoc) { span.textContent = s; return; }
  let last = 0;
  for (const m of s.matchAll(LOC_RE)) {
    span.append(s.slice(last, m.index));
    const p = (m[2] || m[5] || '').replace(/^(\.\/|\/work\/|\/home\/pyodide\/)/, '');
    const line = +(m[3] || m[6]);
    span.append(h('button', { type: 'button', class: 'loc-link', onclick: (e) => { e.stopPropagation(); onLoc(p, line); } }, m[0]));
    last = m.index + m[0].length;
  }
  span.append(s.slice(last));
}
function lintList(items, onLoc) {
  const icon = { err: '⛔', warn: '⚠️', info: 'ℹ️' };
  return h('ul', { class: 'lint-list' }, items.map((x) => h('li', { class: 'lint-' + x.level }, h('span', { class: 'lint-ico' }, icon[x.level]),
    h('div', {}, onLoc ? h('button', { type: 'button', class: 'loc-link', onclick: (e) => { e.stopPropagation(); onLoc(x.path, x.line); } }, `${x.path}:${x.line}`) : `${x.path}:${x.line}`, ' ', x.msg))));
}

function runner(getJob, opts = {}) {
  const status = h('span', { class: 'run-status' });
  const out = h('pre', { class: 'run-out', hidden: true });
  const stopBtn = h('button', { type: 'button', class: 'btn small', hidden: true }, T('Ferma'));
  const runBtn = h('button', { type: 'button', class: 'btn small primary run-btn' }, '▶ ' + T('Esegui'));
  const lintBtn = h('button', { type: 'button', class: 'btn small', hidden: true, title: T('Cerca gli errori tipici prima di compilare') }, T('Controlla'));
  const stressBtn = h('button', { type: 'button', class: 'btn small', hidden: true, title: T('Lo stesso programma 20 volte, con pause casuali vicino alle operazioni di sincronizzazione') }, T('Prova di stress'));
  const lintBox = h('div', { class: 'lint-box', hidden: true });
  const tips = h('div', { class: 'run-tips', hidden: true });
  const xslot = h('div', { class: 'xray-slot' });
  let job = null;
  const write = (cls) => (s) => { out.hidden = false; const span = h('span', { class: cls }); linkify(span, s, cls === 'e' ? opts.onLoc : null); out.append(span); out.scrollTop = out.scrollHeight; };
  const isCompiled = (spec) => spec && (spec.lang === 'c' || spec.lang === 'cpp');
  const refresh = () => {
    const spec = getJob();
    const c = isCompiled(spec);
    lintBtn.hidden = !c;
    stressBtn.hidden = !c || !runAvailable() || !USES_SYNC.test(spec.files.map((f) => f.text).join('\n'));
  };
  const showLint = (spec, always) => {
    const items = lint(spec.files);
    lintBox.hidden = !items.length && !always;
    lintBox.replaceChildren(items.length ? h('details', { open: items.some((x) => x.level === 'err') || always }, h('summary', {}, tn(items.length, 'Controllo del codice: {n} segnalazione', 'Controllo del codice: {n} segnalazioni')), lintList(items, opts.onLoc))
      : h('p', { class: 'lint-ok' }, T('Controllo del codice: nessun errore tipico trovato.')));
  };
  const showTips = (list) => { tips.hidden = !list.length; tips.replaceChildren(...list.map((t) => h('p', {}, '💡 ', t))); };
  const fmtMs = (ms) => (ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(1) + ' s');
  runBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (job) return;
    const spec = getJob();
    if (!spec) return;
    if (!spec.lang) { status.textContent = T('Non so eseguire questo file: servono .c, .cpp, .py o .js'); return; }
    out.replaceChildren(); out.hidden = true; showTips([]); xslot.replaceChildren();
    if (isCompiled(spec)) showLint(spec, false);
    runBtn.disabled = true; status.textContent = T('In esecuzione…');
    let text = '';
    job = run(spec, { out: (s) => { text += s; write('o')(s); }, err: (s) => { text += s; write('e')(s); }, status: (s) => { status.textContent = s; } });
    stopBtn.hidden = !job.stop;
    const r = await job.done;
    job = null; runBtn.disabled = false; stopBtn.hidden = true;
    status.textContent = (r.stopped ? T('Fermato') : r.ok ? T('Fatto') : T('Errore')) + (r.note ? ` · ${r.note}` : '') + (r.ms ? ` · ${fmtMs(r.ms)}` : '');
    if (r.ok && !out.childNodes.length) status.textContent += T(' · nessuna uscita');
    opts.onDiag?.(r.raw ? text : '');
    if (r.raw) {
      const mq = /mqopen \S+ \S+ \S+ \S+ (\d+)/.exec(r.raw.run?.trace || '');
      showTips(explain(text, r.raw, { msgsize: mq ? +mq[1] : null }));
      if (r.raw.run?.trace) { const x = renderXray(r.raw, { onLoc: opts.onLoc, files: spec.files }); if (x) xslot.append(x); }
    }
  });
  stopBtn.addEventListener('click', (e) => { e.stopPropagation(); job?.stop?.(); });
  lintBtn.addEventListener('click', (e) => { e.stopPropagation(); const spec = getJob(); if (spec) showLint(spec, true); });
  stressBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const spec = getJob();
    if (!spec || job) return;
    stressBtn.disabled = runBtn.disabled = true; status.textContent = T('Prova di stress: 20 esecuzioni sul server…'); xslot.replaceChildren();
    try {
      const r = await api('POST', '/api/run', { lang: spec.lang, files: spec.files, stdin: spec.stdin, stress: 20 }, {}, { timeout: 150000 });
      if (!r.ok) { out.replaceChildren(); write('e')(r.compile.stdout + r.compile.stderr || T('Compilazione non riuscita\n')); status.textContent = T('Errore di compilazione'); return; }
      status.textContent = T('Prova di stress · {n} esecuzioni', { n: r.stress.runs }) + ' · ' + tn(r.stress.groups.length, '{n} esito', '{n} esiti diversi');
      xslot.append(renderStress(r.stress, { onLoc: opts.onLoc, files: spec.files }));
    } catch (err) { status.textContent = err.offline ? T('Per la prova di stress serve la connessione al server') : err.message; }
    finally { stressBtn.disabled = runBtn.disabled = false; }
  });
  refresh();
  runBtn.title = T('Esegui ({tasti})', { tasti: `${MOD} ${T('Invio')}` });
  return { bar: h('div', { class: 'run-bar' }, runBtn, stopBtn, lintBtn, stressBtn, status), out, extra: h('div', {}, lintBox, tips, xslot), refresh, runBtn };
}

// Pulsante «Esegui» sotto i blocchi ```python / ```js / ```c / ```cpp del testo
export function addRunButtons(container) {
  container.querySelectorAll('pre > code').forEach((code) => {
    const lang = fenceLang(code.className);
    if (!lang) return;
    const pre = code.parentElement;
    const r = runner(() => ({ lang, files: [{ path: LANGS[lang].main, text: code.textContent }], main: LANGS[lang].main, stdin: '' }));
    const box = h('div', { class: 'run-box', onclick: (e) => e.stopPropagation() }, r.bar, r.out, r.extra);
    pre.after(box);
  });
}

// --- zip e GitHub ---------------------------------------------------------------------------------
let zipLib;
const fflate = async () => (zipLib ||= await import('/vendor/fflate/browser.js'));
const SKIP = /(^|\/)(\.git|node_modules|__pycache__|\.vscode|\.idea|build|dist|out|bin|obj|target|cmake-build-[^/]*|\.DS_Store|__MACOSX)(\/|$)/;
const LIM = { files: 300, file: 512 * 1024, total: 3 * 1024 * 1024 };

export async function filesFromZip(u8, sub = '') {
  const { unzipSync } = await fflate();
  const raw = unzipSync(u8, { filter: (f) => !f.name.endsWith('/') && !SKIP.test(f.name) && f.originalSize <= LIM.file });
  let names = Object.keys(raw);
  // lo zip di GitHub (e molti altri) mette tutto dentro una cartella: la togliamo
  const top = names.length && names.every((n) => n.includes('/') && n.split('/')[0] === names[0].split('/')[0]) ? names[0].split('/')[0] + '/' : '';
  const dec = new TextDecoder('utf-8', { fatal: true });
  const files = []; let skipped = 0, total = 0;
  const subPath = sub.replace(/^\/+|\/+$/g, '');
  for (const n of names.sort()) {
    let p = n.slice(top.length);
    if (subPath) { if (!p.startsWith(subPath + '/')) continue; p = p.slice(subPath.length + 1); }
    const bytes = raw[n];
    if (bytes.subarray(0, 8000).includes(0)) { skipped++; continue; } // binario
    let text;
    try { text = dec.decode(bytes); } catch { skipped++; continue; }
    if (files.length >= LIM.files || total + bytes.length > LIM.total) { skipped++; continue; }
    total += bytes.length;
    files.push({ path: p, text });
  }
  return { files, skipped };
}

// «proprietario/nome», o l'indirizzo di github.com (anche …/tree/ramo/cartella)
export function parseGithub(s) {
  s = s.trim().replace(/\.git$/, '');
  let m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)(?:\/tree\/([^/]+)(?:\/(.+))?)?\/?$/.exec(s);
  if (m) return { repo: `${m[1]}/${m[2]}`, ref: m[3] || '', sub: m[4] || '' };
  m = /^([\w.-]+)\/([\w.-]+)$/.exec(s);
  return m ? { repo: s, ref: '', sub: '' } : null;
}

export async function filesFromGithub(input, ref) {
  const g = parseGithub(input);
  if (!g) throw new Error(T('Scrivi il repository come proprietario/nome o incolla l\'indirizzo di GitHub'));
  const r = await fetch(`/api/github?repo=${encodeURIComponent(g.repo)}&ref=${encodeURIComponent(ref || g.ref)}`, { credentials: 'same-origin' }).catch(() => null);
  if (!r) throw new Error(T('Server non raggiungibile: per importare da GitHub serve la connessione'));
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || T('Errore {codice}', { codice: r.status }));
  const res = await filesFromZip(new Uint8Array(await r.arrayBuffer()), g.sub);
  return { ...res, name: g.repo.split('/')[1] };
}

export async function exportZip(b) {
  const { zipSync, strToU8 } = await fflate();
  const name = (b.name || 'progetto').trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'progetto';
  const data = {};
  for (const f of b.files) data[`${name}/${f.path}`] = strToU8(f.text);
  for (const d of b.dirs || []) data[`${name}/${d}`] = {}; // cartelle vuote
  const url = URL.createObjectURL(new Blob([zipSync(data, { level: 6 })], { type: 'application/zip' }));
  const a = h('a', { href: url, download: name + '.zip' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// --- blocco «Progetto» nell'editor e repository dei quaderni smart ----------------------------------------------
// ctx: { onChange(), toast(msg, action), confirmBtn(label, fn, cls), repo: true per la vista a tutta pagina
//        dei repository (albero dei file al posto delle schede, il nome lo dà il titolo) }
const closedDirs = new Map(); // id del progetto -> cartelle chiuse nell'albero
export function pickOpen(files) {
  return (files.find((f) => /(^|\/)main\.(c|cpp|cc|py|js)$/i.test(f.path)) || files.find((f) => extLang(f.path)) || files.find((f) => /readme/i.test(f.path)) || files[0])?.path || null;
}
const fileIcon = (p) => (/\.(c|h)$/i.test(p) ? 'C' : /\.(cpp|cc|cxx|hpp|hh)$/i.test(p) ? '++' : /\.py$/i.test(p) ? 'Py' : /\.m?js$/i.test(p) ? 'JS' : /\.md$/i.test(p) ? 'MD' : /makefile$/i.test(p) ? 'MK' : '·');

export function renderCodeBlock(b, ctx) {
  b.files ||= []; b.stdin ||= '';
  if (!b.files.find((f) => f.path === b.open)) b.open = b.files[0]?.path || null;
  const repo = !!ctx.repo;
  const root = h('div', { class: 'code-proj' + (repo ? ' repo' : '') });
  const changed = () => { ctx.onChange(); r.refresh(); };

  const name = h('input', { class: 'code-name', placeholder: T('Progetto senza nome'), 'aria-label': T('Nome del progetto'), autocapitalize: 'off' });
  name.value = b.name || '';
  name.addEventListener('input', () => { b.name = name.value; changed(); });
  const langBadge = h('span', { class: 'code-lang' });
  const countBadge = h('span', { class: 'code-count' });

  const tabs = h('div', { class: 'code-tabs', role: 'tablist' });
  const tree = h('nav', { class: 'code-tree', 'aria-label': T('File del repository') });
  const ta = h('textarea', { class: 'code-src', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off', 'aria-label': T('Codice') });
  const gutter = h('pre', { class: 'code-gutter', 'aria-hidden': 'true' });
  const hlCode = h('code', {});
  const hl = h('pre', { class: 'code-hl', 'aria-hidden': 'true' }, hlCode);
  const layer = h('div', { class: 'code-layer' }, hl, ta);
  const edit = h('div', { class: 'code-edit', 'data-theme': codeTheme() }, gutter, layer);
  // riga del cursore e parentesi corrispondente: rettangoli sotto il testo colorato
  const band = h('div', { class: 'code-band', hidden: true });
  const mk1 = h('div', { class: 'code-bracket', hidden: true }), mk2 = h('div', { class: 'code-bracket', hidden: true });
  layer.prepend(band, mk1, mk2);
  let met = null;
  const metrics = () => {
    if (met) return met;
    const cs = getComputedStyle(ta);
    const c = document.createElement('canvas').getContext('2d');
    c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return (met = { lh: parseFloat(cs.lineHeight) || 21, cw: c.measureText('MMMMMMMMMM').width / 10, pad: parseFloat(cs.paddingTop) || 12 });
  };
  const posOf = (i) => {
    const v = ta.value, ls = v.lastIndexOf('\n', i - 1) + 1;
    const line = (v.slice(0, ls).match(/\n/g) || []).length;
    const col = v.slice(ls, i).replace(/\t/g, '    ').length;
    return { line, col };
  };
  const place = (el, i) => {
    const m = metrics(), p = posOf(i);
    el.style.top = `${m.pad + p.line * m.lh}px`;
    el.style.left = `${m.pad + p.col * m.cw - ta.scrollLeft}px`;
    el.style.width = `${m.cw}px`; el.style.height = `${m.lh}px`;
    el.hidden = false;
  };
  const OPEN = '([{', SHUT = ')]}';
  const matchOf = (i) => {
    const v = ta.value, ch = v[i];
    const o = OPEN.indexOf(ch), c = SHUT.indexOf(ch);
    if (o < 0 && c < 0) return -1;
    const dir = o >= 0 ? 1 : -1, me = ch, other = o >= 0 ? SHUT[o] : OPEN[c];
    let depth = 0;
    for (let j = i, n = 0; j >= 0 && j < v.length && n < 30000; j += dir, n++) {
      if (v[j] === me) depth++;
      else if (v[j] === other && --depth === 0) return j;
    }
    return -1;
  };
  let caretRaf = 0;
  const caretMarks = () => {
    caretRaf = 0;
    if (document.activeElement !== ta || ta.selectionStart !== ta.selectionEnd) { band.hidden = mk1.hidden = mk2.hidden = true; return; }
    const m = metrics(), pos = ta.selectionStart;
    band.style.top = `${m.pad + posOf(pos).line * m.lh}px`; band.style.height = `${m.lh}px`; band.hidden = false;
    let at = SHUT.includes(ta.value[pos - 1]) || OPEN.includes(ta.value[pos - 1]) ? pos - 1 : pos;
    const j = matchOf(at);
    if (j >= 0) { place(mk1, at); place(mk2, j); } else { mk1.hidden = mk2.hidden = true; }
  };
  const caretSoon = () => { if (!caretRaf) caretRaf = requestAnimationFrame(caretMarks); };
  ['keyup', 'click', 'focus', 'blur', 'select', 'input'].forEach((k) => ta.addEventListener(k, caretSoon));
  document.addEventListener('selectionchange', () => { if (document.activeElement === ta) caretSoon(); });

  // segnalazioni sui numeri di riga: controllo del codice mentre scrivi + errori del compilatore dopo Esegui
  const diag = { lint: new Map(), cc: new Map() }; // percorso → Map(riga → { level, msg })
  const diagLine = (n) => diag.cc.get(b.open)?.get(n) || diag.lint.get(b.open)?.get(n);
  const drawGutter = () => {
    const n = ta.value.split('\n').length;
    const out = [];
    for (let i = 1; i <= n; i++) { const d = diagLine(i); out.push(d ? `<span class="g-${d.level}">${i}</span>` : String(i)); }
    gutter.innerHTML = out.join('\n');
  };
  let lintT = 0;
  const lintSoon = () => {
    clearTimeout(lintT);
    lintT = setTimeout(() => {
      const byPath = new Map();
      if (/\.(c|h|cc|cpp|hpp|hh)$/i.test(b.open || '')) for (const x of lint(b.files)) { if (!byPath.has(x.path)) byPath.set(x.path, new Map()); const m = byPath.get(x.path); if (!m.has(x.line) || x.level === 'err') m.set(x.line, x); }
      diag.lint = byPath;
      drawGutter();
    }, 700);
  };
  const setCompileDiag = (text) => {
    const m = new Map();
    for (const x of (text || '').matchAll(/(?:\.\/|\/work\/)?([\w.+\-/]+\.(?:c|h|cc|cpp|cxx|hpp|hh)):(\d+)(?::\d+)?:\s*(error|warning|errore|avviso)[^:]*:\s*([^\n]+)/g)) {
      const f = b.files.find((y) => y.path === x[1] || y.path.endsWith('/' + x[1]) || x[1].endsWith('/' + y.path));
      if (!f) continue;
      if (!m.has(f.path)) m.set(f.path, new Map());
      const lv = /error|errore/.test(x[3]) ? 'err' : 'warn';
      const cur = m.get(f.path).get(+x[2]);
      if (!cur || lv === 'err') m.get(f.path).set(+x[2], { level: lv, msg: x[4].trim() });
    }
    diag.cc = m;
    drawGutter();
  };
  gutter.addEventListener('click', (e) => {
    const m = metrics();
    const n = Math.floor((e.clientY - gutter.getBoundingClientRect().top - m.pad) / m.lh) + 1;
    const d = diagLine(n);
    if (!d) return;
    cmpHint.hidden = false;
    cmpHint.classList.add('diag');
    cmpHint.textContent = T('Riga {n}: {messaggio}', { n, messaggio: d.msg });
    clearTimeout(cmpHint._t); cmpHint._t = setTimeout(() => { cmpHint.hidden = true; cmpHint.classList.remove('diag'); }, 7000);
  });

  let paintRaf = 0;
  const paint = () => {
    paintRaf = 0;
    const lang = hlLangOf(b.open || '');
    const v = ta.value;
    if (window.hljs && lang && v.length < 300000) {
      try { hlCode.innerHTML = window.hljs.highlight(v, { language: lang, ignoreIllegals: true }).value + '\n'; } catch { hlCode.textContent = v + '\n'; }
    } else hlCode.textContent = v + '\n';
    hl.scrollLeft = ta.scrollLeft;
  };
  const repaint = () => { if (!paintRaf) paintRaf = requestAnimationFrame(paint); };
  ta.addEventListener('scroll', () => { hl.scrollLeft = ta.scrollLeft; caretSoon(); });
  const mdView = h('div', { class: 'md code-md', hidden: true });
  const fileOf = () => b.files.find((f) => f.path === b.open);
  let lines = 0;
  const size = () => {
    ta.style.height = 'auto'; ta.style.height = Math.max(repo ? 320 : 160, ta.scrollHeight + 2) + 'px';
    const n = ta.value.split('\n').length;
    if (n !== lines) { lines = n; drawGutter(); }
  };
  ta.addEventListener('input', () => { const f = fileOf(); if (f) { f.text = ta.value; changed(); } size(); refCheck(); repaint(); lintSoon(); });
  // righe intere selezionate (per commenti, rientri, spostamenti)
  const lineSpan = () => {
    const v = ta.value, a = ta.selectionStart, z = ta.selectionEnd;
    const s0 = v.lastIndexOf('\n', a - 1) + 1;
    let e0 = v.indexOf('\n', z > a && v[z - 1] === '\n' ? z - 1 : z); if (e0 < 0) e0 = v.length;
    return [s0, e0];
  };
  const editLines = (fn) => {
    const [s0, e0] = lineSpan();
    const lines = ta.value.slice(s0, e0).split('\n');
    const out = fn(lines).join('\n');
    ta.setRangeText(out, s0, e0, 'select');
    ta.dispatchEvent(new Event('input'));
  };
  const commentMark = () => (/\.(py|sh|bash|rb|ya?ml|r|pl|toml|ini|cfg|conf)$|(^|\/)makefile$/i.test(b.open || '') ? '#' : '//');
  ta.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
    if (mod && e.key === 'Enter') { e.preventDefault(); r.runBtn.click(); return; }
    if (mod && k === 's') { e.preventDefault(); ctx.onSave?.(); ctx.toast(T('Salvato')); return; }
    if (mod && (k === '/' || e.code === 'Slash')) {
      e.preventDefault();
      const c = commentMark();
      editLines((ls) => {
        const all = ls.filter((l) => l.trim()).every((l) => l.trimStart().startsWith(c));
        return ls.map((l) => (!l.trim() ? l : all ? l.replace(new RegExp(`^(\\s*)${c.replace(/\//g, '\\/')} ?`), '$1') : l.replace(/^(\s*)/, `$1${c} `)));
      });
      return;
    }
    if (mod && (e.key === ']' || e.key === '[')) { e.preventDefault(); editLines((ls) => ls.map((l) => (e.key === ']' ? '    ' + l : l.replace(/^ {1,4}|^\t/, '')))); return; }
    if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); editLines((ls) => ls.map((l) => l.replace(/^ {1,4}|^\t/, ''))); return; }
    if (e.key === 'Tab' && ta.selectionStart !== ta.selectionEnd && ta.value.slice(ta.selectionStart, ta.selectionEnd).includes('\n')) { e.preventDefault(); editLines((ls) => ls.map((l) => '    ' + l)); return; }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const [s0, e0] = lineSpan(), v = ta.value, up = e.key === 'ArrowUp';
      const block = v.slice(s0, e0);
      if (up && s0 > 0) { const p0 = v.lastIndexOf('\n', s0 - 2) + 1; const prev = v.slice(p0, s0 - 1); ta.setRangeText(block + '\n' + prev, p0, e0, 'end'); ta.setSelectionRange(p0, p0 + block.length); }
      else if (!up && e0 < v.length) { let n1 = v.indexOf('\n', e0 + 1); if (n1 < 0) n1 = v.length; const next = v.slice(e0 + 1, n1); ta.setRangeText(next + '\n' + block, s0, n1, 'end'); ta.setSelectionRange(s0 + next.length + 1, s0 + next.length + 1 + block.length); }
      ta.dispatchEvent(new Event('input'));
      return;
    }
    if (mod && e.shiftKey && k === 'd') { e.preventDefault(); const [s0, e0] = lineSpan(); const blk = ta.value.slice(s0, e0); ta.setRangeText(blk + '\n' + blk, s0, e0, 'end'); ta.dispatchEvent(new Event('input')); return; }
    if (e.ctrlKey && (e.key === ' ' || e.code === 'Space')) { e.preventDefault(); cmp.refresh(); return; }
    if (mod && k === 'p' && repo) { e.preventDefault(); openSwitcher(); return; }
    if (e.key === 'Tab') { e.preventDefault(); put('    ', ta.selectionStart, ta.selectionEnd); }
  });

  // --- scrittura assistita: coppie, Invio, rientri (beforeinput: tastiera dell'iPad e tastiera fisica) ---------
  // Le modifiche passano da execCommand('insertText') quando c'è, così ⌘Z le annulla come il resto.
  const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
  const CLOSE = new Set([')', ']', '}', '"', "'", '`']);
  const UNIT = '    ';
  const put = (text, a, z, caret) => {
    ta.setSelectionRange(a, z);
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch {}
    if (!ok || ta.value.slice(a, a + text.length) !== text) { ta.setRangeText(text, a, z, 'end'); ta.dispatchEvent(new Event('input')); }
    if (caret != null) ta.setSelectionRange(a + caret, a + caret);
  };
  const inCode = () => /\.(c|h|cc|cpp|cxx|hpp|hh|py|m?js|ts|tsx|jsx|java|kt|go|rs|cs|swift|php|rb|lua|json|sh)$/i.test(b.open || '');
  ta.addEventListener('beforeinput', (e) => {
    if (!inCode()) return;
    const v = ta.value, a = ta.selectionStart, z = ta.selectionEnd;
    const prev = v[a - 1] || '', next = v[z] || '';
    if (e.inputType === 'insertText' && e.data?.length === 1) {
      const ch = e.data;
      // la chiusa c'è già subito dopo: si scavalca
      if (CLOSE.has(ch) && a === z && next === ch && (ch !== "'" || !/\w/.test(prev))) { e.preventDefault(); ta.setSelectionRange(a + 1, a + 1); return; }
      if (PAIRS[ch]) {
        const quote = ch === '"' || ch === "'" || ch === '`';
        if (a !== z) { e.preventDefault(); const sel = v.slice(a, z); put(ch + sel + PAIRS[ch], a, z); ta.setSelectionRange(a + 1, a + 1 + sel.length); return; } // racchiude la selezione
        if (quote && (/\w/.test(prev) || prev === ch)) return;           // apostrofo (l'array) o virgolette doppie volute
        if (/[\w$]/.test(next)) return;                                  // davanti a una parola non si chiude
        e.preventDefault(); put(ch + PAIRS[ch], a, z, 1); return;
      }
      // /* → /*  */ con il cursore in mezzo; #include < → <>
      if (ch === '*' && prev === '/' && a === z && /\.(c|h|cc|cpp|hpp|m?js|ts|java|go|rs|cs|kt|swift|php|css)$/i.test(b.open || '')) { e.preventDefault(); put('*  */', a, z, 2); return; }
      if (ch === '<' && a === z && /#\s*include\s*$/.test(v.slice(v.lastIndexOf('\n', a - 1) + 1, a)) && next !== '>') { e.preventDefault(); put('<>', a, z, 1); return; }
      // } su una riga di soli spazi: torna al livello del blocco
      if (ch === '}' && a === z) {
        const ls = v.lastIndexOf('\n', a - 1) + 1, before = v.slice(ls, a);
        if (before && /^\s+$/.test(before)) { e.preventDefault(); put(before.replace(/( {1,4}|\t)$/, '') + '}', ls, a); return; }
      }
    } else if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') {
      e.preventDefault();
      const ls = v.lastIndexOf('\n', a - 1) + 1, line = v.slice(ls, a);
      const base = /^\s*/.exec(line)[0];
      const opens = /[{(\[]\s*$/.test(line) || (/:\s*$/.test(line) && !/\/\/.*:\s*$/.test(line));
      const pairClose = { '{': '}', '(': ')', '[': ']' }[line.trimEnd().slice(-1)];
      if (pairClose && next === pairClose) { put('\n' + base + UNIT + '\n' + base, a, z, 1 + base.length + UNIT.length); return; } // {|} → blocco aperto
      // dentro un commento a blocco: la riga nuova continua con « * »
      const lastOpen = v.lastIndexOf('/*', a), lastClose = v.lastIndexOf('*/', a - 1);
      if (lastOpen >= 0 && lastOpen > lastClose && /^\s*(\/\*|\*)/.test(line)) { const star = /^\s*\/\*/.test(line) ? base + ' * ' : base + '* '; put('\n' + star, a, z); return; }
      put('\n' + base + (opens ? UNIT : ''), a, z);
      return;
    } else if (e.inputType === 'deleteContentBackward' && a === z && a > 0) {
      if (PAIRS[prev] && PAIRS[prev] === next) { e.preventDefault(); put('', a - 1, a + 1); return; } // (|) → niente
      const ls = v.lastIndexOf('\n', a - 1) + 1, before = v.slice(ls, a);
      if (before.length >= 2 && /^ +$/.test(before)) { e.preventDefault(); const n = ((before.length - 1) % UNIT.length) + 1; put('', a - n, a); return; } // rientro a blocchi
    }
  });

  // scheda della chiamata sotto il cursore (sem_open, mq_receive, pthread_cond_wait…)
  const refChip = h('button', { type: 'button', class: 'ref-chip', hidden: true });
  const refCard = h('div', { class: 'ref-card', hidden: true });
  let refWord = null;
  const refCheck = () => {
    const w = /\.(c|h|cc|cpp|hpp)$/i.test(b.open || '') ? refAt(ta.value, ta.selectionStart) : null;
    if (w === refWord) return;
    refWord = w; refChip.hidden = !w;
    if (w) refChip.textContent = `ⓘ ${w}`;
    if (!w) refCard.hidden = true;
  };
  ['keyup', 'click', 'select'].forEach((k) => ta.addEventListener(k, refCheck));
  refChip.addEventListener('click', () => {
    const x = REF[refWord];
    if (!x) return;
    refCard.hidden = !refCard.hidden || refCard.dataset.w !== refWord ? false : true;
    refCard.dataset.w = refWord;
    refCard.replaceChildren(...[
      h('div', { class: 'ref-head' }, h('strong', {}, refWord), x.sysv ? h('span', { class: 'ref-sysv' }, 'System V') : null, h('button', { type: 'button', class: 'ref-x', 'aria-label': T('Chiudi'), onclick: () => { refCard.hidden = true; } }, '×')),
      x.sysv ? h('p', {}, T('Nel corso si usano le IPC POSIX: al suo posto {posix}.', { posix: x.posix })) : h('pre', { class: 'ref-proto' }, x.proto),
      x.inc ? h('p', {}, h('b', {}, T('Include: ')), x.inc.map((i) => `#include <${i}>`).join('  ')) : null,
      x.link ? h('p', {}, h('b', {}, T('Link: ')), x.link) : null,
      x.ret ? h('p', {}, h('b', {}, T('Restituisce: ')), x.ret) : null,
      x.err ? h('p', {}, h('b', {}, T('Errori tipici: ')), x.err) : null,
      x.note ? h('p', {}, x.note) : null].filter(Boolean));
  });

  // apre un file alla riga indicata (dagli errori del compilatore, dal controllo, dalla radiografia)
  const gotoLine = (p, line) => {
    const f = b.files.find((x) => x.path === p) || b.files.find((x) => x.path.endsWith('/' + p) || p.endsWith('/' + x.path));
    if (!f) { ctx.toast(T('{file} non è tra i file del progetto', { file: p })); return; }
    if (b.open !== f.path) { b.open = f.path; draw(); }
    requestAnimationFrame(() => {
      const ls = ta.value.split('\n');
      const n = Math.max(1, Math.min(line, ls.length));
      const start = ls.slice(0, n - 1).join('\n').length + (n > 1 ? 1 : 0);
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(start, start + ls[n - 1].length);
      const lh = parseFloat(getComputedStyle(ta).lineHeight) || 21;
      const y = ta.getBoundingClientRect().top + 12 + (n - 1) * lh;
      const sc = edit.scrollHeight > edit.clientHeight + 2 ? edit : ta.closest('.ed-scroll'); // in modalità IDE scorre l'editor
      if (sc) sc.scrollTo({ top: sc.scrollTop + y - sc.getBoundingClientRect().top - sc.clientHeight / 3, behavior: 'smooth' });
      gutter.dataset.hl = n;
      gutter.style.setProperty('--hl', `${12 + (n - 1) * lh}px`);
      setTimeout(() => { delete gutter.dataset.hl; }, 1800);
    });
  };

  const drawTabs = () => {
    tabs.replaceChildren(...b.files.map((f) => h('button', { type: 'button', role: 'tab', class: 'code-tab' + (f.path === b.open ? ' on' : ''), onclick: () => { b.open = f.path; draw(); changed(); } }, f.path)),
      h('button', { type: 'button', class: 'code-tab add', 'aria-label': T('Nuovo file'), onclick: () => addFile() }, T('+ File')));
  };
  // cartelle: quelle con dentro qualcosa si ricavano dai percorsi dei file; in b.dirs restano solo quelle vuote
  const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const cleanPath = (s) => (s || '').trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
  const badPath = (p) => !p || p.split('/').some((s) => !s.trim() || s === '.' || s === '..');
  const hasUnder = (d) => b.files.some((f) => f.path.startsWith(d + '/')) || (b.dirs || []).some((x) => x.startsWith(d + '/'));
  const dirExists = (d) => hasUnder(d) || (b.dirs || []).includes(d);
  const tidyDirs = () => { if (!b.dirs) return; b.dirs = [...new Set(b.dirs)].filter((d) => !hasUnder(d)); if (!b.dirs.length) delete b.dirs; };
  const keepDir = (p) => { const d = dirOf(p); if (d && !hasUnder(d)) (b.dirs ||= []).push(d); }; // la cartella resta anche se se ne va l'ultimo file
  const openDir = (p) => { const closed = closedDirs.get(b.id); if (closed) for (let a = p; a; a = dirOf(a)) closed.delete(a); };
  const folderIco = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 7.5a2 2 0 0 1 2-2h3.6l2 2.2h7.4a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M12 11.2v5M9.5 13.7h5"/></svg>';
  const fileBtn = h('button', { type: 'button', class: 'tree-add', title: T('Nuovo file'), 'aria-label': T('Nuovo file'), onclick: () => addFile() });
  fileBtn.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z"/><path d="M13.5 3.5V9H19M12 11.8v5M9.5 14.3h5"/></svg>';
  const dirBtn = (parent, label) => { const x = h('button', { type: 'button', class: 'tree-add', title: label, 'aria-label': label, onclick: () => addDir(parent) }); x.innerHTML = folderIco; return x; };
  const drawTree = () => {
    const closed = closedDirs.get(b.id) || new Set();
    closedDirs.set(b.id, closed);
    const rootN = { dirs: new Map(), files: [] };
    const nodeAt = (parts) => {
      let n = rootN, acc = '';
      for (const d of parts) { acc += (acc ? '/' : '') + d; if (!n.dirs.has(d)) n.dirs.set(d, { dirs: new Map(), files: [], path: acc }); n = n.dirs.get(d); }
      return n;
    };
    for (const d of b.dirs || []) nodeAt(d.split('/'));
    for (const f of b.files) nodeAt(f.path.split('/').slice(0, -1)).files.push(f);
    const rows = [];
    const walk = (n, depth) => {
      for (const [d, sub] of [...n.dirs].sort((a, c) => a[0].localeCompare(c[0]))) {
        const shut = closed.has(sub.path);
        const empty = !sub.dirs.size && !sub.files.length;
        rows.push(h('div', { class: 'tree-row dir', style: `--d:${depth}` },
          h('button', { type: 'button', class: 'tree-name', onclick: () => { shut ? closed.delete(sub.path) : closed.add(sub.path); drawTree(); } }, h('span', { class: 'tree-caret' }, shut ? '▸' : '▾'), d, empty ? h('small', { class: 'tree-empty' }, 'vuota') : null),
          empty ? h('button', { type: 'button', class: 'tree-add', title: T('Elimina la cartella vuota'), 'aria-label': T('Elimina la cartella vuota {cartella}', { cartella: sub.path }), onclick: () => removeDir(sub.path) }, '×') : null,
          dirBtn(sub.path + '/', T('Nuova cartella in {cartella}', { cartella: sub.path })),
          h('button', { type: 'button', class: 'tree-add', title: T('Nuovo file in {cartella}', { cartella: sub.path }), 'aria-label': T('Nuovo file in {cartella}', { cartella: sub.path }), onclick: () => addFile(sub.path + '/') }, '+')));
        if (!shut) walk(sub, depth + 1);
      }
      for (const f of [...n.files].sort((a, c) => a.path.localeCompare(c.path))) {
        rows.push(h('button', { type: 'button', class: 'tree-row file' + (f.path === b.open ? ' on' : ''), style: `--d:${depth}`, onclick: () => { b.open = f.path; draw(); changed(); } },
          h('span', { class: 'tree-ico' }, fileIcon(f.path)), f.path.split('/').pop()));
      }
    };
    walk(rootN, 0);
    tree.replaceChildren(h('div', { class: 'tree-head' }, h('span', { class: 'tree-title' }, T('File')),
      dirBtn('', T('Nuova cartella')), fileBtn), ...rows);
  };
  const filePath = h('span', { class: 'code-path' });
  let mdPreview = true;
  const mdToggle = h('button', { type: 'button', hidden: true, onclick: () => { mdPreview = !mdPreview; draw(); } });
  const draw = () => {
    if (repo) drawTree(); else drawTabs();
    const lang = projectLang(b);
    langBadge.textContent = lang ? LANGS[lang].label : '—';
    countBadge.textContent = quantiFile(b.files.length);
    const f = fileOf();
    const isMd = !!f && /\.md$/i.test(f.path);
    ta.value = f ? f.text : '';
    ta.disabled = !f;
    fileTools.hidden = !f;
    filePath.textContent = f ? f.path : T('Nessun file: tocca + File');
    mdToggle.hidden = !isMd;
    mdToggle.textContent = mdPreview ? T('Modifica') : T('Anteprima');
    const showMd = isMd && mdPreview;
    edit.hidden = showMd; mdView.hidden = !showMd;
    if (showMd) { mdView.innerHTML = renderMarkdown(f.text || T('*File vuoto*')); enhance(mdView); }
    refWord = null; refChip.hidden = true; refCard.hidden = true;
    lines = 0;
    cmp.hide(); cmpHint.hidden = true;
    paint(); lintSoon();
    requestAnimationFrame(size);
    r.refresh();
  };
  function addFile(dir = '') {
    const lang = projectLang(b) || 'c';
    const ext = { c: '.c', cpp: '.cpp', python: '.py', js: '.js' }[lang];
    let p = prompt(T('Nome del nuovo file (anche dentro cartelle, es. src/lista.c)'), dir + 'nuovo' + ext);
    if (p == null) return;
    p = cleanPath(p);
    if (badPath(p)) { ctx.toast(T('Nome non valido: scrivi un nome, senza parti vuote, «.» o «..»')); return; }
    if (b.files.some((f) => f.path === p)) { ctx.toast(T('Esiste già un file con questo nome')); return; }
    if (dirExists(p)) { ctx.toast(T('C\'è già una cartella con questo nome: scegline un altro')); return; }
    b.files.push({ path: p, text: '' }); b.open = p; tidyDirs(); openDir(dirOf(p)); draw(); changed();
  }
  function addDir(parent = '') {
    let p = prompt(T('Nome della nuova cartella (anche più livelli, es. src/util)'), parent + 'nuova');
    if (p == null) return;
    p = cleanPath(p);
    if (badPath(p)) { ctx.toast(T('Nome non valido: scrivi un nome, senza parti vuote, «.» o «..»')); return; }
    if (b.files.some((f) => f.path === p || p.startsWith(f.path + '/'))) { ctx.toast(T('C\'è già un file con questo nome: scegline un altro')); return; }
    if (dirExists(p)) { ctx.toast(T('Esiste già una cartella con questo nome')); return; }
    (b.dirs ||= []).push(p); tidyDirs(); openDir(p); draw(); changed();
    ctx.toast(T('Cartella {cartella} creata: tocca + accanto per aggiungerci un file', { cartella: p }));
  }
  function removeDir(p) {
    if (!b.dirs?.includes(p)) return;
    const before = [...b.dirs];
    b.dirs = b.dirs.filter((x) => x !== p); keepDir(p); tidyDirs(); draw(); changed();
    ctx.toast(T('Cartella {cartella} eliminata', { cartella: p }), { label: tp('azione', 'Annulla'), fn: () => { b.dirs = before; tidyDirs(); draw(); changed(); } });
  }
  const fileTools = h('div', { class: 'code-filetools' },
    repo ? filePath : null, mdToggle, refChip,
    h('button', { type: 'button', onclick: () => {
      const f = fileOf(); if (!f) return;
      const raw = prompt(T('Nuovo nome del file (puoi anche spostarlo in una cartella)'), f.path);
      if (raw == null) return;
      const p = cleanPath(raw);
      if (p === f.path) return;
      if (badPath(p)) { ctx.toast(T('Nome non valido: scrivi un nome, senza parti vuote, «.» o «..»')); return; }
      if (b.files.some((x) => x.path === p)) { ctx.toast(T('Esiste già un file con questo nome')); return; }
      if (dirExists(p)) { ctx.toast(T('C\'è già una cartella con questo nome: scegline un altro')); return; }
      const old = f.path;
      f.path = p; b.open = p; if (repo) keepDir(old); tidyDirs(); openDir(dirOf(p)); draw(); changed();
    } }, T('Rinomina')),
    ctx.confirmBtn(T('Elimina file'), () => {
      const i = b.files.findIndex((x) => x.path === b.open); if (i < 0) return;
      const [gone] = b.files.splice(i, 1); b.open = b.files[0]?.path || null; if (repo) keepDir(gone.path); draw(); changed();
      ctx.toast(T('{file} eliminato', { file: gone.path }), { label: tp('azione', 'Annulla'), fn: () => { b.files.splice(i, 0, gone); b.open = gone.path; tidyDirs(); draw(); changed(); } });
    }, 'danger'));

  const stdin = h('textarea', { class: 'code-stdin', placeholder: T('Quello che il programma legge da tastiera (scanf, cin, input), una riga per volta'), spellcheck: 'false', autocapitalize: 'off', 'aria-label': T('Input del programma') });
  stdin.value = b.stdin;
  stdin.addEventListener('input', () => { b.stdin = stdin.value; changed(); });
  const stdinBox = h('details', { class: 'code-stdin-box' }, h('summary', {}, T('Input (stdin)')), stdin);
  if (b.stdin) stdinBox.open = true;

  const r = runner(() => {
    const lang = projectLang(b);
    const main = lang === 'python' || lang === 'js' ? (extLang(b.open || '') === lang ? b.open : b.files.find((f) => extLang(f.path) === lang)?.path) : null;
    return { lang, files: b.files.map((f) => ({ path: f.path, text: f.text })), main, stdin: b.stdin };
  }, { onLoc: gotoLine, onDiag: (t) => setCompileDiag(t) });

  // suggerimenti di completamento (riga di pulsanti sotto il codice) e firma della funzione
  const cmpBar = h('div', { class: 'cmp-bar', hidden: true, role: 'listbox', 'aria-label': T('Suggerimenti') });
  const cmpHint = h('div', { class: 'cmp-hint', hidden: true });
  const cmp = attachCompletion(ta, { getFiles: () => b.files, getPath: () => b.open, bar: cmpBar, hint: cmpHint });

  // tema dei colori
  const themeMenu = h('div', { class: 'theme-menu', hidden: true });
  const drawThemes = () => themeMenu.replaceChildren(...CODE_THEMES.map(([k, l]) => h('button', { type: 'button', class: 'theme-dot' + (codeTheme() === k ? ' on' : ''), 'data-theme': k, onclick: () => { setCodeTheme(k); drawThemes(); } },
    h('span', { class: 'theme-sw' }, h('i', {}), h('i', {}), h('i', {})), l)));
  const themeBtn = h('button', { type: 'button', class: 'btn small icon-only', title: T('Tema dei colori del codice'), 'aria-label': T('Tema dei colori del codice'), onclick: () => { drawThemes(); themeMenu.hidden = !themeMenu.hidden; } });
  themeBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.3-1-1.6-1-2.6 0-.9.7-1.5 1.7-1.5H17a3.5 3.5 0 0 0 3.5-3.5c0-4.3-3.8-7.7-8.5-7.7z"/><circle cx="7.6" cy="11" r="1.1"/><circle cx="10.5" cy="7.3" r="1.1"/><circle cx="15" cy="7.6" r="1.1"/></svg>';

  // apertura rapida di un file del repository (⌘P / Ctrl+P)
  function openSwitcher() {
    const box = h('div', { class: 'switcher' });
    const q = h('input', { placeholder: T('Vai al file…'), autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': T('Nome del file') });
    const list = h('div', { class: 'switcher-list' });
    let sel = 0, hits = [];
    const close = () => { box.remove(); ta.focus(); };
    const go = (f) => { if (f) { b.open = f.path; draw(); changed(); } close(); };
    const fill = () => {
      const t = q.value.toLowerCase();
      hits = b.files.filter((f) => !t || f.path.toLowerCase().includes(t)).sort((a, c) => (a.path.toLowerCase().split('/').pop().startsWith(t) ? -1 : 0) - (c.path.toLowerCase().split('/').pop().startsWith(t) ? -1 : 0)).slice(0, 12);
      sel = Math.min(sel, Math.max(0, hits.length - 1));
      list.replaceChildren(...hits.map((f, i) => h('button', { type: 'button', class: 'switcher-row' + (i === sel ? ' on' : ''), onpointerdown: (e) => { e.preventDefault(); go(f); } }, h('span', { class: 'tree-ico' }, fileIcon(f.path)), f.path)));
    };
    q.addEventListener('input', () => { sel = 0; fill(); });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(hits.length - 1, sel + 1); fill(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); fill(); }
      else if (e.key === 'Enter') { e.preventDefault(); go(hits[sel]); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    q.addEventListener('blur', () => setTimeout(() => box.isConnected && close(), 150));
    box.append(q, list);
    root.append(box);
    fill(); q.focus();
  }

  // importa: da zip o da GitHub (sostituisce i file, con «Annulla»)
  const replaceFiles = (files, skipped, newName) => {
    if (!files.length) { ctx.toast(T('Nessun file di testo da importare')); return; }
    const before = { files: b.files, open: b.open, name: b.name };
    b.files = files;
    b.open = pickOpen(files);
    if (!b.name && newName) { b.name = newName; name.value = newName; ctx.onName?.(newName); }
    draw(); changed();
    ctx.toast(tn(files.length, '{n} file importato', '{n} file importati') + (skipped ? ', ' + T('{n} saltati (binari o troppo grandi)', { n: skipped }) : ''), { label: tp('azione', 'Annulla'), fn: () => { Object.assign(b, before); name.value = b.name || ''; draw(); changed(); } });
  };
  const zipInput = h('input', { type: 'file', accept: '.zip,application/zip', hidden: true });
  zipInput.addEventListener('change', async () => {
    const f = zipInput.files[0]; zipInput.value = '';
    if (!f) return;
    try { const res = await filesFromZip(new Uint8Array(await f.arrayBuffer())); replaceFiles(res.files, res.skipped, f.name.replace(/\.zip$/i, '')); }
    catch (e) { ctx.toast(T('Zip non leggibile: ') + e.message); }
  });
  const ghInput = h('input', { class: 'code-gh', placeholder: T('proprietario/nome o indirizzo github.com'), autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': T('Repository GitHub') });
  const ghBtn = h('button', { type: 'button', class: 'btn small primary', onclick: async () => {
    ghBtn.disabled = true; ghBtn.textContent = T('Scarico…');
    try { const res = await filesFromGithub(ghInput.value); replaceFiles(res.files, res.skipped, res.name); importBox.hidden = true; }
    catch (e) { ctx.toast(e.message); }
    finally { ghBtn.disabled = false; ghBtn.textContent = T('Importa'); }
  } }, T('Importa'));
  const importBox = h('div', { class: 'code-import', hidden: true },
    h('button', { type: 'button', class: 'btn small', onclick: () => zipInput.click() }, T('Da uno zip…')),
    h('span', { class: 'code-or' }, T('oppure da GitHub (solo repository pubblici):')),
    h('div', { class: 'code-gh-row' }, ghInput, ghBtn), zipInput);

  // modalità IDE: il codice a tutto schermo (la gestisce app.js con ctx.onIde)
  const ideBtn = repo && ctx.onIde ? h('button', { type: 'button', class: 'btn small ide-btn', title: T('Modalità IDE: il codice a tutto schermo ({tasti})', { tasti: `${MOD} ⇧ E` }), onclick: () => ctx.onIde() }) : null;
  const drawIde = () => { if (!ideBtn) return; const on = !!ctx.ideOn?.(); ideBtn.classList.toggle('on', on); ideBtn.innerHTML = on ? '<svg viewBox="0 0 24 24"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg><span>Esci</span>' : '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg><span>IDE</span>'; };
  drawIde();
  const ideName = repo ? h('span', { class: 'ide-name' }, ctx.repoName?.() || '') : null;
  const head = h('div', { class: 'code-head' }, langBadge, ideName, repo ? countBadge : name, repo ? h('span', { class: 'spacer' }) : null,
    ctx.extraHead || null, themeBtn, ideBtn,
    h('button', { type: 'button', class: 'btn small', onclick: () => { importBox.hidden = !importBox.hidden; } }, T('Importa')),
    h('button', { type: 'button', class: 'btn small', onclick: () => exportZip({ ...b, name: b.name || ctx.repoName?.() }).catch((e) => ctx.toast(T('Esportazione non riuscita: ') + e.message)) }, T('Esporta zip')));
  const main = h('div', { class: 'repo-main' }, fileTools, refCard, cmpHint, edit, cmpBar, mdView);
  if (repo) root.append(head, themeMenu, importBox, h('div', { class: 'repo-body' }, tree, main), h('div', { class: 'run-panel' }, stdinBox, r.bar, r.out, r.extra));
  else root.append(head, themeMenu, importBox, tabs, refCard, cmpHint, edit, cmpBar, fileTools, stdinBox, r.bar, r.out, r.extra);
  root.addEventListener('click', (e) => e.stopPropagation());
  root.refreshIde = () => { drawIde(); if (ideName) ideName.textContent = ctx.repoName?.() || ''; lines = 0; requestAnimationFrame(size); };
  draw();
  return root;
}

// Anteprima per la galleria: le prime righe del file aperto
export function codePreview(b) {
  const f = (b.files || []).find((x) => x.path === b.open) || b.files?.[0];
  return h('pre', { class: 'prev-code' }, (b.name ? `// ${b.name}\n` : '') + (f ? f.text.split('\n').slice(0, 24).join('\n') : ''));
}

export const runAvailable = () => !!store.run?.available;
