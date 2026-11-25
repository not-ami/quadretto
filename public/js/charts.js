// Quadretto — blocco «Grafico» (2026.11.7): grafici classici e diagrammi di Sistemi Operativi, disegnati in SVG da noi.
// Scelta dell'utente (2026-11-24): «blocco con modulo + testo». Dati nel blocco: { type: 'chart', kind, title, src }.
// `src` è testo semplice (cercabile, salvato come gli altri blocchi): il modulo lo scrive, chi vuole lo scrive a mano.
// Nessuna libreria: funziona offline e nella vista di stampa resta vettoriale.
// Qui t è anche una variabile locale: la traduzione si chiama T() (vedi i18n.js).
// Le parole chiave dei diagrammi (algoritmo:, pagina:, riferimenti:, …) restano italiane: il parser le vuole così.
import { t as T, tn } from './i18n.js';
import { schedule, parseProcs, ALGOS } from './sched.js';

const NS = 'http://www.w3.org/2000/svg';
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) el.setAttribute(k, v);
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
const COL = (i) => `hsl(${[215, 150, 20, 280, 45, 330, 190, 95, 0, 255][i % 10]} 62% 52%)`;
const fmt = (x) => (Number.isInteger(x) ? String(x) : (Math.round(x * 100) / 100).toString().replace('.', ','));
const num = (t) => { const v = Number(String(t).trim().replace(/\s/g, '').replace(',', '.')); return Number.isFinite(v) ? v : NaN; };
const lines = (src) => String(src || '').split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
const kv = (src) => { const o = {}; for (const l of lines(src)) { const m = /^([\wàèéìòù ]+?)\s*:\s*(.*)$/i.exec(l); if (m) o[m[1].toLowerCase()] = m[2]; } return o; };

// --- i tipi ----------------------------------------------------------------------------------------------------
export const CHART_KINDS = [
  { k: 'barre', group: T('Grafici'), label: T('Barre'), form: 'table', help: T('Prima riga: nome delle colonne. Poi una riga per voce: etichetta; valore; valore…'), example: T('Mese; Ore di studio; Ore di lezione\nOttobre; 20; 32\nNovembre; 34; 30\nDicembre; 41; 18\nGennaio; 60; 0') },
  { k: 'linee', group: T('Grafici'), label: T('Linee'), form: 'table', help: T('Come le barre: la prima colonna va sull\'asse orizzontale.'), example: T('Settimana; Esercizi fatti; Esercizi giusti\n1; 10; 6\n2; 14; 10\n3; 12; 11\n4; 20; 17\n5; 18; 17') },
  { k: 'torta', group: T('Grafici'), label: T('Torta'), form: 'table', help: T('Una riga per fetta: etichetta; valore.'), example: T('Voce; Ore\nTeoria; 12\nEsercizi; 20\nLaboratorio; 8\nRipasso; 6') },
  { k: 'dispersione', group: T('Grafici'), label: T('Punti (dispersione)'), form: 'table', help: T('Prima colonna x, le altre y (una serie per colonna).'), example: T('Thread; Tempo (s); Ideale\n1; 8; 8\n2; 4.4; 4\n4; 2.6; 2\n8; 1.9; 1') },
  { k: 'funzione', group: T('Grafici'), label: T('Funzione y = f(x)'), form: 'text', help: T('Una funzione per riga (y = …), poi l\'intervallo «x: da .. a». Si possono usare + − * / ^, sin cos tan exp ln log sqrt abs, pi, e.'), example: 'y = x^2 - 2\ny = sin(x)\nx: -3 .. 3' },
  { k: 'gantt', group: T('Sistemi Operativi'), label: T('Gantt dello scheduling'), form: 'text', help: T('«algoritmo: fcfs | sjf | srtf | rr 2 | prio | priop | mlfq | hrrn» e una riga per processo (nome arrivo durata [priorità]); oppure gli intervalli a mano: «P1: 0-3, 7-9».'), example: 'algoritmo: rr 2\nP1 0 5\nP2 1 3\nP3 2 4' },
  { k: 'stati', group: T('Sistemi Operativi'), label: T('Stati del processo'), form: 'text', help: T('Una transizione per riga: «Da -> A: etichetta».'), example: T('Nuovo -> Pronto: ammesso\nPronto -> Esecuzione: dispatch\nEsecuzione -> Pronto: interrupt, fine quanto\nEsecuzione -> Attesa: I/O o evento\nAttesa -> Pronto: I/O completato\nEsecuzione -> Terminato: exit') },
  { k: 'risorse', group: T('Sistemi Operativi'), label: T('Grafo di allocazione delle risorse'), form: 'text', help: T('«R1 = 2» dà le istanze di una risorsa (i nomi che iniziano con R sono risorse). «P1 -> R1» richiesta, «R1 -> P2» assegnazione. Un ciclo si colora di rosso.'), example: 'R1 = 1\nR2 = 1\nP1 -> R1\nR1 -> P2\nP2 -> R2\nR2 -> P1\nR2 -> P3' },
  { k: 'paginazione', group: T('Sistemi Operativi'), label: T('Paginazione: da logico a fisico'), form: 'text', help: T('«pagina: dimensione», «tabella: pagina->frame, …» («-» = non in memoria), «indirizzi: …».'), example: 'pagina: 1024\ntabella: 0->5, 1->2, 2->-, 3->7\nindirizzi: 1500, 3100, 2300, 4200' },
  { k: 'sostituzione', group: T('Sistemi Operativi'), label: T('Sostituzione delle pagine'), form: 'text', help: T('«frame: n», «riferimenti: …», «algoritmo: fifo | lru | opt | tutti».'), example: 'frame: 3\nriferimenti: 7 0 1 2 0 3 0 4 2 3 0 3 2\nalgoritmo: tutti' },
  { k: 'banchiere', group: T('Sistemi Operativi'), label: T('Algoritmo del banchiere'), form: 'text', help: T('«risorse: totali per tipo», poi «P0: allocate / massimo». Facoltativo: «richiesta: P1 1 0 2».'), example: 'risorse: 10 5 7\nP0: 0 1 0 / 7 5 3\nP1: 2 0 0 / 3 2 2\nP2: 3 0 2 / 9 0 2\nP3: 2 1 1 / 2 2 2\nP4: 0 0 2 / 4 3 3\nrichiesta: P1 1 0 2' },
  { k: 'memoria', group: T('Sistemi Operativi'), label: T('Allocazione della memoria'), form: 'text', help: T('«blocchi: dimensioni dei buchi liberi», «richieste: …», «algoritmo: first | best | worst | tutti».'), example: 'blocchi: 100 500 200 300 600\nrichieste: 212 417 112 426\nalgoritmo: tutti' },
  { k: 'albero', group: T('Sistemi Operativi'), label: T('Albero dei processi (fork)'), form: 'text', help: T('Una riga per figlio: «Padre -> Figlio».'), example: '# for (i = 0; i < 2; i++) fork();\nP -> F1\nP -> F2\nF1 -> F3' },
  { k: 'grafo', group: T('Diagrammi'), label: T('Nodi e frecce'), form: 'text', help: T('«A -> B: etichetta» (freccia), «A -- B» (linea), «A <-> B». «direzione: verticale» dispone dall\'alto in basso.'), example: T('Inizio -> Leggi n\nLeggi n -> n > 0?\nn > 0? -> Stampa: sì\nn > 0? -> Fine: no\nStampa -> Leggi n') },
];
export const kindOf = (k) => CHART_KINDS.find((x) => x.k === k) || CHART_KINDS[0];
export function newChart(kind, uuid) { const K = kindOf(kind); return { id: uuid(), type: 'chart', kind: K.k, title: '', src: K.example }; }

