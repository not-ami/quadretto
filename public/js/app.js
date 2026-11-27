import { store, uuid, setLocalUser, api } from './store.js';
import { ensureUser, logout, showLogin, changePasswordForm } from './auth.js';
import { InkBoard, inkPrefs, inkView, inkTouch, hlColor, savePrefs, prefsHooks, thumb, inkPreview } from './ink.js';
import { initMotion, drag, spring, rubber, viewTransition, measure, flip, reduced } from './motion.js';
import { renderCodeBlock, addRunButtons, newProject, codePreview, LANGS, pickOpen, filesFromZip, filesFromGithub, projectLang, MOD } from './code.js';
import { renderMarkdown, enhance, toggleTask } from './md.js';
import { formatBar, formatKeys, listIndent, autoFormat, FORMAT_SHORTCUTS } from './fmt.js';
import { chartBlock, renderChart, newChart, CHART_KINDS } from './charts.js';
import { openPrint } from './print.js';
import { COURSES, COLORS, colorFor, codeFrom, TRACKS, isCodeNotebook, looksLikeCode, courseOf } from './courses.js';
import { TOOLS, toolsFor, renderTool, newTool, TEMPLATES as REPO_TEMPLATES } from './so-tools.js';
import { VERSION, SOURCE_URL } from './version.js';
// In questo file t è spesso una variabile locale: la traduzione si chiama T() (vedi i18n.js).
import { t as T, tp, tn, getLang, setLang, LANGS as UI_LANGS, fmtDate, locale } from './i18n.js';
import { live } from './live.js';
import { initCollab, collab, isReadOnly, decorateBar, renderReadOnly, shareSheet, sharedNotebookSheet, homeSection } from './collab.js';
import { CHANGELOG } from './changelog.js';
import { readPdf, pageBlocks, renderPage, setQuiet as pdfQuiet } from './pdfdoc.js';

// --- utilità ---------------------------------------------------------------
const $ = (s, el = document) => el.querySelector(s);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('--')) el.style.setProperty(k, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
}
const svg = (d, extra = '') => { const s = document.createElement('span'); s.innerHTML = `<svg viewBox="0 0 24 24" ${extra}>${d}</svg>`; return s.firstChild; };
const I = {
  chart: '<path d="M4 20h16"/><rect x="6" y="11" width="3" height="7" rx=".6"/><rect x="11" y="6" width="3" height="12" rx=".6"/><rect x="16" y="9" width="3" height="9" rx=".6"/>',
  pdf: '<path d="M6.5 3.5h8l4 4v13h-12z"/><path d="M14.5 3.5v4h4"/><path d="M12 10.5v6M9.5 14l2.5 2.5 2.5-2.5"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  pin: '<path d="M9 4h6l-1 6 4 4H6l4-4z"/><path d="M12 14v6"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  text: '<path d="M5 6h14M12 6v13M9 19h6"/>',
  pen: '<path d="M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10z"/><path d="M14 7l3 3"/>',
  hl: '<path d="M9 14l-3 3v3h3l3-3"/><path d="M9 14l6-9 4 4-9 6z"/><path d="M14 20h6"/>',
  eraser: '<path d="M8 20h12"/><path d="M4.5 14.5l8-8a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L11 18H7.5z"/><path d="M9 10l5 5"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  photo: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 8"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  move: '<path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M10 13h6M13 10l3 3-3 3"/>',
  share: '<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="M8.2 10.8l7.6-4.1M8.2 13.2l7.6 4.1"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  grid: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  all: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  restore: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.6"/><path d="M4 4v4.6h4.6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  lasso: '<path d="M12 4c4.7 0 8 2.3 8 5.3S16.7 15 12 15c-1.2 0-2.3-.1-3.3-.4"/><path d="M12 4C7.3 4 4 6.3 4 9.3c0 1.7 1.1 3.2 3 4.2" stroke-dasharray="2.2 2.2"/><path d="M8.5 13.5c-1 .6-1.5 1.5-1.5 2.5 0 1.7 1.3 3 3 3 1 0 2-.6 2-1.6s-1.2-1.4-2.4-1"/>',
  home: '<path d="M4 11l8-6.5 8 6.5"/><path d="M6 9.5V19a1 1 0 0 0 1 1h3.5v-5.5h3V20H17a1 1 0 0 0 1-1V9.5"/>',
  shapes: '<rect x="3.5" y="11" width="9" height="9" rx="1"/><circle cx="15.5" cy="8.5" r="5"/>',
  code: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
  repo: '<path d="M6 4h9l3 3v13H6z"/><path d="M15 4v3h3"/><path d="M10 11l-2 2 2 2M14 11l2 2-2 2"/>',
  tools: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.8-.7-.7-2.8z"/>',
  hand: '<path d="M7 11V6a1.5 1.5 0 0 1 3 0v4M10 10V4.5a1.5 1.5 0 0 1 3 0V10M13 10V5.5a1.5 1.5 0 0 1 3 0V11M16 11V8a1.5 1.5 0 0 1 3 0v6a7 7 0 0 1-7 7h-.5a6.5 6.5 0 0 1-5.3-2.8L4 15a1.6 1.6 0 0 1 2.6-1.8L7 14"/>',
};
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
function when(iso) {
  const d = new Date(iso), now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return T('adesso');
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), 'minute');
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  if (diff < 6 * 86400) return d.toLocaleDateString(locale(), { weekday: 'short' }) + ' ' + d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
function daysTo(date) {
  if (!date) return null;
  const t = new Date(date + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((t - today) / 86400000);
}

const pad2 = (n) => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
function fmtDur(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${pad2(m % 60)}`;
}

let toastTimer;
function toast(msg, action) {
  const t = $('#toast');
  t.replaceChildren(h('span', {}, msg));
  if (action) t.append(h('button', { onclick: () => { t.hidden = true; action.fn(); } }, action.label));
  t.style.removeProperty('--tx'); t.style.removeProperty('--ty'); t.style.opacity = '';
  if (!t.hidden) { t.classList.remove('again'); void t.offsetWidth; t.classList.add('again'); }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, action ? (action.label === T('Aggiorna') ? 600000 : 6000) : 3200);
}

// --- tema ------------------------------------------------------------------
const prefs = { theme: 'auto', paper: 'grid', wide: false, ...ls.get('prefs', {}) };
const mq = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const dark = prefs.theme === 'dark' || (prefs.theme === 'auto' && mq.matches);
  document.documentElement.classList.toggle('is-dark', dark);
  boards.forEach((b) => b.redraw());
  if (typeof renderList === 'function' && layout === 'gallery') renderList();
}
mq.addEventListener('change', applyTheme);

// --- stato ----------------------------------------------------------------
const app = $('#app');
const ui = {
  view: { kind: 'home' }, // si parte sempre dalla Home
  query: '',
  searchHits: null,
  noteId: null,
  note: null,
  active: null, // id del blocco attivo
  editing: null, // id del blocco di testo in modifica
};
const boards = new Map();
let layout = ls.get('layout', 'list'); // list | gallery
// Mentre la penna scrive (e subito dopo) niente salvataggi né ridisegni: tengono occupato il processore e la penna "arriva in ritardo"
const pen = { down: false, last: 0 };
let lastBoardId = null;
const penQuiet = () => !pen.down && Date.now() - pen.last > 900;
pdfQuiet(penQuiet); // le pagine dei PDF si disegnano solo a penna ferma
const narrow = () => matchMedia('(max-width: 1023px)').matches;
const nbById = (id) => store.notebooks.find((n) => n.id === id);
// --- 2026.11.4: profilo di studio e quaderni smart -------------------------------------------------
const profile = () => store.settings.profile || null;
const smartOn = () => profile()?.smart !== false;
const isEng = () => profile()?.track === 'ing-inf';
const codeNb = (nb) => smartOn() && isCodeNotebook(nb);
const isRepo = (n) => n?.kind === 'repo';
const reposOf = (nbId) => [...store.notes.values()].filter((n) => !n.deleted_at && isRepo(n) && n.notebook_id === nbId).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
async function saveProfile(patch) { await store.saveSettings({ ...store.settings, profile: { smart: true, ...(profile() || {}), ...patch } }); }

// --- barra laterale ---------------------------------------------------------
function counts() {
  const c = new Map(); let all = 0, pinned = 0, trash = 0;
  for (const n of store.notes.values()) {
    if (n.deleted_at) { trash++; continue; }
    all++; if (n.pinned) pinned++;
    c.set(n.notebook_id, (c.get(n.notebook_id) || 0) + 1);
  }
  return { c, all, pinned, trash };
}

function renderSide() {
  const nav = $('#side-nav');
  const { c, all, pinned, trash } = counts();
  const is = (kind, id) => ui.view.kind === kind && (id === undefined || ui.view.id === id) && !ui.query;
  const link = (kind, icon, label, n, id) => h('button', { class: 'side-link' + (is(kind, id) ? ' active' : ''), onclick: () => go({ kind, id }) }, svg(icon), label, h('span', { class: 'count' }, n || ''));
  const frag = [
    link('home', I.home, T('Home'), ''),
    link('recent', I.all, T('Tutti gli appunti'), all),
    link('pinned', I.pin, T('Fissati'), pinned),
  ];
  const groups = [[1, T('{n}° anno', { n: 1 })], [2, T('{n}° anno', { n: 2 })], [3, T('{n}° anno', { n: 3 })], [null, T('Altri quaderni')]];
  const active = store.notebooks.filter((n) => !n.archived);
  for (const [y, label] of groups) {
    const list = active.filter((n) => (n.year ?? null) === y);
    if (!list.length && y !== null) continue;
    const head = h('div', { class: 'side-group-head' }, label);
    if (y === null) head.append(h('button', { onclick: () => notebookSheet() }, T('+ Nuovo')));
    frag.push(h('div', { class: 'side-group' }, head, list.map((nb) => nbRow(nb, c.get(nb.id)))));
  }
  const arch = store.notebooks.filter((n) => n.archived);
  if (arch.length) frag.push(h('div', { class: 'side-group' }, h('div', { class: 'side-group-head' }, T('Archivio')), arch.map((nb) => nbRow(nb, c.get(nb.id)))));
  frag.push(h('div', { class: 'side-group' }, link('trash', I.trash, T('Cestino'), trash)));
  nav.replaceChildren(...frag);
}

function nbRow(nb, n) {
  const d = daysTo(nb.exam_date);
  return h('button', { class: 'nb-row' + (ui.view.kind === 'notebook' && ui.view.id === nb.id && !ui.query ? ' active' : ''), onclick: () => go({ kind: 'notebook', id: nb.id }) },
    h('span', { class: 'nb-code', '--c': nb.color }, nb.code || codeFrom(nb.title)),
    h('span', { class: 'nb-name' }, nb.title, nb.shared ? h('small', { class: 'nb-owner' }, ' · ' + nb.shared.owner_name) : null),
    d != null && d >= 0 && d <= 60 ? h('span', { class: 'nb-exam' + (d <= 7 ? ' soon' : ''), title: T('Giorni all\'esame') }, d === 0 ? 'oggi' : `${d} g`) : h('span', { class: 'count' }, n || ''));
}

function go(view) {
  navSeq++;
  viewTransition(() => {
    ui.view = view;
    ui.query = ''; $('#search').value = ''; ui.searchHits = null;
    app.classList.remove('side-open');
    if (narrow() || view.kind === 'home') closeNote();
    renderSide(); renderList(); renderHome();
  }, 'fade');
}
// entrata a cascata degli elementi, solo quando si arriva in una vista (non a ogni aggiornamento)
let navSeq = 0;
function stagger(container, key, sel, max = 14) {
  if (reduced() || container.dataset.enterKey === key) return;
  container.dataset.enterKey = key;
  [...container.querySelectorAll(sel)].slice(0, max).forEach((el, i) => { el.style.setProperty('--i', i); el.classList.add('enter'); });
}

// --- home ---------------------------------------------------------------------
// Ultima attività di ogni quaderno: l'appunto modificato più di recente (o la creazione del quaderno)
function notebookActivity() {
  const act = new Map();
  for (const n of store.notes.values()) {
    if (n.deleted_at || !n.notebook_id) continue;
    const a = act.get(n.notebook_id);
    if (!a) act.set(n.notebook_id, { count: 1, last: n });
    else { a.count++; if (new Date(n.updated_at) > new Date(a.last.updated_at)) a.last = n; }
  }
  return act;
}

function renderHome() {
  const home = $('#home');
  const on = ui.view.kind === 'home' && !ui.query;
  app.dataset.home = on ? 'on' : 'off';
  if (!on) return;
  const act = notebookActivity();
  const stamp = (nb) => new Date(act.get(nb.id)?.last.updated_at || nb.updated_at || nb.created_at);
  const nbs = store.notebooks.filter((n) => !n.archived).sort((a, b) => stamp(b) - stamp(a));
  const hour = new Date().getHours();
  const hello = hour < 6 ? T('Buonanotte') : hour < 13 ? T('Buongiorno') : hour < 18 ? T('Buon pomeriggio') : T('Buonasera');
  const today = new Date().toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });

  const exams = store.notebooks.filter((n) => !n.archived && n.exam_date).map((n) => ({ nb: n, d: daysTo(n.exam_date) }))
    .filter((x) => x.d >= 0 && x.d <= 90).sort((a, b) => a.d - b.d);

  const head = h('header', { class: 'home-head' },
    h('button', { class: 'icon-btn only-narrow has-dot', 'aria-label': T('Apri quaderni'), onclick: () => app.classList.add('side-open') }, svg('<path d="M4 7h16M4 12h16M4 17h10"/>'), h('span', { class: 'news-dot', hidden: !hasNews() })),
    h('button', { class: 'icon-btn only-wide', 'aria-label': T('Mostra o nascondi quaderni'), onclick: toggleSide }, svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9 4.5v15"/>')),
    h('div', { class: 'home-hello' }, h('h1', {}, hello), h('p', {}, today)),
    h('button', { class: 'btn primary home-new', onclick: () => { ui.view = { kind: 'recent' }; newNote(); } }, svg(I.plus), T('Nuovo appunto')));

  const sections = [head, ...homeTop()];
  if (!profile()) sections.push(h('section', { class: 'profile-hint' },
    h('div', {}, h('h2', {}, T('Che cosa studi?')), h('p', {}, T('Con il profilo i quaderni diventano smart: i corsi di programmazione hanno anche i repository di codice e, per Ingegneria Informatica, compaiono gli strumenti dei corsi (Sistemi Operativi: radiografia dei programmi, prova di stress, cacciatore di race condition, scheduling, quiz).'))),
    h('div', { class: 'profile-opts' }, TRACKS.map((t) => h('button', { class: 'profile-opt', onclick: () => saveProfile({ track: t.k }).then(() => { toast(T('Profilo salvato: si cambia in Impostazioni')); renderHome(); renderList(); }) }, h('strong', {}, t.label), h('small', {}, t.sub))),
      h('button', { class: 'home-more', onclick: () => saveProfile({ track: 'none' }).then(renderHome) }, T('Non ora')))));
  if (exams.length) {
    sections.push(h('section', { class: 'home-sec' },
      h('h2', { class: 'home-label' }, T('Prossimi esami')),
      h('div', { class: 'exam-row' }, exams.map(({ nb, d }) => h('button', { class: 'exam-chip' + (d <= 7 ? ' soon' : ''), onclick: () => go({ kind: 'notebook', id: nb.id }) },
        h('span', { class: 'nb-code', '--c': nb.color }, nb.code || codeFrom(nb.title)),
        h('span', { class: 'exam-name' }, nb.title),
        h('span', { class: 'exam-days' }, d === 0 ? T('oggi') : d === 1 ? T('domani') : T('tra {d} giorni', { d })),
        h('span', { class: 'exam-date' }, new Date(nb.exam_date + 'T00:00:00').toLocaleDateString(locale(), { day: 'numeric', month: 'short' })))))));
  }

  const shared = homeSection(); // 2026-11-24: «Condivisi con me»
  if (shared) sections.push(shared);
  const study = studySection();
  if (study) sections.push(study);

  const grid = h('div', { class: 'nb-grid' });
  for (const nb of nbs) {
    const a = act.get(nb.id);
    const d = daysTo(nb.exam_date);
    grid.append(h('div', { class: 'nb-card', '--c': nb.color },
      h('button', { class: 'nb-card-main', onclick: () => go({ kind: 'notebook', id: nb.id }), 'aria-label': T('Apri {quaderno}', { quaderno: nb.title }) },
        h('div', { class: 'nb-cover' },
          h('span', { class: 'nb-cover-code' }, nb.code || codeFrom(nb.title)),
          d != null && d >= 0 && d <= 60 ? h('span', { class: 'nb-cover-exam' }, d === 0 ? T('Esame oggi') : T('Esame tra {d} g', { d })) : null,
          nb.year ? h('span', { class: 'nb-cover-year' }, T('{n}° anno', { n: nb.year })) : null),
        h('div', { class: 'nb-card-body' },
          h('h3', {}, nb.title),
          h('p', { class: 'nb-card-meta' }, a ? (() => { const rc = reposOf(nb.id).length, nc = a.count - rc; return `${tn(nc, '{n} appunto', '{n} appunti')}${rc ? ` · ${rc} repo` : ''} · ${when(a.last.updated_at)}`; })() : T('Ancora vuoto')),
          h('p', { class: 'nb-card-last' }, a ? (a.last.title || T('Senza titolo')) : T('Tocca + per il primo appunto')))),
      h('button', { class: 'nb-card-add', 'aria-label': T('Nuovo appunto in {quaderno}', { quaderno: nb.title }), title: T('Nuovo appunto qui'), onclick: () => { ui.view = { kind: 'notebook', id: nb.id }; renderSide(); newNote(); } }, svg(I.plus))));
  }
  grid.append(h('button', { class: 'nb-card nb-card-new', onclick: () => notebookSheet() }, svg(I.plus), h('span', {}, T('Nuovo quaderno'))));

  sections.push(h('section', { class: 'home-sec' },
    h('div', { class: 'home-label-row' }, h('h2', { class: 'home-label' }, T('Quaderni recenti')), h('span', { class: 'home-count' }, `${nbs.length}`)),
    nbs.length ? grid : h('div', { class: 'empty' }, h('div', { class: 'grid-art' }), h('h2', {}, T('Nessun quaderno')), h('p', {}, T('Crea un quaderno per ogni corso che segui.')),
      h('div', { class: 'sheet-actions', style: { justifyContent: 'center' } }, h('button', { class: 'btn primary', onclick: () => coursePicker(true) }, T('Scegli i corsi')), h('button', { class: 'btn', onclick: () => notebookSheet() }, T('Crea a mano'))))));

  const recent = [...store.notes.values()].filter((n) => !n.deleted_at).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).slice(0, 6);
  if (recent.length) {
    sections.push(h('section', { class: 'home-sec' },
      h('div', { class: 'home-label-row' }, h('h2', { class: 'home-label' }, T('Ultimi appunti')), h('button', { class: 'home-more', onclick: () => go({ kind: 'recent' }) }, T('Vedi tutti'))),
      h('div', { class: 'recent-grid' }, recent.map((n) => {
        const nbk = nbById(n.notebook_id);
        return h('button', { class: 'recent-card', onclick: () => { ui.view = nbk ? { kind: 'notebook', id: nbk.id } : { kind: 'recent' }; renderSide(); renderHome(); openNote(n.id); } },
          h('div', { class: 'recent-top' }, nbk ? h('span', { class: 'nb-code', '--c': nbk.color }, nbk.code || codeFrom(nbk.title)) : null, h('span', { class: 'recent-when' }, when(n.updated_at))),
          h('h3', { class: n.title ? '' : 'untitled' }, n.title || T('Senza titolo')),
          h('p', {}, isRepo(n) ? T('Repository di codice') : n.plain.replace(/```[\s\S]*?```/g, ' ').replace(/\\[a-zA-Z]+/g, ' ').replace(/[#>*`$|\-\[\]{}_^]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 110) || (n.has_ink ? T('Scrittura a mano') : T('Nessun testo'))));
      }))));
  }
  home.replaceChildren(h('div', { class: 'home-inner' }, sections));
  stagger(home, `home:${navSeq}:${nbs.length > 0}`, '.home-inner > section, .home-inner > button, .home-inner > .tt-hint, .nb-card, .recent-card, .study-row', 18);
}

// --- elenco -----------------------------------------------------------------
function visibleNotes() {
  let arr = [...store.notes.values()];
  if (ui.query) {
    const terms = norm(ui.query).split(/\s+/).filter(Boolean);
    const hit = new Set((ui.searchHits || []).map((r) => r.id));
    arr = arr.filter((n) => !n.deleted_at && (hit.has(n.id) || terms.every((t) => norm(n.title + ' ' + n.plain + ' ' + n.tags.join(' ')).includes(t))));
  } else if (ui.view.kind === 'trash') arr = arr.filter((n) => n.deleted_at);
  else {
    arr = arr.filter((n) => !n.deleted_at);
    if (ui.view.kind === 'pinned') arr = arr.filter((n) => n.pinned);
    if (ui.view.kind === 'notebook') arr = arr.filter((n) => n.notebook_id === ui.view.id && !isRepo(n));
  }
  return arr.sort((a, b) => (b.pinned - a.pinned) || (new Date(b.updated_at) - new Date(a.updated_at)));
}

