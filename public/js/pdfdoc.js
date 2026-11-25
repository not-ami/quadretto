// Quadretto — PDF da annotare (2026.11.6)
// Ogni pagina del PDF diventa una tavola a mano con la pagina come sfondo: blocco «ink» con
// bg = { att, page, pw, ph } (att = allegato PDF, page da 1, pw/ph = misure della pagina in punti PDF).
// pdf.js si carica solo quando serve; le pagine si disegnano, se il browser lo permette, in un worker a parte
// (OffscreenCanvas), così la penna non rallenta mai.
import { t } from './i18n.js';

const BASE = '/vendor/pdfjs/';
let libP = null;
const docs = new Map();      // att -> Promise<PDFDocumentProxy>
const MAX_MB = 100;          // lo stesso limite del server
const PAGE_TEXT = 3000;      // caratteri di testo per pagina che entrano nella ricerca
const TOTAL_TEXT = 150000;   // e in tutto, per appunto

export function lib() {
  libP ||= import(BASE + 'build/pdf.min.mjs').then((m) => {
    m.GlobalWorkerOptions.workerSrc = BASE + 'build/pdf.worker.min.mjs';
    m.GlobalWorkerOptions.rendererSrc = BASE + 'build/pdf.renderer.min.mjs';
    return m;
  }).catch((e) => { libP = null; throw Object.assign(new Error(t('Il lettore di PDF non si è caricato: controlla la connessione e riprova')), { cause: e }); });
  return libP;
}

const OPTS = {
  cMapUrl: BASE + 'cmaps/', cMapPacked: true,
  standardFontDataUrl: BASE + 'standard_fonts/', wasmUrl: BASE + 'wasm/', iccUrl: BASE + 'iccs/',
  isEvalSupported: false, enableXfa: false,
};

async function open(data) {
  const pdfjs = await lib();
  try {
    return await pdfjs.getDocument({ ...OPTS, data }).promise;
  } catch (e) {
    if (e?.name === 'PasswordException') throw new Error(t('Il PDF è protetto da password: aprilo in un\'altra app, togli la password e riprova'));
    throw new Error(t('Il PDF non si apre: forse è danneggiato. Prova a salvarlo di nuovo come PDF da un\'altra app'));
  }
}

// Documento di un allegato già importato (dalla copia locale, dalla cache o dal server)
export function docOf(att, url) {
  if (docs.has(att)) { const p = docs.get(att); docs.delete(att); docs.set(att, p); return p; } // il più recente in fondo
  // al massimo 4 PDF aperti insieme: ognuno tiene un worker e la sua memoria
  while (docs.size >= 4) forget(docs.keys().next().value);
  const p = fetch(url).then((r) => { if (!r.ok) throw new Error(r.status === 404 ? t('Il PDF non è sul server') : t('PDF non raggiungibile: serve la connessione')); return r.arrayBuffer(); })
    .then((buf) => open(new Uint8Array(buf)));
  p.catch(() => { if (docs.get(att) === p) docs.delete(att); }); // al prossimo tentativo si riprova
  docs.set(att, p);
  return p;
}
export function forget(att) { docs.get(att)?.then((d) => d.loadingTask.destroy()).catch(() => {}); docs.delete(att); }

const clean = (s) => s.replace(/\s+/g, ' ').trim();