// --- disegno -----------------------------------------------------------------------------------------------------
export function renderChart(b) {
  const K = kindOf(b.kind);
  try {
    const fig = h('figure', { class: 'chart chart-' + K.k });
    const body = DRAW[K.k](b.src || '');
    fig.append(...[].concat(body));
    if (b.title) fig.prepend(h('figcaption', {}, b.title));
    return fig;
  } catch (e) {
    return h('p', { class: 'tool-err' }, e.message);
  }
}

function niceTicks(min, max, n = 5) {
  if (min === max) { max = min + 1; min -= min === 0 ? 0 : 1; }
  const raw = (max - min) / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) || raw;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v / step) * step);
  return out;
}
function table(src) {
  const rows = lines(src).map((l) => l.split(/\s*[;\t|]\s*/));
  if (rows.length < 2) throw new Error(T('Servono la riga dei nomi e almeno una riga di valori'));
  const head = rows[0];
  const data = rows.slice(1).map((r) => ({ label: r[0], vals: head.slice(1).map((_, j) => num(r[j + 1] ?? '')) }));
  if (!head.slice(1).length) throw new Error(T('Serve almeno una colonna di valori (separa con «;»)'));
  return { series: head.slice(1), data };
}
function legend(names) {
  return names.length > 1 ? h('div', { class: 'chart-legend' }, names.map((n, i) => h('span', {}, h('i', { style: `background:${COL(i)}` }), n))) : null;
}
// assi e griglia: restituisce { svg, X(v|i), Y(v) }
function axes({ W = 640, H = 300, ymin, ymax, xlabels, xmin, xmax, pad = { l: 46, r: 14, t: 12, b: 34 } }) {
  const ty = niceTicks(ymin, ymax);
  const y0 = ty[0], y1 = ty[ty.length - 1];
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img' });
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  const Y = (v) => pad.t + ph - ((v - y0) / (y1 - y0)) * ph;
  let X;
  if (xlabels) { const bw = pw / xlabels.length; X = (i) => pad.l + bw * (i + 0.5); X.bw = bw; }
  else { const tx = niceTicks(xmin, xmax); const a = tx[0], z = tx[tx.length - 1]; X = (v) => pad.l + ((v - a) / (z - a)) * pw; X.ticks = tx; }
  for (const t of ty) svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: Y(t), y2: Y(t), class: 'grid' + (t === 0 ? ' zero' : '') }), s('text', { x: pad.l - 6, y: Y(t) + 4, 'text-anchor': 'end', class: 'tick' }, fmt(t)));
  if (xlabels) xlabels.forEach((l, i) => svg.append(s('text', { x: X(i), y: H - pad.b + 18, 'text-anchor': 'middle', class: 'tick' }, String(l).slice(0, 14))));
  else for (const t of X.ticks) svg.append(s('line', { x1: X(t), x2: X(t), y1: pad.t, y2: pad.t + ph, class: 'grid' + (t === 0 ? ' zero' : '') }), s('text', { x: X(t), y: H - pad.b + 18, 'text-anchor': 'middle', class: 'tick' }, fmt(t)));
  return { svg, X, Y, y0, pad, W, H };
}