const thumbCache = new Map();
function renderList() {
  const title = $('#list-title');
  const nb = ui.view.kind === 'notebook' ? nbById(ui.view.id) : null;
  if (ui.view.kind === 'notebook' && !nb) { ui.view = { kind: 'recent' }; }
  $('#nb-edit').hidden = !nb || !!ui.query;
  if (ui.query) title.replaceChildren(h('h1', {}, T('Risultati')));
  else if (nb) title.replaceChildren(h('span', { class: 'nb-code', '--c': nb.color }, nb.code || codeFrom(nb.title)), h('h1', {}, nb.title));
  else title.replaceChildren(h('h1', {}, { recent: T('Tutti gli appunti'), pinned: T('Fissati'), trash: T('Cestino') }[ui.view.kind] || T('Appunti')));
  $('#new-note').hidden = ui.view.kind === 'trash' && !ui.query;
  $('#new-pdf').hidden = $('#new-note').hidden;

  const body = $('#list-body');
  const notes = visibleNotes();
  const items = [];
  if (nb && !ui.query) {
    const d = daysTo(nb.exam_date);
    const sub = [];
    if (nb.exam_date) sub.push(h('span', { class: 'nb-exam' + (d != null && d <= 7 && d >= 0 ? ' soon' : '') }, d > 0 ? tn(d, 'Esame tra {n} giorno', 'Esame tra {n} giorni') : d === 0 ? T('Esame oggi') : T('Esame del {data}', { data: fmtDate(nb.exam_date) })));
    sub.push(h('span', {}, tn(notes.length, '{n} appunto', '{n} appunti')));
    if (notes.length) sub.push(h('button', { class: 'smart-chip', title: T('Tutti gli appunti del quaderno in un PDF, con copertina e indice'), onclick: () => exportPdf(notes.filter((n) => !isRepo(n)).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).map((n) => n.id), nb) }, svg(I.pdf), T('PDF del quaderno')));
    if (codeNb(nb)) sub.push(h('button', { class: 'smart-chip', title: T('Cambia il tipo in Modifica quaderno'), onclick: () => notebookSheet(nb) }, svg(I.code), T('Quaderno smart · programmazione')));
    items.push(h('div', { class: 'list-sub' }, sub));
  }
  // repository e strumenti del corso: in fondo all'elenco, compatti (utente, 2026-11-23: «sposta questi in basso, e meno invasivi»)
  const tail = nb && !ui.query ? [repoStrip(nb), toolStrip(nb)].filter(Boolean) : [];
  if (ui.view.kind === 'trash' && !ui.query && notes.length) {
    items.push(h('div', { class: 'list-sub' }, h('span', {}, T('Gli appunti restano qui 30 giorni.')), confirmBtn(T('Svuota cestino'), async () => { await store.emptyTrash(); toast(T('Cestino svuotato')); }, 'btn danger')));
  }
  if (!notes.length) {
    items.push(h('div', { class: 'empty' }, h('div', { class: 'grid-art' }),
      ui.query ? [h('h2', {}, T('Nessun risultato')), h('p', {}, T('Nessun appunto contiene “{testo}”.', { testo: ui.query }))]
      : ui.view.kind === 'trash' ? [h('h2', {}, T('Cestino vuoto')), h('p', {}, T('Gli appunti eliminati finiscono qui e si possono ripristinare.'))]
      : ui.view.kind === 'pinned' ? [h('h2', {}, T('Niente di fissato')), h('p', {}, T('Fissa in alto formulari e riassunti dal menu dell\'appunto.'))]
      : [h('h2', {}, nb && reposOf(nb.id).length ? T('Nessun appunto') : T('Pagina bianca')), h('p', {}, T('Tocca “Nuovo appunto” per scrivere a tastiera, o con l\'Apple Pencil.'))]));
  }
  const hitSnip = new Map((ui.searchHits || []).map((r) => [r.id, r.snippet]));
  body.classList.toggle('gallery', layout === 'gallery');
  if (layout === 'gallery' && notes.length) {
    items.push(h('div', { class: 'gal-grid' }, notes.map((n) => galleryCard(n))), ...tail);
    body.replaceChildren(...items);
    stagger(body, `${ui.view.kind}:${ui.view.id}:${layout}:${navSeq}`, '.gal-card');
    return;
  }
  for (const n of notes) {
    const nbk = nbById(n.notebook_id);
    let snippet = n.plain.replace(/```[\s\S]*?```/g, ' ').replace(/\\[a-zA-Z]+/g, ' ').replace(/[#>*`$|\-\[\]{}_^]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    const p = h('p', {});
    if (ui.query && hitSnip.get(n.id)) p.innerHTML = escapeHtml(hitSnip.get(n.id)).replace(/«/g, '<mark>').replace(/»/g, '</mark>');
    else p.textContent = isRepo(n) ? T('Repository di codice') : snippet || (n.has_ink ? T('Scrittura a mano') : T('Nessun testo'));
    const card = h('button', { class: 'note-card' + (n.id === ui.noteId ? ' active' : ''), onclick: () => openNote(n.id) },
      h('h3', { class: n.title ? '' : 'untitled' }, n.title || T('Senza titolo')),
      p,
      h('div', { class: 'meta' },
        n.pinned ? h('span', { class: 'pin-mark', title: T('Fissato') }, svg(I.pin)) : null,
        isRepo(n) ? h('span', { class: 'repo-badge' }, svg(I.repo), 'repo') : null,
        nbk && (ui.view.kind !== 'notebook' || ui.query) ? h('span', { class: 'nb-code', '--c': nbk.color }, nbk.code || codeFrom(nbk.title)) : null,
        h('span', {}, when(n.updated_at)),
        n.has_ink ? h('span', {}, '· ' + T('a mano')) : null,
        n.tags.length ? h('span', {}, '· ' + n.tags.map((t) => '#' + t).join(' ')) : null));
    if (n.has_ink) {
      const th = h('div', { class: 'thumb' });
      const key = n.id + ':' + n.rev + ':' + n.updated_at;
      if (thumbCache.has(key)) th.append(thumbCache.get(key));
      else store.getNote(n.id).then((full) => { const c = thumb(full.blocks, 72, 48); if (c) { thumbCache.set(key, c); th.append(c); } }).catch(() => {});
      card.append(th);
    }
    items.push(card);
  }
  items.push(...tail);
  body.replaceChildren(...items);
  stagger(body, `${ui.view.kind}:${ui.view.id}:${layout}:${navSeq}`, '.note-card');
}
// --- 2026.11.4: repository e strumenti nei quaderni smart --------------------------------------
const repoMeta = new Map();
function repoCard(n) {
  const meta = h('small', {}, when(n.updated_at));
  const key = n.id + ':' + n.rev + ':' + n.updated_at;
  const fill = (full) => { const b = full.blocks.find((x) => x.type === 'code'); if (!b) return; const lang = projectLang(b); meta.textContent = `${lang ? LANGS[lang].label : T('Codice')} · ${b.files.length === 1 ? tp('uno', '{n} file', { n: 1 }) : T('{n} file', { n: b.files.length })} · ${when(n.updated_at)}`; };
  if (repoMeta.has(key)) fill(repoMeta.get(key));
  else store.getNote(n.id).then((f) => { repoMeta.set(key, f); fill(f); }).catch(() => {});
  return h('button', { class: 'repo-card' + (n.id === ui.noteId ? ' active' : ''), onclick: () => openNote(n.id) },
    h('span', { class: 'repo-ico' }, svg(I.repo)), h('span', { class: 'repo-card-txt' }, h('strong', {}, n.title || T('Senza nome')), meta));
}
function repoStrip(nb) {
  const repos = reposOf(nb.id);
  if (!codeNb(nb) && !repos.length) return null;
  return h('section', { class: 'strip repo-strip' },
    h('div', { class: 'strip-head' }, svg(I.repo), h('span', {}, tp('elenco', 'Repository')), h('span', { class: 'count' }, repos.length || ''),
      h('button', { class: 'strip-add', title: T('Nuovo repository: progetto di codice con più file, da eseguire qui e citare negli appunti con [[nome]]'), onclick: () => repoSheet(nb.id) }, T('+ Nuovo'))),
    repos.length ? h('div', { class: 'repo-list' }, repos.map(repoCard)) : null);
}
function toolStrip(nb) {
  const tools = isEng() ? toolsFor(courseOf(nb)) : [];
  if (!tools.length) return null;
  return h('section', { class: 'strip tool-strip' },
    h('div', { class: 'strip-head' }, svg(I.tools), h('span', {}, T('Strumenti')),
      h('button', { class: 'strip-add', title: tools.map((t) => t.label).join(', '), onclick: () => toolSheet({ nbId: nb.id }) }, T('+ Nuovo'))));
}
// Nuovo repository: tre strade (vuoto, modello del corso, importa) con icone; sotto, solo le opzioni della strada scelta.
// Utente, 2026-11-23: «più intuitiva, meno ingombrante, più pulita, più minimal e con icone».
const RS_ICO = {
  empty: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4"/>',
  tpl: '<rect x="4" y="3.5" width="16" height="17" rx="2.5"/><path d="M8 8.5h8M8 12h8M8 15.5h5"/>',
  import: '<path d="M12 4v10.5M7.5 10l4.5 4.5 4.5-4.5"/><path d="M5 19.5h14"/>',
  zip: '<path d="M6.5 3.5h8l4 4v13h-12z"/><path d="M14.5 3.5v4h4"/><path d="M10.5 9.5h2M10.5 12.5h2M10.5 15.5h2"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
  proc: '<rect x="3.5" y="4" width="7" height="6" rx="1.5"/><rect x="13.5" y="14" width="7" height="6" rx="1.5"/><path d="M7 10v3.5a3 3 0 0 0 3 3h3.5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  queue: '<rect x="3" y="8" width="5" height="8" rx="1.2"/><rect x="10" y="8" width="5" height="8" rx="1.2"/><path d="M17.5 12H21M19.5 10l2 2-2 2"/>',
  doc: '<path d="M6.5 3.5h8l4 4v13h-12z"/><path d="M14.5 3.5v4h4"/><path d="M9.5 13h5M9.5 16h3"/>',
  tree: '<circle cx="12" cy="5.5" r="2"/><circle cx="6" cy="18.5" r="2"/><circle cx="18" cy="18.5" r="2"/><path d="M12 7.5v4M12 11.5l-6 5M12 11.5l6 5"/>',
  warn: '<path d="M12 4l9 15.5H3z"/><path d="M12 10v4M12 16.8v.2"/>',
};
// Nuovo strumento del corso: stessa forma del «Nuovo repository». Dal quaderno crea un appunto con lo strumento;
// dalla barra dell'appunto (insert) lo aggiunge all'appunto aperto.
const TOOL_ICO = {
  sched: '<path d="M4 6.5h7M4 12h11M4 17.5h5"/><path d="M13 6.5h7M17 12h3M11 17.5h9" opacity=".45"/>',
  race: '<path d="M4 7h4c4 0 4 10 8 10h4M4 17h4c4 0 4-10 8-10h4"/><path d="M18 5l2 2-2 2M18 15l2 2-2 2"/>',
  quiz: '<path d="M4 6.5l1.5 1.5L8 5.5M4 12.5l1.5 1.5L8 11.5"/><path d="M11 7h9M11 13h9M11 18.5h6"/><circle cx="6" cy="18.5" r="1.4"/>',
  mutex: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.3"/>',
  starve: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2.5M9.5 3.5h5"/>',
};
function toolSheet({ nbId = ui.note?.notebook_id ?? null, insert = false } = {}) {
  const nb = nbById(nbId);
  const tools = toolsFor(courseOf(nb));
  if (!tools.length) return;
  let pick = tools[0].k;
  const name = h('input', { autocomplete: 'off', 'aria-label': T('Titolo dell\'appunto') });
  const list = h('div', { class: 'rs-list' });
  const draw = () => {
    list.replaceChildren(...tools.map((t) => h('button', { type: 'button', class: 'rs-row' + (pick === t.k ? ' on' : ''), onclick: () => { pick = t.k; draw(); } },
      h('span', { class: 'rs-ico' }, svg(TOOL_ICO[t.k] || I.tools)),
      h('span', { class: 'rs-txt' }, h('strong', {}, t.label), h('small', {}, t.sub)),
      h('span', { class: 'rs-check', 'aria-hidden': 'true' }))));
    name.placeholder = tools.find((t) => t.k === pick).title();
  };
  const create = h('button', { class: 'btn primary', onclick: () => {
    closeSheet();
    if (insert && ui.note) addBlock('tool', newTool(pick, uuid));
    else { if (nbId) ui.view = { kind: 'notebook', id: nbId }; renderSide(); newNote({ notebookId: nbId, title: name.value.trim() || tools.find((t) => t.k === pick).title(), tool: pick }); }
  } }, insert ? T('Aggiungi') : T('Crea'));
  draw();
  openSheet([
    h('div', { class: 'rs-head' }, h('span', { class: 'rs-head-ico' }, svg(I.tools)), h('div', {}, h('h2', {}, insert ? T('Aggiungi uno strumento') : T('Nuovo strumento')), h('p', { class: 'rs-sub' }, insert ? T('Nell\'appunto aperto, dove sei') : nb?.title || ''))),
    insert ? null : h('label', { class: 'rs-name' }, name),
    h('div', { class: 'rs-panel tools' }, list),
    h('div', { class: 'sheet-actions' }, h('button', { class: 'btn', onclick: closeSheet }, T('Annulla')), create),
  ]);
}
function repoSheet(nbId) {
  const nb = nbById(nbId);
  const tpls = isEng() ? REPO_TEMPLATES.filter((t) => t.course === courseOf(nb)) : [];
  const st = { way: tpls.length ? 'tpl' : 'empty', tpl: tpls[0]?.k, lang: 'c', src: 'zip' };
  const name = h('input', { placeholder: 'nome-del-repository', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': T('Nome del repository') });
  const zipIn = h('input', { type: 'file', accept: '.zip,application/zip', hidden: true });
  const zipBtn = h('button', { type: 'button', class: 'rs-file', onclick: () => zipIn.click() }, svg(RS_ICO.zip), h('span', {}, T('Scegli lo zip…')));
  zipIn.addEventListener('change', () => { const f = zipIn.files[0]; zipBtn.lastChild.textContent = f ? f.name : T('Scegli lo zip…'); zipBtn.classList.toggle('on', !!f); if (f && !name.value.trim()) name.placeholder = f.name.replace(/\.zip$/i, ''); });
  const gh = h('input', { class: 'rs-gh', placeholder: T('proprietario/nome o indirizzo github.com'), autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': T('Repository GitHub pubblico') });
  const ways = h('div', { class: 'rs-ways', role: 'tablist' });
  // altezza fissa: cambiando scheda la finestra non si ridimensiona e i pulsanti non scappano da sotto il dito
  const panel = h('div', { class: 'rs-panel' + (tpls.length ? ' tall' : '') });
  const placeholder = () => {
    const t = st.way === 'tpl' && tpls.find((x) => x.k === st.tpl);
    name.placeholder = t ? t.name : st.way === 'empty' ? 'nome-del-repository' : name.placeholder;
  };
  const draw = () => {
    const W = [['empty', T('Vuoto'), RS_ICO.empty], ...(tpls.length ? [['tpl', T('Modello del corso'), RS_ICO.tpl]] : []), ['import', T('Importa'), RS_ICO.import]];
    ways.replaceChildren(...W.map(([k, l, ic]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(st.way === k), class: 'rs-way' + (st.way === k ? ' on' : ''), onclick: () => { st.way = k; draw(); } }, svg(ic), h('span', {}, l))));
    if (st.way === 'empty') {
      panel.replaceChildren(h('div', { class: 'rs-langs' }, [['c', 'C', 'C'], ['cpp', 'C++', '++'], ['python', 'Python', 'Py'], ['js', 'JavaScript', 'JS']].map(([k, l, b]) =>
        h('button', { type: 'button', class: 'rs-lang' + (st.lang === k ? ' on' : ''), onclick: () => { st.lang = k; draw(); } }, h('span', { class: 'rs-badge' }, b), l))));
    } else if (st.way === 'tpl') {
      panel.replaceChildren(h('div', { class: 'rs-list' }, tpls.map((t) => h('button', { type: 'button', class: 'rs-row' + (st.tpl === t.k ? ' on' : ''), title: t.desc, onclick: () => { st.tpl = t.k; draw(); } },
        h('span', { class: 'rs-ico' }, svg(RS_ICO[t.ico] || RS_ICO.doc)),
        h('span', { class: 'rs-txt' }, h('strong', {}, t.label), h('small', {}, t.short)),
        h('span', { class: 'rs-check', 'aria-hidden': 'true' })))));
    } else {
      panel.replaceChildren(
        h('div', { class: 'seg rs-seg' }, [['zip', T('Da uno zip')], ['gh', T('Da GitHub')]].map(([k, l]) => h('button', { type: 'button', class: st.src === k ? 'on' : '', onclick: () => { st.src = k; draw(); } }, l))),
        st.src === 'zip' ? zipBtn : h('label', { class: 'rs-ghrow' }, svg(RS_ICO.link), gh), zipIn);
      if (st.src === 'gh') setTimeout(() => gh.focus(), 30);
    }
    placeholder();
  };
  const create = h('button', { class: 'btn primary', onclick: async () => {
    create.disabled = true;
    try {
      let files, guess = '', stdin = '';
      if (st.way === 'import' && st.src === 'zip') { const f = zipIn.files[0]; if (!f) throw new Error(T('Scegli prima lo zip')); const r = await filesFromZip(new Uint8Array(await f.arrayBuffer())); files = r.files; guess = f.name.replace(/\.zip$/i, ''); }
      else if (st.way === 'import') { const r = await filesFromGithub(gh.value); files = r.files; guess = r.name; }
      else if (st.way === 'tpl') { const t = tpls.find((x) => x.k === st.tpl); files = structuredClone(t.files); guess = t.name; stdin = t.stdin || ''; }
      else files = newProject(st.lang, uuid).files;
      if (!files.length) throw new Error(T('Nessun file di testo da importare'));
      const note = store.newNote(nbId, 'repo');
      note.title = name.value.trim() || guess || 'nuovo-repository';
      note.blocks = [{ id: uuid(), type: 'code', name: note.title, files, open: pickOpen(files), stdin }];
      note._saved = true;
      await store.saveNote(note);
      closeSheet();
      if (nbId) ui.view = { kind: 'notebook', id: nbId };
      renderSide();
      openNote(note.id);
      toast(T('Repository «{nome}» creato', { nome: note.title }));
    } catch (e) { toast(e.message); create.disabled = false; }
  } }, T('Crea'));
  draw();
  openSheet([
    h('div', { class: 'rs-head' }, h('span', { class: 'rs-head-ico' }, svg(I.repo)), h('div', {}, h('h2', {}, T('Nuovo repository')), nb ? h('p', { class: 'rs-sub' }, nb.title) : null)),
    h('label', { class: 'rs-name' }, name),
    ways, panel,
    h('div', { class: 'sheet-actions' }, h('button', { class: 'btn', onclick: closeSheet }, T('Annulla')), create),
  ]);
}
// --- modalità IDE: il repository a tutto schermo (quaderni ed elenco nascosti, editor a tutta altezza) -----------
let repoCode = null;
let ideFrom = null; // appunto da cui si è entrati nell'IDE: uscendo si torna lì
function toggleIde(force) {
  if (ideBlock) { closeBlockIde(); return; }
  if (ui.note && !isRepo(ui.note)) { ideFromNote(); return; }
  if (!ui.note) return;
  const on = force ?? app.dataset.ide !== 'on';
  if (!on && ideFrom && store.notes.get(ideFrom)) { const back = ideFrom; ideFrom = null; delete app.dataset.ide; ls.set('ide', false); openNote(back); return; }
  if (!on) ideFrom = null;
  viewTransition(() => {
    if (on) app.dataset.ide = 'on'; else delete app.dataset.ide;
    ls.set('ide', on);
    app.classList.remove('side-open');
    repoCode?.refreshIde?.();
  }, 'fade');
}
// --- 2026.11.6: IDE anche dagli appunti ----------------------------------------------------------------------
// (utente: «permettimi di accedere alla modalità IDE anche dalle note, però proponendo di collegare una repo alla nota
// appena entro, in maniera non invasiva, come una notifica molto sintetica»). Il collegamento è quello di sempre:
// una riga «Repository: [[nome]]» nell'appunto. Collegato → si apre il repository in IDE; se no, un avviso di una riga.
function linkedRepo(note) {
  for (const b of note.blocks) {
    if (b.type !== 'text') continue;
    for (const m of b.text.matchAll(/\[\[([^\]]+)\]\]/g)) { const r = findByTitle(m[1], note.notebook_id); if (r && isRepo(r) && !r.deleted_at) return r; }
  }
  return null;
}
function openRepoIde(repo, fromId) {
  flushSave();
  ideFrom = fromId; ls.set('ide', true);
  openNote(repo.id);
  toast(T('Modalità IDE · esci per tornare all\'appunto'));
}
function linkRepo(note, repo) {
  note.blocks.unshift({ id: uuid(), type: 'text', text: `Repository: [[${repo.title.trim()}]]` });
  scheduleSave(true);
}
// Blocco di codice di un appunto a tutto schermo (utente: «nelle note esistenti non vedo la possibilità di aprire lo snippet
// di codice in ide»): stesso aspetto dell'IDE dei repository, «Esci» torna all'appunto sul blocco.
let ideBlock = null;
function openBlockIde(id) {
  if (!ui.note) return;
  ideBlock = { note: ui.note.id, id };
  viewTransition(() => { app.dataset.ide = 'on'; app.classList.remove('side-open'); renderEditor(); }, 'fade');
  // anche dal pulsante «IDE» del blocco si propone il repository (utente, 2026-11-24: «notifica di conversione a repo
  // anche per l'ide aperto nel blocco codice in un appunto»)
  const note = ui.note;
  setTimeout(() => { if (ideBlock?.id === id && ui.note === note) proposeRepo(note, id); }, 400);
}
// L'avviso di una riga che propone di collegare (o creare) il repository, uguale dall'appunto e dal blocco di codice
function proposeRepo(note, blockId) {
  if (!smartOn()) return;
  const linked = linkedRepo(note);
  if (linked) { toast(T('Collegato a «{nome}»', { nome: linked.title }), { label: T('Apri'), fn: () => { ideBlock = null; delete app.dataset.ide; openRepoIde(linked, note.id); } }); return; }
  const repos = reposOf(note.notebook_id).filter((r) => r.title.trim());
  const go = (r) => { ideBlock = null; delete app.dataset.ide; linkRepo(note, r); openRepoIde(r, note.id); };
  if (repos.length === 1) toast(T('Collegare «{nome}»?', { nome: repos[0].title }), { label: T('Collega'), fn: () => go(repos[0]) });
  else if (repos.length) toast(T('Nessun repository collegato'), { label: T('Scegli'), fn: () => pickRepoSheet(note, repos) });
  else if (blockId) toast(T('Nessun repository nel quaderno'), { label: T('Crea da questo codice'), fn: () => {
    const i = note.blocks.findIndex((x) => x.id === blockId);
    if (ideBlock) closeBlockIde();
    if (i >= 0) blockToRepo(note.blocks[i], i);
  } });
  else toast(T('Nessun repository nel quaderno'), { label: T('Crea'), fn: () => repoSheet(note.notebook_id) });
}
function closeBlockIde() {
  const id = ideBlock?.id;
  ideBlock = null;
  viewTransition(() => { delete app.dataset.ide; renderEditor(); }, 'fade');
  requestAnimationFrame(() => $(`.block[data-id="${id}"]`)?.scrollIntoView({ block: 'center' }));
}
function renderBlockIde(ed, bar, note) {
  const b = note.blocks.find((x) => x.id === ideBlock.id);
  app.dataset.ide = 'on';
  const code = renderCodeBlock(b, { onChange: () => scheduleSave(), onSave: () => scheduleSave(true), toast, confirmBtn, repo: true,
    repoName: () => b.name || note.title || T('Codice'), onIde: () => closeBlockIde(), ideOn: () => true });
  repoCode = code;
  const page = h('div', { class: 'page wide repo-page' }, code);
  ed.replaceChildren(bar, h('div', { class: 'ed-scroll', id: 'ed-scroll' }, page));
}
function ideFromNote() {
  const note = ui.note;
  if (!note) return;
  const repo = linkedRepo(note);
  if (repo) { openRepoIde(repo, note.id); return; }
  // l'appunto ha già del codice: si apre quello, e il repository si propone soltanto (lo fa openBlockIde)
  const own = note.blocks.find((x) => x.type === 'code');
  if (own) { openBlockIde(own.id); return; }
  proposeRepo(note, null);
}
function pickRepoSheet(note, repos) {
  openSheet([
    h('h2', {}, T('Collega un repository')),
    h('p', { class: 'lead' }, T('Si apre in modalità IDE; uscendo torni a questo appunto.')),
    h('div', { class: 'pick-list' }, repos.map((r) => h('button', { class: 'btn', onclick: () => { closeSheet(); ideBlock = null; delete app.dataset.ide; linkRepo(note, r); openRepoIde(r, note.id); } }, svg(I.repo), r.title))),
  ]);
}
function renderRepoEditor(ed, bar, note) {
  let proj = note.blocks.find((b) => b.type === 'code');
  if (!proj) { proj = newProject('c', uuid); note.blocks.unshift(proj); }
  const nb = nbById(note.notebook_id);
  const title = h('input', { class: 'repo-title', placeholder: T('Nome del repository'), 'aria-label': T('Nome del repository'), autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false' });
  title.value = note.title;
  title.addEventListener('input', () => { note.title = title.value; proj.name = title.value; scheduleSave(); });
  const back = backlinksOf(note);
  const linkName = () => note.title.trim();
  const sub = h('div', { class: 'repo-sub' }, svg(I.repo), h('span', {}, nb ? T('Repository del quaderno {quaderno}', { quaderno: nb.title }) : T('Repository')), h('span', {}, '·'),
    h('span', {}, T('creato il {data}', { data: fmtDate(note.created_at, { day: 'numeric', month: 'long' }) })));
  if (ls.get('ide', false)) app.dataset.ide = 'on'; // la modalità IDE si ricorda da un repository all'altro
  const code = renderCodeBlock(proj, { onChange: () => scheduleSave(), onSave: () => scheduleSave(true), toast, confirmBtn, repo: true, repoName: linkName,
    onIde: () => toggleIde(), ideOn: () => app.dataset.ide === 'on',
    onName: (n) => { if (!note.title.trim()) { note.title = n; title.value = n; } } });
  const actions = h('div', { class: 'repo-actions' },
    h('button', { class: 'btn small', onclick: () => { if (!linkName()) { toast(T('Dai prima un nome al repository')); title.focus(); return; } flushSave(); newNote({ notebookId: note.notebook_id, text: `Repository: [[${linkName()}]]\n\n` }); } }, svg(I.plus), T('Nuovo appunto collegato')),
    h('button', { class: 'btn small', onclick: async () => { if (!linkName()) return; const t = `[[${linkName()}]]`; try { await navigator.clipboard.writeText(t); toast(T('Collegamento copiato: incollalo in un appunto')); } catch { toast(T('Scrivi {link} in un appunto', { link: t })); } } }, T('Copia il collegamento')));
  const backEl = h('div', { class: 'backlinks' }, h('div', { class: 'home-label' }, back.length ? T('Appunti che lo citano') : T('Nessun appunto lo cita ancora')),
    back.length ? h('div', { class: 'bl-list' }, back.map((m) => h('button', { class: 'bl-chip', onclick: () => openNote(m.id) }, m.title || T('Senza titolo')))) : null, actions);
  repoCode = code;
  title.addEventListener('input', () => code.refreshIde?.());
  const page = h('div', { class: 'page wide repo-page' }, title, sub, code, backEl);
  const scroll = h('div', { class: 'ed-scroll', id: 'ed-scroll' }, page);
  let memT;
  scroll.addEventListener('scroll', () => { ed.classList.toggle('scrolled', scroll.scrollTop > 4); clearTimeout(memT); memT = setTimeout(rememberScroll, 900); }, { passive: true });
  ed.replaceChildren(bar, scroll);
  if (!note.title) requestAnimationFrame(() => title.focus());
}

// --- galleria: ogni appunto come pagina in miniatura -------------------------------
const previewCache = new Map();
function pagePreview(full) {
  const inner = h('div', { class: 'prev-inner' + (full.blocks.some((b) => b.type === 'ink') ? ' paper-' + (full.paper || 'grid') : '') });
  let budget = 4;
  for (const b of full.blocks) {
    if (budget-- <= 0) break;
    if (b.type === 'text' && b.text.trim()) {
      const md = h('div', { class: 'md' });
      md.innerHTML = renderMarkdown(b.text.slice(0, 1500));
      enhance(md);
      md.querySelectorAll('input').forEach((i) => { i.disabled = true; });
      inner.append(md);
    } else if (b.type === 'ink' && b.bg) {
      // pagina di un PDF: la pagina (disegnata a penna ferma) con sopra i tratti
      const box = h('div', { class: 'prev-pdf', style: { aspectRatio: `${b.bg.pw} / ${b.bg.ph}` } });
      if (b.strokes?.length) box.append(inkPreview(b, 600, 600 * b.bg.ph / b.bg.pw));
      renderPage(b.bg, store.imageUrl(b.bg.att), 300, 2, (c) => { if (c) box.prepend(c); });
      inner.append(box);
      budget = 0;
    } else if (b.type === 'ink' && b.strokes?.length) {
      inner.append(h('div', { class: 'prev-ink' }, inkPreview(b)));
    } else if (b.type === 'code') {
      inner.append(codePreview(b));
    } else if (b.type === 'chart') {
      inner.append(renderChart(b));
    } else if (b.type === 'image') {
      inner.append(h('img', { class: 'prev-img', src: store.imageUrl(b.att), alt: '', loading: 'lazy' }));
    }
  }
  if (!inner.childNodes.length) inner.append(h('p', { class: 'prev-empty' }, T('Pagina vuota')));
  return inner;
}

function galleryCard(n) {
  const nbk = nbById(n.notebook_id);
  const page = h('div', { class: 'prev-page' });
  const key = n.id + ':' + n.rev + ':' + n.updated_at + ':' + document.documentElement.classList.contains('is-dark');
  if (previewCache.has(key)) page.append(previewCache.get(key));
  else {
    page.append(h('div', { class: 'prev-loading' }));
    store.getNote(n.id).then((full) => { const el = pagePreview(full); previewCache.set(key, el); page.replaceChildren(el); }).catch(() => page.replaceChildren(h('p', { class: 'prev-empty' }, T('Anteprima non disponibile offline'))));
  }
  return h('button', { class: 'gal-card' + (n.id === ui.noteId ? ' active' : ''), onclick: () => openNote(n.id) },
    page,
    h('div', { class: 'gal-info' },
      h('h3', { class: n.title ? '' : 'untitled' }, n.title || T('Senza titolo')),
      h('div', { class: 'meta' },
        n.pinned ? h('span', { class: 'pin-mark', title: T('Fissato') }, svg(I.pin)) : null,
        nbk && (ui.view.kind !== 'notebook' || ui.query) ? h('span', { class: 'nb-code', '--c': nbk.color }, nbk.code || codeFrom(nbk.title)) : null,
        h('span', {}, when(n.updated_at)))));
}

function setLayout(l) {
  layout = l; ls.set('layout', l);
  app.dataset.layout = l;
  $('#lay-list').classList.toggle('on', l === 'list');
  $('#lay-gallery').classList.toggle('on', l === 'gallery');
  navSeq++;
  viewTransition(() => { if (l === 'gallery' && ui.note && !narrow()) closeNote(); else renderList(); }, 'fade');
}

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function confirmBtn(label, fn, cls = 'btn danger') {
  let armed = false, t;
  const b = h('button', { class: cls, type: 'button', onclick: async () => {
    if (!armed) { armed = true; b.classList.add('armed'); b.textContent = T('Tocca di nuovo per confermare'); t = setTimeout(() => { armed = false; b.classList.remove('armed'); b.textContent = label; }, 3500); return; }
    clearTimeout(t); b.disabled = true; try { await fn(); } finally { b.disabled = false; }
  } }, label);
  return b;
}

// --- editor -----------------------------------------------------------------
let saveTimer;
const isEmptyNote = (n) => !n.title.trim() && !n.blocks.some((b) => (b.type === 'text' && b.text.trim()) || (b.type === 'ink' && b.strokes?.length) || b.type === 'image' || b.type === 'code' || b.type === 'tool' || b.type === 'chart');

function scheduleSave(now = false) {
  if (!ui.note) return;
  const note = ui.note;
  if (isReadOnly(note)) return;
  collab.changed(note.id); // live: la modifica parte subito come aggiornamento CRDT (a penna ferma)
  clearTimeout(saveTimer);
  const run = () => {
    if (!penQuiet()) { saveTimer = setTimeout(run, 400); return; }
    saveTimer = null;
    if (note.rev === 0 && !note._saved && isEmptyNote(note)) return;
    note._saved = true;
    store.saveNote(note).catch((e) => toast(T('Salvataggio non riuscito: ') + e.message));
    const s = $('.ed-saved'); if (s) s.textContent = T('Salvato');
  };
  const s = $('.ed-saved'); if (s) s.textContent = T('Modificato');
  if (now) run(); else saveTimer = setTimeout(run, 650);
}
function flushSave() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; pen.down = false; pen.last = 0; scheduleSave(true); } }

async function openNote(id, { focusTitle = false } = {}) {
  const reload = ui.noteId === id && !!ui.note; // stesso appunto riletto perché cambiato altrove
  if (!reload) pano?.close();
  rememberScroll();
  flushSave();
  if (ui.noteId && ui.noteId !== id) collab.close(ui.noteId);
  let note;
  try { note = await store.getNote(id); } catch (e) { toast(T('Non riesco ad aprire l\'appunto: ') + e.message); return; }
  if (reload && (ui.noteId !== id || saveTimer || !penQuiet())) return; // nel frattempo hai scritto: al prossimo giro
  const apply = () => {
    ui.noteId = id; ui.note = structuredClone(note); ui.active = null; ui.editing = null;
    ls.set('lastNote', id);
    legendSel.clear(); inkView.only = null;
    app.dataset.view = 'editor';
    renderEditor({ focusTitle });
    renderList();
    collab.open(ui.note);
  };
  if (reload) { const top = $('#ed-scroll')?.scrollTop; apply(); const sc = $('#ed-scroll'); if (sc && top != null) sc.scrollTop = top; return; }
  viewTransition(apply, narrow() ? 'forward' : 'fade');
  restoreScroll(id);
}

function newNote(opts = {}) {
  if (opts instanceof Event) opts = {};
  pano?.close();
  rememberScroll();
  flushSave();
  if (ui.noteId) collab.close(ui.noteId);
  const nbId = opts.notebookId !== undefined ? opts.notebookId : ui.view.kind === 'notebook' ? ui.view.id : null;
  const note = store.newNote(nbId);
  if (opts.title) note.title = opts.title;
  legendSel.clear(); inkView.only = null;
  note.paper = prefs.paper;
  const startInk = inkPrefs.penOnly; // chi usa la Pencil parte dalla pagina a mano
  if (opts.tool) { note.blocks.push(newTool(opts.tool, uuid)); note._saved = true; }
  else if (opts.text != null) note.blocks.push({ id: uuid(), type: 'text', text: opts.text });
  else note.blocks.push(startInk ? { id: uuid(), type: 'ink', strokes: [], h: 900 } : { id: uuid(), type: 'text', text: '' });
  const first = note.blocks[0];
  ui.noteId = note.id; ui.note = note; ui.active = first.type === 'ink' ? first.id : null; ui.editing = first.type === 'text' ? first.id : null;
  app.dataset.view = 'editor';
  if (ui.view.kind === 'trash' || ui.view.kind === 'pinned' || ui.view.kind === 'home') go({ kind: 'recent' });
  renderEditor({ focusTitle: !startInk && !opts.title && !opts.template && !opts.tool && opts.text == null });
  renderList();
  collab.open(note);
  if (opts.tool) scheduleSave();
  if (opts.template) applyTemplate(TEMPLATES.find((t) => t.k === opts.template));
}

function closeNote() {
  pano?.close();
  rememberScroll();
  legendSel.clear(); inkView.only = null;
  flushSave();
  collab.close(ui.noteId);
  if (ui.note && ui.note.rev === 0 && !ui.note._saved) { /* appunto vuoto mai salvato: scartato */ }
  for (const b of boards.values()) b.destroy();
  boards.clear();
  ui.noteId = null; ui.note = null;
  ls.set('lastNote', null);
  app.dataset.view = 'list';
  listStale = false;
  renderEditor();
  renderList();
}

function renderEditor({ focusTitle = false } = {}) {
  const ed = $('#editor');
  const blockIde = ideBlock && ui.note && ideBlock.note === ui.note.id && ui.note.blocks.some((b) => b.id === ideBlock.id && b.type === 'code');
  if (!blockIde) ideBlock = null;
  if ((!ui.note || !isRepo(ui.note)) && !blockIde) { delete app.dataset.ide; repoCode = null; ideFrom = null; }
  const note = ui.note;
  // la tavola aperta nella vista panoramica sopravvive al ridisegno (BUG-017): distruggerla lasciava la panoramica a
  // schermo con una tavola scollegata, e quello che si scriveva andava perso
  if (pano && !(note && note.id === pano.noteId && !isReadOnly(note) && !isRepo(note) && !blockIde && note.blocks.some((b) => b.id === pano.id && b.type === 'ink'))) pano.close({ discard: true });
  const kept = pano && boards.get(pano.id);
  for (const b of boards.values()) if (b !== kept) b.destroy();
  boards.clear();
  if (kept) boards.set(pano.id, kept);
  if (!note) {
    ed.replaceChildren(h('div', { class: 'ed-empty' }, h('div', {},
      h('div', { class: 'big-grid' }),
      h('h2', {}, T('Scegli un appunto o creane uno')),
      h('p', {}, T('Testo, formule LaTeX, codice e scrittura a mano nello stesso foglio.')),
      h('p', {}, h('span', { class: 'kbd' }, '⌘ N'), ' ' + T('nuovo') + '  ·  ', h('span', { class: 'kbd' }, '⌘ F'), ' ' + T('cerca') + '  ·  ', h('span', { class: 'kbd' }, '⌘ \\'), ' ' + T('pannelli')))));
    return;
  }
  const nb = nbById(note.notebook_id);
  const trashed = !!note.deleted_at;
  const bar = h('div', { class: 'ed-bar' },
    h('button', { class: 'icon-btn only-narrow ed-back', 'aria-label': T('Torna all\'elenco'), onclick: () => viewTransition(closeNote, 'back') }, svg(I.back)),
    h('button', { class: 'icon-btn only-wide' + (app.dataset.focus === 'on' ? ' on' : ''), 'aria-label': T('Modalità concentrazione'), title: 'Concentrazione (⌘⇧F)', onclick: toggleFocus }, svg(I.expand)),
    h('button', { class: 'nb-chip', onclick: () => moveSheet() },
      nb ? h('span', { class: 'nb-code', '--c': nb.color }, nb.code || codeFrom(nb.title)) : h('span', { class: 'nb-code', '--c': 'var(--faint)' }, '—'),
      h('span', {}, nb ? nb.title : T('Nessun quaderno'))),
    h('div', { class: 'spacer' }),
    h('span', { class: 'ed-saved' }, note.rev ? T('Salvato') : ''),
    h('button', { class: 'focus-btn' + (focusT ? ' on' : ''), id: 'focus-btn', 'aria-label': T('Timer di concentrazione'), title: T('Timer di concentrazione'), onclick: (e) => focusPop(e.currentTarget) }, svg(I.clock), h('span', { id: 'focus-left' }, focusLeft())),
    trashed ? h('button', { class: 'btn', onclick: restoreNote }, T('Ripristina')) : null,
    isRepo(note) ? null : h('button', { class: 'icon-btn', 'aria-label': T('Modalità IDE'), title: T('Modalità IDE (⌘⇧E)'), onclick: ideFromNote }, svg(I.code)),
    note.shared ? null : h('button', { class: 'icon-btn' + (note.pinned ? ' on' : ''), 'aria-label': note.pinned ? T('Togli da fissati') : T('Fissa in alto'), onclick: togglePin }, svg(I.pin)),
    h('button', { class: 'icon-btn', 'aria-label': T('Altre azioni'), onclick: noteMenu }, svg(I.more)));

  decorateBar(bar, note); // live: chi c'è; condiviso: di chi è
  if (isReadOnly(note)) { renderReadOnly(ed, bar, note); return; }
  if (isRepo(note)) { renderRepoEditor(ed, bar, note); return; }
  if (blockIde) { renderBlockIde(ed, bar, note); return; }
  const title = h('textarea', { class: 'title-input', id: 'note-title', rows: 1, placeholder: T('Titolo'), enterkeyhint: 'next', 'aria-label': T('Titolo') });
  title.value = note.title;
  const autosize = (t) => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; };
  title.addEventListener('input', () => { note.title = title.value.replace(/\n/g, ' '); autosize(title); scheduleSave(); });
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = note.blocks.find((b) => b.type === 'text');
      if (first) { ui.editing = first.id; renderBlocks(); }
      else addBlock('text');
    }
  });

  const tags = h('div', { class: 'page-meta' });
  const renderTags = () => {
    const input = h('input', { class: 'tag-add', placeholder: T('+ etichetta'), enterkeyhint: 'done', 'aria-label': T('Aggiungi etichetta') });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const v = input.value.trim().replace(/^#/, '').replace(/\s+/g, '-');
        if (v && !note.tags.includes(v)) { note.tags.push(v); scheduleSave(); renderTags(); $('.tag-add', tags)?.focus(); }
        input.value = '';
      }
    });
    tags.replaceChildren(
      h('span', {}, T('Creato il {data}', { data: fmtDate(note.created_at, { day: 'numeric', month: 'long' }) })),
      h('span', {}, '·'),
      ...note.tags.map((t) => h('span', { class: 'tag' }, '#' + t, h('button', { 'aria-label': T('Rimuovi {etichetta}', { etichetta: t }), onclick: () => { note.tags = note.tags.filter((x) => x !== t); scheduleSave(); renderTags(); } }, '×'))),
      input);
  };
  renderTags();

  const blocksEl = h('div', { class: 'blocks', id: 'blocks' });
  const tail = h('div', { class: 'page-tail', style: { minHeight: '30vh' }, 'aria-hidden': 'true' });
  tail.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'pen') return;
    e.preventDefault();
    // 2026.11.6: se l'appunto finisce già con una tavola, la penna sotto di lei la allunga fino a dove ha toccato invece
    // di crearne una nuova (prima ogni tocco della Pencil qui sotto aggiungeva una tavola vuota: 31 in un appunto)
    const last = note.blocks[note.blocks.length - 1];
    const board = last && last.type === 'ink' && !last.bg ? boards.get(last.id) : null;
    if (board) {
      const r = board.el.getBoundingClientRect();
      const need = board.scale ? Math.ceil(((e.clientY - r.bottom) / board.scale + 300) / 50) * 50 : 300;
      activate(last.id);
      board.grow(Number.isFinite(need) ? Math.max(300, need) : 300);
      return;
    }
    addBlock('ink');
  });
  tail.addEventListener('click', (e) => {
    if (e.pointerType === 'pen') return;
    const last = note.blocks[note.blocks.length - 1];
    if (last && last.type === 'text' && !last.text.trim()) { ui.editing = last.id; renderBlocks(); }
    else addBlock('text');
  });
  const fresh = note.rev === 0 && !note._saved && isEmptyNote(note);
  const tpl = fresh ? h('div', { class: 'tpl-row' }, h('span', {}, T('Inizia da un modello')), TEMPLATES.map((t) => h('button', { class: 'chip', onclick: () => applyTemplate(t) }, t.label))) : null;
  const back = backlinksOf(note);
  const backEl = back.length ? h('div', { class: 'backlinks' }, h('div', { class: 'home-label' }, T('Citato in')),
    h('div', { class: 'bl-list' }, back.map((m) => { const nbk = nbById(m.notebook_id); return h('button', { class: 'bl-chip', onclick: () => openNote(m.id) }, nbk ? h('span', { class: 'nb-code', '--c': nbk.color }, nbk.code || codeFrom(nbk.title)) : null, m.title || T('Senza titolo')); }))) : null;
  const page = h('div', { class: 'page' + (prefs.wide ? ' wide' : '') }, title, tags, tpl, h('div', { id: 'legend-slot' }), blocksEl, backEl, tail);
  const scroll = h('div', { class: 'ed-scroll', id: 'ed-scroll' }, page);
  let memT;
  scroll.addEventListener('scroll', () => { ed.classList.toggle('scrolled', scroll.scrollTop > 4); clearTimeout(memT); memT = setTimeout(rememberScroll, 900); }, { passive: true });

  ed.replaceChildren(bar, scroll, buildDock());
  renderBlocks();
  pano?.adopt();
  requestAnimationFrame(() => { autosize(title); if (focusTitle) title.focus(); });
}