// Legge un file PDF scelto dall'utente: misure e testo di ogni pagina, e i capitoli dell'indice (se ci sono).
// onProgress(fatte, totale) mentre legge le pagine.
export async function readPdf(file, onProgress = () => {}) {
  if (file.size > MAX_MB * 1024 * 1024) throw new Error(t('«{nome}» supera {mb} MB: dividilo in parti più piccole e importale una alla volta', { nome: file.name, mb: MAX_MB }));
  const buf = new Uint8Array(await file.arrayBuffer());
  const doc = await open(buf.slice()); // pdf.js si prende il buffer: ne teniamo una copia per l'allegato
  try {
    const pages = [];
    let total = 0;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      let text = '';
      if (total < TOTAL_TEXT) {
        try {
          const tc = await page.getTextContent();
          text = clean(tc.items.map((it) => (it.str || '') + (it.hasEOL ? '\n' : ' ')).join('')).slice(0, Math.min(PAGE_TEXT, TOTAL_TEXT - total));
          total += text.length;
        } catch { /* pagina senza testo leggibile (scansione): resta solo l'immagine */ }
      }
      pages.push({ pw: Math.round(vp.width * 100) / 100, ph: Math.round(vp.height * 100) / 100, text });
      page.cleanup();
      onProgress(i, doc.numPages);
    }
    const chapters = await outline(doc);
    const meta = await doc.getMetadata().catch(() => null);
    const title = clean(String(meta?.info?.Title || '')) || file.name.replace(/\.pdf$/i, '');
    return { blob: new Blob([buf], { type: 'application/pdf' }), pages, chapters, title };
  } finally {
    doc.loadingTask.destroy(); // pdf.js 6: il documento si chiude dal suo loadingTask
  }
}

// Capitoli di primo livello dell'indice del PDF: [{ title, page }] in ordine di pagina, senza doppioni
async function outline(doc) {
  let items;
  try { items = await doc.getOutline(); } catch { return []; }
  if (!items?.length) return [];
  const out = [];
  for (const it of items) {
    try {
      const dest = typeof it.dest === 'string' ? await doc.getDestination(it.dest) : it.dest;
      if (!Array.isArray(dest) || !dest[0]) continue;
      const page = typeof dest[0] === 'number' ? dest[0] + 1 : (await doc.getPageIndex(dest[0])) + 1;
      const title = clean(it.title || '');
      if (title && page >= 1 && page <= doc.numPages) out.push({ title, page });
    } catch { /* voce dell'indice che punta fuori dal documento */ }
  }
  out.sort((a, b) => a.page - b.page);
  return out.filter((c, i) => i === 0 || c.page > out[i - 1].page);
}

// Blocchi «ink» per le pagine [from, to] (da 1, estremi inclusi)
export function pageBlocks(att, pages, uuid, from = 1, to = pages.length) {
  const out = [];
  for (let i = from; i <= to; i++) {
    const p = pages[i - 1];
    out.push({ id: uuid(), type: 'ink', strokes: [], h: Math.round(1000 * p.ph / p.pw), bg: { att, page: i, pw: p.pw, ph: p.ph }, ...(p.text ? { ptext: p.text } : {}) });
  }
  return out;
}

// --- disegno delle pagine ---------------------------------------------------------------------------------
// Una coda sola: una pagina alla volta, e mai mentre la penna scrive (quiet() falso) per non toccare la latenza.
const queue = [];
let running = false;
let quiet = () => true;
export function setQuiet(fn) { quiet = fn; }

// Disegna la pagina bg (larghezza cssW in px CSS) su una tela nuova e la passa a done(canvas) quando è pronta.
// Restituisce una funzione che annulla la richiesta.
export function renderPage(bg, url, cssW, dpr, done) {
  const job = { bg, url, cssW, dpr, done, cancelled: false, task: null };
  queue.push(job);
  pump();
  return () => { job.cancelled = true; job.task?.cancel(); };
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      if (!quiet()) { await new Promise((r) => setTimeout(r, 300)); continue; }
      const job = queue.shift();
      if (job.cancelled) continue;
      try { await draw(job); } catch (e) { if (e?.name !== 'RenderingCancelledException') job.done(null, e); }
    }
  } finally { running = false; }
}

async function draw(job) {
  const doc = await docOf(job.bg.att, job.url);
  if (job.cancelled) return;
  const page = await doc.getPage(job.bg.page);
  if (job.cancelled) return;
  const vp1 = page.getViewport({ scale: 1 });
  // Safari su iPad rifiuta le tele troppo grandi: si scende di densità, come per l'inchiostro
  const px = job.cssW * job.dpr;
  const s = Math.min(px / vp1.width, Math.sqrt(16e6 / (vp1.width * vp1.height)));
  const vp = page.getViewport({ scale: s });
  const c = document.createElement('canvas');
  c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
  c.className = 'ink-page';
  job.task = page.render({ canvas: c, viewport: vp, background: 'white' });
  await job.task.promise;
  if (!job.cancelled) job.done(c);
}