const DRAW = {
  barre(src) {
    const { series, data } = table(src);
    const all = data.flatMap((d) => d.vals).filter(Number.isFinite);
    const A = axes({ ymin: Math.min(0, ...all), ymax: Math.max(0, ...all), xlabels: data.map((d) => d.label) });
    const gw = A.X.bw * 0.72, bw = gw / series.length;
    data.forEach((d, i) => d.vals.forEach((v, j) => {
      if (!Number.isFinite(v)) return;
      const x = A.X(i) - gw / 2 + j * bw, y = A.Y(Math.max(v, 0)), y2 = A.Y(Math.min(v, 0));
      A.svg.append(s('rect', { x: x + 1, y, width: Math.max(bw - 2, 1), height: Math.max(y2 - y, 0.5), rx: 3, fill: COL(j) }, s('title', {}, `${d.label} · ${series[j]}: ${fmt(v)}`)));
    }));
    return [A.svg, legend(series)];
  },
  linee(src) {
    const { series, data } = table(src);
    const all = data.flatMap((d) => d.vals).filter(Number.isFinite);
    const A = axes({ ymin: Math.min(0, ...all), ymax: Math.max(...all), xlabels: data.map((d) => d.label) });
    series.forEach((_, j) => {
      const pts = data.map((d, i) => [A.X(i), d.vals[j]]).filter((p) => Number.isFinite(p[1])).map(([x, v]) => [x, A.Y(v)]);
      A.svg.append(s('polyline', { points: pts.map((p) => p.join(',')).join(' '), fill: 'none', stroke: COL(j), 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
      pts.forEach(([x, y]) => A.svg.append(s('circle', { cx: x, cy: y, r: 3.5, fill: COL(j) })));
    });
    return [A.svg, legend(series)];
  },
  dispersione(src) {
    const { series, data } = table(src);
    const xs = data.map((d) => num(d.label));
    if (xs.some((x) => !Number.isFinite(x))) throw new Error(T('La prima colonna deve contenere numeri (la x)'));
    const all = data.flatMap((d) => d.vals).filter(Number.isFinite);
    const A = axes({ ymin: Math.min(0, ...all), ymax: Math.max(...all), xmin: Math.min(...xs), xmax: Math.max(...xs) });
    series.forEach((_, j) => data.forEach((d, i) => { const v = d.vals[j]; if (Number.isFinite(v)) A.svg.append(s('circle', { cx: A.X(xs[i]), cy: A.Y(v), r: 4.5, fill: COL(j), 'fill-opacity': 0.85 }, s('title', {}, `(${fmt(xs[i])}; ${fmt(v)})`))); }));
    return [A.svg, legend(series)];
  },
  torta(src) {
    const { data } = table(src);
    const vals = data.map((d) => Math.max(0, d.vals[0] || 0));
    const tot = vals.reduce((a, v) => a + v, 0);
    if (!tot) throw new Error(T('I valori della torta devono essere positivi'));
    const svg = s('svg', { viewBox: '0 0 420 260', class: 'chart-svg', role: 'img' });
    const cx = 130, cy = 130, r = 110;
    let a = -Math.PI / 2;
    vals.forEach((v, i) => {
      const da = (v / tot) * Math.PI * 2;
      const p = (t) => [cx + r * Math.cos(t), cy + r * Math.sin(t)];
      const [x1, y1] = p(a), [x2, y2] = p(a + da);
      const d = da >= Math.PI * 2 - 1e-9 ? `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0` : `M${cx},${cy}L${x1},${y1}A${r},${r} 0 ${da > Math.PI ? 1 : 0},1 ${x2},${y2}Z`;
      svg.append(s('path', { d, fill: COL(i), stroke: 'var(--surface)', 'stroke-width': 2 }, s('title', {}, `${data[i].label}: ${fmt(v)}`)));
      if (da > 0.25) { const [lx, ly] = [cx + r * 0.62 * Math.cos(a + da / 2), cy + r * 0.62 * Math.sin(a + da / 2)]; svg.append(s('text', { x: lx, y: ly + 4, 'text-anchor': 'middle', class: 'pie-pct' }, `${Math.round((100 * v) / tot)}%`)); }
      a += da;
    });
    data.forEach((d, i) => svg.append(s('rect', { x: 270, y: 30 + i * 24, width: 14, height: 14, rx: 3, fill: COL(i) }), s('text', { x: 292, y: 42 + i * 24, class: 'tick' }, `${d.label} (${fmt(vals[i])})`)));
    return svg;
  },
  funzione(src) {
    const o = kv(src);
    const fs = lines(src).filter((l) => /^y\s*=/.test(l)).map((l) => ({ txt: l.replace(/^y\s*=\s*/, ''), f: compileExpr(l.replace(/^y\s*=\s*/, '')) }));
    if (!fs.length) throw new Error(T('Scrivi almeno una funzione: y = …'));
    const m = /(-?[\d.,pie]+)\s*(?:\.\.|;|a)\s*(-?[\d.,pie]+)/.exec(o.x || '-5 .. 5');
    const a = compileExpr(m ? m[1].replace(',', '.') : '-5')(0), z = compileExpr(m ? m[2].replace(',', '.') : '5')(0);
    if (!(z > a)) throw new Error(T('L\'intervallo «x: da .. a» deve andare da un numero più piccolo a uno più grande'));
    const N = 240, pts = fs.map((F) => Array.from({ length: N + 1 }, (_, i) => { const x = a + ((z - a) * i) / N; const y = F.f(x); return [x, Number.isFinite(y) ? y : NaN]; }));
    let ys = pts.flat().map((p) => p[1]).filter(Number.isFinite).sort((p, q) => p - q);
    if (!ys.length) throw new Error(T('La funzione non è definita in questo intervallo'));
    // si tagliano gli asintoti: 2 % dei valori più estremi
    const lo = ys[Math.floor(ys.length * 0.02)], hi = ys[Math.ceil(ys.length * 0.98) - 1];
    const A = axes({ ymin: Math.min(lo, 0), ymax: Math.max(hi, 0), xmin: a, xmax: z });
    pts.forEach((P, j) => {
      let d = '', pen = false;
      for (const [x, y] of P) {
        if (!Number.isFinite(y) || y < lo - (hi - lo) || y > hi + (hi - lo)) { pen = false; continue; }
        d += `${pen ? 'L' : 'M'}${A.X(x).toFixed(1)},${A.Y(y).toFixed(1)}`; pen = true;
      }
      A.svg.append(s('path', { d, fill: 'none', stroke: COL(j), 'stroke-width': 2.5 }));
    });
    return [A.svg, legend(fs.map((F) => 'y = ' + F.txt))];
  },
  gantt(src) {
    const o = kv(src);
    let segs, end, extra = null;
    if (o.algoritmo) {
      const [alg, qq] = o.algoritmo.trim().split(/\s+/);
      if (!ALGOS.some((x) => x.k === alg)) throw new Error(T('Algoritmo «{nome}» sconosciuto: {elenco}', { nome: alg, elenco: ALGOS.map((x) => x.k).join(', ') }));
      const procs = parseProcs(lines(src).filter((l) => !/^\w+\s*:/.test(l)).join('\n'));
      const r = schedule(alg, procs, { q: +qq || 2, quanta: [1, 2, 4] });
      segs = r.segs; end = r.end;
      extra = h('p', { class: 'chart-note' }, `${ALGOS.find((x) => x.k === alg).label}${alg === 'rr' ? ` (q = ${+qq || 2})` : ''} · ` + T('attesa media {a} · turnaround medio {t}', { a: fmt(r.avg.waiting), t: fmt(r.avg.turnaround) }));
    } else {
      segs = [];
      for (const l of lines(src)) {
        const m = /^(\S+)\s*:\s*(.+)$/.exec(l);
        if (!m) throw new Error(T('Non capisco «{riga}»: scrivi «P1: 0-3, 7-9» oppure «algoritmo: …»', { riga: l }));
        for (const part of m[2].split(',')) { const mm = /(\d+)\s*-\s*(\d+)/.exec(part); if (mm) segs.push({ p: m[1], start: +mm[1], end: +mm[2] }); }
      }
      end = Math.max(1, ...segs.map((x) => x.end));
    }
    const names = [...new Set(segs.filter((x) => x.p).map((x) => x.p))];
    const W = 640, H = 70, l = 10, r = 10, pw = W - l - r, X = (t) => l + (t / end) * pw;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img' });
    for (const g of segs) {
      const x = X(g.start), w = X(g.end) - x;
      svg.append(s('rect', { x, y: 8, width: w, height: 34, fill: g.p ? COL(names.indexOf(g.p)) : 'transparent', stroke: 'var(--line)', class: g.p ? '' : 'idle' }, s('title', {}, `${g.p || T('CPU libera')}: ${g.start} → ${g.end}`)));
      if (g.p && w > 16) svg.append(s('text', { x: x + w / 2, y: 30, 'text-anchor': 'middle', class: 'bar-lab' }, g.p));
    }
    const marks = [...new Set([0, ...segs.map((x) => x.end), ...segs.map((x) => x.start)])].sort((p, q) => p - q);
    let lastX = -99;
    for (const m of marks) { const x = X(m); if (x - lastX < 14 && m !== end) continue; lastX = x; svg.append(s('text', { x, y: 58, 'text-anchor': 'middle', class: 'tick' }, String(m))); }
    return [svg, extra];
  },
  stati: (src) => graph(src, { dir: 'LR' }),
  albero: (src) => graph(src, { dir: 'TB' }),
  grafo: (src) => graph(src, { dir: /vertical/i.test(kv(src).direzione || '') ? 'TB' : 'LR' }),
  risorse: (src) => graph(src, { dir: 'LR', rag: true }),
  paginazione(src) {
    const o = kv(src);
    const size = num(o.pagina);
    if (!(size > 0)) throw new Error(T('Scrivi «pagina: dimensione» (es. 1024)'));
    const tab = new Map();
    for (const part of String(o.tabella || '').split(',')) { const m = /(\d+)\s*->\s*(\d+|-)/.exec(part); if (m) tab.set(+m[1], m[2] === '-' ? null : +m[2]); }
    const addrs = String(o.indirizzi || '').split(/[\s,;]+/).filter(Boolean).map(num);
    const pt = h('table', { class: 'tool-table' }, h('thead', {}, h('tr', {}, h('th', {}, T('Pagina')), h('th', {}, T('Frame')), h('th', {}, T('Valida')))),
      h('tbody', {}, [...tab].map(([p, f]) => h('tr', {}, h('td', {}, p), h('td', {}, f ?? '—'), h('td', {}, f == null ? '0' : '1')))));
    const bits = Math.log2(size);
    const tr = h('table', { class: 'tool-table' }, h('thead', {}, h('tr', {}, [T('Indirizzo logico'), T('Pagina') + ` = ⌊a / ${size}⌋`, `Offset = a mod ${size}`, T('Frame'), T('Indirizzo fisico')].map((x) => h('th', {}, x)))),
      h('tbody', {}, addrs.map((a) => { const p = Math.floor(a / size), d = a % size, f = tab.get(p); return h('tr', { class: f == null ? 'fault' : '' }, h('td', {}, a), h('td', {}, p), h('td', {}, d), h('td', {}, f ?? '—'), h('td', {}, f == null ? 'page fault' : `${f} × ${size} + ${d} = ${f * size + d}`)); })));
    return [h('div', { class: 'chart-cols' }, pt, tr), Number.isInteger(bits) ? h('p', { class: 'chart-note' }, T('Pagina di {size} byte = 2^{bits}: l\'offset sono gli ultimi {bits} bit dell\'indirizzo, il resto è il numero di pagina.', { size, bits })) : null];
  },
  sostituzione(src) {
    const o = kv(src);
    const F = Math.max(1, num(o.frame) | 0);
    const refs = String(o.riferimenti || '').split(/[\s,;]+/).filter(Boolean);
    if (!refs.length) throw new Error(T('Scrivi «riferimenti: 7 0 1 2 …»'));
    const alg = (o.algoritmo || 'tutti').trim().toLowerCase();
    const list = alg === 'tutti' ? ['fifo', 'lru', 'opt'] : [alg];
    return list.map((a) => {
      if (!['fifo', 'lru', 'opt'].includes(a)) throw new Error(T('Algoritmo «{nome}»: fifo, lru, opt o tutti', { nome: a }));
      const frames = [], cols = [];
      const load = new Map(), used = new Map();
      let faults = 0;
      refs.forEach((r, t) => {
        let fault = false, out = null;
        if (frames.includes(r)) used.set(r, t);
        else {
          fault = true; faults++;
          if (frames.length < F) frames.push(r);
          else {
            let victim;
            if (a === 'fifo') victim = frames.reduce((x, y) => (load.get(y) < load.get(x) ? y : x));
            else if (a === 'lru') victim = frames.reduce((x, y) => (used.get(y) < used.get(x) ? y : x));
            else { const next = (p) => { const i = refs.indexOf(p, t + 1); return i < 0 ? Infinity : i; }; victim = frames.reduce((x, y) => (next(y) > next(x) ? y : x)); }
            out = victim; frames[frames.indexOf(victim)] = r;
          }
          load.set(r, t); used.set(r, t);
        }
        cols.push({ r, frames: frames.slice(), fault, out });
      });
      return h('div', { class: 'chart-pr' }, h('h4', {}, T('{alg} · {f} page fault su {n} riferimenti', { alg: a.toUpperCase(), f: faults, n: refs.length })),
        h('div', { class: 'chart-scroll' }, h('table', { class: 'tool-table pr' },
          h('thead', {}, h('tr', {}, h('th', {}, T('rif.')), cols.map((c) => h('th', {}, c.r)))),
          h('tbody', {}, Array.from({ length: F }, (_, k) => h('tr', {}, h('th', {}, `frame ${k}`), cols.map((c) => h('td', { class: c.fault && c.frames[k] === c.r ? 'new' : '' }, c.frames[k] ?? '')))),
            h('tr', { class: 'faults' }, h('th', {}, 'fault'), cols.map((c) => h('td', { title: c.out ? T('esce {pagina}', { pagina: c.out }) : '' }, c.fault ? (c.out ? `✕ ${c.out}` : '✕') : '')))))));
    });
  },
  banchiere(src) {
    const o = kv(src);
    const ps = [];
    for (const l of lines(src)) { const m = /^(P\w*)\s*:\s*([\d\s]+)\/([\d\s]+)$/i.exec(l); if (m) ps.push({ n: m[1], alloc: m[2].trim().split(/\s+/).map(Number), max: m[3].trim().split(/\s+/).map(Number) }); }
    if (!ps.length) throw new Error(T('Scrivi un processo per riga: «P0: allocate / massimo»'));
    const R = ps[0].alloc.length;
    let avail;
    if (o.disponibili) avail = o.disponibili.trim().split(/\s+/).map(Number);
    else if (o.risorse) { const tot = o.risorse.trim().split(/\s+/).map(Number); avail = tot.map((t, j) => t - ps.reduce((a, p) => a + p.alloc[j], 0)); }
    else throw new Error(T('Scrivi «risorse: totali» oppure «disponibili: …»'));
    for (const p of ps) p.need = p.max.map((m, j) => m - p.alloc[j]);
    const le = (a, b) => a.every((x, j) => x <= b[j]);
    const notes = [];
    const safe = (av, P) => {
      const work = av.slice(), fin = P.map(() => false), seq = [];
      for (let found = true; found;) {
        found = false;
        for (let i = 0; i < P.length; i++) if (!fin[i] && le(P[i].need, work)) { notes.push(T('{p}: bisogno ({b}) ≤ disponibili ({d}) → finisce e restituisce ({a})', { p: P[i].n, b: P[i].need.join(' '), d: work.join(' '), a: P[i].alloc.join(' ') })); P[i].alloc.forEach((x, j) => { work[j] += x; }); fin[i] = true; seq.push(P[i].n); found = true; }
      }
      return { ok: fin.every(Boolean), seq, stuck: P.filter((_, i) => !fin[i]).map((p) => p.n) };
    };
    const kids = [];
    const tableOf = (P, av) => h('table', { class: 'tool-table' }, h('thead', {}, h('tr', {}, [T('Processo'), T('Allocate'), T('Massimo'), T('Bisogno')].map((x) => h('th', {}, x)))),
      h('tbody', {}, P.map((p) => h('tr', {}, h('td', {}, p.n), h('td', {}, p.alloc.join(' ')), h('td', {}, p.max.join(' ')), h('td', {}, p.need.join(' ')))),
        h('tr', { class: 'avg' }, h('td', {}, T('Disponibili')), h('td', { colspan: 3 }, av.join(' ')))));
    const r0 = safe(avail, ps);
    kids.push(tableOf(ps, avail), h('p', { class: r0.ok ? 'xray-ok' : 'xray-alert' }, r0.ok ? T('✅ Stato sicuro: sequenza {seq}', { seq: r0.seq.join(' → ') }) : T('⛔ Stato non sicuro: non possono finire {p}', { p: r0.stuck.join(', ') })));
    if (o.richiesta) {
      const m = /^(P\w*)\s+([\d\s]+)$/i.exec(o.richiesta.trim());
      if (m) {
        const req = m[2].trim().split(/\s+/).map(Number), p = ps.find((x) => x.n.toLowerCase() === m[1].toLowerCase());
        if (!p || req.length !== R) kids.push(h('p', { class: 'tool-err' }, T('La richiesta va scritta come «richiesta: P1 1 0 2» (un numero per tipo di risorsa)')));
        else if (!le(req, p.need)) kids.push(h('p', { class: 'xray-alert' }, T('⛔ {p} chiede più del suo bisogno dichiarato: errore', { p: p.n })));
        else if (!le(req, avail)) kids.push(h('p', { class: 'xray-alert' }, T('⏳ {p} deve aspettare: le risorse disponibili non bastano', { p: p.n })));
        else {
          const P2 = ps.map((x) => (x === p ? { ...x, alloc: x.alloc.map((v, j) => v + req[j]), need: x.need.map((v, j) => v - req[j]) } : x));
          const av2 = avail.map((v, j) => v - req[j]);
          notes.push(T('— richiesta di {p} ({r}): si prova a concederla —', { p: p.n, r: req.join(' ') }));
          const r1 = safe(av2, P2);
          kids.push(h('p', { class: r1.ok ? 'xray-ok' : 'xray-alert' }, r1.ok ? T('✅ La richiesta di {p} ({r}) si concede: resta sicuro ({seq})', { p: p.n, r: req.join(' '), seq: r1.seq.join(' → ') }) : T('⛔ La richiesta di {p} non si concede: lo stato diventerebbe non sicuro', { p: p.n })));
        }
      }
    }
    kids.push(h('details', { class: 'tool-steps' }, h('summary', {}, T('Passaggi')), h('ol', {}, notes.map((n) => h('li', {}, n)))));
    return kids;
  },
  memoria(src) {
    const o = kv(src);
    const blocks = String(o.blocchi || '').split(/[\s,;]+/).filter(Boolean).map(Number);
    const reqs = String(o.richieste || '').split(/[\s,;]+/).filter(Boolean).map(Number);
    if (!blocks.length || !reqs.length) throw new Error(T('Scrivi «blocchi: …» e «richieste: …»'));
    const alg = (o.algoritmo || 'tutti').trim().toLowerCase();
    const list = alg === 'tutti' ? ['first', 'best', 'worst'] : [alg];
    const label = { first: T('First fit'), best: T('Best fit'), worst: T('Worst fit') };
    return list.map((a) => {
      if (!label[a]) throw new Error(T('Algoritmo «{nome}»: first, best, worst o tutti', { nome: a }));
      const free = blocks.slice(), rows = [];
      for (const r of reqs) {
        const ok = free.map((f, i) => [f, i]).filter(([f]) => f >= r);
        const pick = !ok.length ? null : a === 'first' ? ok[0] : a === 'best' ? ok.reduce((x, y) => (y[0] < x[0] ? y : x)) : ok.reduce((x, y) => (y[0] > x[0] ? y : x));
        if (pick) { rows.push([r, T('blocco {n} ({dim})', { n: pick[1] + 1, dim: pick[0] }), pick[0] - r]); free[pick[1]] -= r; } else rows.push([r, T('non allocata: nessun buco abbastanza grande'), '—']);
      }
      const W = 640, tot = blocks.reduce((x, y) => x + y, 0);
      const svg = s('svg', { viewBox: `0 0 ${W} 40`, class: 'chart-svg', role: 'img' });
      let x = 0;
      blocks.forEach((bsz, i) => {
        const w = (bsz / tot) * W, used = bsz - free[i];
        svg.append(s('rect', { x, y: 4, width: w - 2, height: 30, rx: 4, fill: 'var(--surface-2)', stroke: 'var(--line)' }));
        if (used) svg.append(s('rect', { x, y: 4, width: ((used / bsz) * (w - 2)), height: 30, rx: 4, fill: COL(i), 'fill-opacity': 0.8 }));
        svg.append(s('text', { x: x + (w - 2) / 2, y: 24, 'text-anchor': 'middle', class: 'bar-lab' }, T('{n} liberi', { n: free[i] })));
        x += w;
      });
      return h('div', { class: 'chart-pr' }, h('h4', {}, label[a]), svg,
        h('table', { class: 'tool-table' }, h('thead', {}, h('tr', {}, [T('Richiesta'), T('Dove va'), T('Resta nel buco')].map((t) => h('th', {}, t)))), h('tbody', {}, rows.map((r) => h('tr', { class: r[2] === '—' ? 'fault' : '' }, r.map((c) => h('td', {}, c)))))));
    });
  },
};

// --- grafi: disposizione a livelli --------------------------------------------------------------------------------
function graph(src, { dir = 'LR', rag = false } = {}) {
  const nodes = new Map(), edges = [], inst = new Map();
  const node = (n) => { n = n.trim(); if (!nodes.has(n)) nodes.set(n, { n, i: nodes.size }); return nodes.get(n); };
  for (const l of lines(src)) {
    if (/^direzione\s*:/i.test(l)) continue;
    let m;
    if (rag && (m = /^(R\w*)\s*=\s*(\d+)$/i.exec(l))) { node(m[1]); inst.set(m[1], +m[2]); continue; }
    if ((m = /^(.+?)\s*(<->|->|--)\s*(.+?)(?:\s*:\s*(.+))?$/.exec(l))) { edges.push({ a: node(m[1]), b: node(m[3]), kind: m[2], label: m[4] || '' }); continue; }
    node(l);
  }
  if (!nodes.size) throw new Error(T('Scrivi almeno un collegamento: A -> B'));
  const N = [...nodes.values()];
  // livelli: il più lungo cammino senza gli archi all'indietro (trovati con una visita in profondità)
  const out = new Map(N.map((n) => [n, []]));
  edges.forEach((e) => out.get(e.a).push(e));
  const state = new Map(), back = new Set();
  const dfs = (n) => { state.set(n, 1); for (const e of out.get(n)) { const st = state.get(e.b); if (st === 1) back.add(e); else if (!st) dfs(e.b); } state.set(n, 2); };
  N.forEach((n) => { if (!state.get(n)) dfs(n); });
  const level = new Map(N.map((n) => [n, 0]));
  for (let k = 0; k < N.length; k++) for (const e of edges) if (!back.has(e) && e.a !== e.b && level.get(e.b) < level.get(e.a) + 1) level.set(e.b, level.get(e.a) + 1);
  const layers = [];
  N.forEach((n) => { (layers[level.get(n)] ||= []).push(n); });
  const gapMain = dir === 'LR' ? 170 : 96, gapCross = dir === 'LR' ? 92 : 120;
  const maxL = Math.max(...layers.map((l) => l?.length || 0));
  const pos = new Map();
  layers.forEach((L, li) => (L || []).forEach((n, k) => {
    const cross = (k - (L.length - 1) / 2) * gapCross + ((maxL - 1) / 2) * gapCross;
    pos.set(n, dir === 'LR' ? [70 + li * gapMain, 76 + cross] : [80 + cross, 40 + li * gapMain]);
  }));
  const W = dir === 'LR' ? 140 + (layers.length - 1) * gapMain : 160 + (maxL - 1) * gapCross;
  const H = dir === 'LR' ? 120 + (maxL - 1) * gapCross : 80 + (layers.length - 1) * gapMain;
  // ciclo (grafo di allocazione delle risorse)
  let cycle = null;
  if (rag) {
    const path = [], onPath = new Set(), seen = new Set();
    const find = (n) => { path.push(n); onPath.add(n); for (const e of out.get(n)) { if (onPath.has(e.b)) { cycle = path.slice(path.indexOf(e.b)).concat(e.b); return true; } if (!seen.has(e.b) && find(e.b)) return true; } path.pop(); onPath.delete(n); seen.add(n); return false; };
    for (const n of N) if (!seen.has(n) && find(n)) break;
  }
  const inCycle = (e) => cycle && cycle.some((n, i) => i < cycle.length - 1 && n === e.a && cycle[i + 1] === e.b);
  const isRes = (n) => rag && /^R/i.test(n.n);
  const R = (n) => (isRes(n) ? 26 : Math.max(24, Math.min(64, n.n.length * 4.2 + 12)));
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg graph', role: 'img' });
  svg.append(s('defs', {}, s('marker', { id: 'arr', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, s('path', { d: 'M0,0L10,5L0,10z', fill: 'var(--muted)' })),
    s('marker', { id: 'arr-bad', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, s('path', { d: 'M0,0L10,5L0,10z', fill: 'var(--danger)' }))));
  // bordo del nodo nella direzione di un punto (ellisse/rettangolo approssimati)
  const border = (n, tx, ty) => { const [x, y] = pos.get(n); const dx = tx - x, dy = ty - y, d = Math.hypot(dx, dy) || 1; const rx = R(n), ry = isRes(n) ? 26 : 22; const k = 1 / Math.sqrt((dx / d / rx) ** 2 + (dy / d / ry) ** 2); return [x + (dx / d) * k, y + (dy / d) * k]; };
  for (const e of edges) {
    const [ax, ay] = pos.get(e.a), [bx, by] = pos.get(e.b);
    const bad = inCycle(e);
    const attrs = { fill: 'none', stroke: bad ? 'var(--danger)' : 'var(--muted)', 'stroke-width': bad ? 2.4 : 1.6, 'marker-end': e.kind === '--' ? null : `url(#${bad ? 'arr-bad' : 'arr'})`, 'marker-start': e.kind === '<->' ? `url(#${bad ? 'arr-bad' : 'arr'})` : null };
    let d, lx, ly;
    if (e.a === e.b) { d = `M${ax - 12},${ay - 20} C${ax - 40},${ay - 70} ${ax + 40},${ay - 70} ${ax + 12},${ay - 20}`; lx = ax; ly = ay - 58; }
    else {
      // all'indietro o sullo stesso livello: curva, così non si sovrappone alla freccia di andata
      const curved = back.has(e) || level.get(e.a) === level.get(e.b) || edges.some((f) => f !== e && f.a === e.b && f.b === e.a);
      const mx = (ax + bx) / 2, my = (ay + by) / 2, len = Math.hypot(bx - ax, by - ay) || 1;
      const off = curved ? (back.has(e) ? 24 + len * 0.16 : 28) : 0; // le frecce all'indietro più lunghe curvano di più: non si sovrappongono
      const cx = mx + (-(by - ay) / len) * off, cy = my + ((bx - ax) / len) * off;
      const [sx, sy] = border(e.a, cx, cy), [tx, ty] = border(e.b, cx, cy);
      d = curved ? `M${sx},${sy} Q${cx},${cy} ${tx},${ty}` : `M${sx},${sy} L${tx},${ty}`;
      lx = curved ? (sx + 2 * cx + tx) / 4 : mx; ly = curved ? (sy + 2 * cy + ty) / 4 : my;
    }
    svg.append(s('path', { d, ...attrs }));
    if (e.label) { const w = e.label.length * 6.4 + 10; svg.append(s('rect', { x: lx - w / 2, y: ly - 10, width: w, height: 18, rx: 5, class: 'edge-lab-bg' }), s('text', { x: lx, y: ly + 3, 'text-anchor': 'middle', class: 'edge-lab' }, e.label)); }
  }
  for (const n of N) {
    const [x, y] = pos.get(n);
    const hot = cycle?.includes(n);
    if (isRes(n)) {
      svg.append(s('rect', { x: x - 26, y: y - 26, width: 52, height: 52, rx: 6, class: 'node res' + (hot ? ' hot' : '') }));
      const k = inst.get(n.n) || 1;
      for (let j = 0; j < k; j++) svg.append(s('circle', { cx: x - ((k - 1) * 9) / 2 + j * 9, cy: y + 12, r: 3, fill: 'var(--ink)' }));
      svg.append(s('text', { x, y: y - 4, 'text-anchor': 'middle', class: 'node-lab' }, n.n));
    } else {
      svg.append(s('ellipse', { cx: x, cy: y, rx: R(n), ry: 22, class: 'node' + (hot ? ' hot' : '') }), s('text', { x, y: y + 4, 'text-anchor': 'middle', class: 'node-lab' }, n.n));
    }
  }
  const kids = [svg];
  if (rag) {
    const single = cycle && cycle.filter(isRes).every((r) => (inst.get(r.n) || 1) === 1);
    kids.push(h('p', { class: cycle ? 'xray-alert' : 'xray-ok' }, cycle
      ? (single ? '⛔ Deadlock' : '⚠ ' + T('Ciclo')) + ': ' + cycle.map((n) => n.n).join(' → ') + ' ' + (single ? T('(ogni risorsa del ciclo ha una sola istanza)') : T('(con più istanze un ciclo non basta per il deadlock: controlla se qualcuno può finire)'))
      : T('✅ Nessun ciclo: niente deadlock')));
  }
  return kids;
}

// --- espressioni per «funzione» (niente eval) ----------------------------------------------------------------------
const FN = { sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, ln: Math.log, log: Math.log10, sqrt: Math.sqrt, abs: Math.abs, asin: Math.asin, acos: Math.acos, atan: Math.atan };
export function compileExpr(src) {
  // i nomi noti prima delle lettere sciolte: «xsin(x)» (anche scritto «x sin(x)») è x · sin(x)
  const t = String(src).replace(/\s+/g, '').replace(/,/g, '.').match(/\d*\.?\d+(?:e[+-]?\d+)?|asin|acos|atan|sqrt|sin|cos|tan|exp|abs|log|ln|pi|x|e|[a-z]+|[-+*/^()]/gi);
  if (!t) throw new Error(T('Espressione vuota'));
  let i = 0;
  const peek = () => t[i], eat = (x) => { if (t[i] !== x) throw new Error(T('Manca «{x}» nella funzione', { x })); i++; };
  const prim = () => {
    const x = t[i++];
    if (x == null) throw new Error(T('Funzione incompleta'));
    if (x === '(') { const e = add(); eat(')'); return e; }
    if (x === '-') { const e = pow(); return (v) => -e(v); }
    if (x === '+') return pow();
    if (/^\d|^\./.test(x)) { const v = Number(x); return implicit(() => v); }
    const n = x.toLowerCase();
    if (n === 'x') return implicit((v) => v);
    if (n === 'pi') return implicit(() => Math.PI);
    if (n === 'e') return implicit(() => Math.E);
    if (FN[n]) { const arg = peek() === '(' ? (i++, (() => { const e = add(); eat(')'); return e; })()) : pow(); return implicit((v) => FN[n](arg(v))); }
    throw new Error(T('Non conosco «{x}»', { x }));
  };
  // 2x, 3(x+1), x sin(x): moltiplicazione sottintesa
  const implicit = (f) => (peek() && /^(x|pi|e|\(|[a-z]{2,})$/i.test(peek()) ? ((g) => (v) => f(v) * g(v))(pow()) : f);
  const pow = () => { const a = prim(); if (peek() === '^') { i++; const b = pow(); return (v) => a(v) ** b(v); } return a; };
  const mul = () => { let a = pow(); while (peek() === '*' || peek() === '/') { const op = t[i++]; const b = pow(); const l = a; a = op === '*' ? (v) => l(v) * b(v) : (v) => l(v) / b(v); } return a; };
  const add = () => { let a = mul(); while (peek() === '+' || peek() === '-') { const op = t[i++]; const b = mul(); const l = a; a = op === '+' ? (v) => l(v) + b(v) : (v) => l(v) - b(v); } return a; };
  const e = add();
  if (i < t.length) throw new Error(T('«{x}» in più nella funzione', { x: t[i] }));
  return e;
}

const OPEN = new Map();
// --- il blocco nell'appunto: modulo + testo + disegno ---------------------------------------------------------------
// ctx: { onChange(), quiet() }
export function chartBlock(b, ctx) {
  const box = h('div', { class: 'tool chart-block' });
  box.addEventListener('click', (e) => e.stopPropagation());
  const kindSel = h('select', { 'aria-label': T('Tipo di grafico') }, [T('Grafici'), T('Sistemi Operativi'), T('Diagrammi')].map((g) => h('optgroup', { label: g }, CHART_KINDS.filter((k) => k.group === g).map((k) => h('option', { value: k.k, selected: k.k === b.kind }, k.label)))));
  const title = h('input', { class: 'chart-title-in', placeholder: T('Titolo (facoltativo)'), 'aria-label': T('Titolo del grafico'), value: b.title || '' });
  const help = h('p', { class: 'tool-hint' });
  const editor = h('div', { class: 'chart-editor' });
  const out = h('div', { class: 'chart-out' });
  let t;
  const draw = () => { clearTimeout(t); t = setTimeout(function go() { if (ctx.quiet && !ctx.quiet()) { t = setTimeout(go, 300); return; } out.replaceChildren(renderChart(b)); }, 200); };
  const changed = () => { ctx.onChange(); draw(); };
  title.addEventListener('input', () => { b.title = title.value; changed(); });
  kindSel.addEventListener('change', () => {
    const was = kindOf(b.kind);
    const K = kindOf(kindSel.value);
    // si tiene il testo se è dello stesso genere (tabella → tabella) e l'hai cambiato; altrimenti l'esempio del tipo nuovo
    const keep = was.form === 'table' && K.form === 'table' && b.src !== was.example;
    b.kind = K.k; if (!keep) b.src = K.example;
    ctx.onChange(); build(); draw();
  });
  const build = () => {
    const K = kindOf(b.kind);
    help.textContent = K.help;
    if (K.form === 'table') editor.replaceChildren(tableEditor(b, changed));
    else {
      const ta = h('textarea', { class: 'tool-src mono', rows: Math.min(12, Math.max(4, String(b.src || '').split('\n').length + 1)), spellcheck: 'false', autocapitalize: 'off', 'aria-label': T('Dati del grafico') });
      ta.value = b.src || '';
      ta.addEventListener('input', () => { b.src = ta.value; changed(); });
      editor.replaceChildren(ta, h('button', { type: 'button', class: 'btn small', onclick: () => { b.src = K.example; ta.value = b.src; changed(); } }, T('Rimetti l\'esempio')));
    }
  };
  const exp = h('button', { type: 'button', class: 'btn small', title: T('Scarica il disegno come immagine SVG'), onclick: () => {
    const svg = out.querySelector('svg');
    if (!svg) return;
    const c = svg.cloneNode(true);
    c.setAttribute('xmlns', NS);
    inlineStyles(svg, c);
    const blob = new Blob([c.outerHTML], { type: 'image/svg+xml' });
    const a = h('a', { href: URL.createObjectURL(blob), download: (b.title || kindOf(b.kind).label).replace(/[^\w\- àèéìòù]/gi, '') + '.svg' });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } }, T('Scarica SVG'));
  // aperto finché è ancora l'esempio (appena creato); poi si ricorda la scelta, ma solo in questa sessione (non nei dati)
  const edit = h('details', { class: 'chart-edit', open: (OPEN.get(b.id) ?? b.src === kindOf(b.kind).example) || null }, h('summary', {}, T('Dati e tipo')), h('div', { class: 'tool-head' }, kindSel, title, exp), help, editor);
  edit.addEventListener('toggle', () => OPEN.set(b.id, edit.open));
  box.append(edit, out);
  build();
  out.replaceChildren(renderChart(b));
  return box;
}
// i colori dei temi sono variabili CSS: nel file scaricato si scrivono per esteso
function inlineStyles(src, dst) {
  const a = src.querySelectorAll('*'), b = dst.querySelectorAll('*');
  a.forEach((el, i) => { const cs = getComputedStyle(el); b[i].setAttribute('style', `fill:${cs.fill};stroke:${cs.stroke};font:${cs.font};opacity:${cs.opacity}`); });
}
function tableEditor(b, onChange) {
  let rows = lines(b.src).map((l) => l.split(/\s*[;\t|]\s*/));
  if (!rows.length) rows = [[T('Voce'), T('Valore')], ['', '']];
  const cols = Math.max(...rows.map((r) => r.length));
  rows = rows.map((r) => Array.from({ length: cols }, (_, j) => r[j] ?? ''));
  const write = () => { b.src = rows.map((r) => r.join('; ')).join('\n'); onChange(); };
  const grid = h('div', { class: 'chart-grid' });
  const draw = () => {
    grid.style.setProperty('--cols', rows[0].length);
    grid.replaceChildren(...rows.flatMap((r, i) => r.map((v, j) => {
      const inp = h('input', { value: v, class: i === 0 ? 'head' : j === 0 ? 'lab' : 'val', inputmode: i > 0 && j > 0 ? 'decimal' : null, 'aria-label': i === 0 ? T('Nome della colonna {n}', { n: j + 1 }) : T('Riga {r}, colonna {c}', { r: i, c: j + 1 }) });
      inp.addEventListener('input', () => { rows[i][j] = inp.value.replace(/;/g, ','); write(); });
      return inp;
    })));
  };
  const btn = (lab, fn) => h('button', { type: 'button', class: 'btn small', onclick: () => { fn(); draw(); write(); } }, lab);
  draw();
  return h('div', { class: 'chart-table' }, grid, h('div', { class: 'chart-table-btns' },
    btn(T('+ Riga'), () => rows.push(rows[0].map(() => ''))),
    btn(T('− Riga'), () => { if (rows.length > 2) rows.pop(); }),
    btn(T('+ Colonna'), () => rows.forEach((r, i) => r.push(i ? '' : T('Serie {n}', { n: r.length })))),
    btn(T('− Colonna'), () => { if (rows[0].length > 2) rows.forEach((r) => r.pop()); })));
}