function renderBlocks() {
  const el = $('#blocks');
  if (!el || !ui.note) return;
  const keep = new Map(boards);
  boards.clear();
  const kids = ui.note.blocks.map((b, i) => renderBlock(b, i, keep));
  for (const b of keep.values()) b.destroy();
  el.replaceChildren(...kids);
  $('#legend-slot')?.replaceChildren(...[legendRow(ui.note)].filter(Boolean));
  updateDock();
  const ta = $('.text-src', el);
  if (ta && !ta.dataset.focused) { ta.dataset.focused = '1'; ta.focus({ preventScroll: false }); const n = ta.value.length; ta.setSelectionRange(n, n); }
}

function blockTools(b, i) {
  const n = ui.note.blocks.length;
  return h('div', { class: 'block-tools' },
    b.type === 'code' && smartOn() ? h('button', { 'aria-label': T('Fai diventare un repository del quaderno'), title: T('Fai diventare un repository'), onclick: (e) => { e.stopPropagation(); blockToRepo(b, i); } }, svg(I.repo)) : null,
    h('button', { 'aria-label': T('Sposta su'), disabled: i === 0 || null, onclick: (e) => { e.stopPropagation(); moveBlock(i, -1); } }, svg(I.up)),
    h('button', { 'aria-label': T('Sposta giù'), disabled: i === n - 1 || null, onclick: (e) => { e.stopPropagation(); moveBlock(i, 1); } }, svg(I.down)),
    h('button', { class: 'danger', 'aria-label': T('Elimina blocco'), onclick: (e) => { e.stopPropagation(); removeBlock(i); } }, svg(I.trash)));
}

function renderBlock(b, i, keep) {
  const wrap = h('div', { class: 'block' + (ui.active === b.id || ui.editing === b.id ? ' active' : '') + (enterBlock === b.id ? ' enter' : ''), 'data-id': b.id });
  if (enterBlock === b.id) enterBlock = null;
  if (b.type === 'text') {
    if (ui.editing === b.id) {
      const ta = h('textarea', { class: 'text-src', spellcheck: 'true', autocapitalize: 'sentences', placeholder: T('Scrivi… Markdown, $formule$, ```codice```'), 'aria-label': T('Testo') });
      ta.value = b.text;
      const size = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
      // barra di formattazione sopra la tastiera (2026.11.7): il Markdown lo scrive lei
      const prev = h('div', { class: 'md live-prev', 'aria-label': T('Anteprima') });
      let prevT = 0;
      const drawPrev = () => {
        clearTimeout(prevT);
        if (!prefs.livePreview) { prev.hidden = true; return; }
        prevT = setTimeout(function again() {
          if (!penQuiet()) { prevT = setTimeout(again, 300); return; }
          prev.hidden = !b.text.trim();
          prev.innerHTML = b.text.trim() ? renderMarkdown(b.text) : ''; enhance(prev);
        }, 350);
      };
      const bar = formatBar(ta, { preview: prefs.livePreview !== false, onPreview: (on) => { prefs.livePreview = on; ls.set('prefs', prefs); drawPrev(); } });
      if (prefs.livePreview == null) prefs.livePreview = true;
      const sugg = h('div', { class: 'snips fmt-sugg', hidden: true });
      bar.append(sugg);
      ta.addEventListener('input', (ev) => { autoFormat(ta, ev); b.text = ta.value; size(); scheduleSave(); suggest(); bar.refresh(); drawPrev(); });
      ta.addEventListener('keydown', (e) => { if (formatKeys(e, ta) || listIndent(e, ta)) return; textKeys(e, ta, b); });
      ta.addEventListener('keyup', (e) => { if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') { suggest(); bar.refresh(); } });
      ta.addEventListener('click', () => { suggest(); bar.refresh(); });
      ta.addEventListener('select', () => bar.refresh());
      ta.addEventListener('blur', () => {
        setTimeout(() => {
          if (document.activeElement === ta) return;
          if (ui.editing === b.id) { ui.editing = null; renderBlocks(); }
        }, 120);
      });
      requestAnimationFrame(size);
      // dopo [[ la barra propone i titoli degli appunti
      const suggest = () => {
        const m = /\[\[([^\[\]\n]{0,60})$/.exec(ta.value.slice(0, ta.selectionStart));
        if (!m) { if (!sugg.hidden) { sugg.hidden = true; bar.tools.hidden = false; } return; }
        const qn = norm(m[1]);
        const list = [...store.notes.values()].filter((n) => !n.deleted_at && n.title.trim() && n.id !== ui.note.id && norm(n.title).includes(qn))
          .sort((a, c) => new Date(c.updated_at) - new Date(a.updated_at)).slice(0, 8);
        sugg.hidden = false; bar.tools.hidden = true;
        sugg.replaceChildren(h('span', { class: 'snip-hint' }, list.length ? T('Collega a') : T('Nessun appunto con questo titolo: chiudi con ]] e toccando il collegamento lo crei')),
          ...list.map((n) => h('button', { type: 'button', onpointerdown: (e) => {
            e.preventDefault();
            const pos = ta.selectionStart;
            ta.setRangeText(n.title.trim() + ']]', pos - m[1].length, pos, 'end');
            b.text = ta.value; size(); scheduleSave(); suggest();
          } }, n.title)));
      };
      drawPrev();
      ta._refresh = () => { size(); bar.refresh(); drawPrev(); }; // live: testo cambiato altrove
      wrap.append(ta, bar, prev, blockTools(b, i));
    } else {
      const md = h('div', { class: 'md' + (b.text.trim() ? '' : ' placeholder') });
      if (b.text.trim()) {
        md.innerHTML = renderMarkdown(b.text); enhance(md);
        md.querySelectorAll('a.wikilink').forEach((a) => a.classList.toggle('missing', !findByTitle(a.dataset.wl)));
        addRunButtons(md);
      }
      else md.textContent = T('Tocca per scrivere');
      md.addEventListener('click', (e) => {
        const wl = e.target.closest('a.wikilink');
        if (wl) { e.preventDefault(); followLink(wl.dataset.wl); return; }
        if (e.target.closest('.run-box')) return;
        if (e.target.matches('input[type=checkbox]')) {
          b.text = toggleTask(b.text, Number(e.target.dataset.i)); scheduleSave(); renderBlocks(); return;
        }
        if (e.target.closest('a')) return;
        if (getSelection()?.toString()) return;
        ui.editing = b.id; ui.active = null; renderBlocks();
      });
      wrap.append(md);
    }
  } else if (b.type === 'ink') {
    let board = keep.get(b.id);
    if (board) { keep.delete(b.id); board.block = b; }
    else board = new InkBoard(b, { paper: ui.note.paper, pageUrl: (att) => store.imageUrl(att), onChange: () => { scheduleSave(); updateDock(); }, onActivate: () => { lastBoardId = b.id; activate(b.id); }, onSnap: (name) => snapBadge(name),
      onStrokeStart: () => { pen.down = true; lastBoardId = b.id; },
      onStrokeEnd: () => { pen.down = false; pen.last = Date.now(); collab.inkStroke(b.id); },
      onGesture: (g) => { snapBadge(g); updateDock(); } });
    board.setPaper(ui.note.paper);
    boards.set(b.id, board);
    if (b.bg && !board.frame.querySelector('.page-no')) board.frame.append(h('span', { class: 'page-no' }, `p. ${b.bg.page}`));
    if (!board.frame.querySelector('.ink-pano-btn')) board.frame.append(h('button', { type: 'button', class: 'ink-pano-btn', 'aria-label': T('Vista panoramica: a tutto schermo'), title: T('Vista panoramica'), onpointerdown: (e) => e.stopPropagation(), onclick: (e) => { e.stopPropagation(); openPano(b); } }, svg(I.expand)));
    wrap.append(board.frame.closest('.pano') ? h('div', { class: 'ink-pano-ph' }, T('Questa tavola è aperta nella vista panoramica')) : board.frame, blockTools(b, i));
  } else if (b.type === 'code') {
    wrap.className += ' code-block';
    const ideOpen = h('button', { type: 'button', class: 'btn small ide-btn', title: T('Apri in modalità IDE, a tutto schermo ({tasti})', { tasti: `${MOD} ⇧ E` }), onclick: (e) => { e.stopPropagation(); openBlockIde(b.id); } }, svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'), h('span', {}, 'IDE'));
    wrap.append(renderCodeBlock(b, { onChange: () => scheduleSave(), onSave: () => scheduleSave(true), toast, confirmBtn, extraHead: ideOpen }), blockTools(b, i));
  } else if (b.type === 'tool') {
    wrap.className += ' tool-block';
    wrap.append(renderTool(b, { onChange: () => scheduleSave(), toast, confirmBtn, quiet: penQuiet }), blockTools(b, i));
  } else if (b.type === 'chart') {
    wrap.className += ' tool-block chart-wrap';
    wrap.append(chartBlock(b, { onChange: () => scheduleSave(), quiet: penQuiet }), blockTools(b, i));
  } else if (b.type === 'image') {
    const cap = h('input', { placeholder: T('Didascalia'), 'aria-label': T('Didascalia') });
    cap.value = b.caption || '';
    cap.addEventListener('input', () => { b.caption = cap.value; scheduleSave(); });
    const img = h('img', { src: store.imageUrl(b.att), alt: b.caption || T('Foto'), loading: 'lazy', width: b.w, height: b.h });
    img.addEventListener('click', () => activate(b.id));
    wrap.className += ' img-block';
    wrap.append(h('figure', {}, img, h('figcaption', {}, cap)), blockTools(b, i));
  }
  return wrap;
}

// Un blocco «Progetto» diventa un repository del quaderno; al suo posto resta il collegamento [[nome]]
async function blockToRepo(b, i) {
  const note = ui.note;
  const nameBase = (b.name || note.title || 'progetto').trim();
  let nm = nameBase, k = 2;
  while (findByTitle(nm)) nm = `${nameBase} ${k++}`;
  const r = store.newNote(note.notebook_id, 'repo');
  r.title = nm;
  r.blocks = [{ ...structuredClone(b), id: uuid(), name: nm }];
  r._saved = true;
  await store.saveNote(r);
  note.blocks.splice(i, 1, { id: uuid(), type: 'text', text: `Repository: [[${nm}]]` });
  scheduleSave(true); renderBlocks();
  toast(T('Ora è il repository «{nome}» del quaderno', { nome: nm }), { label: T('Apri'), fn: () => openNote(r.id) });
}

// --- 2026.11.4: vista panoramica di una tavola ------------------------------------------------------------
// La tavola va a tutto schermo con più spazio (a destra e sotto), l'inchiostro alla stessa grandezza della pagina.
// «Riduci» la rimette al suo posto: se si è scritto oltre la larghezza della pagina, tutto rimpicciolisce insieme
// per entrare nel riquadro, che si allunga verso il basso se serve. Gli altri blocchi e l'ordine non cambiano.
let pano = null; // la panoramica aperta: { id, noteId, close, adopt }
function openPano(b) {
  const board = boards.get(b.id);
  if (!board || pano) return;
  const id = b.id;
  const holder = board.frame.parentElement, next = board.frame.nextSibling;
  const pageW = board.pan.clientWidth || board.frame.clientWidth;
  const h0 = b.h;
  const scroll = h('div', { class: 'pano-scroll' });
  const zoomLbl = h('span', { class: 'pano-zoom' }, '100%');
  // sempre il blocco di adesso: dopo una modifica arrivata da fuori `b` può essere un oggetto vecchio
  const close = ({ discard = false } = {}) => {
    pano = null;
    document.removeEventListener('keydown', onKey);
    ro.disconnect();
    board.wide = 1; board.onZoom = null; board.infinite = false; board.extentW = 0;
    const ph = document.querySelector(`#blocks > .block[data-id="${id}"] > .ink-pano-ph`);
    if (ph) ph.replaceWith(board.frame);
    else if (holder.isConnected) holder.insertBefore(board.frame, next);
    else board.frame.remove();
    const dock = ov.querySelector('#dock');
    if (dock) { if ($('#editor #dock')) dock.remove(); else $('#editor').append(dock); }
    ov.remove();
    app.classList.remove('pano-open');
    if (discard) { board.destroy(); return; }
    const cur = board.block;
    cur.h = Math.max(h0, 200);
    const r = board.fitToPage();
    board.setZoom(1);
    scheduleSave(true);
    if (r.changed) toast(r.k < 1 ? (cur.h > h0 ? T('Tavola rimpicciolita al {p}% per entrare nel riquadro, che si è allungato verso il basso', { p: Math.round(r.k * 100) }) : T('Tavola rimpicciolita al {p}% per entrare nel riquadro', { p: Math.round(r.k * 100) })) : T('Il riquadro si è allungato verso il basso per contenere tutto'), { label: tp('azione', 'Annulla'), fn: () => { board.undo(); scheduleSave(true); } });
    requestAnimationFrame(() => board.frame.scrollIntoView({ block: 'nearest' }));
  };
  // dopo un ridisegno dell'editor: la barra nuova torna nella panoramica e la tavola resta quella attiva
  const adopt = () => {
    const fresh = $('#editor #dock');
    if (fresh) { ov.querySelector('#dock')?.remove(); ov.append(fresh); }
    ui.active = null; activate(id);
  };
  // ruotando l'iPad cambia la larghezza: l'inchiostro resta grande quanto sulla pagina, cambia solo lo spazio a destra
  const ro = new ResizeObserver(() => {
    const wide = Math.max(1, (scroll.clientWidth - 40) / pageW);
    if (!scroll.clientWidth || Math.abs(wide - board.wide) < 0.001) return;
    board.wide = wide;
    if (board.extentW) board.extentW = Math.max(board.extentW, Math.round(1000 * wide));
    board.resize();
  });
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const ov = h('div', { class: 'pano', role: 'dialog', 'aria-label': T('Vista panoramica') },
    h('div', { class: 'pano-bar' },
      h('strong', {}, T('Vista panoramica')),
      h('span', { class: 'pano-hint' }, T('Spazio infinito a destra e in basso · pizzica con due dita per ingrandire · Riduci per tornare alla pagina')),
      h('span', { class: 'spacer' }),
      h('button', { class: 'icon-btn', 'aria-label': T('Rimpicciolisci'), onclick: () => board.setZoom(board.zoom / 1.25) }, '−'), zoomLbl,
      h('button', { class: 'icon-btn', 'aria-label': T('Ingrandisci'), onclick: () => board.setZoom(board.zoom * 1.25) }, '+'),
      h('button', { class: 'btn primary', onclick: () => close() }, T('Riduci'))),
    scroll);
  const dock = $('#dock');
  document.body.append(ov);
  app.classList.add('pano-open');
  scroll.append(board.frame);
  if (dock) ov.append(dock);
  pano = { id, noteId: ui.note.id, close, adopt };
  board.wide = Math.max(1, (scroll.clientWidth - 40) / pageW);
  board.infinite = true; // 2026.11.6: pagine infinite, la tavola si allunga a destra e in basso mentre scorri
  b.h = Math.max(h0, Math.ceil((scroll.clientHeight - 20) / (pageW / 1000)) + 200);
  board.onZoom = (z) => { zoomLbl.textContent = Math.round(z * 100) + '%'; };
  board.setZoom(1);
  ro.observe(scroll);
  lastBoardId = id; activate(id);
  document.addEventListener('keydown', onKey);
}

let badgeTimer;
function snapBadge(name) {
  let b = document.querySelector('.snap-badge');
  if (!b) { b = h('div', { class: 'snap-badge', role: 'status' }); $('#editor').append(b); }
  b.textContent = SNAP_NAMES[name] || T('Forma');
  b.classList.add('show');
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => b.classList.remove('show'), 1100);
}

function activate(id) {
  if (ui.active === id) return;
  ui.active = id;
  if (ui.editing) { ui.editing = null; renderBlocks(); return; }
  document.querySelectorAll('.block').forEach((el) => el.classList.toggle('active', el.dataset.id === id));
  updateDock();
}

function textKeys(e, ta, b) {
  // continua elenchi e checklist con Invio
  if (e.key === 'Enter' && !e.shiftKey) {
    const pos = ta.selectionStart;
    const lineStart = ta.value.lastIndexOf('\n', pos - 1) + 1;
    const line = ta.value.slice(lineStart, pos);
    const m = line.match(/^(\s*)([-*+] \[[ xX]\] |[-*+] |(\d+)\. )/);
    if (m) {
      e.preventDefault();
      if (line.trim() === m[2].trim()) { ta.setRangeText('', lineStart, pos, 'end'); }
      else {
        let next = m[2];
        if (m[3]) next = `${Number(m[3]) + 1}. `;
        if (/\[[xX]\]/.test(next)) next = next.replace(/\[[xX]\]/, '[ ]');
        ta.setRangeText('\n' + m[1] + next, pos, ta.selectionEnd, 'end');
      }
      ta.dispatchEvent(new Event('input'));
    }
  } else if (e.key === 'Tab') {
    e.preventDefault();
    ta.setRangeText('    ', ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input'));
  } else if (e.key === 'Escape') {
    ta.blur();
  }
}

let enterBlock = null;
const blockEls = () => [...document.querySelectorAll('#blocks > .block')];
// 2026.11.6: posto scelto trascinando uno strumento del dock nell'appunto (vale per il prossimo blocco inserito, entro 2 minuti:
// foto e PDF passano dal selettore dei file, il codice dal menu dei linguaggi)
let dropAt = null;
const takeDrop = () => { const d = dropAt; dropAt = null; return d && d.note === ui.note?.id && Date.now() - d.t < 120000 ? Math.min(d.i, ui.note.blocks.length) : null; };
function addBlock(type, extra = {}) {
  if (!ui.note) return;
  const b = type === 'text' ? { id: uuid(), type, text: '' } : type === 'ink' ? { id: uuid(), type, strokes: [], h: 800 } : { id: uuid(), type, ...extra };
  // dove l'hai lasciato trascinando; altrimenti dopo il blocco attivo, altrimenti in fondo
  const at = takeDrop();
  const ref = ui.editing || ui.active;
  const idx = ref ? ui.note.blocks.findIndex((x) => x.id === ref) : -1;
  ui.note.blocks.splice(at ?? (idx >= 0 ? idx + 1 : ui.note.blocks.length), 0, b);
  ui.editing = type === 'text' ? b.id : null;
  ui.active = type === 'text' ? null : b.id;
  scheduleSave();
  enterBlock = b.id;
  const before = measure(blockEls());
  renderBlocks();
  flip(before, blockEls());
  requestAnimationFrame(() => $(`.block[data-id="${b.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: type === 'ink' ? 'start' : 'center' }));
}

function moveBlock(i, d) {
  const arr = ui.note.blocks;
  const j = i + d;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  const before = measure(blockEls());
  scheduleSave(); renderBlocks();
  flip(before, blockEls());
}

function removeBlock(i) {
  const [b] = ui.note.blocks.splice(i, 1);
  if (ui.active === b.id) ui.active = null;
  if (ui.editing === b.id) ui.editing = null;
  const before = measure(blockEls());
  scheduleSave(); renderBlocks();
  flip(before, blockEls());
  toast(b.type === 'ink' ? T('Scrittura a mano eliminata') : b.type === 'image' ? T('Foto eliminata') : b.type === 'code' ? T('Blocco di codice eliminato') : b.type === 'tool' ? T('Strumento eliminato') : b.type === 'chart' ? T('Grafico eliminato') : T('Testo eliminato'), { label: tp('azione', 'Annulla'), fn: () => { ui.note.blocks.splice(i, 0, b); scheduleSave(); renderBlocks(); } });
}

// --- barra strumenti --------------------------------------------------------
const INK_COLORS = ['#1c2333', '#3657e8', '#e2573b', '#0f9d8a', '#8b5cf6'];
const WIDTHS = [2, 3.5, 6];
let fileInput;

function buildDock() {
  const tool = (t, icon, label) => h('button', { 'data-tool': t, 'aria-label': label, title: label, onclick: () => { inkPrefs.tool = t; savePrefs(); updateDock(); } }, svg(icon));
  const inkTools = h('div', { class: 'ink-tools', id: 'ink-tools' },
    tool('pen', I.pen, T('Penna')), tool('hl', I.hl, T('Evidenziatore')), tool('eraser', I.eraser, T('Gomma')),
    tool('lasso', I.lasso, T('Lazo: seleziona a mano libera')),
    h('button', { 'data-tool': 'shape', id: 'shape-btn', 'aria-label': T('Forme e piano cartesiano'), title: T('Forme'), onclick: (e) => shapePop(e.currentTarget) }, svg(SHAPES.find((s) => s.k === inkPrefs.shape)?.icon || I.shapes)),
    h('span', { class: 'sep' }),
    INK_COLORS.map((c) => h('button', { 'data-color': c, 'aria-label': currentLegend()[c] || T('Colore'), title: currentLegend()[c] || null, onclick: () => { inkPrefs.color = c; if (inkPrefs.tool === 'eraser' || inkPrefs.tool === 'lasso') inkPrefs.tool = 'pen'; savePrefs(); updateDock(); } }, h('span', { class: 'swatch', '--c': c === '#1c2333' ? 'var(--ink)' : c }))),
    h('span', { class: 'legend-now', id: 'legend-now', hidden: true }),
    h('span', { class: 'sep' }),
    WIDTHS.map((w) => h('button', { 'data-width': w, 'aria-label': T('Spessore {n}', { n: w }), onclick: () => { inkPrefs.width = w; savePrefs(); updateDock(); } }, h('span', { class: 'wdot', style: { width: w * 2 + 3 + 'px', height: w * 2 + 3 + 'px' } }))),
    h('span', { class: 'sep' }),
    h('button', { id: 'undo', 'aria-label': T('Annulla tratto'), onclick: () => activeBoard()?.undo() }, svg(I.undo)),
    h('button', { id: 'redo', 'aria-label': T('Ripeti tratto'), onclick: () => activeBoard()?.redo() }, svg(I.redo)),
    h('button', { id: 'pen-only', 'aria-label': T('Solo Apple Pencil scrive'), title: T('Solo Apple Pencil: il dito scorre la pagina'), onclick: () => { inkPrefs.penOnly = !inkPrefs.penOnly; savePrefs(); updateDock(); toast(inkPrefs.penOnly ? T('Solo l\'Apple Pencil scrive, il dito scorre') : T('Ora scrive anche il dito')); } }, svg(I.hand)),
    h('span', { class: 'sep' }));
  fileInput ||= Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: () => { addImages([...fileInput.files]); fileInput.value = ''; } });
  document.body.append(fileInput);
  return h('div', { class: 'dock', id: 'dock', role: 'toolbar', 'aria-label': T('Strumenti') },
    inkTools,
    h('button', { class: 'add', onclick: () => addBlock('text'), 'aria-label': T('Aggiungi testo') }, svg(I.text), h('span', { class: 'label' }, T('Testo'))),
    h('button', { class: 'add', onclick: () => addBlock('ink'), 'aria-label': T('Aggiungi scrittura a mano') }, svg(I.pen), h('span', { class: 'label' }, T('A mano'))),
    h('button', { class: 'add', onclick: () => fileInput.click(), 'aria-label': T('Aggiungi foto') }, svg(I.photo), h('span', { class: 'label' }, T('Foto'))),
    h('button', { class: 'add', onclick: () => pickPdf('insert'), 'aria-label': T('Inserisci le pagine di un PDF da annotare') }, svg(I.pdf), h('span', { class: 'label' }, 'PDF')),
    h('button', { class: 'add', id: 'code-btn', onclick: (e) => codePop(e.currentTarget), 'aria-label': T('Aggiungi codice eseguibile') }, svg(I.code), h('span', { class: 'label' }, T('Codice'))),
    h('button', { class: 'add', id: 'chart-btn', onclick: (e) => chartPop(e.currentTarget), 'aria-label': T('Aggiungi un grafico o un diagramma') }, svg(I.chart), h('span', { class: 'label' }, T('Grafico'))),
    isEng() && toolsFor(courseOf(nbById(ui.note?.notebook_id))).length ? h('button', { class: 'add', id: 'tools-btn', onclick: () => toolSheet({ insert: true }), 'aria-label': T('Strumenti del corso') }, svg(I.tools), h('span', { class: 'label' }, T('Strumenti'))) : null);
}

const SHAPES = [
  { k: 'line', label: T('Linea'), icon: '<path d="M5 19L19 5"/>' },
  { k: 'arrow', label: T('Freccia'), icon: '<path d="M5 19L19 5M11 5h8v8"/>' },
  { k: 'rect', label: T('Rettangolo'), icon: '<rect x="4" y="6" width="16" height="12" rx="1"/>' },
  { k: 'ellipse', label: T('Ellisse / cerchio'), icon: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>' },
  { k: 'axes', label: T('Piano cartesiano'), icon: '<path d="M4 12h16M12 20V4M17 9l3 3-3 3M9 7l3-3 3 3"/>' },
];

function closePop() { document.querySelector('.pop')?.remove(); }
function shapePop(anchor) {
  if (document.querySelector('.pop')) { closePop(); return; }
  inkPrefs.tool = 'shape'; savePrefs(); updateDock();
  const pop = h('div', { class: 'pop', role: 'menu' },
    h('div', { class: 'pop-title' }, T('Forme')),
    SHAPES.map((s) => h('button', { class: inkPrefs.shape === s.k ? 'on' : '', role: 'menuitem', onclick: () => {
      inkPrefs.shape = s.k; inkPrefs.tool = 'shape'; savePrefs(); closePop();
      $('#shape-btn').replaceChildren(svg(s.icon)); updateDock();
      toast(s.k === 'axes' ? T('Trascina per disegnare il piano: l\'origine va sul quadretto al centro') : T('Trascina per disegnare: {forma}', { forma: s.label.toLowerCase() }));
    } }, svg(s.icon), s.label)),
    h('label', { class: 'pop-toggle' },
      h('span', {}, T('Aggancia ai quadretti')),
      (() => { const c = h('input', { type: 'checkbox', id: 'snap-grid' }); c.checked = !!inkPrefs.snapGrid; c.addEventListener('change', () => { inkPrefs.snapGrid = c.checked; savePrefs(); }); return c; })()),
    h('p', { class: 'pop-hint' }, T('Con la penna: disegna a mano libera e tieni ferma la punta un attimo alla fine. Linee, cerchi, rettangoli, triangoli e spezzate si raddrizzano da soli.')));
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.max(12, Math.min(innerWidth - 292, r.left + r.width / 2 - 140)) + 'px';
  pop.style.bottom = (innerHeight - r.top + 10) + 'px';
  pop.style.transformOrigin = `${r.left + r.width / 2 - parseFloat(pop.style.left)}px 100%`;
  document.body.append(pop);
  setTimeout(() => document.addEventListener('pointerdown', function off(e) { if (!e.target.closest('.pop, #shape-btn')) { closePop(); document.removeEventListener('pointerdown', off); } }), 0);
}

const SNAP_NAMES = { noredo: T('Niente da ripristinare'), selected: T('Selezionato'), undo: T('Annullato'), redo: T('Ripristinato'), nothing: T('Niente da annullare'), line: T('Linea'), circle: T('Cerchio'), ellipse: T('Ellisse'), rect: T('Rettangolo'), triangle: T('Triangolo'), quad: T('Quadrilatero'), polyline: T('Spezzata') };

function activeBoard() { return ui.active ? boards.get(ui.active) : null; }

function updateDock() {
  app.classList.toggle('pen-only', !!inkPrefs.penOnly);
  const tools = $('#ink-tools');
  if (!tools) return;
  const b = activeBoard();
  tools.hidden = !b;
  tools.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('on', x.dataset.tool === inkPrefs.tool));
  tools.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x.dataset.color === inkPrefs.color && inkPrefs.tool !== 'eraser'));
  tools.querySelectorAll('[data-width]').forEach((x) => x.classList.toggle('on', Number(x.dataset.width) === inkPrefs.width));
  $('#pen-only').classList.toggle('on', !!inkPrefs.penOnly);
  const ln = $('#legend-now');
  if (ln) { const t = inkPrefs.tool === 'pen' || inkPrefs.tool === 'hl' || inkPrefs.tool === 'shape' ? currentLegend()[inkPrefs.color] : ''; ln.textContent = t || ''; ln.hidden = !t; }
  if (b) { $('#undo').disabled = !b.undoStack.length; $('#redo').disabled = !b.redoStack.length; }
}
document.addEventListener('ink-pen-detected', () => { updateDock(); toast(T('Apple Pencil rilevata: ora il dito scorre e la penna scrive')); });

async function addImages(files) {
  if (!ui.note) return;
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    try {
      const { blob, w, hgt } = await shrink(f);
      const att = await store.addImage(blob, ui.note.id);
      addBlock('image', { att, w, h: hgt, caption: '' });
    } catch (e) { toast(T('Foto non caricata: ') + e.message); }
  }
}
async function shrink(file, max = 2000) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * s), hgt = Math.round(bmp.height * s);
  const c = Object.assign(document.createElement('canvas'), { width: w, height: hgt });
  c.getContext('2d').drawImage(bmp, 0, 0, w, hgt);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
  return { blob, w, hgt };
}

// --- PDF da annotare (2026.11.6) ----------------------------------------------
// Ogni pagina diventa una tavola con la pagina come sfondo (vedi pdfdoc.js). «new»: un appunto per PDF (o per
// capitolo, se il PDF ha un indice); «insert»: le pagine entrano nell'appunto aperto, dopo il blocco attivo.
let pdfInput, pdfMode = 'new';
const isPdfFile = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
function pickPdf(mode) {
  pdfMode = mode;
  pdfInput ||= Object.assign(document.createElement('input'), { type: 'file', accept: 'application/pdf,.pdf', multiple: true, hidden: true,
    onchange: () => { const files = [...pdfInput.files]; pdfInput.value = ''; importPdfs(files, pdfMode); } });
  if (!pdfInput.isConnected) document.body.append(pdfInput);
  pdfInput.click();
}

async function importPdfs(files, mode) {
  files = files.filter(isPdfFile);
  if (!files.length) { toast(T('Scegli un file PDF')); return; }
  if (mode === 'insert' && !ui.note) mode = 'new';
  const bar = h('i'), label = h('p', { class: 'muted' }, T('Apro il PDF…'));
  openSheet(h('div', { class: 'pdf-import' }, h('h2', {}, files.length > 1 ? T('Importo {n} PDF', { n: files.length }) : T('Importo il PDF')), label, h('div', { class: 'pdf-progress' }, bar)));
  const read = [];
  for (const [k, f] of files.entries()) {
    try {
      read.push(await readPdf(f, (i, n) => {
        label.textContent = (files.length > 1 ? T('File {k} di {n} · ', { k: k + 1, n: files.length }) : '') + T('leggo la pagina {i} di {n}', { i, n });
        bar.style.width = ((k + i / n) / files.length) * 100 + '%';
      }));
    } catch (e) { toast(e.message); }
  }
  if (!read.length) { closeSheet(); return; }
  if (mode === 'new' && read.some((r) => r.chapters.length >= 2)) pdfChoice(read);
  else finishPdf(read, mode, false);
}

// Il PDF ha un indice: un appunto unico o uno per capitolo?
function pdfChoice(read) {
  let split = false;
  const nCh = read.reduce((a, r) => a + (r.chapters.length >= 2 ? partsOf(r).length : 1), 0);
  const pages = read.reduce((a, r) => a + r.pages.length, 0);
  const ways = h('div', { class: 'pdf-ways' });
  const draw = () => ways.replaceChildren(
    h('button', { type: 'button', class: split ? '' : 'on', onclick: () => { split = false; draw(); } }, h('strong', {}, read.length > 1 ? T('Un appunto per PDF') : T('Un appunto unico')), h('small', {}, tn(pages, '{n} pagina', '{n} pagine, tutte insieme'))),
    h('button', { type: 'button', class: split ? 'on' : '', onclick: () => { split = true; draw(); } }, h('strong', {}, T('Un appunto per capitolo')), h('small', {}, T('{n} appunti, dai capitoli dell\'indice del PDF', { n: nCh }))));
  draw();
  const first = read.find((r) => r.chapters.length >= 2);
  openSheet(h('div', { class: 'pdf-import' },
    h('h2', {}, T('Come lo vuoi negli appunti?')),
    read.map((r) => h('div', { class: 'pdf-file' }, svg(I.pdf), h('div', {}, h('strong', {}, r.title), h('small', {}, tn(r.pages.length, '{n} pagina', '{n} pagine') + (r.chapters.length >= 2 ? ' · ' + T('{n} capitoli', { n: r.chapters.length }) : ''))))),
    ways,
    h('ol', { class: 'pdf-chapters' }, partsOf(first).slice(0, 40).map((c) => h('li', {}, `${c.title} (p. ${c.from}${c.to > c.from ? `–${c.to}` : ''})`))),
    h('div', { class: 'sheet-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => closeSheet() }, T('Annulla')),
      h('button', { class: 'btn primary', type: 'button', onclick: () => finishPdf(read, 'new', split) }, T('Importa')))));
}

// Parti di un PDF secondo i capitoli dell'indice; le pagine prima del primo capitolo (copertina, indice) restano col titolo del PDF
function partsOf(r) {
  const ch = r.chapters, n = r.pages.length;
  if (ch.length < 2) return [{ title: r.title, from: 1, to: n }];
  const parts = [];
  if (ch[0].page > 1) parts.push({ title: r.title, from: 1, to: ch[0].page - 1 });
  ch.forEach((c, i) => parts.push({ title: c.title.slice(0, 200), from: c.page, to: i + 1 < ch.length ? ch[i + 1].page - 1 : n }));
  return parts;
}

async function finishPdf(read, mode, split) {
  closeSheet();
  try {
    if (mode === 'insert' && ui.note) {
      let pages = 0;
      for (const r of read) {
        const att = await store.addAttachment(r.blob, ui.note.id, 'application/pdf');
        insertBlocks(pageBlocks(att, r.pages, uuid));
        pages += r.pages.length;
      }
      if (!ui.note.title.trim() && read.length === 1) { ui.note.title = read[0].title; renderEditor(); }
      scheduleSave(true);
      toast(tn(pages, '{n} pagina aggiunta: scrivi sopra con la Pencil', '{n} pagine aggiunte: scrivi sopra con la Pencil'));
      return;
    }
    flushSave();
    const nbId = ui.view.kind === 'notebook' ? ui.view.id : null;
    let first = null, made = 0;
    for (const r of read) {
      const parts = split ? partsOf(r) : [{ title: r.title, from: 1, to: r.pages.length }];
      let att = null;
      for (const part of parts) {
        const note = store.newNote(nbId);
        att ||= await store.addAttachment(r.blob, note.id, 'application/pdf'); // un solo allegato per PDF, anche se diviso
        note.title = part.title;
        note.paper = prefs.paper;
        note.blocks = pageBlocks(att, r.pages, uuid, part.from, part.to);
        await store.saveNote(note);
        first ||= note; made++;
      }
    }
    if (ui.view.kind === 'trash' || ui.view.kind === 'pinned' || ui.view.kind === 'home') go({ kind: 'recent' });
    renderList();
    await openNote(first.id);
    toast(made > 1 ? T('{n} appunti creati dal PDF: scrivi sopra le pagine con la Pencil', { n: made }) : T('PDF pronto: scrivi sopra le pagine con la Pencil'));
  } catch (e) { toast(T('PDF non importato: ') + e.message); }
}

// Inserisce più blocchi dopo quello attivo (o in fondo) e mostra il primo
function insertBlocks(blocks) {
  if (!ui.note || !blocks.length) return;
  const ref = ui.editing || ui.active;
  const idx = ref ? ui.note.blocks.findIndex((x) => x.id === ref) : -1;
  // un appunto con solo un blocco vuoto (appena creato) lo sostituisce
  const only = ui.note.blocks.length === 1 ? ui.note.blocks[0] : null;
  const empty = only && ((only.type === 'text' && !only.text.trim()) || (only.type === 'ink' && !only.strokes?.length && !only.bg));
  const at = takeDrop();
  if (empty) ui.note.blocks = [];
  ui.note.blocks.splice(empty ? 0 : at ?? (idx >= 0 ? idx + 1 : ui.note.blocks.length), 0, ...blocks);
  ui.editing = null; ui.active = blocks[0].id;
  renderBlocks();
  requestAnimationFrame(() => $(`.block[data-id="${blocks[0].id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

// --- azioni appunto ----------------------------------------------------------
// 2026-11-24: quaderno, cestino e «fissato» non sono nel documento Yjs: per un appunto live vanno col PATCH
function noteFields(fields) {
  Object.assign(ui.note, fields);
  if (collab.owns(ui.note.id) && ui.note.rev > 0) store.patchNote(ui.note.id, fields);
  scheduleSave(true);
}
function togglePin() {
  noteFields({ pinned: !ui.note.pinned });
  renderEditor();
  toast(ui.note.pinned ? T('Fissato in alto') : T('Tolto dai fissati'));
}
function trashNote() {
  const id = ui.note.id;
  const wasNew = ui.note.rev === 0 && !ui.note._saved;
  if (!wasNew) noteFields({ deleted_at: new Date().toISOString() });
  closeSheet(); closeNote();
  if (!wasNew) toast(T('Spostato nel cestino'), { label: tp('azione', 'Annulla'), fn: async () => { await store.patchNote(id, { deleted_at: null }); openNote(id); } });
}
function restoreNote() {
  noteFields({ deleted_at: null });
  renderEditor(); toast(T('Appunto ripristinato'));
}

let sheetT;
function openSheet(content, big = false) {
  const s = $('#sheet-body'), w = $('#sheet');
  const wasClosing = w.classList.contains('closing');
  clearTimeout(sheetT);
  s.className = 'sheet' + (big ? ' big' : '');
  s.replaceChildren(...[content].flat(Infinity).filter(Boolean));
  s.style.transform = ''; w.style.removeProperty('--dim'); w.classList.remove('closing');
  if (w.hidden || wasClosing) { w.hidden = false; s.scrollTop = 0; w.classList.remove('opening'); void w.offsetWidth; w.classList.add('opening'); }
  else { s.classList.add('swap'); } // un foglio che ne sostituisce un altro: solo una piccola dissolvenza
}
function closeSheet(instant = false) {
  const w = $('#sheet'), s = $('#sheet-body');
  if (w.hidden) return;
  const done = () => { w.hidden = true; w.classList.remove('closing', 'opening'); s.style.transform = ''; w.style.removeProperty('--dim'); };
  if (instant === true || reduced()) { done(); return; }
  w.classList.add('closing');
  clearTimeout(sheetT); sheetT = setTimeout(done, 230);
}
// il foglio segue il dito verso il basso e, lasciato andare, si chiude o torna su con la sua spinta
(() => {
  const w = $('#sheet'), s = $('#sheet-body');
  let anim = null;
  const at = (y) => { s.style.transform = y ? `translateY(${y}px)` : ''; w.style.setProperty('--dim', String(Math.max(0, 1 - Math.max(0, y) / (s.offsetHeight || 600)))); };
  drag(s, {
    start: (x0, y0, dx, dy, target) => dy > 0 && dy > Math.abs(dx) && s.scrollTop <= 0 && !w.dataset.locked && !w.classList.contains('closing')
      && !target.closest('textarea, input, select, .code-src, .run-out, .tt-row'),
    move: (dx, dy) => { anim?.stop(); w.classList.remove('opening'); at(dy > 0 ? dy : -rubber(-dy, 300)); },
    end: (dx, dy, vx, vy, cancel) => {
      const H = s.offsetHeight || 600;
      if (!cancel && (vy > 0.45 || dy > H * 0.3)) anim = spring({ from: dy, to: H + 80, velocity: Math.max(vy, 0.9), stiffness: 260, damping: 30, onUpdate: at, onDone: () => closeSheet(true) });
      else anim = spring({ from: dy, to: 0, velocity: vy, onUpdate: at, onDone: () => at(0) });
    },
  });
})();
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet' && !e.target.dataset.locked) closeSheet(); });

function noteMenu() {
  const note = ui.note;
  const paperSeg = h('div', { class: 'seg' }, [['grid', T('Quadretti')], ['lines', T('Righe')], ['dots', T('Puntini')], ['blank', T('Bianca')]].map(([k, l]) =>
    h('button', { class: note.paper === k ? 'on' : '', onclick: () => { note.paper = k; scheduleSave(); boards.forEach((b) => b.setPaper(k)); paperSeg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.textContent === l)); } }, l)));
  openSheet([
    h('h2', {}, note.title || T('Senza titolo')),
    h('p', { class: 'lead' }, T('Modificato {quando}', { quando: when(note.updated_at) })),
    isRepo(note) ? null : h('div', { class: 'field' }, h('span', {}, T('Carta per la scrittura a mano')), paperSeg),
    h('div', { class: 'menu-list' },
      // 2026.11.6: le pagine di un PDF in un appunto già esistente, dopo il blocco attivo (o in fondo)
      isRepo(note) ? null : h('button', { onclick: () => { closeSheet(); pickPdf('insert'); } }, svg(I.pdf), (ui.active || ui.editing) ? T('Aggiungi un PDF dopo il blocco selezionato') : T('Aggiungi un PDF in fondo all\'appunto')),
      isRepo(note) ? null : h('button', { onclick: () => { closeSheet(); exportPdf([note.id]); } }, svg(I.pdf), T('Esporta in PDF (copertina, indice, stile)')),
      note.shared || !note.rev ? null : h('button', { onclick: () => shareSheet(isRepo(note) ? 'repo' : 'note', note) }, svg(I.share), T('Condividi…')),
      note.shared ? null : h('button', { onclick: () => moveSheet() }, svg(I.move), T('Sposta in un altro quaderno')),
      h('button', { onclick: () => versionsSheet() }, svg(I.clock), T('Cronologia versioni')),
      isRepo(note) ? null : h('button', { onclick: () => { prefs.wide = !prefs.wide; ls.set('prefs', prefs); closeSheet(); renderEditor(); } }, svg(I.expand), prefs.wide ? T('Pagina a larghezza normale') : T('Pagina a tutta larghezza')),
      note.shared ? null : note.deleted_at
        ? confirmBtn(T('Elimina per sempre'), async () => { await store.destroyNote(note.id); ui.note.rev = 0; ui.note._saved = false; closeSheet(); closeNote(); toast(T('Eliminato definitivamente')); }, 'danger')
        : h('button', { class: 'danger', onclick: trashNote }, svg(I.trash), T('Sposta nel cestino'))),
  ]);
}

function moveSheet() {
  const note = ui.note;
  const list = store.notebooks.filter((n) => !n.archived);
  openSheet([
    h('h2', {}, T('Sposta in…')),
    h('p', { class: 'lead' }, T('Scegli il quaderno di questo appunto.')),
    h('div', { class: 'menu-list' },
      list.filter((nb) => !nb.shared).map((nb) => h('button', { onclick: () => { noteFields({ notebook_id: nb.id }); closeSheet(); renderEditor(); toast(T('Spostato in {quaderno}', { quaderno: nb.title })); } },
        h('span', { class: 'nb-code', '--c': nb.color }, nb.code || codeFrom(nb.title)), nb.title, note.notebook_id === nb.id ? h('span', { style: { marginLeft: 'auto', color: 'var(--accent)' } }, T('attuale')) : null)),
      h('button', { onclick: () => { noteFields({ notebook_id: null }); closeSheet(); renderEditor(); } }, h('span', { class: 'nb-code', '--c': 'var(--faint)' }, '—'), T('Nessun quaderno'))),
  ]);
}

async function versionsSheet() {
  const note = ui.note;
  openSheet([h('h2', {}, T('Cronologia')), h('p', { class: 'lead' }, T('Caricamento…'))]);
  try {
    const vs = await store.versions(note.id);
    openSheet([
      h('h2', {}, T('Cronologia')),
      h('p', { class: 'lead' }, vs.length ? T('Una copia ogni 10 minuti di lavoro. Ripristinarne una salva prima quella attuale.') : T('Nessuna versione precedente per ora: le copie si creano dopo 10 minuti di modifiche.')),
      h('div', { class: 'versions' }, vs.map((v) => h('button', { onclick: async () => {
        const full = await store.version(v.id);
        ui.note.blocks = full.blocks; ui.note.title = full.title;
        scheduleSave(true); closeSheet(); renderEditor(); toast(T('Versione ripristinata'));
      } }, h('span', {}, v.title || T('Senza titolo')), h('small', {}, new Date(v.saved_at).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))))),
      h('div', { class: 'sheet-actions' }, h('button', { class: 'btn', onclick: closeSheet }, T('Chiudi'))),
    ]);
  } catch (e) { openSheet([h('h2', {}, T('Cronologia')), h('p', { class: 'lead' }, T('Serve la connessione al server: ') + e.message)]); }
}

// --- quaderni ----------------------------------------------------------------
function notebookSheet(nb) {
  if (nb?.shared) return sharedNotebookSheet(nb);
  const isNew = !nb;
  const d = nb ? { ...nb } : { title: '', code: '', color: colorFor(store.notebooks.length), year: null, exam_date: '' };
  let codeTouched = !!d.code;
  const title = h('input', { id: 'nb-title', value: d.title, placeholder: T('es. Analisi Matematica I'), autocomplete: 'off' });
  const code = h('input', { id: 'nb-code', value: d.code, placeholder: 'AM1', maxlength: 5, autocomplete: 'off', style: { textTransform: 'none' } });
  title.addEventListener('input', () => { if (!codeTouched) code.value = codeFrom(title.value); });
  code.addEventListener('input', () => { codeTouched = true; });
  const exam = h('input', { id: 'nb-exam', type: 'date', value: d.exam_date || '' });
  const colors = h('div', { class: 'colors' }, COLORS.map((c) => h('button', { class: c === d.color ? 'on' : '', '--c': c, 'aria-label': T('Colore'), onclick: () => { d.color = c; colors.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.style.getPropertyValue('--c') === c)); } })));
  const years = h('div', { class: 'seg' }, [[1, T('{n}° anno', { n: 1 })], [2, T('{n}° anno', { n: 2 })], [3, T('{n}° anno', { n: 3 })], [null, T('Altro')]].map(([y, l]) => h('button', { class: (d.year ?? null) === y ? 'on' : '', onclick: (e) => { d.year = y; years.querySelectorAll('button').forEach((x) => x.classList.remove('on')); e.currentTarget.classList.add('on'); } }, l)));
  const legend = { ...(d.legend || {}) };
  const legInputs = Object.entries(LEGEND_SUGGEST).map(([c, sug]) => {
    const inp = h('input', { placeholder: sug, maxlength: 30, 'aria-label': T('Significato del colore {colore}', { colore: sug }) });
    inp.value = legend[c] || '';
    inp.addEventListener('input', () => { legend[c] = inp.value; });
    return { c, sug, inp, el: h('label', { class: 'legend-edit' }, h('span', { class: 'swatch', '--c': c }), inp) };
  });
  const legendField = h('div', { class: 'field' }, h('span', {}, T('Colori con significato (facoltativo)')),
    h('div', { class: 'legend-grid' }, legInputs.map((x) => x.el)),
    h('button', { type: 'button', class: 'btn small', onclick: () => legInputs.forEach((x) => { if (!x.inp.value.trim()) { x.inp.value = x.sug; legend[x.c] = x.sug; } }) }, T('Usa i suggeriti')));
  let kind = d.kind || '';
  const kindHint = h('p', { class: 'field-hint' });
  const kindSeg = h('div', { class: 'seg' });
  const drawKind = () => {
    kindSeg.replaceChildren(...[['', T('Automatico')], ['code', T('Programmazione')], ['plain', T('Classico')]].map(([k, l]) => h('button', { type: 'button', class: k === kind ? 'on' : '', onclick: () => { kind = k; drawKind(); } }, l)));
    const auto = looksLikeCode({ title: title.value, code: code.value });
    kindHint.textContent = kind === 'code' ? T('Appunti e repository di codice.') : kind === 'plain' ? T('Solo appunti.')
      : auto ? T('Dal nome sembra un corso di programmazione: oltre agli appunti avrà i repository di codice.') : T('Dal nome sembra un corso senza codice: solo appunti. Scegli Programmazione per avere i repository.');
  };
  title.addEventListener('input', () => drawKind());
  drawKind();
  const kindField = smartOn() ? h('div', { class: 'field' }, h('span', {}, T('Tipo di quaderno (smart)')), kindSeg, kindHint) : null;
  const save = h('button', { class: 'btn primary', onclick: async () => {
    if (!title.value.trim()) { title.focus(); return; }
    save.disabled = true;
    const leg = Object.fromEntries(Object.entries(legend).map(([c, t]) => [c, (t || '').trim()]).filter(([, t]) => t));
    const fields = { title: title.value.trim(), code: code.value.trim() || codeFrom(title.value), color: d.color, year: d.year, exam_date: exam.value || null, legend: leg, kind };
    try {
      if (isNew) { const { legend: lg, ...rest } = fields; let created = await store.createNotebook(rest); if (Object.keys(lg).length) created = await store.updateNotebook(created.id, { legend: lg }); closeSheet(); go({ kind: 'notebook', id: created.id }); }
      else { await store.updateNotebook(nb.id, fields); closeSheet(); renderSide(); renderList(); renderEditor(); }
    } catch (e) { save.disabled = false; toast((e.offline ? T('Serve la connessione per i quaderni: ') : '') + e.message); }
  } }, isNew ? T('Crea quaderno') : T('Salva'));
  openSheet([
    h('h2', {}, isNew ? T('Nuovo quaderno') : T('Modifica quaderno')),
    h('p', { class: 'lead' }, isNew ? T('Un quaderno per corso: la sigla compare su ogni appunto.') : T('Nome, sigla, colore e data dell\'esame.')),
    h('div', { class: 'row2' }, h('label', { class: 'field' }, h('span', {}, T('Nome')), title), h('label', { class: 'field' }, h('span', {}, T('Sigla')), code)),
    h('div', { class: 'field' }, h('span', {}, T('Colore')), colors),
    h('div', { class: 'field' }, h('span', {}, T('Anno di corso')), years),
    h('label', { class: 'field' }, h('span', {}, T('Data esame (facoltativa)')), exam),
    kindField,
    legendField,
    h('div', { class: 'sheet-actions' },
      !isNew ? h('button', { class: 'btn', onclick: () => shareSheet('notebook', nb) }, T('Condividi…')) : null,
      !isNew ? h('button', { class: 'btn', style: { marginRight: 'auto' }, onclick: async () => { try { await store.updateNotebook(nb.id, { archived: !nb.archived }); closeSheet(); renderSide(); toast(nb.archived ? T('Quaderno riattivato') : T('Quaderno archiviato')); } catch (e) { toast(e.message); } } }, nb.archived ? T('Riattiva') : T('Archivia')) : null,
      !isNew ? confirmBtn(T('Elimina'), async () => { try { await store.deleteNotebook(nb.id); closeSheet(); go({ kind: 'recent' }); toast(T('Quaderno eliminato: i suoi appunti sono nel cestino')); } catch (e) { toast(e.message); } }) : null,
      h('button', { class: 'btn', onclick: closeSheet }, T('Annulla')), save),
  ]);
  if (isNew) setTimeout(() => title.focus(), 50);
}

function coursePicker(first = false) {
  const existing = new Set(store.notebooks.map((n) => norm(n.title)));
  const chosen = new Set();
  const avail = COURSES.filter((c) => !existing.has(norm(c.title)));
  const btn = h('button', { class: 'btn primary', disabled: true });
  const refresh = () => { btn.disabled = !chosen.size; btn.textContent = chosen.size ? tn(chosen.size, 'Crea {n} quaderno', 'Crea {n} quaderni') : T('Scegli almeno un corso'); };
  const chips = new Map();
  const yearsEl = [1, 2, 3].map((y) => {
    const list = avail.filter((c) => c.year === y);
    if (!list.length) return null;
    return h('div', {},
      h('div', { class: 'course-year' }, T('{n}° anno', { n: y }), h('button', { onclick: () => { const all = list.every((c) => chosen.has(c)); list.forEach((c) => { all ? chosen.delete(c) : chosen.add(c); chips.get(c).classList.toggle('on', !all); }); refresh(); } }, T('Tutto l\'anno'))),
      h('div', { class: 'chips' }, list.map((c, i) => {
        const chip = h('button', { class: 'chip', onclick: () => { chosen.has(c) ? chosen.delete(c) : chosen.add(c); chip.classList.toggle('on'); refresh(); } },
          h('span', { class: 'nb-code', '--c': colorFor(COURSES.indexOf(c)) }, c.code), c.title);
        chips.set(c, chip);
        return chip;
      })));
  });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const items = COURSES.filter((c) => chosen.has(c)).map((c) => ({ title: c.title, code: c.code, year: c.year, color: colorFor(COURSES.indexOf(c)) }));
      await store.createNotebooks(items);
      ls.set('onboarded', true);
      if (!profile()) saveProfile({ track: 'ing-inf' });
      closeSheet(); renderSide(); renderList();
      toast(tn(items.length, '{n} quaderno pronto', '{n} quaderni pronti'));
    } catch (e) { refresh(); toast((e.offline ? T('Serve la connessione al server: ') : '') + e.message); }
  });
  refresh();
  openSheet([
    h('h2', {}, first ? T('Benvenuto in Quadretto') : T('Aggiungi corsi')),
    h('p', { class: 'lead' }, first ? T('Scegli i corsi di Ingegneria Informatica che stai seguendo: per ognuno nasce un quaderno. Nomi e sigle si cambiano quando vuoi.') : T('Corsi del piano di studi non ancora tra i tuoi quaderni.')),
    yearsEl,
    h('div', { class: 'sheet-actions' },
      h('button', { class: 'btn', style: { marginRight: 'auto' }, onclick: () => { ls.set('onboarded', true); closeSheet(); notebookSheet(); } }, T('Crea a mano')),
      first ? h('button', { class: 'btn', onclick: () => { ls.set('onboarded', true); closeSheet(); } }, T('Più tardi')) : h('button', { class: 'btn', onclick: closeSheet }, T('Annulla')),
      btn),
  ], true);
}

function settingsSheet() {
  const seg = (opts, cur, fn) => { const el = h('div', { class: 'seg' }, opts.map(([k, l]) => h('button', { class: cur === k ? 'on' : '', onclick: (e) => { el.querySelectorAll('button').forEach((x) => x.classList.remove('on')); e.currentTarget.classList.add('on'); fn(k); } }, l))); return el; };
  openSheet([
    h('h2', {}, T('Impostazioni')),
    h('p', { class: 'lead' }, T('Appunti salvati su PostgreSQL ({server}) con una copia su questo dispositivo.', { server: location.host })),
    h('div', { class: 'account-row' },
      h('span', { class: 'avatar' }, (me?.display_name || me?.username || '?').slice(0, 1).toUpperCase()),
      h('div', { class: 'account-who' }, h('strong', {}, me?.display_name || me?.username), h('small', {}, '@' + (me?.username || ''))),
      h('button', { class: 'btn', onclick: () => openSheet(changePasswordForm(() => { closeSheet(); toast(T('Password cambiata')); })) }, T('Password')),
      confirmBtn(T('Esci'), () => logout(), 'btn')),
    h('div', { class: 'field' }, h('span', {}, T('Profilo di studio')), seg(TRACKS.map((t) => [t.k, t.label]), profile()?.track, (k) => { saveProfile({ track: k }).then(() => { renderSide(); renderList(); renderHome(); renderEditor(); }); }),
      h('p', { class: 'field-hint' }, T('Ingegneria Informatica accende gli strumenti dei corsi nei quaderni (per ora Sistemi Operativi). I quaderni smart valgono per tutti.'))),
    h('div', { class: 'field' }, h('span', {}, T('Quaderni smart')), seg([[true, T('Attivi')], [false, T('Spenti')]], smartOn(), (k) => { saveProfile({ smart: k }).then(() => { renderList(); renderHome(); }); }),
      h('p', { class: 'field-hint' }, T('Un quaderno di programmazione (riconosciuto dal nome, o scelto in Modifica quaderno) ha anche i repository di codice.'))),
    h('div', { class: 'field' }, h('span', {}, T('Tema')), seg([['auto', T('Automatico')], ['light', T('Chiaro')], ['dark', T('Scuro')]], prefs.theme, (k) => { prefs.theme = k; ls.set('prefs', prefs); applyTheme(); })),
    h('div', { class: 'field' }, h('span', {}, T('Carta dei nuovi appunti')), seg([['grid', T('Quadretti')], ['lines', T('Righe')], ['dots', T('Puntini')], ['blank', T('Bianca')]], prefs.paper, (k) => { prefs.paper = k; ls.set('prefs', prefs); })),
    // Lingua (2026-11-24): resta nell'account; si ricarica la pagina perché tutti i testi si ridisegnino nella lingua nuova.
    h('div', { class: 'field' }, h('span', {}, T('Lingua')), seg(UI_LANGS, getLang(), async (k) => { if (!setLang(k)) return; await store.saveSettings({ ...store.settings, lang: k }); location.reload(); })),
    h('div', { class: 'field' }, h('span', {}, T('Chi scrive a mano')), seg([[true, T('Solo Apple Pencil')], [false, T('Pencil e dito')]], !!inkPrefs.penOnly, (k) => { inkPrefs.penOnly = k; savePrefs(); updateDock(); })),
    h('div', { class: 'menu-list' },
      h('button', { onclick: () => timetableSheet() }, svg(I.clock), T('Orario delle lezioni')),
      h('button', { onclick: () => shortcutsSheet() }, svg('<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7.5 14h9"/>'), T('Scorciatoie da tastiera')),
      h('button', { onclick: () => { closeSheet(); coursePicker(); } }, svg(I.plus), T('Aggiungi corsi dal piano di studi')),
      h('button', { onclick: () => { closeSheet(); notebookSheet(); } }, svg(I.grid), T('Nuovo quaderno vuoto')),
      h('button', { onclick: () => { location.href = '/api/export'; } }, svg(I.down), T('Scarica backup completo (JSON)')),
      h('button', { onclick: () => { closeSheet(); store.sync(); toast(T('Sincronizzazione avviata')); } }, svg(I.restore), T('Sincronizza adesso'))),
    h('p', { class: 'lead', style: { marginTop: '16px', fontSize: '13px' } }, T('Quadretto {versione} · senza rete gli appunti restano salvati su questo dispositivo e si sincronizzano al ritorno della connessione.', { versione: VERSION }), ' ',
      // Licenza AGPL-3.0: chi usa l'app deve poter avere il codice sorgente (2026-11-24, pubblicazione su GitHub)
      h('a', { href: SOURCE_URL, target: '_blank', rel: 'noopener' }, T('Codice sorgente (AGPL-3.0)')), ' ', h('span', { class: 'signature inline' }, 'AMi')),
    h('div', { class: 'sheet-actions' }, h('button', { class: 'btn primary', onclick: closeSheet }, T('Fatto'))),
  ]);
}

// --- concentrazione e pannelli -------------------------------------------------
function toggleFocus() {
  app.dataset.focus = app.dataset.focus === 'on' ? 'off' : 'on';
  ls.set('focus', app.dataset.focus);
  renderEditor();
}
function toggleSide() {
  if (narrow()) { app.classList.toggle('side-open'); return; }
  app.dataset.side = app.dataset.side === 'hidden' ? 'shown' : 'hidden';
  ls.set('side', app.dataset.side);
}

// --- stato sincronizzazione ------------------------------------------------------
function renderSync() {
  const el = $('#sync');
  el.dataset.s = store.status;
  const t = {
    loading: T('Avvio…'),
    synced: T('Tutto salvato sul server'),
    syncing: store.pending ? tn(store.pending, 'Invio di {n} modifica…', 'Invio di {n} modifiche…') : T('Sincronizzazione…'),
    offline: store.pending ? T('Offline · {n} in attesa, salvate su questo dispositivo', { n: store.pending }) : T('Offline · salvato su questo dispositivo'),
    error: T('Errore: ') + store.lastError,
    auth: T('Accesso scaduto · modifiche salvate su questo dispositivo'),
  }[store.status];
  $('.sync-text', el).textContent = t;
}

// --- gesti su tutto il foglio -------------------------------------------------------
// tocco a 2 dita = annulla · tocco a 3 dita = ripristina · 2 dita verso sinistra = annulla, verso destra = ripristina
function gestureBoard() {
  if (activeBoard()) return activeBoard();
  if (lastBoardId && boards.has(lastBoardId)) return boards.get(lastBoardId);
  return boards.size === 1 ? [...boards.values()][0] : null;
}
function doGesture(kind) {
  const b = gestureBoard();
  if (!b) { snapBadge('nothing'); return; }
  const ok = kind === 'undo' ? b.undo() : b.redo();
  snapBadge(ok ? kind : kind === 'undo' ? 'nothing' : 'noredo');
  updateDock();
}
// --- 2026.11.6: trascina uno strumento del dock (Testo, A mano, Foto, PDF, Codice…) nel punto dell'appunto dove lo vuoi ---
// Col dito, la Pencil o il mouse: tieni premuto il pulsante e spostalo nell'appunto; una riga mostra dove andrà. Un tocco
// semplice fa come prima (dopo il blocco attivo). Niente HTML5 drag and drop: su iPad non funziona con il tocco.
(function bindToolDrag() {
  let d = null;
  const blocksNow = () => [...document.querySelectorAll('#blocks > .block')];
  const slot = (y) => { const bs = blocksNow(); let i = 0; for (; i < bs.length; i++) { const r = bs[i].getBoundingClientRect(); if (y < r.top + r.height / 2) break; } return { i, bs }; };
  const place = (x, y) => {
    d.ghost.style.transform = `translate(${x - 24}px, ${y - 24}px)`;
    const ed = $('#ed-scroll'), er = ed?.getBoundingClientRect();
    const inside = er && x >= er.left && x <= er.right && y >= er.top && y <= er.bottom && $('#blocks');
    d.line.hidden = !inside; d.i = null;
    if (!inside) return;
    const { i, bs } = slot(y);
    const area = $('#blocks').getBoundingClientRect();
    const top = !bs.length ? area.top : i < bs.length ? bs[i].getBoundingClientRect().top - 6 : bs[bs.length - 1].getBoundingClientRect().bottom + 6;
    Object.assign(d.line.style, { left: area.left + 'px', width: area.width + 'px', top: top + 'px' });
    d.i = i;
    // vicino ai bordi la pagina scorre da sola
    if (y < er.top + 50) ed.scrollTop -= 14; else if (y > er.bottom - 70) ed.scrollTop += 14;
  };
  const end = (ok) => {
    const x = d; d = null;
    x.ghost.remove(); x.line.remove(); document.body.classList.remove('tool-dragging');
    if (!x.on) return;
    x.btn.dataset.dragged = '1'; setTimeout(() => delete x.btn.dataset.dragged, 400);
    if (ok && x.i != null && ui.note) { dropAt = { note: ui.note.id, i: x.i, t: Date.now() }; x.btn.click(); x.btn.dataset.dragged = '1'; }
  };
  document.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('.dock .add');
    if (!btn || !ui.note || e.button > 0) return;
    d = { btn, id: e.pointerId, x: e.clientX, y: e.clientY, on: false, i: null, ghost: null, line: null };
  }, true);
  document.addEventListener('pointermove', (e) => {
    if (!d || e.pointerId !== d.id) return;
    if (!d.on) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 10) return;
      d.on = true;
      try { d.btn.setPointerCapture(e.pointerId); } catch {}
      d.ghost = h('div', { class: 'tool-ghost', 'aria-hidden': 'true' }, d.btn.querySelector('svg')?.cloneNode(true));
      d.line = h('div', { class: 'drop-line', hidden: true });
      document.body.append(d.ghost, d.line); document.body.classList.add('tool-dragging');
    }
    e.preventDefault();
    place(e.clientX, e.clientY);
  }, { capture: true, passive: false });
  document.addEventListener('pointerup', (e) => { if (d && e.pointerId === d.id) end(true); }, true);
  document.addEventListener('pointercancel', (e) => { if (d && e.pointerId === d.id) end(false); }, true);
  // il clic che segue il rilascio non deve inserire un secondo blocco
  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('.dock .add');
    if (btn?.dataset.dragged === '1' && !e.isTrusted) { delete btn.dataset.dragged; return; } // quello lanciato da end()
    if (btn?.dataset.dragged) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
})();

(function bindGestures() {
  const ed = document.body; // l'editor e la vista panoramica
  let g = null;
  const fingers = (e) => [...e.touches].filter((t) => t.touchType !== 'stylus');
  ed.addEventListener('touchstart', (e) => {
    if (!e.target.closest('#editor, .pano') || e.target.closest('textarea, input, .sheet, .air-menu')) { g = null; return; }
    const f = fingers(e);
    if (pen.down && f.length < 2) { g = null; return; }
    if (!g) { g = { t0: e.timeStamp, max: 0, start: new Map(), moved: false, dx: 0, dy: 0 }; inkTouch.used = false; }
    g.max = Math.max(g.max, f.length);
    for (const t of f) if (!g.start.has(t.identifier)) g.start.set(t.identifier, [t.clientX, t.clientY]);
  }, { capture: true, passive: true });
  ed.addEventListener('touchmove', (e) => {
    if (!g) return;
    const f = fingers(e);
    let sx = 0, sy = 0, n = 0;
    for (const t of f) { const a = g.start.get(t.identifier); if (!a) continue; const dx = t.clientX - a[0], dy = t.clientY - a[1]; sx += dx; sy += dy; n++; if (Math.hypot(dx, dy) > 14) g.moved = true; }
    if (n) { g.dx = sx / n; g.dy = sy / n; }
  }, { capture: true, passive: true });
  const end = (e) => {
    if (!g || e.touches.length) return;
    const x = g; g = null;
    const dt = e.timeStamp - x.t0;
    if (x.max < 2 || inkTouch.used) return; // 2026.11.6: le due dita hanno ingrandito o fatto scorrere la tavola
    if (!x.moved && dt < 380) doGesture(x.max >= 3 ? 'redo' : 'undo');
    else if (x.max === 2 && dt < 700 && Math.abs(x.dx) > 70 && Math.abs(x.dx) > 2 * Math.abs(x.dy)) doGesture(x.dx < 0 ? 'undo' : 'redo');
  };
  ed.addEventListener('touchend', end, { capture: true });
  ed.addEventListener('touchcancel', () => { g = null; }, { capture: true });
})();

// --- nuova versione sul server: proponi di aggiornare ------------------------------
let updateOffered = false;
async function checkVersion() {
  if (updateOffered) return;
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    const { version } = await r.json();
    if (version && version !== VERSION) { updateOffered = true; toast(T('Nuova versione {versione} disponibile', { versione: version }), { label: T('Aggiorna'), fn: () => { flushSave(); setTimeout(() => location.reload(), 300); } }); }
  } catch {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkVersion(); });
setInterval(checkVersion, 5 * 60e3);

// --- eventi globali ---------------------------------------------------------------
let searchTimer;
$('#search').addEventListener('input', (e) => {
  ui.query = e.target.value.trim();
  ui.searchHits = null;
  renderSide(); renderList(); renderHome();
  clearTimeout(searchTimer);
  if (ui.query.length >= 2) searchTimer = setTimeout(async () => {
    try { const q = ui.query; const hits = await store.search(q); if (q === ui.query) { ui.searchHits = hits; renderList(); } } catch {}
  }, 300);
});
$('#search').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.target.value = ''; e.target.dispatchEvent(new Event('input')); e.target.blur(); } });
$('#new-note').addEventListener('click', newNote);
$('#new-pdf').addEventListener('click', () => pickPdf('new'));
$('#brand').addEventListener('click', () => go({ kind: 'home' }));
$('#lay-list').addEventListener('click', () => setLayout('list'));
$('#lay-gallery').addEventListener('click', () => setLayout('gallery'));
$('#nb-edit').addEventListener('click', () => notebookSheet(nbById(ui.view.id)));
$('#btn-settings').addEventListener('click', settingsSheet);
$('#btn-news').addEventListener('click', newsSheet);
$('#side-open').classList.add('has-dot');
$('#side-open').append(h('span', { class: 'news-dot', hidden: true }));
$('#side-open').addEventListener('click', () => app.classList.add('side-open'));
$('#side-close').addEventListener('click', () => app.classList.remove('side-open'));
$('#scrim').addEventListener('click', () => app.classList.remove('side-open'));
$('#side-toggle').addEventListener('click', toggleSide);

// --- scorciatoie da tastiera (anche su desktop e con la tastiera dell'iPad) -------------------------------------
const SHORTCUTS = [
  ['App', [
    [`${MOD} N`, T('Nuovo appunto')], [`${MOD} ⌥ N`, T('Nuovo repository (nel quaderno di programmazione aperto)')], [`${MOD} F`, T('Cerca')],
    [`${MOD} 1…9`, T('Apri il quaderno n. 1…9')], [`${MOD} \\`, T('Mostra o nascondi i pannelli')], [`${MOD} ⇧ F`, T('Concentrazione')],
    [`${MOD} ,`, T('Impostazioni')], ['?', T('Questa schermata')], ['Esc', T('Chiudi la finestra aperta')],
  ]],
  [T('Testo'), FORMAT_SHORTCUTS],
  [T('Scrittura a mano'), [[`${MOD} Z`, T('Annulla il tratto')], [`${MOD} ⇧ Z`, T('Ripeti il tratto')], [`${MOD} ⇧ P`, T('Vista panoramica della tavola attiva')]]],
  [T('Codice'), [
    [`${MOD} ⇧ E`, T('Modalità IDE: il repository a tutto schermo')], [`${MOD} ${T('Invio')}`, T('Esegui')], [`${MOD} S`, T('Salva subito')], [`${MOD} P`, T('Vai a un file del repository')], [T('Ctrl Spazio'), T('Mostra i suggerimenti')],
    ['Tab', T('Accetta il primo suggerimento (altrimenti rientra)')], ['⇧ Tab', T('Togli un rientro')], [`${MOD} /`, T('Commenta o scommenta le righe')],
    [`${MOD} ] | ${MOD} [`, T('Rientra / togli rientro')], ['⌥ ↑ | ⌥ ↓', T('Sposta le righe su o giù')], [`${MOD} ⇧ D`, T('Duplica le righe')], ['Esc', T('Nascondi i suggerimenti')],
  ]],
];
function shortcutsSheet() {
  openSheet([
    h('div', { class: 'rs-head' }, h('span', { class: 'rs-head-ico' }, svg('<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7.5 14h9"/>')), h('div', {}, h('h2', {}, T('Scorciatoie da tastiera')), h('p', { class: 'rs-sub' }, T('Su Mac, PC e iPad con la tastiera')))),
    SHORTCUTS.map(([g, list]) => h('div', { class: 'kb-group' }, h('div', { class: 'home-label' }, g),
      h('div', { class: 'kb-list' }, list.map(([k, d]) => h('div', { class: 'kb-row' }, h('span', { class: 'kb-keys' }, k.split(' ').map((x) => (x === '|' ? h('span', { class: 'kb-or' }, 'o') : h('kbd', {}, x)))), h('span', {}, d)))))),
    h('div', { class: 'sheet-actions' }, h('button', { class: 'btn primary', onclick: closeSheet }, T('Fatto'))),
  ]);
}
const typing = (e) => e.target.matches?.('textarea, input, select, [contenteditable]');
document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (e.key === 'Escape' && document.querySelector('.pano')) return; // la chiude la vista panoramica
  if (e.key === 'Escape' && !$('#sheet').hidden) { closeSheet(); return; }
  if (!mod && e.key === '?' && !typing(e)) { e.preventDefault(); shortcutsSheet(); return; }
  if (!mod) return;
  const k = e.key.toLowerCase();
  if ((k === '/' || e.code === 'Slash') && !typing(e)) { e.preventDefault(); shortcutsSheet(); return; }
  if (k === ',') { e.preventDefault(); settingsSheet(); return; }
  if (/^[1-9]$/.test(e.key) && !e.shiftKey && !e.altKey) {
    const list = store.notebooks.filter((n) => !n.archived);
    const nb = list[Number(e.key) - 1];
    if (nb) { e.preventDefault(); go({ kind: 'notebook', id: nb.id }); }
    return;
  }
  if (k === 'e' && e.shiftKey && ui.note) { e.preventDefault(); toggleIde(); return; }
  if (k === 'p' && e.shiftKey && !typing(e)) { const bid = ui.active || lastBoardId; const blk = ui.note?.blocks.find((x) => x.id === bid && x.type === 'ink'); if (blk) { e.preventDefault(); openPano(blk); } return; }
  if ((k === 'n' || e.code === 'KeyN') && e.altKey) {
    const nb = nbById(ui.view.kind === 'notebook' ? ui.view.id : ui.note?.notebook_id);
    if (nb && codeNb(nb)) { e.preventDefault(); repoSheet(nb.id); }
    return;
  }
  if (k === 'n') { e.preventDefault(); newNote(); }
  else if (k === 'f' && e.shiftKey) { e.preventDefault(); if (ui.note) toggleFocus(); }
  else if (k === 'f') { e.preventDefault(); if (narrow()) app.classList.add('side-open'); $('#search').focus(); }
  else if (k === '\\') { e.preventDefault(); toggleSide(); }
  else if (k === 'z' && activeBoard() && !e.target.matches('textarea, input')) { e.preventDefault(); e.shiftKey ? activeBoard().redo() : activeBoard().undo(); }
});
document.addEventListener('paste', (e) => {
  if (!ui.note) return;
  const all = [...(e.clipboardData?.files || [])];
  const files = all.filter((f) => f.type.startsWith('image/'));
  if (all.some(isPdfFile)) { e.preventDefault(); importPdfs(all, 'insert'); }
  if (files.length) { e.preventDefault(); addImages(files); }
});
document.addEventListener('dragover', (e) => { if (ui.note || [...(e.dataTransfer?.items || [])].some((i) => i.type === 'application/pdf')) e.preventDefault(); });
document.addEventListener('drop', (e) => {
  const files = [...(e.dataTransfer?.files || [])];
  if (files.some(isPdfFile)) { e.preventDefault(); importPdfs(files, ui.note ? 'insert' : 'new'); }
  if (!ui.note) return;
  e.preventDefault(); addImages(files);
});
addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { flushSave(); rememberScroll(); flushStudy(true); } });
addEventListener('pagehide', () => { rememberScroll(); flushStudy(true); });
// tocco fuori dai blocchi: disattiva la tavola. Nella vista panoramica la tavola non sta più dentro il suo
// .block (è in .pano): senza «.pano» qui ogni tratto spegneva la barra della penna (BUG-012).
document.addEventListener('pointerdown', (e) => {
  if (!ui.active) return;
  if (e.target.closest('.block, .dock, .sheet, .toast, .ed-bar, .pano, .pop')) return;
  ui.active = null;
  document.querySelectorAll('.block.active').forEach((x) => x.classList.remove('active'));
  updateDock();
});

let viewsTimer;
function listVisible() {
  if (app.dataset.home === 'on') return false;
  return !(app.dataset.view === 'editor' && (narrow() || layout === 'gallery'));
}
function refreshViews() {
  clearTimeout(viewsTimer);
  viewsTimer = setTimeout(() => {
    if (!penQuiet()) return refreshViews();
    renderSide();
    if (listVisible()) renderList(); else listStale = true;
    renderHome();
  }, 120);
}
let listStale = false;
store.addEventListener('change', (e) => {
  renderSync();
  if (e.detail === 'status') return;
  refreshViews();
  // aggiornamento arrivato da un altro dispositivo per l'appunto aperto
  if (ui.note && !saveTimer) {
    const m = store.notes.get(ui.note.id);
    if (!m || !(m.rev > ui.note.rev)) return;
    // col live le modifiche entrano dal documento (collab.js) e il server alza la revisione a ogni salvataggio, anche del
    // tuo: qui si annota e basta. Rileggere l'appunto ridisegnava tutto a ogni sincronizzazione (BUG-017)
    if (live.room(m.id)?.ready) { ui.note.rev = m.rev; return; }
    if (!m._local && penQuiet() && !document.activeElement?.matches('textarea, input')) openNote(ui.note.id);
  }
});
store.addEventListener('saved', (e) => { if (ui.note && ui.note.id === e.detail.id) ui.note.rev = Math.max(ui.note.rev, e.detail.rev); collab.saved(e.detail.id); });
store.addEventListener('conflict', () => toast(T('Appunto modificato anche da un altro dispositivo: la versione precedente è in Cronologia')));

// --- popover generico (sotto o sopra il pulsante) -------------------------------------
function openPop(pop, anchor, below = false) {
  closePop();
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.max(12, Math.min(innerWidth - 292, r.left + r.width / 2 - 140)) + 'px';
  if (below) pop.style.top = (r.bottom + 8) + 'px'; else pop.style.bottom = (innerHeight - r.top + 10) + 'px';
  pop.style.transformOrigin = `${r.left + r.width / 2 - parseFloat(pop.style.left)}px ${below ? '0' : '100%'}`;
  document.body.append(pop);
  setTimeout(() => document.addEventListener('pointerdown', function off(e) { if (!e.target.closest('.pop') && !anchor.contains(e.target)) { closePop(); document.removeEventListener('pointerdown', off); } }), 0);
}

// --- F10: modelli di pagina -------------------------------------------------------------
const shortDate = (d = new Date()) => d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
function nextLessonNumber(nbId) {
  let max = 0;
  for (const n of store.notes.values()) {
    if (n.deleted_at || n.notebook_id !== nbId) continue;
    const m = /^(?:Lezione|Lecture)\s+(\d+)/i.exec(n.title); // in tutte e due le lingue
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}
const TEMPLATES = [
  { k: 'lezione', label: T('Lezione'), ink: true, make: (n) => ({ title: T('Lezione {n} — {data}', { n: nextLessonNumber(n.notebook_id), data: shortDate() }), text: T('**Argomenti:** \n\n## \n') }) },
  { k: 'esercizio', label: T('Esercizio'), ink: true, make: () => ({ title: T('Esercizio — {data}', { data: shortDate() }), text: T('### Traccia\n\n\n### Svolgimento\n\n\n### Risultato\n') }) },
  { k: 'dimostrazione', label: T('Dimostrazione'), make: () => ({ title: T('Dimostrazione: '), text: T('> **Teorema.** \n\n**Ipotesi:** \n\n**Tesi:** \n\n**Dimostrazione.** \n\n$\\square$\n') }) },
  { k: 'codice', label: T('Esercizio di codice'), make: () => ({ title: T('Esercizio di codice — {data}', { data: shortDate() }), text: T('### Traccia\n\n'), code: 'c' }) },
];
function applyTemplate(t) {
  const note = ui.note;
  if (!note || !t) return;
  const r = t.make(note);
  const empty = isEmptyNote(note);
  if (!note.title.trim()) note.title = r.title;
  const text = { id: uuid(), type: 'text', text: r.text };
  if (!empty) note.blocks.unshift(text); // c'è già qualcosa (anche solo un tratto): il modello si aggiunge in cima, non cancella
  else {
    note.blocks = [text];
    if (r.code) note.blocks.push(newProject(r.code, uuid));
    else if (t.ink && inkPrefs.penOnly) note.blocks.push({ id: uuid(), type: 'ink', strokes: [], h: 900 });
  }
  const ink = note.blocks.find((b) => b.type === 'ink');
  ui.editing = ink ? null : text.id; ui.active = ink ? ink.id : null;
  note._saved = true; // un modello applicato è già un appunto: si salva anche se non scrivi altro
  scheduleSave(); renderEditor();
}

// --- F9: collegamenti [[titolo]] e «Citato in» --------------------------------------------
function findByTitle(t, prefNb) {
  const k = norm(String(t).trim());
  let best = null;
  for (const m of store.notes.values()) {
    if (m.deleted_at || norm(m.title.trim()) !== k) continue;
    if (m.notebook_id === prefNb) return m;
    best ||= m;
  }
  return best;
}
function followLink(t) {
  const m = findByTitle(t, ui.note?.notebook_id);
  if (m) { openNote(m.id); return; }
  newNote({ title: String(t).trim(), notebookId: ui.note?.notebook_id ?? null });
  toast(T('Nuovo appunto «{titolo}»: il collegamento ora porta qui', { titolo: String(t).trim() }));
}
function backlinksOf(note) {
  const t = note.title.trim();
  if (!t) return [];
  const needle = norm('[[' + t + ']]');
  return [...store.notes.values()].filter((m) => m.id !== note.id && !m.deleted_at && norm(m.plain).includes(needle))
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
}

// --- N5: colori con significato -------------------------------------------------------------
const LEGEND_SUGGEST = { '#e2573b': T('Definizione'), '#3657e8': T('Dimostrazione'), '#0f9d8a': T('Esempio'), '#8b5cf6': T('Teorema') };
const legendSel = new Set();
const currentLegend = () => nbById(ui.note?.notebook_id)?.legend || {};
function applyLegendFilter() {
  inkView.only = legendSel.size ? new Set([...legendSel].flatMap((c) => [c, hlColor(c)])) : null;
  boards.forEach((b) => b.redraw());
}
function legendRow(note) {
  const lg = Object.entries(nbById(note.notebook_id)?.legend || {});
  if (!lg.length || !note.blocks.some((b) => b.type === 'ink')) return null;
  const row = h('div', { class: 'legend-row' });
  const draw = () => row.replaceChildren(
    h('span', { class: 'legend-title' }, T('Mostra')),
    h('button', { class: 'chip' + (legendSel.size ? '' : ' on'), onclick: () => { legendSel.clear(); applyLegendFilter(); draw(); } }, T('Tutto')),
    ...lg.map(([c, t]) => h('button', { class: 'chip' + (legendSel.has(c) ? ' on' : ''), onclick: () => { legendSel.has(c) ? legendSel.delete(c) : legendSel.add(c); applyLegendFilter(); draw(); } }, h('span', { class: 'swatch', '--c': c }), t)));
  draw();
  return row;
}

// --- N1: orario delle lezioni e «Lezione di adesso» --------------------------------------------
const DAYS = [T('Lunedì'), T('Martedì'), T('Mercoledì'), T('Giovedì'), T('Venerdì'), T('Sabato'), T('Domenica')];
const toMin = (t) => { const [a, b] = String(t || '0:0').split(':').map(Number); return a * 60 + b; };
function lessonNow(now = new Date()) {
  const tt = (store.settings.timetable || []).filter((s) => nbById(s.nb) && s.start && s.end);
  const day = ((now.getDay() + 6) % 7) + 1;
  const m = now.getHours() * 60 + now.getMinutes();
  const today = tt.filter((s) => s.day === day).sort((a, b) => toMin(a.start) - toMin(b.start));
  return {
    cur: today.find((s) => m >= toMin(s.start) - 10 && m < toMin(s.end)),
    next: today.find((s) => toMin(s.start) - 10 > m),
    any: tt.length > 0,
  };
}
function todaysLesson(nbId) {
  const t = new Date().toDateString();
  return [...store.notes.values()].find((n) => !n.deleted_at && n.notebook_id === nbId && /^(?:Lezione|Lecture)\b/i.test(n.title) && new Date(n.created_at).toDateString() === t);
}
function startLesson(slot) {
  const ex = todaysLesson(slot.nb);
  ui.view = { kind: 'notebook', id: slot.nb };
  renderSide(); renderHome();
  if (ex) openNote(ex.id); else newNote({ template: 'lezione' });
}
function timetableSheet() {
  const nbs = store.notebooks.filter((n) => !n.archived);
  const rows = structuredClone(store.settings.timetable || []).sort((a, b) => a.day - b.day || toMin(a.start) - toMin(b.start));
  const list = h('div', { class: 'tt-list' });
  const sel = (opts, cur, fn, label) => { const s = h('select', { 'aria-label': label }, opts.map(([v, l]) => { const o = h('option', { value: v }, l); if (String(v) === String(cur)) o.selected = true; return o; })); s.addEventListener('change', () => fn(s.value)); return s; };
  const time = (v, fn, label) => { const i = h('input', { type: 'time', value: v, step: 300, 'aria-label': label }); i.addEventListener('change', () => fn(i.value)); return i; };
  const draw = () => list.replaceChildren(...(rows.length ? rows.map((r) => {
    const room = h('input', { placeholder: T('Aula'), value: r.room || '', maxlength: 30, 'aria-label': T('Aula') });
    room.addEventListener('input', () => { r.room = room.value; });
    return h('div', { class: 'tt-row' },
      sel(DAYS.map((d, i) => [i + 1, d]), r.day, (v) => { r.day = Number(v); }, T('Giorno')),
      time(r.start, (v) => { r.start = v; }, T('Inizio')), h('span', { class: 'tt-dash' }, '–'), time(r.end, (v) => { r.end = v; }, T('Fine')),
      sel(nbs.map((n) => [n.id, n.title]), r.nb, (v) => { r.nb = v; }, T('Corso')),
      room,
      h('button', { class: 'icon-btn', 'aria-label': T('Togli questa lezione'), onclick: () => { rows.splice(rows.indexOf(r), 1); draw(); } }, svg(I.trash)));
  }) : [h('p', { class: 'lead' }, T('Nessuna lezione: aggiungi la prima.'))]));
  draw();
  const add = h('button', { class: 'btn', onclick: () => {
    const last = rows[rows.length - 1];
    rows.push({ id: uuid(), day: last?.day || ((new Date().getDay() + 6) % 7) + 1, start: last?.end || '09:00', end: last ? `${pad2(Math.min(23, Math.floor(toMin(last.end) / 60) + 2))}:${pad2(toMin(last.end) % 60)}` : '11:00', nb: last?.nb || nbs[0]?.id, room: '' });
    draw();
  } }, T('+ Lezione'));
  openSheet([
    h('h2', {}, T('Orario delle lezioni')),
    h('p', { class: 'lead' }, T('All\'ora di ogni lezione (da 10 minuti prima) la Home propone l\'appunto della lezione, già nel quaderno giusto.')),
    nbs.length ? list : h('p', { class: 'lead' }, T('Crea prima i quaderni dei corsi.')),
    h('div', { class: 'sheet-actions' }, nbs.length ? add : null, h('button', { class: 'btn', style: { marginLeft: 'auto' }, onclick: closeSheet }, T('Annulla')),
      h('button', { class: 'btn primary', onclick: async () => {
        const bad = rows.find((r) => !r.nb || !r.start || !r.end || toMin(r.end) <= toMin(r.start));
        if (bad) { toast(T('{giorno}: l\'ora di fine deve venire dopo quella di inizio', { giorno: DAYS[bad.day - 1] })); return; }
        rows.sort((a, b) => a.day - b.day || toMin(a.start) - toMin(b.start));
        await store.saveSettings({ ...store.settings, timetable: rows });
        closeSheet(); renderHome(); toast(T('Orario salvato'));
      } }, T('Salva'))),
  ], true);
}

// --- N2: riprendi da dove eri -----------------------------------------------------------------
const scrollPos = ls.get('scrollPos', {});
function rememberScroll() {
  if (!penQuiet()) { setTimeout(rememberScroll, 1500); return; }
  const sc = $('#ed-scroll');
  if (!ui.note || !sc) return;
  delete scrollPos[ui.note.id];
  scrollPos[ui.note.id] = Math.round(sc.scrollTop);
  const keys = Object.keys(scrollPos);
  for (const k of keys.slice(0, Math.max(0, keys.length - 40))) delete scrollPos[k];
  ls.set('scrollPos', scrollPos);
  ls.set('resume', { id: ui.note.id, at: Date.now() });
}
function restoreScroll(id) {
  const y = scrollPos[id];
  if (!y) return;
  // le tavole a mano prendono l'altezza un attimo dopo: si riprova
  for (const t of [40, 250, 600]) setTimeout(() => { const sc = $('#ed-scroll'); if (sc && ui.noteId === id && sc.scrollTop < 2) sc.scrollTop = y; }, t);
}
function resumeTarget() {
  const r = ls.get('resume', null);
  if (!r || Date.now() - r.at > 14 * 86400e3) return null;
  const m = store.notes.get(r.id);
  return m && !m.deleted_at && ui.noteId !== r.id ? m : null;
}

// --- Home: lezione di adesso, riprendi ----------------------------------------------------------
function homeTop() {
  const out = [];
  const { cur, next, any } = lessonNow();
  if (cur) {
    const nb = nbById(cur.nb);
    out.push(h('section', { class: 'now-card', '--c': nb.color },
      h('span', { class: 'nb-code', '--c': nb.color }, nb.code || codeFrom(nb.title)),
      h('div', { class: 'now-text' },
        h('span', { class: 'now-label' }, T('Adesso · fino alle {ora}', { ora: cur.end }) + (cur.room ? ' · ' + cur.room : '')),
        h('h2', {}, nb.title)),
      h('button', { class: 'btn primary', onclick: () => startLesson(cur) }, todaysLesson(cur.nb) ? T('Continua la lezione') : T('Nuova lezione'))));
  } else if (next) {
    const nb = nbById(next.nb);
    out.push(h('button', { class: 'next-card', onclick: () => go({ kind: 'notebook', id: nb.id }) },
      h('span', { class: 'nb-code', '--c': nb.color }, nb.code || codeFrom(nb.title)),
      h('span', {}, T('Oggi alle {ora}: {quaderno}', { ora: next.start, quaderno: nb.title }) + (next.room ? ' · ' + next.room : ''))));
  } else if (!any && store.notebooks.length && !ls.get('ttHintOff', false)) {
    out.push(h('div', { class: 'tt-hint' },
      h('span', {}, T('Inserisci l\'orario delle lezioni: all\'ora giusta qui trovi la lezione pronta da scrivere.')),
      h('button', { class: 'btn small primary', onclick: timetableSheet }, T('Inserisci l\'orario')),
      h('button', { class: 'btn small', onclick: () => { ls.set('ttHintOff', true); renderHome(); } }, T('Non ora'))));
  }
  const r = resumeTarget();
  if (r) {
    const nb = nbById(r.notebook_id);
    out.push(h('button', { class: 'resume-card', onclick: () => { ui.view = nb ? { kind: 'notebook', id: nb.id } : { kind: 'recent' }; renderSide(); renderHome(); openNote(r.id); } },
      h('span', { class: 'resume-label' }, T('Continua da dove eri')),
      nb ? h('span', { class: 'nb-code', '--c': nb.color }, nb.code || codeFrom(nb.title)) : null,
      h('strong', {}, r.title || T('Senza titolo')),
      h('span', { class: 'resume-when' }, when(r.updated_at))));
  }
  return out;
}

// --- N4: tempo di studio per corso ------------------------------------------------------------------
// Conta 15 secondi alla volta, solo con l'app in primo piano e usata negli ultimi 2 minuti, nel quaderno aperto.
let lastInput = Date.now();
for (const t of ['pointerdown', 'keydown', 'wheel']) addEventListener(t, () => { lastInput = Date.now(); }, { capture: true, passive: true });
// in localStorage a ogni scatto (scrittura sincrona): se l'app si chiude di colpo, al prossimo avvio si recupera
const studyAcc = new Map(ls.get('studyAcc', []));
let studyAccSec = [...studyAcc.values()].reduce((a, b) => a + b, 0);
setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  if (!pen.down && Date.now() - Math.max(lastInput, pen.last) > 120000) return;
  const nb = ui.note?.notebook_id || (ui.view.kind === 'notebook' ? ui.view.id : null);
  if (!nb || !nbById(nb)) return;
  const k = dayKey() + '|' + nb;
  studyAcc.set(k, (studyAcc.get(k) || 0) + 15);
  studyAccSec += 15;
  if (penQuiet()) ls.set('studyAcc', [...studyAcc]); // mentre la penna scrive, solo in memoria
  if (studyAccSec >= 180) flushStudy();
}, 15000);
function flushStudy(force = false) {
  if (!studyAcc.size) return;
  if (!force && !penQuiet()) { setTimeout(flushStudy, 2000); return; }
  const items = [...studyAcc].map(([k, seconds]) => { const [day, notebook_id] = k.split('|'); return { day, notebook_id, seconds }; });
  studyAcc.clear(); studyAccSec = 0;
  store.addStudy(items).then(() => ls.set('studyAcc', [...studyAcc])).catch(() => {});
}
function studySection() {
  const mon = new Date(); mon.setHours(0, 0, 0, 0); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
  const tot = store.studySince(dayKey(mon));
  for (const [k, sec] of studyAcc) { const [day, nb] = k.split('|'); if (day >= dayKey(mon)) tot.set(nb, (tot.get(nb) || 0) + sec); }
  const rows = [...tot].filter(([nb, s]) => nbById(nb) && s >= 60).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return null;
  const max = rows[0][1];
  const all = rows.reduce((a, [, s]) => a + s, 0);
  return h('section', { class: 'home-sec' },
    h('div', { class: 'home-label-row' }, h('h2', { class: 'home-label' }, T('Studio questa settimana')), h('span', { class: 'home-count' }, fmtDur(all))),
    h('div', { class: 'study-list' }, rows.map(([id, sec]) => {
      const nb = nbById(id); const d = daysTo(nb.exam_date);
      return h('button', { class: 'study-row', onclick: () => go({ kind: 'notebook', id }) },
        h('span', { class: 'nb-code', '--c': nb.color }, nb.code || codeFrom(nb.title)),
        h('span', { class: 'study-name' }, nb.title),
        h('span', { class: 'study-bar' }, h('span', { style: { width: Math.max(4, (sec / max) * 100) + '%' }, '--c': nb.color })),
        h('span', { class: 'study-time' }, fmtDur(sec)),
        d != null && d >= 0 && d <= 60 ? h('span', { class: 'study-exam' + (d <= 7 ? ' soon' : '') }, d === 0 ? T('esame oggi') : T('esame tra {d} g', { d })) : h('span', { class: 'study-exam' }));
    })));
}

// --- N4: timer di concentrazione (25 o 50 minuti) ----------------------------------------------------
let focusT = ls.get('focusT', null); // { end, min }
const focusLeft = () => (focusT && focusT.end > Date.now() ? `${Math.ceil((focusT.end - Date.now()) / 60000)} min` : '');
function focusPop(anchor) {
  if (document.querySelector('.pop')) { closePop(); return; }
  const start = (min) => { focusT = { end: Date.now() + min * 60000, min }; ls.set('focusT', focusT); closePop(); tickFocus(); toast(T('{n} minuti di concentrazione: buono studio', { n: min })); };
  openPop(h('div', { class: 'pop', role: 'menu' },
    h('div', { class: 'pop-title' }, T('Concentrazione')),
    h('button', { role: 'menuitem', onclick: () => start(25) }, svg(I.clock), T('25 minuti, poi 5 di pausa')),
    h('button', { role: 'menuitem', onclick: () => start(50) }, svg(I.clock), T('50 minuti, poi 10 di pausa')),
    focusT ? h('button', { role: 'menuitem', onclick: () => { focusT = null; ls.set('focusT', null); closePop(); tickFocus(); } }, svg(I.restore), T('Ferma il timer')) : null,
    h('p', { class: 'pop-hint' }, T('Il tempo passato sugli appunti si conta da solo, per corso, nella Home.'))), anchor, true);
}
function tickFocus() {
  const b = $('#focus-btn'), l = $('#focus-left');
  if (focusT && focusT.end <= Date.now()) {
    const m = focusT.min; focusT = null; ls.set('focusT', null);
    toast(T('Fine dei {n} minuti di concentrazione: pausa di {p} minuti', { n: m, p: m >= 50 ? 10 : 5 }), { label: T('Ancora'), fn: () => { focusT = { end: Date.now() + m * 60000, min: m }; ls.set('focusT', focusT); tickFocus(); } });
  }
  if (b) b.classList.toggle('on', !!focusT);
  if (l) l.textContent = focusLeft();
}
setInterval(() => { if (penQuiet()) tickFocus(); }, 15000);

// --- S5: nuovo progetto di codice -----------------------------------------------------------------
function codePop(anchor) {
  if (document.querySelector('.pop')) { closePop(); return; }
  openPop(h('div', { class: 'pop', role: 'menu' },
    h('div', { class: 'pop-title' }, T('Codice eseguibile')),
    Object.entries(LANGS).map(([k, L]) => h('button', { role: 'menuitem', onclick: () => { closePop(); addBlock('code', newProject(k, uuid)); } }, svg(I.code), L.label)),
    h('p', { class: 'pop-hint' }, T('Python e JavaScript girano su questo dispositivo, anche senza rete. C e C++ si compilano sul server. Nel progetto: più file, input da tastiera, importazione da zip o da GitHub, esportazione in zip. Anche i blocchi di codice python, c, cpp e js scritti nel testo hanno il pulsante Esegui.'))), anchor);
}

// PDF con stile (2026.11.7): un appunto o un quaderno intero, nell'ordine in cui sono stati scritti
async function exportPdf(ids, nb = null) {
  flushSave();
  const notes = [];
  for (const id of ids) { const n = id === ui.note?.id ? ui.note : await store.getNote(id); if (n && !n.deleted_at) notes.push(n); }
  if (!notes.length) { toast(T('Niente da esportare: gli appunti sono vuoti')); return; }
  const notebook = nb || nbById(notes[0].notebook_id);
  const track = TRACKS.find((t) => t.k === profile().track);
  await openPrint({ notes, notebook, user: me, track: track?.k === 'ing-inf' ? T('Ingegneria Informatica') : '', prefs, savePrefs: () => ls.set('prefs', prefs), imageUrl: (att) => store.imageUrl(att), toast });
}

// Blocco «Grafico» (2026.11.7): si sceglie il tipo, poi dati e titolo nel blocco
function chartPop(anchor) {
  if (document.querySelector('.pop')) { closePop(); return; }
  openPop(h('div', { class: 'pop pop-chart', role: 'menu' },
    [T('Grafici'), T('Sistemi Operativi'), T('Diagrammi')].flatMap((g) => [h('div', { class: 'pop-title' }, g),
      ...CHART_KINDS.filter((k) => k.group === g).map((k) => h('button', { role: 'menuitem', onclick: () => { closePop(); addBlock('chart', newChart(k.k, uuid)); } }, svg(I.chart), k.label))]),
    h('p', { class: 'pop-hint' }, T('I dati si scrivono in una tabellina o in poche righe di testo; il disegno si aggiorna mentre scrivi.'))), anchor);
}

// la Home segue l'orologio (lezione di adesso, minuti del timer)
setInterval(() => { if (app.dataset.home === 'on' && penQuiet()) renderHome(); }, 60000);


// --- Novità: il changelog, con un pallino al primo ingresso dopo un aggiornamento ------------------
// Chi apre Quadretto per la prima volta su questo dispositivo non ha «novità»: le ha appena viste tutte.
// Due segni distinti: il popup compare una volta sola, il pallino resta finché non apri «Novità».
if (ls.get('seenVersion', null) == null && !['prefs', 'layout', 'ink-prefs', 'onboarded', 'side'].some((k) => localStorage.getItem(k) != null)) { ls.set('seenVersion', VERSION); ls.set('popupVersion', VERSION); }
const verNum = (v) => String(v || '0').split('.').map(Number).reduce((a, n) => a * 1000 + (n || 0), 0);
function hasNews() { const seen = ls.get('seenVersion', null); return verNum(seen) < verNum(VERSION) && CHANGELOG.some((c) => verNum(c.v) > verNum(seen)); }
function renderNewsBadge() { const on = hasNews(); document.querySelectorAll('.news-dot').forEach((d) => { d.hidden = !on; }); }
// Popup al primo accesso dopo un aggiornamento: solo le frasi brevi, niente dettagli
const popupDue = () => verNum(ls.get('popupVersion', ls.get('seenVersion', null))) < verNum(VERSION) && hasNews();
function newsPopup() {
  const seen = ls.get('seenVersion', null);
  const fresh = CHANGELOG.filter((c) => verNum(c.v) > verNum(seen));
  const lines = fresh.flatMap((c) => c.items.filter((i) => i[2]).map((i) => T(i[2]))).slice(0, 8); // il testo del popup si traduce qui
  ls.set('popupVersion', VERSION);
  if (!lines.length) return;
  openSheet([
    h('div', { class: 'news-pop' },
      h('span', { class: 'news-pop-ver' }, T('Versione {versione}', { versione: VERSION })),
      h('h2', {}, T('Quadretto si è aggiornato')),
      h('ul', {}, lines.map((t) => h('li', {}, t))),
      h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn', onclick: () => newsSheet(seen) }, T('Vedi tutte le novità')),
        h('button', { class: 'btn primary', onclick: closeSheet }, T('Inizia')))),
  ]);
}
function newsSheet(prevSeen) {
  const seen = typeof prevSeen === 'string' ? prevSeen : ls.get('seenVersion', null);
  ls.set('seenVersion', VERSION);
  renderNewsBadge();
  const fmt = (d) => new Date(d + 'T12:00:00').toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' });
  openSheet([
    h('h2', {}, T('Novità')),
    h('p', { class: 'lead' }, T('Stai usando Quadretto {versione}.', { versione: VERSION })),
    CHANGELOG.map((c) => h('section', { class: 'news-ver' + (verNum(c.v) > verNum(seen) && seen != null ? ' fresh' : '') },
      h('div', { class: 'news-head' }, h('strong', {}, c.v), h('span', {}, fmt(c.date)), verNum(c.v) > verNum(seen) && seen != null ? h('span', { class: 'news-new' }, T('Nuovo')) : null),
      h('ul', {}, c.items.map(([titolo, dettaglio]) => h('li', {}, h('b', {}, T(titolo)), ' — ', T(dettaglio)))))),
    h('div', { class: 'sheet-actions' }, h('button', { class: 'btn primary', onclick: closeSheet }, T('Fatto'))),
  ], true);
}


// --- gesti che seguono il dito: cassetto dei quaderni, indietro dall'editor, avvisi ----------------------
(() => {
  const side = $('#side'), scrim = $('#scrim'), ed = $('#editor'), list = $('#list');
  const W = () => side.offsetWidth || 320;
  let anim = null;
  // cassetto: posizione in px (0 = aperto, -W = chiuso)
  const sideAt = (x) => { side.style.transition = 'none'; side.style.transform = `translateX(${Math.min(0, x)}px)`; scrim.style.transition = 'none'; scrim.style.opacity = String(Math.max(0, 1 + x / W())); scrim.style.pointerEvents = 'auto'; };
  const sideClear = () => { side.style.transition = side.style.transform = ''; scrim.style.transition = scrim.style.opacity = scrim.style.pointerEvents = ''; };
  const settleSide = (from, open, v) => {
    anim = spring({ from, to: open ? 0 : -W(), velocity: v, onUpdate: sideAt, onDone: () => { app.classList.toggle('side-open', open); requestAnimationFrame(sideClear); } });
  };
  // dal bordo sinistro (elenco o Home, in verticale) il cassetto si apre seguendo il dito
  drag(app, {
    start: (x0, y0, dx, dy, t) => narrow() && !app.classList.contains('side-open') && app.dataset.view !== 'editor' && x0 < 28 && dx > 0 && dx > Math.abs(dy) && !t.closest('.sheet-wrap'),
    move: (dx) => { anim?.stop(); sideAt(-W() + (dx < W() ? dx : W() + rubber(dx - W(), 200))); },
    end: (dx, dy, vx, vy, cancel) => settleSide(-W() + Math.min(dx, W()), !cancel && (vx > 0.35 || dx > W() * 0.4) && vx > -0.3, vx),
  });
  // a cassetto aperto, trascinandolo a sinistra si chiude
  for (const el of [side, scrim]) drag(el, {
    start: (x0, y0, dx, dy) => narrow() && app.classList.contains('side-open') && dx < 0 && -dx > Math.abs(dy),
    move: (dx) => { anim?.stop(); sideAt(dx); },
    end: (dx, dy, vx, vy, cancel) => settleSide(Math.max(dx, -W()), cancel || !(vx < -0.35 || -dx > W() * 0.3), vx),
  });
  // editor in verticale: dal bordo sinistro si torna all'elenco, che si vede sotto mentre trascini
  const edAt = (x) => {
    const Wd = ed.offsetWidth || innerWidth;
    ed.style.transition = 'none'; ed.style.transform = `translateX(${Math.max(0, x)}px)`;
    list.style.transform = `translateX(${(-0.28 * Wd) * (1 - Math.max(0, x) / Wd)}px)`;
    list.style.setProperty('--peek-dim', String(0.35 * (1 - Math.max(0, x) / Wd)));
  };
  const edClear = () => { app.classList.remove('peek'); ed.style.transition = ed.style.transform = ''; list.style.transform = ''; list.style.removeProperty('--peek-dim'); };
  drag(ed, {
    start: (x0, y0, dx, dy, t) => narrow() && app.dataset.view === 'editor' && x0 < 28 && dx > 0 && dx > Math.abs(dy) && !t.closest('.ink, textarea, .code-proj'),
    move: (dx) => { anim?.stop(); app.classList.add('peek'); edAt(dx); },
    end: (dx, dy, vx, vy, cancel) => {
      const Wd = ed.offsetWidth || innerWidth;
      const back = !cancel && (vx > 0.4 || dx > Wd * 0.33) && vx > -0.3;
      anim = spring({ from: dx, to: back ? Wd : 0, velocity: vx, onUpdate: edAt, onDone: () => { if (back) closeNote(); requestAnimationFrame(edClear); } });
    },
  });
  // avvisi: si scacciano di lato o verso il basso
  const t = $('#toast');
  const tAt = (x, y) => { t.style.setProperty('--tx', x + 'px'); t.style.setProperty('--ty', Math.max(0, y) + 'px'); t.style.opacity = String(Math.max(0, 1 - Math.max(Math.abs(x) / 220, Math.max(0, y) / 90))); };
  drag(t, {
    start: () => !t.hidden,
    move: (dx, dy) => tAt(dx, dy > 0 ? dy : -rubber(-dy, 120)),
    end: (dx, dy, vx, vy, cancel) => {
      if (!cancel && (Math.abs(dx) > 90 || Math.abs(vx) > 0.45 || dy > 45 || vy > 0.4)) {
        const horiz = Math.abs(dx) > dy;
        spring({ from: horiz ? dx : dy, to: horiz ? Math.sign(dx || vx || 1) * 420 : 160, velocity: horiz ? vx : vy, stiffness: 240, onUpdate: (v) => horiz ? tAt(v, 0) : tAt(0, v), onDone: () => { t.hidden = true; clearTimeout(toastTimer); } });
      } else spring({ from: dx, to: 0, velocity: vx, onUpdate: (v) => tAt(v, 0) });
    },
  });
})();

// --- le impostazioni della penna seguono l'account -------------------------------------------------------------
// Sono in localStorage, che Safari tiene separato per indirizzo: col passaggio all'HTTPS erano tornate ai valori di
// partenza (spessore, colore, «Solo Apple Pencil»). Ora si salvano anche nell'account e da lì si recuperano.
const INK_KEYS = ['tool', 'shape', 'color', 'width', 'penOnly', 'snapGrid'];
// Lingua dell'account (2026-11-24): vince su quella di questo dispositivo. Se l'account non ne ha ancora una, prende quella
// in uso qui (la scelta fatta all'accesso), ma solo con i dati del server già arrivati, per non scrivere sopra le impostazioni.
function applyAccountLang() {
  const l = store.settings?.lang;
  if (!l) { if (store.status === 'synced') store.saveSettings({ ...store.settings, lang: getLang() }); return; }
  if (setLang(l)) location.reload();
}
// I testi fissi di index.html (2026-11-24): i [data-t] e le etichette (aria-label, title, placeholder) passano da T() all'avvio,
// prima che l'app disegni il resto (che usa già T()).
function translateStatic() {
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = T(el.textContent.trim());
  for (const a of ['aria-label', 'title', 'placeholder']) for (const el of document.querySelectorAll(`[${a}]`)) el.setAttribute(a, T(el.getAttribute(a)));
}
function restorePrefsFromAccount() {
  const s = store.settings || {};
  let changed = false;
  if (!localStorage.getItem('ink-prefs') && s.ink) { for (const k of INK_KEYS) if (k in s.ink) inkPrefs[k] = s.ink[k]; try { localStorage.setItem('ink-prefs', JSON.stringify(inkPrefs)); } catch {} changed = true; }
  if (!localStorage.getItem('prefs') && s.prefs) { Object.assign(prefs, s.prefs); ls.set('prefs', prefs); applyTheme(); changed = true; }
  if (changed) { updateDock(); toast(T('Impostazioni della penna recuperate dal tuo account')); }
  else syncPrefsToAccount();
}
let prefsT;
function syncPrefsToAccount() {
  clearTimeout(prefsT);
  prefsT = setTimeout(() => {
    if (!penQuiet()) { syncPrefsToAccount(); return; }
    const ink = Object.fromEntries(INK_KEYS.map((k) => [k, inkPrefs[k]]));
    const p = { theme: prefs.theme, paper: prefs.paper, wide: prefs.wide };
    const s = store.settings || {};
    if (JSON.stringify(s.ink) === JSON.stringify(ink) && JSON.stringify(s.prefs) === JSON.stringify(p)) return;
    store.saveSettings({ ...s, ink, prefs: p }).catch(() => {});
  }, 4000);
}
prefsHooks.push(syncPrefsToAccount);

// --- avvio ---------------------------------------------------------------------------
app.dataset.side = ls.get('side', 'shown');
initMotion({ isBusy: () => !penQuiet() });
store.busy = () => !penQuiet();
app.dataset.focus = 'off';
app.dataset.layout = layout;
$('#lay-list').classList.toggle('on', layout === 'list');
$('#lay-gallery').classList.toggle('on', layout === 'gallery');
translateStatic();
applyTheme();
renderSync();
const me = await ensureUser();
if (!me) throw new Error('accesso richiesto'); // la schermata di accesso è già visibile
setLocalUser(me);
// 2026-11-24: live, presenza e condivisione (collab.js usa le funzioni di qui; live.js apre il WebSocket)
initCollab({ ui, boards, store, api, h, $, svg, I, prefs, toast, openSheet, closeSheet, confirmBtn, renderBlocks, renderBlock, renderEditor, renderList, renderHome, closeNote, openNote, go, penQuiet,
  nbCode: (nb) => h('span', { class: 'nb-code', '--c': nb.color }, nb.code || codeFrom(nb.title)) });
await live.init(me, { store, quiet: penQuiet, penDown: () => pen.down });
addEventListener('quadretto-auth', () => { if (!document.querySelector('.auth')) showLogin({ expired: true }); });
renderSide(); renderList(); renderEditor(); renderHome(); renderNewsBadge();
await store.init();
restorePrefsFromAccount();
applyAccountLang();
if (!store.notebooks.length && !ls.get('onboarded', false) && store.status === 'synced') coursePicker(true);
else if (popupDue()) setTimeout(() => { if ($('#sheet').hidden) newsPopup(); }, 700);

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});

// --- trasloco su HTTPS (2026.11.3) ----------------------------------------------------
// Sull'indirizzo HTTP vecchio si invita ad aprire quello sicuro, ma solo quando la coda è vuota: sessione e
// archivio dell'iPad sono legati all'indirizzo, e le modifiche ancora in coda qui, là non ci sarebbero.
let httpsUrl = null;
function renderMove() {
  let bar = $('#move-bar');
  if (!httpsUrl || location.protocol === 'https:') { bar?.remove(); return; }
  if (!bar) { bar = h('div', { id: 'move-bar', class: 'move-bar', role: 'status' }); document.body.append(bar); }
  const waiting = store.pending > 0 || store.status !== 'synced';
  bar.replaceChildren(...[
    h('span', {}, waiting
      ? (store.pending
        ? tn(store.pending, 'Quadretto ha un indirizzo nuovo e sicuro. Prima invio al server {n} modifica: resta qui finché non finisco.', 'Quadretto ha un indirizzo nuovo e sicuro. Prima invio al server {n} modifiche: resta qui finché non finisco.')
        : T('Quadretto ha un indirizzo nuovo e sicuro. Controllo che sia tutto salvato sul server…'))
      : T('Quadretto ha un indirizzo nuovo e sicuro, che si apre anche senza rete. Qui è tutto salvato sul server: puoi passare.')),
    waiting ? null : h('a', { class: 'btn primary', href: httpsUrl + '/' }, T('Apri il nuovo indirizzo')),
  ].filter(Boolean)); // replaceChildren scriverebbe «null» come testo
}
fetch('/api/health', { cache: 'no-store' }).then((r) => r.json()).then((o) => { httpsUrl = o.httpsUrl || null; renderMove(); }).catch(() => {});
store.addEventListener('change', renderMove);
