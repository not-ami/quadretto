// Tavola per scrittura a mano: Apple Pencil con pressione, evidenziatore, gomma a tratto,
// riconoscimento forme (tieni ferma la penna a fine tratto), strumento Forme e piano cartesiano.
// Coordinate logiche: larghezza fissa 1000 unità, così il disegno resta identico
// in verticale, in orizzontale e su schermi diversi.

// Qui t è anche una variabile locale: la traduzione si chiama T() (vedi i18n.js).
import { t as T } from './i18n.js';
import { renderPage } from './pdfdoc.js';

export const W = 1000;
export const STEP = 25; // un quadretto = 25 unità (5 mm su un foglio da 200 mm)
const HOLD_MS = 520;
// 2026.11.6: «penna ferma» = la punta resta dentro un cerchietto di HOLD_R_PX pixel per HOLD_MS. Prima si guardava il
// passo tra un campione e l'altro: a 240 Hz, scrivendo piccolo e piano, ogni passo era sotto la soglia e la scrittura
// diventava una linea o una spezzata a zig-zag mentre si continuava a scrivere.
const HOLD_R_PX = 3.5;
const LIVE_CHUNK = 120; // punti del tratto in corso fissati sulla tela «live» in una volta

export const inkPrefs = {
  tool: 'pen',            // pen | hl | eraser | shape | lasso
  shape: 'line',          // line | arrow | rect | ellipse | axes
  color: '#1c2333',
  width: 3,
  penOnly: false,         // con l'Apple Pencil: il dito scorre, la penna scrive
  snapGrid: true,         // vertici delle forme agganciati ai quadretti
  ...(() => { try { return JSON.parse(localStorage.getItem('ink-prefs') || '{}'); } catch { return {}; } })(),
};
// Filtro dei colori con significato (N5): se `only` è un insieme di colori, gli altri tratti si vedono appena
export const inkView = { only: null };
// 2026.11.6: la tavola ha usato le due dita (pizzico o trascinamento): app.js non le conta come gesto annulla/ripristina
export const inkTouch = { used: false };
export const prefsHooks = [];
export function savePrefs() { try { localStorage.setItem('ink-prefs', JSON.stringify(inkPrefs)); } catch {} prefsHooks.forEach((f) => f()); }

// --- disegno ----------------------------------------------------------------
// Tratto: { t: pen|hl|txt, c: colore, w: spessore, p: [x, y, pressione, ...], g?: 1 (geometrico), s?: testo }
function drawStroke(ctx, s, scale) {
  const p = drawPoints(s);
  const n = p.length / 3;
  if (!n) return;
  ctx.save();
  if (s._fade) ctx.globalAlpha = 0.1;
  ctx.strokeStyle = s.c;
  ctx.fillStyle = s.c;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (s.t === 'txt') {
    ctx.font = `italic ${s.w * scale}px "Times New Roman", Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s.s, p[0] * scale, p[1] * scale);
    ctx.restore();
    return;
  }
  if (s.g) {
    ctx.lineWidth = s.w * 0.95 * scale;
    ctx.beginPath();
    ctx.moveTo(p[0] * scale, p[1] * scale);
    for (let i = 1; i < n; i++) ctx.lineTo(p[i * 3] * scale, p[i * 3 + 1] * scale);
    if (n === 1) ctx.lineTo(p[0] * scale + 0.1, p[1] * scale);
    ctx.stroke();
    ctx.restore();
    return;
  }
  // mano libera (penna ed evidenziatore): figura calcolata una volta in unità e tenuta da parte, qui solo riempita
  if (s.t === 'hl') { ctx.globalAlpha = s._fade ? 0.04 : 0.32; ctx.globalCompositeOperation = 'multiply'; }
  const shape = inkShape(s, p);
  ctx.scale(scale, scale);
  if (shape.line) { ctx.lineWidth = shape.line; ctx.stroke(shape.path); } else ctx.fill(shape.path);
  ctx.restore();
}

// --- inchiostro (2026.11.6) ---------------------------------------------------------------------------------
// Prima ogni pezzo tra due punti era una linea a sé, curva tra i punti medi: gli angoli venivano tagliati e dove
// i pezzi si sovrapponevano il bordo si ispessiva a perline. Ora la linea passa PER i punti (Catmull-Rom centripeta:
// niente riccioli né rimbalzi) e il tratto è una figura sola: se lo spessore è costante (i tratti di prima) una linea
// del browser, se varia (velocità, pressione) un nastro pieno con i bordi spostati di mezzo spessore, spezzato con un
// disco dove gira stretto, riempito in una volta (nonzero: i pezzi si uniscono senza sommarsi). Lo stesso codice
// disegna il tratto mentre lo scrivi e quando è finito: alzando la penna non cambia niente.
const inkR = (s, pr) => (s.t === 'hl' ? s.w : Math.max(0.5, s.w * (0.45 + pr / 110))) / 2;
const shapeCache = new WeakMap(); // punti del tratto → { w, path, line }
function inkShape(s, p) {
  const hit = shapeCache.get(p);
  if (hit && hit.w === s.w && hit.t === s.t) return hit;
  const n = p.length / 3;
  const path = new Path2D();
  let even = true;
  for (let i = 5; i < p.length; i += 3) if (p[i] !== p[2]) { even = false; break; }
  let line = 0;
  if (s.t === 'hl' || (even && !s.v)) { line = inkR(s, p[2]) * 2; inkCurve(path, p, 0, n - 1); }
  else inkRibbon(path, p, 0, n - 1, (i) => inkR(s, p[i * 3 + 2]));
  const out = { w: s.w, t: s.t, path, line };
  shapeCache.set(p, out);
  return out;
}
// da chiamare quando i punti di un tratto cambiano sul posto (selezione spostata, tavola rimpicciolita)
function forgetInk(s) { shapeCache.delete(s.p); thinCache.delete(s.p); boxCache.delete(s.p); }
// riquadro del tratto in unità, con margine (per non disegnare ciò che sta fuori dalle tele a finestra)
const boxCache = new WeakMap();
function strokeBox(s) {
  let b = boxCache.get(s.p);
  if (b) return b;
  const p = s.p, m = s.t === 'txt' ? s.w * ((s.s?.length || 1) + 1) : s.w + 2;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < p.length; i += 3) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
  b = [x0 - m, y0 - m, x1 + m, y1 + m];
  boxCache.set(p, b);
  return b;
}

// punti di controllo della curva di Bézier che fa il pezzo i → i+1 della Catmull-Rom centripeta. Agli spigoli (svolta
// oltre ~53°: il «4», la «v», la punta della «m») il pezzo arriva e riparte dritto: niente pance ai lati.
const SHARP = 0.6;
function crCtrl(p, i, n, out) {
  const x1 = p[i * 3], y1 = p[i * 3 + 1], x2 = p[i * 3 + 3], y2 = p[i * 3 + 4];
  const x0 = i > 0 ? p[i * 3 - 3] : 2 * x1 - x2, y0 = i > 0 ? p[i * 3 - 2] : 2 * y1 - y2;
  const x3 = i + 2 < n ? p[i * 3 + 6] : 2 * x2 - x1, y3 = i + 2 < n ? p[i * 3 + 7] : 2 * y2 - y1;
  const d1 = Math.hypot(x1 - x0, y1 - y0), d2 = Math.hypot(x2 - x1, y2 - y1), d3 = Math.hypot(x3 - x2, y3 - y2);
  const s1 = Math.sqrt(d1), s2 = Math.sqrt(d2), s3 = Math.sqrt(d3);
  out[0] = x1; out[1] = y1; out[2] = x2; out[3] = y2;
  if (s2 <= 1e-3) return d2;
  const sharp1 = s1 > 1e-3 && ((x1 - x0) * (x2 - x1) + (y1 - y0) * (y2 - y1)) / (d1 * d2) < SHARP;
  const sharp2 = s3 > 1e-3 && ((x2 - x1) * (x3 - x2) + (y2 - y1) * (y3 - y2)) / (d2 * d3) < SHARP;
  if (sharp1) { out[0] = x1 + (x2 - x1) / 3; out[1] = y1 + (y2 - y1) / 3; }
  else if (s1 > 1e-3) { const k = 3 * s1 * (s1 + s2), m = 2 * d1 + 3 * s1 * s2 + d2; out[0] = (d1 * x2 - d2 * x0 + m * x1) / k; out[1] = (d1 * y2 - d2 * y0 + m * y1) / k; }
  if (sharp2) { out[2] = x2 - (x2 - x1) / 3; out[3] = y2 - (y2 - y1) / 3; }
  else if (s3 > 1e-3) { const k = 3 * s3 * (s3 + s2), m = 2 * d3 + 3 * s3 * s2 + d2; out[2] = (d3 * x1 - d2 * x3 + m * x2) / k; out[3] = (d3 * y1 - d2 * y3 + m * y2) / k; }
  return d2;
}
const CC = [0, 0, 0, 0];
// spessore costante: una sola linea curva dal punto a al punto b
function inkCurve(path, p, a, b) {
  const n = p.length / 3;
  path.moveTo(p[a * 3], p[a * 3 + 1]);
  if (a === b) { path.lineTo(p[a * 3] + 0.01, p[a * 3 + 1]); return; }
  for (let i = a; i < b; i++) {
    if (crCtrl(p, i, n, CC) < 1e-6) continue;
    path.bezierCurveTo(CC[0], CC[1], CC[2], CC[3], p[i * 3 + 3], p[i * 3 + 4]);
  }
}
const disc = (path, x, y, r) => { path.moveTo(x + r, y); path.arc(x, y, r, 0, Math.PI * 2, true); };
// spessore che varia: la curva si campiona fitta (≤ 1,2 unità) e diventa un nastro pieno
function inkRibbon(path, p, a, b, R) {
  const n = p.length / 3;
  const xs = [p[a * 3]], ys = [p[a * 3 + 1]], rs = [R(a)];
  for (let i = a; i < b; i++) {
    const d = crCtrl(p, i, n, CC);
    if (d < 1e-6) continue;
    const x1 = p[i * 3], y1 = p[i * 3 + 1], x2 = p[i * 3 + 3], y2 = p[i * 3 + 4], r1 = R(i), r2 = R(i + 1);
    const m = Math.min(16, Math.max(1, Math.ceil(d / 1.2)));
    for (let k = 1; k <= m; k++) {
      const t = k / m, u = 1 - t;
      xs.push(u * u * u * x1 + 3 * u * u * t * CC[0] + 3 * u * t * t * CC[2] + t * t * t * x2);
      ys.push(u * u * u * y1 + 3 * u * u * t * CC[1] + 3 * u * t * t * CC[3] + t * t * t * y2);
      rs.push(r1 + (r2 - r1) * t);
    }
  }
  ribbon(path, xs, ys, rs);
}
// Nastro lungo i campioni. Tutti i pezzi girano nello stesso verso dei dischi (antiorario), così il riempimento
// nonzero li unisce. Dove la linea gira più di ~35° o più stretto del mezzo spessore il nastro si spezza con un disco:
// il bordo interno non si ripiega su sé stesso (farebbe un buco).
function ribbon(path, xs, ys, rs) {
  const m = xs.length;
  disc(path, xs[0], ys[0], rs[0]);
  if (m < 2) return;
  disc(path, xs[m - 1], ys[m - 1], rs[m - 1]);
  const dx = new Float64Array(m - 1), dy = new Float64Array(m - 1), dl = new Float64Array(m - 1);
  let lx = 1, ly = 0;
  for (let j = 0; j < m - 1; j++) {
    const ex = xs[j + 1] - xs[j], ey = ys[j + 1] - ys[j], l = Math.hypot(ex, ey);
    if (l > 1e-6) { lx = ex / l; ly = ey / l; }
    dx[j] = lx; dy[j] = ly; dl[j] = l;
  }
  const band = (j0, j1) => {
    if (j1 <= j0) return;
    const L = [], Rt = [];
    for (let j = j0; j <= j1; j++) {
      let nx, ny;
      if (j === j0) { nx = -dy[j]; ny = dx[j]; }
      else if (j === j1) { nx = -dy[j - 1]; ny = dx[j - 1]; }
      else { const bx = dx[j - 1] + dx[j], by = dy[j - 1] + dy[j], bl = Math.hypot(bx, by) || 1; nx = -by / bl; ny = bx / bl; }
      L.push(xs[j] + nx * rs[j], ys[j] + ny * rs[j]);
      Rt.push(xs[j] - nx * rs[j], ys[j] - ny * rs[j]);
    }
    path.moveTo(L[0], L[1]);
    for (let q = 2; q < L.length; q += 2) path.lineTo(L[q], L[q + 1]);
    for (let q = Rt.length - 2; q >= 0; q -= 2) path.lineTo(Rt[q], Rt[q + 1]);
    path.closePath();
  };
  let j0 = 0;
  for (let j = 1; j < m - 1; j++) {
    const c = dx[j - 1] * dx[j] + dy[j - 1] * dy[j];
    const th = Math.acos(Math.max(-1, Math.min(1, c)));
    if (c < 0.82 || rs[j] * th > 0.8 * Math.min(dl[j - 1], dl[j])) { band(j0, j); disc(path, xs[j], ys[j], rs[j]); j0 = j; }
  }
  band(j0, m - 1);
}

function hits(s, x, y, r) {
  const p = s.p;
  const rr = (r + (s.t === 'txt' ? s.w * 0.6 : s.w / 2)) ** 2;
  for (let i = 0; i < p.length; i += 3) {
    const dx = p[i] - x, dy = p[i + 1] - y;
    if (dx * dx + dy * dy < rr) return true;
    // anche i segmenti lunghi delle forme
    if (s.g && i + 3 < p.length) {
      const ax = p[i], ay = p[i + 1], bx = p[i + 3], by = p[i + 4];
      const L = (bx - ax) ** 2 + (by - ay) ** 2;
      if (L > 0) {
        const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / L));
        if ((ax + t * (bx - ax) - x) ** 2 + (ay + t * (by - ay) - y) ** 2 < rr) return true;
      }
    }
  }
  return false;
}

// --- geometria delle forme ------------------------------------------------------
const flat = (pts) => pts.flatMap(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10, 50]);
const snapV = (v) => Math.round(v / STEP) * STEP;
function snapPt([x, y], force) {
  if (!inkPrefs.snapGrid && !force) return [x, y];
  const sx = snapV(x), sy = snapV(y);
  // aggancia solo se vicino a un incrocio (resta libero altrove)
  return Math.hypot(sx - x, sy - y) < STEP * 0.42 ? [sx, sy] : [x, y];
}
function snapAngle(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx);
  const step = Math.PI / 4;
  const near = Math.round(ang / step) * step;
  if (Math.abs(ang - near) < (7 * Math.PI) / 180) return [a[0] + Math.cos(near) * len, a[1] + Math.sin(near) * len];
  return b;
}

const G = {
  line: (a, b) => [a, b],
  rect: (a, b) => [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]], [a[0], a[1]]],
  ellipse: (cx, cy, rx, ry, rot = 0) => {
    const out = [];
    for (let i = 0; i <= 72; i++) {
      const t = (i / 72) * Math.PI * 2;
      const x = Math.cos(t) * rx, y = Math.sin(t) * ry;
      out.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
    }
    return out;
  },
  head: (a, b, size) => {
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const s = size;
    return [[b[0] - s * Math.cos(ang - 0.45), b[1] - s * Math.sin(ang - 0.45)], b, [b[0] - s * Math.cos(ang + 0.45), b[1] - s * Math.sin(ang + 0.45)]];
  },
};

// Strumento Forme: dal punto di partenza al punto corrente
export function buildShape(kind, a, b, base) {
  const mk = (pts, extra = {}) => ({ ...base, t: 'pen', g: 1, p: flat(pts), ...extra });
  if (kind === 'line') return [mk(G.line(a, snapAngle(a, b)))];
  if (kind === 'arrow') { const e = snapAngle(a, b); return [mk(G.line(a, e)), mk(G.head(a, e, Math.max(14, base.w * 5)))]; }
  if (kind === 'rect') return [mk(G.rect(a, b))];
  if (kind === 'ellipse') {
    const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
    let rx = Math.abs(b[0] - a[0]) / 2, ry = Math.abs(b[1] - a[1]) / 2;
    if (Math.abs(rx - ry) / Math.max(rx, ry, 1) < 0.08) rx = ry = (rx + ry) / 2; // quasi tondo: cerchio
    return [mk(G.ellipse(cx, cy, rx, ry))];
  }
  if (kind === 'axes') return axes(a, b, base);
  return [];
}

// Piano cartesiano: il rettangolo trascinato è l'estensione, l'origine cade sul quadretto più vicino al centro
function axes(a, b, base) {
  let x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
  let y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  if (x1 - x0 < STEP * 4) { const c = (x0 + x1) / 2; x0 = c - 200; x1 = c + 200; }
  if (y1 - y0 < STEP * 4) { const c = (y0 + y1) / 2; y0 = c - 150; y1 = c + 150; }
  const ox = snapV((x0 + x1) / 2), oy = snapV((y0 + y1) / 2);
  const w = Math.max(1.6, base.w * 0.7);
  const mk = (pts) => ({ ...base, w, t: 'pen', g: 1, p: flat(pts) });
  const out = [mk([[x0, oy], [x1, oy]]), mk(G.head([x0, oy], [x1, oy], 14)), mk([[ox, y1], [ox, y0]]), mk(G.head([ox, y1], [ox, y0], 14))];
  const tick = 5;
  for (let x = ox + STEP; x < x1 - STEP * 0.8; x += STEP) out.push(mk([[x, oy - tick], [x, oy + tick]]));
  for (let x = ox - STEP; x > x0 + 2; x -= STEP) out.push(mk([[x, oy - tick], [x, oy + tick]]));
  for (let y = oy - STEP; y > y0 + STEP * 0.8; y -= STEP) out.push(mk([[ox - tick, y], [ox + tick, y]]));
  for (let y = oy + STEP; y < y1 - 2; y += STEP) out.push(mk([[ox - tick, y], [ox + tick, y]]));
  const txt = (s, x, y) => ({ t: 'txt', c: base.c, w: 22, s, p: [x, y, 50] });
  out.push(txt('x', x1 - 6, oy + 22), txt('y', ox - 18, y0 + 8), txt('O', ox - 14, oy + 18));
  return out;
}

// Douglas–Peucker: semplifica il tratto per trovare gli spigoli
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let idx = 0, max = 0;
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((b[1] - a[1]) * pts[i][0] - (b[0] - a[0]) * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / L;
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [a, b];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}
// --- morbidezza del tratto (2026.11.3) ----------------------------------------------------------------
// Con l'HTTPS Safari passa tutti i campioni della Pencil (getCoalescedEvents, 240 Hz, solo nelle pagine sicure):
// punti a 1 unità l'uno dall'altro rendono visibile il tremolio della mano e il tratto viene seghettato.
// In HTTP arrivava un punto per fotogramma (3-4 unità). Ora, per ogni fotogramma, si tengono solo i punti che
// cambiano la forma oltre THIN_EPS: la densità torna quella di prima, gli angoli veri restano.
const THIN_EPS = 1.0; // con 1,0 la scrittura normale torna identica all'HTTP (simulazione: 73 punti, passo 3,9)
export function thinFrame(last, pts) {
  if (pts.length < 2) return pts;
  return rdp([last, ...pts], THIN_EPS).slice(1);
}
// I tratti già salvati con i punti troppo fitti (scritti in HTTPS prima della correzione) si disegnano
// semplificati allo stesso modo, senza toccare i dati. I tratti radi restano identici.
const thinCache = new WeakMap();
function drawPoints(s) {
  const p = s.p;
  if (s.t !== 'pen' || s.g || s.v || p.length < 30) return p; // v: 2 = scritto col filtro del 2026.11.6, già pulito
  const hit = thinCache.get(p);
  if (hit) return hit;
  const n = p.length / 3;
  let sum = 0;
  for (let i = 1; i < n; i++) sum += Math.hypot(p[i * 3] - p[i * 3 - 3], p[i * 3 + 1] - p[i * 3 - 2]);
  let out = p;
  if (sum / (n - 1) < 2) {
    // come in scrittura: a gruppi di 4 campioni (240 Hz → un fotogramma a 60 Hz)
    const res = [[p[0], p[1], p[2]]];
    for (let i = 1; i < n; i += 4) {
      const frame = [];
      for (let j = i; j < Math.min(n, i + 4); j++) frame.push([p[j * 3], p[j * 3 + 1], p[j * 3 + 2]]);
      res.push(...thinFrame(res[res.length - 1], frame));
    }
    out = res.flat();
  }
  thinCache.set(p, out);
  return out;
}

// --- presa del tratto (2026.11.6) ---------------------------------------------------------------------------
// Al posto della semplificazione per fotogramma (THIN_EPS = 1 unità: in una scrittura piccola è il 5-10 % di una
// lettera, e si vedeva) si tengono tutti i campioni della Pencil e si fa una media gaussiana LUNGO IL TRATTO, con
// σ in pixel dello schermo: toglie il gradino dei campioni (≈ 0,5 px, era quello a seghettare) senza smussare le forme,
// e ai due capi la finestra si stringe fino a zero, così il tratto comincia e finisce esattamente sotto la punta.
// Poi si tengono solo i punti che servono (scarto ≤ EPS_PX). Il ritardo è di ~1,5 unità di tratto: lo copre la coda
// disegnata coi campioni grezzi fino alla punta.
// Spessore: la pressione che arriva da Safari è sempre la stessa (BUG-011), quindi se non cambia lo spessore segue la
// velocità come una penna vera (piano = un filo più pieno, veloce = più sottile, ±10 % attorno allo spessore di sempre)
// con un attacco appena più sottile. Il valore finisce nel terzo numero di ogni punto (pressione «efficace»). Se un
// giorno la pressione cambia davvero, si usa quella.
const SIG_PX = 0.6, EPS_PX = 0.15, GAP_PX = 8; // GAP: due punti tenuti mai più lontani di così (la curva tra punti
// radi si gonfierebbe: un lato dritto dopo una curva verrebbe a pancia)
let realPressure = false;
const sstep = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
class Capture {
  constructor(stroke, scale) {
    this.s = stroke; this.k = scale;
    this.sig = SIG_PX / scale; this.win = 2.5 * this.sig; this.eps = EPS_PX / scale; this.gap = GAP_PX / scale;
    this.x = []; this.y = []; this.p = []; this.t = []; this.a = []; this.pe = [];
    this.done = 0; this.anchor = null; this.pend = [];
    this.pmin = Infinity; this.pmax = -Infinity; this.real = realPressure; this.g = 1;
  }
  add(x, y, pr, t) {
    const n = this.x.length;
    if (n) {
      const d = Math.hypot(x - this.x[n - 1], y - this.y[n - 1]);
      if (d < 0.1 / this.k) return; // stesso punto
      this.a.push(this.a[n - 1] + d);
      if (!this.real) { this.pmin = Math.min(this.pmin, pr); this.pmax = Math.max(this.pmax, pr); if (this.pmax - this.pmin > 4) this.real = realPressure = true; }
    } else this.a.push(0);
    this.x.push(x); this.y.push(y); this.p.push(pr); this.t.push(t);
    this.pe.push(this.effective(n));
    this.run(false);
  }
  // spessore dal campione grezzo i: pressione vera, oppure velocità (px/ms sugli ultimi ~24 ms) e attacco
  effective(i) {
    const pr = this.p[i];
    if (this.real) return pr;
    let j = i;
    while (j > 0 && this.t[i] - this.t[j] < 24) j--;
    let v = 0;
    if (j < i) { const dt = Math.max(this.t[i] - this.t[j], (i - j) * 2); v = Math.hypot(this.x[i] - this.x[j], this.y[i] - this.y[j]) * this.k / dt; }
    const target = 1.06 - 0.22 * sstep((v - 0.1) / 1.5);
    const dt = i ? Math.max(1, this.t[i] - this.t[i - 1]) : 0;
    this.g = i ? this.g + (target - this.g) * (1 - Math.exp(-dt / 40)) : target;
    const entry = 0.8 + 0.2 * sstep(this.a[i] * this.k / 3);
    const F = (0.45 + pr / 110) * this.g * entry;
    return Math.max(1, Math.min(100, Math.round((F - 0.45) * 110)));
  }
  // media gaussiana lungo il tratto attorno al campione i, con la finestra stretta ai capi
  smooth(i, rad) {
    const n = this.x.length, ai = this.a[i];
    if (rad <= 1e-6) return [this.x[i], this.y[i], this.pe[i]];
    const inv = 1 / (2 * this.sig * this.sig);
    let sx = 0, sy = 0, sp = 0, sw = 0;
    for (let j = i; j >= 0 && ai - this.a[j] <= rad; j--) { const w = Math.exp(-((ai - this.a[j]) ** 2) * inv); sx += w * this.x[j]; sy += w * this.y[j]; sp += w * this.pe[j]; sw += w; }
    for (let j = i + 1; j < n && this.a[j] - ai <= rad; j++) { const w = Math.exp(-((this.a[j] - ai) ** 2) * inv); sx += w * this.x[j]; sy += w * this.y[j]; sp += w * this.pe[j]; sw += w; }
    return [sx / sw, sy / sw, sp / sw];
  }
  run(flush) {
    const n = this.x.length, last = this.a[n - 1];
    while (this.done < n) {
      const i = this.done, ai = this.a[i];
      let rad = Math.min(this.win, ai);
      if (flush) rad = Math.min(rad, last - ai);
      else if (last - ai < rad) break; // aspetta i campioni dopo
      this.emit(this.smooth(i, rad));
      this.done++;
    }
    if (flush) { if (this.pend.length) this.keep(this.pend[this.pend.length - 1]); this.pend = []; }
  }
  // tiene un punto quando quelli saltati si allontanerebbero più di eps dalla corda (o cambierebbero spessore)
  emit(q) {
    if (!this.anchor) { this.keep(q); return; }
    this.pend.push(q);
    const m = this.pend.length;
    if (m < 2) return;
    const A = this.anchor, B = q;
    const ex = B[0] - A[0], ey = B[1] - A[1], L = ex * ex + ey * ey;
    let ok = m <= 48 && L <= this.gap * this.gap;
    for (let j = 0; ok && j < m - 1; j++) {
      const P = this.pend[j];
      const t = L > 0 ? Math.max(0, Math.min(1, ((P[0] - A[0]) * ex + (P[1] - A[1]) * ey) / L)) : 0;
      if ((A[0] + t * ex - P[0]) ** 2 + (A[1] + t * ey - P[1]) ** 2 > this.eps * this.eps || Math.abs(A[2] + t * (B[2] - A[2]) - P[2]) > 1.5) ok = false;
    }
    if (!ok) { const k = this.pend[m - 2]; this.keep(k); this.pend = [q]; }
  }
  keep(q) {
    this.anchor = q;
    this.s.p.push(Math.round(q[0] * 100) / 100, Math.round(q[1] * 100) / 100, Math.round(q[2]));
  }
  // punti non ancora fissati: quelli in attesa e i campioni grezzi fino alla punta
  tail() {
    const out = [];
    for (const q of this.pend) out.push(q[0], q[1], q[2]);
    for (let i = this.done; i < this.x.length; i++) out.push(this.x[i], this.y[i], this.pe[i]);
    return out;
  }
  finish() { this.run(true); this.s.v = 2; return this.s; }
}

function rdpClosed(pts, eps) {
  // spezza il contorno nel punto più lontano dall'inizio, così gli spigoli non dipendono da dove si è partiti
  let far = 0, md = 0;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > md) { md = d; far = i; } }
  const a = rdp(pts.slice(0, far + 1), eps), b = rdp([...pts.slice(far), pts[0]], eps);
  const v = [...a.slice(0, -1), ...b.slice(0, -1)];
  // unisci vertici troppo vicini
  return v.filter((p, i) => Math.hypot(p[0] - v[(i + 1) % v.length][0], p[1] - v[(i + 1) % v.length][1]) > eps * 1.2);
}

// distanza massima dei punti dalla spezzata v (aperta, o chiusa se closed)
function devFrom(raw, v, closed) {
  const segs = closed ? v.length : v.length - 1;
  let worst = 0;
  for (const [x, y] of raw) {
    let best = Infinity;
    for (let i = 0; i < segs; i++) {
      const [ax, ay] = v[i], [bx, by] = v[(i + 1) % v.length];
      const ex = bx - ax, ey = by - ay, L = ex * ex + ey * ey;
      const t = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L)) : 0;
      best = Math.min(best, Math.hypot(ax + t * ex - x, ay + t * ey - y));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}
const polyLen = (v, closed) => { let l = 0; for (let i = 1; i < v.length + (closed ? 1 : 0); i++) l += Math.hypot(v[i % v.length][0] - v[i - 1][0], v[i % v.length][1] - v[i - 1][1]); return l; };

// Riconosce la forma disegnata a mano libera.
// 2026.11.6 (utente: «quando scrivo molto piccolo … mi converte il testo in linea od in linee storte a zig zag»): oltre
// alla «penna ferma» vera (HOLD_R_PX), una forma deve anche esserlo davvero. Le parole piccole erano spezzate perché la
// tolleranza era almeno 6 unità (in una lettera di 15 è quasi metà): ora è proporzionata alla grandezza, i lati devono
// essere dritti (il tratto non più lungo del 12 % della spezzata, nessun punto lontano) e c'è una grandezza minima.
const MIN_SHAPE = 30;   // unità (poco più di un quadretto): sotto, cerchi, triangoli e spezzate restano scrittura
export function recognize(stroke) {
  const raw = [];
  for (let i = 0; i < stroke.p.length; i += 3) raw.push([stroke.p[i], stroke.p[i + 1]]);
  if (raw.length < 4) return null;
  let len = 0;
  for (let i = 1; i < raw.length; i++) len += Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]);
  if (len < 30) return null;
  const xs = raw.map((p) => p[0]), ys = raw.map((p) => p[1]);
  const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys);
  const diag = Math.hypot(bx1 - bx0, by1 - by0);
  const a = raw[0], z = raw[raw.length - 1];
  const gap = Math.hypot(z[0] - a[0], z[1] - a[1]);
  const base = { t: stroke.t, c: stroke.c, w: stroke.w };
  const mk = (pts, name) => ({ name, strokes: [{ ...base, g: 1, p: flat(pts) }] });

  // linea retta: quasi senza giri e senza punti lontani dalla corda (le parole piatte, «mm», «~~», non lo sono)
  if (gap / len > 0.92) {
    if (devFrom(raw, [a, z]) > Math.max(2.5, 0.045 * gap)) return null;
    const s = snapPt(a), e = snapPt(snapAngle(a, z));
    return { name: 'line', strokes: [{ ...base, g: 1, p: flat([s, e]) }], line: true, start: s };
  }
  if (stroke.t === 'hl' || diag < MIN_SHAPE) return null;

  const closed = gap < Math.max(0.22 * len, 0.3 * diag) && len > diag * 2;
  if (closed) {
    const cx = xs.reduce((s, v) => s + v, 0) / xs.length, cy = ys.reduce((s, v) => s + v, 0) / ys.length;
    const verts = rdpClosed(raw, diag * 0.075);
    // ellisse/cerchio: distanza normalizzata dal centro quasi costante
    const rx = (bx1 - bx0) / 2, ry = (by1 - by0) / 2;
    const ecx = (bx0 + bx1) / 2, ecy = (by0 + by1) / 2;
    let err = 0;
    for (const [x, y] of raw) err += Math.abs(Math.hypot((x - ecx) / (rx || 1), (y - ecy) / (ry || 1)) - 1);
    err /= raw.length;
    if (verts.length >= 5 || err < 0.09) {
      if (err < 0.2) {
        let Rx = rx, Ry = ry;
        if (Math.abs(rx - ry) / Math.max(rx, ry) < 0.15) Rx = Ry = (rx + ry) / 2;
        const c = snapPt([ecx, ecy]);
        return mk(G.ellipse(c[0], c[1], Rx, Ry), Rx === Ry ? 'circle' : 'ellipse');
      }
    }
    // triangoli e quadrilateri: lati dritti, non riccioli di scrittura
    const straight = verts.length >= 3 && len / polyLen(verts, true) < 1.12 && devFrom(raw, verts, true) < Math.max(3, 0.06 * diag);
    if (verts.length === 3 && straight) {
      const v = verts.map((p) => snapPt(p));
      return mk([...v, v[0]], 'triangle');
    }
    if (verts.length === 4 && straight) {
      // rettangolo allineato se i lati sono quasi orizzontali/verticali
      const aligned = verts.every((p, i) => {
        const q = verts[(i + 1) % 4];
        const ang = Math.abs(Math.atan2(q[1] - p[1], q[0] - p[0])) % (Math.PI / 2);
        return Math.min(ang, Math.PI / 2 - ang) < 0.26;
      });
      if (aligned) {
        const p0 = snapPt([bx0, by0]), p1 = snapPt([bx1, by1]);
        return mk(G.rect(p0, p1), 'rect');
      }
      const v = verts.map((p) => snapPt(p));
      return mk([...v, v[0]], 'quad');
    }
    void cx; void cy;
    return null;
  }
  // spezzata aperta: fino a 5 segmenti dritti, ognuno non troppo corto
  if (diag < MIN_SHAPE * 1.3) return null;
  const v = rdp(raw, Math.max(2.5, diag * 0.04));
  if (v.length < 3 || v.length > 6) return null;
  if (len / polyLen(v) > 1.12) return null;
  for (let i = 1; i < v.length; i++) if (Math.hypot(v[i][0] - v[i - 1][0], v[i][1] - v[i - 1][1]) < Math.max(10, 0.15 * diag)) return null;
  return mk(v.map((p) => snapPt(p)), 'polyline');
}

// --- tavola -------------------------------------------------------------------
export class InkBoard {
  constructor(block, { onChange, onActivate, onSnap, onStrokeStart, onStrokeEnd, onGesture, paper, pageUrl }) {
    this.onGesture = onGesture;
    this.onStrokeStart = onStrokeStart;
    this.onStrokeEnd = onStrokeEnd;
    this.block = block;
    block.strokes ||= [];
    block.h ||= 700;
    this.onChange = onChange;
    this.onActivate = onActivate;
    this.onSnap = onSnap;
    this.undoStack = [];
    this.redoStack = [];

    this.el = document.createElement('div');
    this.el.className = 'ink paper-canvas';
    this.el.dataset.paper = paper || 'grid';
    this.canvas = document.createElement('canvas');
    this.pred = document.createElement('canvas');   // coda del tratto + punti previsti, ridisegnata a ogni evento
    this.live = document.createElement('canvas');   // tratto in corso, disegnato a pezzi senza cancellare
    this.live.className = 'ink-live';
    this.pred.className = 'ink-pred';
    const fast = { desynchronized: true };
    this.ctx = this.canvas.getContext('2d');
    this.pctx = this.pred.getContext('2d', fast);
    this.lctx = this.live.getContext('2d', fast);
    this.more = document.createElement('button');
    this.more.type = 'button';
    this.more.className = 'ink-more';
    this.more.textContent = T('+ Altro spazio');
    this.more.addEventListener('click', () => this.grow(500));
    this.el.append(this.canvas, this.pred, this.live, this.more);
    // 2026.11.6: pagina di un PDF come sfondo (block.bg). Le tavole con la pagina partono «addormentate» (tele
    // senza pixel) e si svegliano solo vicino allo schermo: un PDF di 200 pagine non deve occupare 200 tele.
    this.pageUrl = pageUrl;
    this.awake = !block.bg;
    if (block.bg) {
      this.el.classList.add('has-page');
      this.pageBox = document.createElement('div');
      this.pageBox.className = 'ink-pagebox';
      this.pageBox.dataset.state = 'loading';
      this.el.prepend(this.pageBox);
    }
    // 2026.11.4: cornice che scorre di lato quando la tavola è ingrandita (pizzico); zoom 1 = larghezza della pagina.
    // wide > 1 solo nella vista panoramica: la tavola è più larga della pagina (più spazio a destra), con l'inchiostro
    // alla stessa grandezza. Tornando alla pagina, fitToPage() la fa rientrare nel riquadro.
    this.zoom = 1; this.wide = 1;
    this.frame = document.createElement('div');
    this.frame.className = 'ink-frame';
    this.pan = document.createElement('div');
    this.pan.className = 'ink-pan';
    this.pan.append(this.el);
    this.frame.append(this.pan);
    this.zoomChip = document.createElement('button');
    this.zoomChip.type = 'button';
    this.zoomChip.className = 'ink-zoom-chip';
    this.zoomChip.hidden = true;
    this.zoomChip.addEventListener('click', (e) => { e.stopPropagation(); this.setZoom(1); });
    this.frame.prepend(this.zoomChip); // appiccicoso in alto: si vede anche con la tavola ingrandita

    this.abortStroke = () => {};
    this.liveTok = 0;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.frame);
    this.bind();
  }

  setPaper(p) { this.el.dataset.paper = p; this.redraw(); }

  // Carta (quadretti, righe, puntini) disegnata sulla tela, nelle stesse coordinate dell'inchiostro (2026.11.6). Come
  // sfondo CSS il quadretto era una piastrella di 12,8 px che il browser arrotonda al pixel: le righe scivolavano rispetto
  // all'inchiostro e, ingrandendo, sembravano spostarsi invece di ingrandirsi (utente: «quando zoommo non deve spostarsi
  // la griglia sfondo, ma ingrandirsi a sua volta»). Sulla pagina di un PDF non si disegna.
  drawPaper(ctx) {
    const kind = this.el.dataset.paper;
    if (kind !== 'grid' && kind !== 'lines' && kind !== 'dots') return;
    const k = this.scale, w = this.win;
    if (!w) return;
    const cs = getComputedStyle(this.el);
    const color = (kind === 'grid' ? cs.getPropertyValue('--grid') : cs.getPropertyValue('--grid-strong')).trim() || 'rgba(54, 87, 232, 0.11)';
    const top = Math.max(w.y0, this.block.bg ? W * this.block.bg.ph / this.block.bg.pw * k : 0);
    const sq = STEP * k;
    // righe nitide: posizione e spessore sui pixel veri della tela
    const dpr = this.canvas.width / Math.max(1, w.x1 - w.x0), lw = Math.max(1, Math.round(dpr)) / dpr, px = (v) => Math.round(v * dpr) / dpr;
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    if (kind === 'grid') {
      for (let i = Math.floor(w.x0 / sq); i * sq < w.x1; i++) ctx.rect(px(i * sq), top, lw, w.y1 - top);
      for (let i = Math.ceil(top / sq); i * sq < w.y1; i++) ctx.rect(w.x0, px(i * sq), w.x1 - w.x0, lw);
    } else if (kind === 'lines') {
      const g = sq * 1.4;
      for (let i = Math.ceil(top / g); i * g < w.y1; i++) ctx.rect(w.x0, px(i * g), w.x1 - w.x0, lw);
    } else {
      for (let y = Math.floor(top / sq) * sq + sq / 2; y < w.y1; y += sq) for (let x = Math.floor(w.x0 / sq) * sq + sq / 2; x < w.x1; x += sq) { ctx.moveTo(x + 1.2, y); ctx.arc(x, y, 1.2, 0, Math.PI * 2); }
    }
    ctx.fill();
    ctx.restore();
  }

  resize() {
    const base = this.pan.clientWidth;
    if (!base) return;
    this.scale = Math.round(base * this.zoom) / (W * this.wide);
    // extentW (unità): nella vista panoramica la tavola si allunga anche a destra (pagine infinite, 2026.11.6)
    const cssW = this.extentW ? Math.round(this.extentW * this.scale) : Math.round(base * this.zoom);
    this.el.style.width = this.zoom === 1 && !this.extentW ? '' : cssW + 'px';
    const cssH = this.block.h * this.scale;
    this.cssW = cssW; this.cssH = cssH;
    this.listenScroll();
    this.el.style.height = cssH + 'px';
    this.el.style.setProperty('--sq', STEP * this.scale + 'px');
    if (this.block.bg) {
      this.watch();
      this.pageBox.style.width = W * this.scale + 'px';
      this.pageBox.style.height = W * this.block.bg.ph / this.block.bg.pw * this.scale + 'px';
      if (!this.awake) {
        for (const c of [this.canvas, this.pred, this.live]) { c.width = 0; c.height = 0; c.style.width = cssW + 'px'; c.style.height = cssH + 'px'; }
        return;
      }
      this.drawPage();
    }
    this.win = null;
    this.place();
  }

  // --- tele a finestra (2026.11.6) --------------------------------------------------------------------------
  // Safari su iPad rifiuta le tele oltre ~16,7 milioni di pixel. Se la tavola intera ci sta, le tre tele la coprono tutta
  // (come prima). Se no (tavola ingrandita, pagine infinite) coprono solo la parte visibile più mezzo schermo per lato e
  // si spostano quando si scorre: densità piena a ogni grandezza. Le tele hanno la trasformazione spostata di (ox, oy),
  // così tutto il resto del codice disegna nelle coordinate della tavola senza saperlo.
  place() {
    if (!this.cssW || (this.block.bg && !this.awake)) return;
    const dmax = Math.min(window.devicePixelRatio || 1, 2.5);
    let x0 = 0, y0 = 0, w = this.cssW, h = this.cssH;
    if (w * h * dmax * dmax > 16e6) {
      const v = this.visible();
      const mx = Math.max(240, v.w * 0.5), my = Math.max(240, v.h * 0.5);
      x0 = Math.max(0, Math.floor(v.x - mx)); y0 = Math.max(0, Math.floor(v.y - my));
      w = Math.min(this.cssW - x0, Math.ceil(v.w + 2 * mx)); h = Math.min(this.cssH - y0, Math.ceil(v.h + 2 * my));
    }
    const dpr = Math.min(dmax, Math.sqrt(16e6 / Math.max(1, w * h)));
    this.win = { x0, y0, x1: x0 + w, y1: y0 + h, full: x0 === 0 && y0 === 0 && w === this.cssW && h === this.cssH };
    for (const [c, ctx] of [[this.canvas, this.ctx], [this.pred, this.pctx], [this.live, this.lctx]]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      Object.assign(c.style, { left: x0 + 'px', top: y0 + 'px', width: w + 'px', height: h + 'px' });
      ctx.setTransform(dpr, 0, 0, dpr, -x0 * dpr, -y0 * dpr);
    }
    this.dirty = null;
    this.redraw();
    this.placeSel?.();
  }
  // parte della tavola che si vede, in pixel della tavola
  visible() {
    const r = this.el.getBoundingClientRect();
    let L = 0, T = 0, R = innerWidth, B = innerHeight;
    for (const s of [this.pan, this.scrollers().y]) if (s) { const q = s.getBoundingClientRect(); L = Math.max(L, q.left); T = Math.max(T, q.top); R = Math.min(R, q.right); B = Math.min(B, q.bottom); }
    return { x: L - r.left, y: T - r.top, w: Math.max(0, R - L), h: Math.max(0, B - T) };
  }
  listenScroll() {
    const els = [this.pan, this.scrollers().y].filter(Boolean);
    if (this.scrollEls && els.length === this.scrollEls.length && els.every((e, i) => e === this.scrollEls[i])) return;
    for (const e of this.scrollEls || []) e.removeEventListener('scroll', this.onScroll);
    this.onScroll ||= () => {
      if (this.scrollRaf) return;
      this.scrollRaf = requestAnimationFrame(() => {
        this.scrollRaf = 0;
        if (this.busy) return; // mai mentre la penna scrive (BUG-006): ci si pensa a tratto finito
        this.growIfNear();
        const v = this.visible(), w = this.win;
        if (w && !w.full && (v.x < w.x0 || v.y < w.y0 || v.x + v.w > w.x1 || v.y + v.h > w.y1)) this.place();
      });
    };
    for (const e of els) e.addEventListener('scroll', this.onScroll, { passive: true });
    this.scrollEls = els;
  }
  // Pagine infinite nella vista panoramica: quando la parte visibile arriva a meno di mezzo schermo dal fondo o dal bordo
  // destro, la tavola si allunga di uno schermo. «Riduci» la riporta nella pagina (fitToPage).
  growIfNear() {
    if (!this.infinite || this.busy || !this.cssW) return false;
    const v = this.visible(), k = this.scale;
    // si allunga se la tavola scorre già in quel verso e se ne vede la fine, oppure se l'inchiostro arriva vicino al bordo
    // (a 100 % la tavola è larga quanto lo schermo: senza la seconda condizione crescerebbe a destra a ogni scorrimento)
    let ix = 0, iy = 0;
    for (const st of this.block.strokes) { const b = strokeBox(st); if (b[2] > ix) ix = b[2]; if (b[3] > iy) iy = b[3]; }
    const nearR = this.cssW - v.w * 0.5, nearB = this.cssH - v.h * 0.5;
    let grow = false;
    if (v.h && ((this.cssH > v.h + 2 && v.y + v.h > nearB) || iy * k > nearB)) { this.block.h += Math.ceil(v.h / k / 50) * 50; grow = true; }
    if (v.w && ((this.cssW > v.w + 2 && v.x + v.w > nearR) || ix * k > nearR)) { this.extentW = (this.extentW || Math.round(this.cssW / k)) + Math.ceil(v.w / k / 50) * 50; grow = true; }
    if (grow) this.resize();
    return grow;
  }

  // --- pagina PDF di sfondo (2026.11.6) -------------------------------------------------------------------
  // Osserva quando la tavola si avvicina allo schermo, dentro il contenitore che scorre (l'editor o la vista panoramica)
  watch() {
    const root = this.frame.closest('.ed-scroll, .pano-scroll');
    if (!root || root === this.ioRoot) return;
    this.io?.disconnect();
    this.ioRoot = root;
    this.io = new IntersectionObserver((es) => {
      const e = es[es.length - 1];
      this.setAwake(e.isIntersecting || !this.ioRoot.contains(this.frame));
    }, { root, rootMargin: '100% 0px' });
    this.io.observe(this.frame);
  }
  setAwake(on) {
    if (on === this.awake) return;
    this.awake = on;
    if (!on) {
      this.cancelPage?.(); this.cancelPage = null; clearTimeout(this.pageTimer);
      this.pageBox.querySelector('canvas')?.remove();
      this.pageBox.dataset.state = 'loading';
      this.pagePx = 0;
    }
    this.resize();
  }
  // Ridisegna la pagina se manca o se la densità non basta più (dopo il pizzico); prima la vecchia resta, allargata
  drawPage() {
    const cssW = W * this.scale;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const want = cssW * dpr;
    if (this.pagePx && want <= this.pagePx * 1.15 && want >= this.pagePx * 0.6) return;
    clearTimeout(this.pageTimer);
    this.pageTimer = setTimeout(() => {
      this.cancelPage?.();
      const target = want;
      this.cancelPage = renderPage(this.block.bg, this.pageUrl(this.block.bg.att), cssW, dpr, (c, err) => {
        this.cancelPage = null;
        if (!this.awake) return;
        if (!c) { this.pageBox.dataset.state = 'error'; this.pageBox.title = err?.message || T('Pagina non disponibile'); this.pageBox.dataset.msg = err?.message || T('Pagina non disponibile'); return; }
        this.pageBox.querySelector('canvas')?.remove();
        this.pageBox.append(c);
        this.pageBox.dataset.state = 'ok';
        this.pagePx = target;
      });
    }, this.pagePx ? 250 : 0);
  }

  view(s) {
    // l'inchiostro scuro diventa chiaro in tema scuro, gli altri colori restano (non sulle pagine PDF, che restano bianche)
    let v = s;
    if (s.c === '#1c2333' && !this.block.bg && document.documentElement.classList.contains('is-dark')) v = { ...s, c: '#e6e9f2' };
    if (inkView.only && !inkView.only.has(s.c)) v = { ...v, _fade: true };
    return v;
  }

  redraw() {
    if (!this.scale || !this.awake) return;
    const ctx = this.ctx;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); ctx.restore();
    this.drawPaper(ctx);
    const w = this.win, k = this.scale;
    for (const s of this.block.strokes) {
      if (w && !w.full) { const b = strokeBox(s); if (b[2] * k < w.x0 || b[0] * k > w.x1 || b[3] * k < w.y0 || b[1] * k > w.y1) continue; }
      drawStroke(ctx, this.view(s), k);
    }
  }

  // --- zoom (pizzico) --------------------------------------------------------------------------------------
  // fx, fy: punto dello schermo che resta fermo; ux, uy (unità): il punto della tavola da mettere lì (dopo il pizzico
  // è quello che era sotto le dita all'inizio). Senza fx/fy (pulsanti −/+, chip) resta fermo il centro della parte visibile.
  setZoom(z, fx, fy, ux, uy) {
    z = Math.max(1, Math.min(4, Math.round(z * 100) / 100));
    if (Math.abs(z - 1) < 0.06) z = 1;
    const sc = this.scrollers();
    this.el.style.transform = '';
    const r = this.el.getBoundingClientRect();
    if (fx == null) {
      const v = (sc.y || document.documentElement).getBoundingClientRect(), h = this.pan.getBoundingClientRect();
      fx = (Math.max(r.left, h.left) + Math.min(r.right, h.right)) / 2;
      fy = (Math.max(r.top, v.top, 0) + Math.min(r.bottom, v.bottom, innerHeight)) / 2;
    }
    if (ux == null) { ux = (fx - r.left) / this.scale; uy = (fy - r.top) / this.scale; }
    this.zoom = z;
    this.resize();
    this.zoomChip.hidden = z === 1;
    this.zoomChip.textContent = T('{p}% · tocca per 100%', { p: Math.round(z * 100) });
    this.frame.classList.toggle('zoomed', z > 1);
    const r2 = this.el.getBoundingClientRect();
    if (sc.x) sc.x.scrollLeft += r2.left + ux * this.scale - fx;
    if (sc.y) sc.y.scrollTop += r2.top + uy * this.scale - fy;
    this.onZoom?.(z);
  }
  // Di lato scorre sempre la cornice della tavola (.ink-pan, overflow-x: la tavola ingrandita è più larga di lei), anche
  // nella vista panoramica: prima lì si faceva scorrere .pano-scroll, che di lato non ha niente da scorrere (2026.11.6).
  scrollers() {
    const pano = this.frame.closest('.pano-scroll');
    return { x: this.pan, y: pano || this.el.closest('.ed-scroll') };
  }
  // Riporta nella pagina: se l'inchiostro esce a destra (scritto nella vista panoramica) lo rimpicciolisce tutto
  // insieme perché entri nella larghezza, e allunga il riquadro verso il basso se serve. Gli altri blocchi non si toccano.
  fitToPage() {
    let maxX = 0, maxY = 0;
    for (const st of this.block.strokes) for (let i = 0; i < st.p.length; i += 3) { maxX = Math.max(maxX, st.p[i] + (st.t === 'txt' ? (st.s?.length || 1) * st.w * 0.5 : 0)); maxY = Math.max(maxY, st.p[i + 1]); }
    const h0 = this.block.h;
    const k = maxX > W - 8 ? (W - 16) / maxX : 1;
    const before = k < 1 ? snapshot(this.block.strokes) : null;
    if (k < 1) for (const st of this.block.strokes) { forgetInk(st); for (let i = 0; i < st.p.length; i += 3) { st.p[i] = Math.round(st.p[i] * k * 10) / 10; st.p[i + 1] = Math.round(st.p[i + 1] * k * 10) / 10; } st.w = Math.round(st.w * k * 100) / 100; }
    const need = Math.ceil((maxY * k + 120) / 50) * 50;
    if (need > this.block.h) this.block.h = need;
    const changed = k < 1 || this.block.h !== h0;
    if (changed) { this.undoStack.push({ type: 'fit', before, after: k < 1 ? snapshot(this.block.strokes) : null, h0, h1: this.block.h }); this.redoStack = []; }
    return { changed, k, h0 };
  }

  grow(units) {
    if (!Number.isFinite(units) || !Number.isFinite(this.block.h)) units = 0, this.block.h = Number.isFinite(this.block.h) ? this.block.h : 700;
    this.block.h += units;
    this.resize();
    this.onChange();
  }

  // r: riquadro della tela, letto una volta per evento (i campioni raggruppati sono fino a 4 per evento)
  point(e, r = this.el.getBoundingClientRect()) {
    const pr = e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5;
    return [(e.clientX - r.left) / this.scale, (e.clientY - r.top) / this.scale, Math.round(pr * 100)];
  }

  bind() {
    const live = this.live;
    let cur = null, pid = null, erased = null, shape = null, hold = null, snapped = null, lasso = null;

    const canDraw = (e) => !(inkPrefs.penOnly && e.pointerType === 'touch');
    const stopHold = () => { clearTimeout(hold); hold = null; };

    // Safari: se scriviamo con la penna blocchiamo lo scorrimento solo per lei
    // touch-action: none sulla tavola, così Safari non trattiene la penna per capire se è uno scorrimento.
    let fy = null, fv = 0, fvx = 0, ft = 0, fling = 0;
    let fx = null;
    // Gesti: tocco con 2 dita = annulla, 3 dita = ripristina
    let tap = null;
    const fingers = (e) => [...e.touches].filter((t) => t.touchType !== 'stylus');
    let penType = null, lastPen = 0, downAt = 0;
    const penBusy = (t) => penType === 'pen' || t - lastPen < 700;
    const palmish = (f) => f.length === 1 && f.some((t) => (t.radiusX || 0) > 60 || (t.radiusY || 0) > 60);
    live.addEventListener('touchstart', (e) => {
      const f = fingers(e);
      if (penBusy(e.timeStamp) || palmish(f)) { tap = null; if (f.length) e.preventDefault(); return; } // palmo appoggiato mentre si scrive
      if (f.length === 2 && !pinch) {
        const [a, b] = f;
        const r = this.el.getBoundingClientRect(), sc = this.scrollers();
        const cx = (a.clientX + b.clientX) / 2, cy = (a.clientY + b.clientY) / 2;
        cancelAnimationFrame(fling);
        pinch = { d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, z0: this.zoom, cx, cy, mx: cx, my: cy, ox: cx - r.left, oy: cy - r.top, ux: (cx - r.left) / this.scale, uy: (cy - r.top) / this.scale, r: 1, active: null, sx: sc.x?.scrollLeft || 0, sy: sc.y?.scrollTop || 0, sc };
      }
      if (f.length >= 2) {
        if (!tap) tap = { t0: e.timeStamp, max: 0, pts: new Map(), moved: false };
        tap.max = Math.max(tap.max, f.length);
        for (const t of f) if (!tap.pts.has(t.identifier)) tap.pts.set(t.identifier, [t.clientX, t.clientY]);
        if ((cur || erased || shape) && penType === 'touch') this.abortStroke();
        e.preventDefault();
        return;
      }
      if (f.length === 1 && !tap) tap = { t0: e.timeStamp, max: 1, pts: new Map([[f[0].identifier, [f[0].clientX, f[0].clientY]]]), moved: false };
    }, { passive: false });
    // Due dita: pizzico e trascinamento (2026.11.6). Durante il gesto il trascinamento fa scorrere davvero (costa poco)
    // e lo zoom è solo una trasformazione CSS (niente ridisegni); alla fine la tavola si ridisegna nitida con il punto
    // che era sotto le dita di nuovo sotto le dita. Trascinare con due dita vale solo a tavola ingrandita: a 100 % due
    // dita verso sinistra/destra restano annulla/ripristina (app.js), e il gesto usato qui lo dice con inkTouch.used.
    let pinch = null;
    live.addEventListener('touchmove', (e) => {
      const f = fingers(e);
      if (pinch && f.length === 2 && !penBusy(e.timeStamp)) {
        const d = Math.hypot(f[0].clientX - f[1].clientX, f[0].clientY - f[1].clientY);
        const r = Math.max(1 / pinch.z0, Math.min(4 / pinch.z0, d / pinch.d0));
        const mx = (f[0].clientX + f[1].clientX) / 2, my = (f[0].clientY + f[1].clientY) / 2;
        const tx = mx - pinch.cx, ty = my - pinch.cy;
        if (pinch.active !== 'zoom' && Math.abs(r - 1) > 0.08) pinch.active = 'zoom';
        else if (!pinch.active && pinch.z0 > 1.01 && Math.hypot(tx, ty) > 12) pinch.active = 'pan';
        if (pinch.active) {
          e.preventDefault();
          inkTouch.used = true;
          pinch.r = pinch.active === 'zoom' ? r : 1; pinch.mx = mx; pinch.my = my;
          const { sc } = pinch;
          if (sc.x) sc.x.scrollLeft = pinch.sx - tx;
          if (sc.y) sc.y.scrollTop = pinch.sy - ty;
          if (pinch.active === 'zoom') {
            this.el.style.transformOrigin = `${pinch.ox}px ${pinch.oy}px`;
            this.el.style.transform = `scale(${r})`;
          }
        }
      }
    }, { passive: false });
    const pinchEnd = (e) => {
      if (!pinch || fingers(e).length >= 2) return;
      const p = pinch; pinch = null;
      if (p.active !== 'zoom') { this.el.style.transform = ''; return; }
      this.setZoom(p.z0 * p.r, p.mx, p.my, p.ux, p.uy);
    };
    live.addEventListener('touchend', pinchEnd);
    live.addEventListener('touchcancel', pinchEnd);
    live.addEventListener('touchmove', (e) => {
      if (!tap) return;
      for (const t of fingers(e)) { const a = tap.pts.get(t.identifier); if (a && Math.hypot(t.clientX - a[0], t.clientY - a[1]) > 14) tap.moved = true; }
    }, { passive: true });
    const tapEnd = (e) => {
      if (!tap || e.touches.length) return;
      const g = tap; tap = null;
      if (g.moved || g.max < 2 || e.timeStamp - g.t0 > 350) return;
      if (g.max === 2) { if (this.undo()) this.onGesture?.('undo'); else this.onGesture?.('nothing'); }
      else if (g.max >= 3) { if (this.redo()) this.onGesture?.('redo'); else this.onGesture?.('nothing'); }
    };
    void tapEnd; // gesti gestiti a livello di foglio (app.js)
    live.addEventListener('touchcancel', () => { tap = null; });

    live.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      if (!t) return;
      if (t.touchType === 'stylus' || !inkPrefs.penOnly) { e.preventDefault(); return; }
      if (e.touches.length > 1) { fy = null; return; }
      cancelAnimationFrame(fling);
      fy = t.clientY; fx = t.clientX; fv = 0; fvx = 0; ft = e.timeStamp;
      e.preventDefault();
    }, { passive: false });
    // un dito (con «Solo Apple Pencil»): scorre su e giù e, a tavola ingrandita, di lato, con l'inerzia nei due versi
    live.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      if (!t) return;
      if (t.touchType === 'stylus' || !inkPrefs.penOnly) { e.preventDefault(); return; }
      if (fy === null || fingers(e).length > 1) { fy = null; return; }
      e.preventDefault();
      const dy = t.clientY - fy, dx = t.clientX - fx, dt = Math.max(1, e.timeStamp - ft);
      const sc = this.scrollers();
      if (sc.y) sc.y.scrollTop -= dy;
      if (sc.x) sc.x.scrollLeft -= dx;
      fv = 0.8 * (dy / dt) + 0.2 * fv; fvx = 0.8 * (dx / dt) + 0.2 * fvx; fy = t.clientY; fx = t.clientX; ft = e.timeStamp;
    }, { passive: false });
    live.addEventListener('touchend', () => {
      if (fy === null) return;
      fy = null;
      const sc = this.scrollers();
      let v = fv * 16, vx = fvx * 16; // px per fotogramma
      const step = () => {
        if (Math.abs(v) < 0.3 && Math.abs(vx) < 0.3) return;
        if (sc.y) sc.y.scrollTop -= v;
        if (sc.x) sc.x.scrollLeft -= vx;
        v *= 0.95; vx *= 0.95; fling = requestAnimationFrame(step);
      };
      if (Math.abs(v) > 0.5 || Math.abs(vx) > 0.5) fling = requestAnimationFrame(step);
    });

    let cap = null, holdPt = null, holdSince = 0;
    const checkHold = () => {
      hold = null;
      const left = HOLD_MS - (performance.now() - holdSince);
      if (left > 8) { hold = setTimeout(checkHold, left); return; }
      trySnap();
    };
    // la punta è uscita dal cerchietto: da qui riparte il conto della «penna ferma»
    const armHold = (pt) => { holdPt = pt; holdSince = performance.now(); if (!hold) hold = setTimeout(checkHold, HOLD_MS); };
    const trySnap = () => {
      hold = null;
      if (!cur || snapped) return;
      const r = recognize({ ...cur, p: cur.p.concat(cap ? cap.tail() : []) }, this.scale);
      if (!r) return;
      snapped = r;
      this.resetLiveStyle();
      this.drawLive(r.strokes);
      this.onSnap?.(r.name);
    };

    live.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'pen' && !inkPrefs.penOnly) {
        inkPrefs.penOnly = true; savePrefs();
        document.dispatchEvent(new CustomEvent('ink-pen-detected'));
      }
      this.onActivate?.(this);
      if (pid !== null && e.pointerType === 'touch' && e.pointerId !== pid) { if (penType === 'touch') this.abortStroke(); return; }
      if (!canDraw(e) || pid !== null) return;
      if (e.button > 0) return;
      e.preventDefault();
      cancelAnimationFrame(fling); // se la pagina scorre ancora per l'inerzia, il tratto non deve scivolare
      pid = e.pointerId; this.busy = true;
      penType = e.pointerType;
      try { live.setPointerCapture(pid); } catch {}
      const pt = this.point(e);
      if (inkPrefs.tool === 'eraser') { erased = []; this.eraseAt(pt, erased); this.onStrokeStart?.(); return; }
      if (inkPrefs.tool === 'lasso') { if (this.sel) this.deselect(); lasso = [pt[0], pt[1]]; this.drawLasso(lasso); this.onStrokeStart?.(); return; }
      if (inkPrefs.tool === 'shape') {
        downAt = e.timeStamp;
        const a = snapPt(pt, false);
        shape = { a, b: a, base: { c: inkPrefs.color, w: inkPrefs.width } };
        this.drawLive(buildShape(inkPrefs.shape, a, a, shape.base));
        this.onStrokeStart?.();
        return;
      }
      snapped = null;
      downAt = e.timeStamp;
      cur = { t: inkPrefs.tool, c: inkPrefs.tool === 'hl' ? hlColor(inkPrefs.color) : inkPrefs.color, w: inkPrefs.tool === 'hl' ? Math.max(14, inkPrefs.width * 5) : inkPrefs.width, p: [] };
      cap = new Capture(cur, this.scale);
      cap.add(pt[0], pt[1], pt[2], e.timeStamp);
      holdPt = null; stopHold(); armHold(pt);
      this.beginLive(cur);
      this.onStrokeStart?.();
    });

    live.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      e.preventDefault();
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      const r = this.el.getBoundingClientRect();
      const R = HOLD_R_PX / this.scale;
      for (const ev of (evs.length ? evs : [e])) {
        const pt = this.point(ev, r);
        if (erased) { this.eraseAt(pt, erased); continue; }
        if (lasso) { lasso.push(pt[0], pt[1]); continue; }
        if (shape) { shape.b = snapPt(pt); continue; }
        if (!cur) continue;
        if (snapped) {
          // dopo l'aggancio di una linea, la penna sposta l'estremo finale
          if (snapped.line) { const end = snapPt(snapAngle(snapped.start, pt)); snapped.strokes[0].p = flat([snapped.start, end]); }
          continue;
        }
        cap.add(pt[0], pt[1], pt[2], ev.timeStamp || e.timeStamp);
        if (!holdPt || Math.hypot(pt[0] - holdPt[0], pt[1] - holdPt[1]) > R) armHold(pt);
      }
      if (lasso) this.drawLasso(lasso);
      else if (shape) this.drawLive(buildShape(inkPrefs.shape, shape.a, shape.b, shape.base));
      else if (snapped) this.drawLive(snapped.strokes);
      // niente punti previsti (getPredictedEvents): in HTTPS ci sono, ma fanno tremare la punta del tratto
      else if (cur) this.drawInk(cur, cap.tail());
    });

    this.abortStroke = () => {
      stopHold();
      if (erased && erased.length) { this.undoStack.push({ type: 'erase', strokes: erased }); this.redoStack = []; this.onChange(); }
      cur = null; cap = null; shape = null; snapped = null; erased = null; lasso = null; pid = null; penType = null; this.busy = false;
      this.clearLive();
      this.onStrokeEnd?.();
    };

    const end = (e) => {
      if (e.pointerId !== pid) return;
      if (penType === 'pen') lastPen = e.timeStamp;
      pid = null; penType = null; this.busy = false;
      this.afterStroke();
      stopHold();
      queueMicrotask(() => this.onStrokeEnd?.());
      if (erased) {
        if (erased.length) { this.undoStack.push({ type: 'erase', strokes: erased }); this.redoStack = []; this.onChange(); }
        erased = null;
        return;
      }
      if (lasso) {
        const poly = lasso; lasso = null;
        this.clearLive();
        const picked = poly.length >= 6 ? this.inLasso(poly) : null;
        if (picked && picked.length) this.select(picked);
        else { const hit = this.shapeAt(poly[0], poly[1]); hit ? this.select(hit) : this.deselect(); }
        return;
      }
      if (cur && cap && !snapped) cap.finish(); // gli ultimi punti, fino a dove la punta si è alzata
      cap = null;
      // tocco breve senza spostamento: seleziona la forma sotto la punta (o chiude la selezione)
      const quick = e.timeStamp - downAt < 320;
      const tapAt = cur && !snapped && quick && tiny(cur.p) ? [cur.p[0], cur.p[1]] : shape && quick && Math.hypot(shape.b[0] - shape.a[0], shape.b[1] - shape.a[1]) < 6 ? shape.a : null;
      if (tapAt) {
        const hit = this.shapeAt(tapAt[0], tapAt[1]);
        if (hit || this.sel) { cur = null; shape = null; snapped = null; this.clearLive(); hit ? this.select(hit) : this.deselect(); return; }
      }
      if (this.sel) this.deselect();
      let added = [];
      if (shape) {
        const { a, b } = shape;
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 6 && inkPrefs.shape !== 'axes') { shape = null; this.clearLive(); return; }
        added = buildShape(inkPrefs.shape, a, b, shape.base);
        shape = null;
      } else if (cur) {
        added = snapped ? snapped.strokes : [cur];
        cur = null; snapped = null;
      }
      if (!added.length) { this.clearLive(); return; }
      this.commit(added);
      // il tratto è già sulla tela di sotto: la tela del tratto in corso si svuota al fotogramma dopo, così non c'è
      // un fotogramma senza inchiostro (le tele «desynchronized» si mostrano per conto loro)
      this.clearLiveSoon();
    };
    live.addEventListener('pointerup', end);
    live.addEventListener('pointercancel', end);
  }

  // a penna ferma: tele a finestra al posto giusto e, nella panoramica, altro spazio se si è scritto vicino al bordo
  afterStroke() {
    clearTimeout(this.afterT);
    this.afterT = setTimeout(() => {
      if (this.busy) return this.afterStroke();
      if (this.growIfNear()) return;
      const v = this.visible(), w = this.win;
      if (w && !w.full && (v.x < w.x0 || v.y < w.y0 || v.x + v.w > w.x1 || v.y + v.h > w.y1)) this.place();
    }, 900);
  }

  commit(added) {
    // le forme fatte di più tratti (frecce, piano cartesiano) restano un gruppo unico
    if (added.some((x) => x.g || x.t === 'txt')) { const gid = Math.random().toString(36).slice(2, 9); for (const x of added) x.gid ||= gid; }
    this.block.strokes.push(...added);
    this.undoStack.push({ type: 'add', strokes: added });
    this.redoStack = [];
    for (const s of added) drawStroke(this.ctx, this.view(s), this.scale);
    let maxY = 0;
    for (const s of added) for (let i = 1; i < s.p.length; i += 3) maxY = Math.max(maxY, s.p[i]);
    if (maxY > this.block.h - 120) this.grow(400); else this.onChange();
  }

  wipe(ctx, c) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height); ctx.restore(); }

  resetLiveStyle() {
    this.live.style.opacity = ''; this.live.style.mixBlendMode = '';
    this.pred.style.opacity = ''; this.pred.style.mixBlendMode = '';
    this.wipe(this.lctx, this.live); this.wipe(this.pctx, this.pred);
  }

  clearLive() { this.resetLiveStyle(); }
  clearLiveSoon() { const tok = ++this.liveTok; requestAnimationFrame(() => { if (tok === this.liveTok) this.clearLive(); }); }

  // Forme e anteprime: ridisegno completo (sono pochi punti)
  drawLive(strokes) {
    this.liveTok++;
    this.wipe(this.lctx, this.live); this.wipe(this.pctx, this.pred);
    for (const s of strokes) drawStroke(this.lctx, this.view(s), this.scale);
  }

  // Tratto a mano libera mentre si scrive (2026.11.6), con le stesse funzioni del tratto finito. La parte già fissata e
  // lontana dalla punta va sulla tela «live» una volta sola, a pezzi di LIVE_CHUNK punti; il resto (gli ultimi punti,
  // quelli in attesa e i campioni grezzi fino alla punta) si ridisegna a ogni evento sulla tela «pred», cancellando solo
  // il riquadro disegnato la volta prima: il lavoro per evento non cresce con la lunghezza del tratto (BUG-006).
  beginLive(s) {
    this.liveTok++;
    this.resetLiveStyle();
    this.liveColor = this.view(s).c;
    this.frozen = 0; this.dirty = null;
    if (s.t === 'hl') {
      // evidenziatore: si disegna pieno e la trasparenza la fa il livello, così i pezzi non si sommano
      for (const c of [this.live, this.pred]) { c.style.opacity = '0.32'; c.style.mixBlendMode = 'multiply'; }
    }
    this.drawInk(s, []);
  }

  drawInk(s, tail) {
    const k = this.scale, n = s.p.length / 3;
    const rOf = (pp) => (i) => inkR(s, pp[i * 3 + 2]);
    // l'evidenziatore resta tutto su una tela: due livelli trasparenti sovrapposti si vedrebbero
    if (s.t !== 'hl' && n - this.frozen > LIVE_CHUNK + 3) {
      const b = this.frozen + LIVE_CHUNK, path = new Path2D(), c = this.lctx;
      inkRibbon(path, s.p, this.frozen, b, rOf(s.p));
      c.save(); c.fillStyle = this.liveColor; c.scale(k, k); c.fill(path); c.restore();
      this.frozen = b;
    }
    const from = Math.max(0, this.frozen - 1); // un punto prima, per la tangente
    const act = tail.length ? s.p.slice(from * 3).concat(tail) : s.p.slice(from * 3);
    const m = act.length / 3, a = this.frozen - from;
    const ctx = this.pctx;
    if (this.dirty) { const d = this.dirty; ctx.clearRect(d[0], d[1], d[2], d[3]); }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, rm = 0;
    for (let i = a; i < m; i++) {
      const x = act[i * 3], y = act[i * 3 + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      rm = Math.max(rm, inkR(s, act[i * 3 + 2]));
    }
    const path = new Path2D();
    ctx.save(); ctx.scale(k, k);
    if (s.t === 'hl') { inkCurve(path, act, a, m - 1); ctx.strokeStyle = this.liveColor; ctx.lineWidth = s.w; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(path); }
    else { inkRibbon(path, act, a, m - 1, rOf(act)); ctx.fillStyle = this.liveColor; ctx.fill(path); }
    ctx.restore();
    const pad = rm + 3 / k;
    this.dirty = [(x0 - pad) * k, (y0 - pad) * k, (x1 - x0 + 2 * pad) * k, (y1 - y0 + 2 * pad) * k];
  }

  eraseAt([x, y], erased) {
    const r = 10;
    const keep = [];
    let changed = false;
    this.block.strokes.forEach((s, index) => {
      if (hits(s, x, y, r)) { erased.push({ stroke: s, index }); changed = true; }
      else keep.push(s);
    });
    if (changed) { this.block.strokes = keep; this.redraw(); }
  }

  undo() {
    const a = this.undoStack.pop();
    if (!a) return false;
    if (a.type === 'add') { const gone = new Set(a.strokes); this.block.strokes = this.block.strokes.filter((s) => !gone.has(s)); }
    else if (a.type === 'erase') {
      // reinserisci nell'ordine originale
      const all = [...this.block.strokes];
      for (const { stroke, index } of [...a.strokes].sort((p, q) => p.index - q.index)) all.splice(Math.min(index, all.length), 0, stroke);
      this.block.strokes = all;
    } else if (a.type === 'edit') applySnap(a.before);
    else if (a.type === 'fit') { if (a.before) applySnap(a.before); this.block.h = a.h0; this.resize(); }
    this.redoStack.push(a);
    if (this.sel) this.deselect();
    this.redraw(); this.onChange();
    return true;
  }

  redo() {
    const a = this.redoStack.pop();
    if (!a) return false;
    if (a.type === 'add') this.block.strokes.push(...a.strokes);
    else if (a.type === 'erase') { const gone = new Set(a.strokes.map((x) => x.stroke)); this.block.strokes = this.block.strokes.filter((s) => !gone.has(s)); }
    else if (a.type === 'edit') applySnap(a.after);
    else if (a.type === 'fit') { if (a.after) applySnap(a.after); this.block.h = a.h1; this.resize(); }
    this.undoStack.push(a);
    if (this.sel) this.deselect();
    this.redraw(); this.onChange();
    return true;
  }

  // --- lazo ------------------------------------------------------------------------
  drawLasso(poly) {
    this.liveTok++;
    const ctx = this.lctx, k = this.scale;
    this.wipe(ctx, this.live); this.wipe(this.pctx, this.pred);
    ctx.save();
    ctx.strokeStyle = getComputedStyle(this.el).getPropertyValue('--accent').trim() || '#3657e8';
    ctx.fillStyle = 'rgba(54, 87, 232, 0.07)';
    ctx.lineWidth = 1.6; ctx.setLineDash([6, 5]); ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(poly[0] * k, poly[1] * k);
    for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i] * k, poly[i + 1] * k);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // un tratto è dentro se lo è almeno metà dei suoi punti; i gruppi (forme composte) entrano interi
  inLasso(poly) {
    const inside = (x, y) => {
      let c = false;
      for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
        const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    const picked = new Set();
    for (const s of this.block.strokes) {
      let n = 0, tot = 0;
      for (let i = 0; i < s.p.length; i += 3) { tot++; if (inside(s.p[i], s.p[i + 1])) n++; }
      if (tot && n / tot >= 0.5) picked.add(s);
    }
    for (const s of [...picked]) if (s.gid) for (const o of this.block.strokes) if (o.gid === s.gid) picked.add(o);
    return this.block.strokes.filter((s) => picked.has(s));
  }

  // --- modifica delle forme -------------------------------------------------------
  shapeAt(x, y) {
    for (let i = this.block.strokes.length - 1; i >= 0; i--) {
      const s = this.block.strokes[i];
      if ((s.g || s.t === 'txt') && hits(s, x, y, 12)) return s.gid ? this.block.strokes.filter((o) => o.gid === s.gid) : [s];
    }
    return null;
  }

  bbox(strokes) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of strokes) for (let i = 0; i < s.p.length; i += 3) {
      const r = s.t === 'txt' ? s.w * 0.6 : s.w / 2;
      x0 = Math.min(x0, s.p[i] - r); y0 = Math.min(y0, s.p[i + 1] - r); x1 = Math.max(x1, s.p[i] + r); y1 = Math.max(y1, s.p[i + 1] + r);
    }
    return { x0, y0, x1, y1 };
  }

  select(strokes) {
    this.deselect(true);
    this.sel = { strokes };
    const box = document.createElement('div');
    box.className = 'sel-box';
    const handle = document.createElement('div');
    handle.className = 'sel-handle';
    handle.setAttribute('aria-label', T('Ridimensiona'));
    box.append(handle);
    const menu = document.createElement('div');
    menu.className = 'air-menu';
    menu.setAttribute('role', 'toolbar');
    menu.setAttribute('aria-label', T('Modifica forma'));
    const btn = (cls, label, html, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.setAttribute('aria-label', label); b.title = label; b.innerHTML = html; b.addEventListener('pointerdown', (e) => e.stopPropagation()); b.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); return b; };
    for (const c of SHAPE_COLORS) menu.append(btn('am-color', T('Colore'), `<span style="--c:${c === '#1c2333' ? 'var(--ink)' : c}"></span>`, () => this.editSel((s) => { s.c = s.t === 'hl' ? hlColor(c) : c; })));
    menu.append(Object.assign(document.createElement('i'), { className: 'am-sep' }));
    for (const w of [1.6, 3, 5.5]) menu.append(btn('am-width', T('Spessore'), `<span style="width:${w * 2 + 3}px;height:${w * 2 + 3}px"></span>`, () => this.editSel((s) => { if (s.t === 'hl') s.w = Math.max(14, w * 5); else if (s.t !== 'txt') s.w = w; })));
    menu.append(Object.assign(document.createElement('i'), { className: 'am-sep' }));
    menu.append(btn('am-act', T('Duplica'), '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>', () => this.duplicateSel()));
    menu.append(btn('am-act danger', T('Elimina'), '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>', () => this.deleteSel()));
    this.el.append(box, menu);
    this.sel.box = box; this.sel.menu = menu;
    this.placeSel();
    this.bindSel(box, handle);
    this.onGesture?.('selected');
  }

  placeSel() {
    const sel = this.sel; if (!sel) return;
    const b = this.bbox(sel.strokes), k = this.scale, pad = 8;
    Object.assign(sel.box.style, { left: (b.x0 * k - pad) + 'px', top: (b.y0 * k - pad) + 'px', width: ((b.x1 - b.x0) * k + pad * 2) + 'px', height: ((b.y1 - b.y0) * k + pad * 2) + 'px' });
    // menu sopra la forma, sotto se non c'è spazio; sempre dentro la tavola
    const mw = sel.menu.offsetWidth || 330, mh = sel.menu.offsetHeight || 48, W0 = this.el.clientWidth;
    let left = ((b.x0 + b.x1) / 2) * k - mw / 2;
    left = Math.max(6, Math.min(W0 - mw - 6, left));
    let top = b.y0 * k - pad - mh - 10;
    if (top < 6) top = b.y1 * k + pad + 10;
    Object.assign(sel.menu.style, { left: left + 'px', top: top + 'px' });
  }

  bindSel(box, handle) {
    let drag = null;
    const start = (e, mode) => {
      e.preventDefault(); e.stopPropagation();
      try { box.setPointerCapture(e.pointerId); } catch {}
      const b = this.bbox(this.sel.strokes);
      drag = { id: e.pointerId, mode, x: e.clientX, y: e.clientY, b, before: snapshot(this.sel.strokes), orig: this.sel.strokes.map((s) => s.p.slice()) };
      this.onStrokeStart?.();
    };
    handle.addEventListener('pointerdown', (e) => start(e, 'resize'));
    box.addEventListener('pointerdown', (e) => { if (e.target === box) start(e, 'move'); });
    box.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      e.preventDefault();
      const dx = (e.clientX - drag.x) / this.scale, dy = (e.clientY - drag.y) / this.scale;
      const { b } = drag;
      this.sel.strokes.forEach((s, j) => {
        const o = drag.orig[j], p = s.p;
        forgetInk(s);
        if (drag.mode === 'move') { for (let i = 0; i < p.length; i += 3) { p[i] = o[i] + dx; p[i + 1] = o[i + 1] + dy; } }
        else {
          // ridimensiona dall'angolo opposto (in alto a sinistra resta fermo)
          const sx = Math.max(0.1, (b.x1 - b.x0 + dx) / Math.max(1, b.x1 - b.x0));
          const sy = Math.max(0.1, (b.y1 - b.y0 + dy) / Math.max(1, b.y1 - b.y0));
          for (let i = 0; i < p.length; i += 3) { p[i] = b.x0 + (o[i] - b.x0) * sx; p[i + 1] = b.y0 + (o[i + 1] - b.y0) * sy; }
        }
      });
      this.redraw(); this.placeSel();
    });
    const stop = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const moved = Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 2;
      if (moved) { this.undoStack.push({ type: 'edit', before: drag.before, after: snapshot(this.sel.strokes) }); this.redoStack = []; this.onChange(); }
      drag = null;
      this.onStrokeEnd?.();
    };
    box.addEventListener('pointerup', stop);
    box.addEventListener('pointercancel', stop);
    box.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  }

  editSel(fn) {
    if (!this.sel) return;
    const before = snapshot(this.sel.strokes);
    this.sel.strokes.forEach(fn);
    this.undoStack.push({ type: 'edit', before, after: snapshot(this.sel.strokes) }); this.redoStack = [];
    this.redraw(); this.placeSel(); this.onChange();
  }

  duplicateSel() {
    if (!this.sel) return;
    const gid = Math.random().toString(36).slice(2, 9);
    const copy = this.sel.strokes.map((s) => ({ ...s, gid, p: s.p.map((v, i) => (i % 3 === 2 ? v : v + 25)) }));
    this.block.strokes.push(...copy);
    this.undoStack.push({ type: 'add', strokes: copy }); this.redoStack = [];
    this.redraw(); this.onChange();
    this.select(copy);
  }

  deleteSel() {
    if (!this.sel) return;
    const gone = new Set(this.sel.strokes);
    const erased = [];
    this.block.strokes.forEach((s, index) => { if (gone.has(s)) erased.push({ stroke: s, index }); });
    this.block.strokes = this.block.strokes.filter((s) => !gone.has(s));
    this.undoStack.push({ type: 'erase', strokes: erased }); this.redoStack = [];
    this.deselect(); this.redraw(); this.onChange();
  }

  deselect(silent) {
    if (!this.sel) return;
    this.sel.box.remove(); this.sel.menu.remove();
    this.sel = null;
  }

  // --- 2026-11-24 (live): tratti arrivati da un altro dispositivo o da un'altra persona ----------------------------
  // prev = l'elenco dei tratti prima dell'arrivo. Se sono stati solo aggiunti in fondo si disegnano solo quelli nuovi,
  // altrimenti si ridisegna la tavola. La chiama l'app a penna ferma (punto di sincronia di live.js).
  liveApply(prev, prevH) {
    if (prevH !== this.block.h) { this.resize(); return; }
    const now = this.block.strokes;
    if (this.sel && this.sel.strokes.some((s) => !now.includes(s))) this.deselect();
    const appended = prev && prev.length <= now.length && prev.every((s, i) => now[i] === s);
    if (appended && this.scale && this.awake) { for (let i = prev.length; i < now.length; i++) drawStroke(this.ctx, this.view(now[i]), this.scale); }
    else this.redraw();
  }
  // etichetta «Mario sta scrivendo» dove scrive un altro (x, y in unità della tavola); p = null la toglie
  peerMark(id, p) {
    this.marks ||= new Map();
    let el = this.marks.get(id);
    if (!p) { el?.remove(); this.marks.delete(id); return; }
    if (!el) { el = document.createElement('div'); el.className = 'ink-peer'; el.setAttribute('aria-hidden', 'true'); this.el.append(el); this.marks.set(id, el); }
    el.textContent = p.label;
    el.style.setProperty('--c', p.color);
    el.style.left = `${Math.round(p.x * (this.scale || 1))}px`;
    el.style.top = `${Math.round(p.y * (this.scale || 1))}px`;
  }

  destroy() { this.ro.disconnect(); this.io?.disconnect(); this.cancelPage?.(); clearTimeout(this.pageTimer); this.deselect(); }
  // per provare lo zoom senza un iPad (console): board.setZoom(2)
}

const SHAPE_COLORS = ['#1c2333', '#3657e8', '#e2573b', '#0f9d8a', '#8b5cf6'];
const snapshot = (strokes) => strokes.map((s) => ({ s, p: s.p.slice(), c: s.c, w: s.w }));
const applySnap = (snap) => { for (const x of snap) { x.s.p = x.p.slice(); x.s.c = x.c; x.s.w = x.w; } };
function tiny(p) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < p.length; i += 3) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
  return x1 - x0 < 6 && y1 - y0 < 6;
}

export function hlColor(c) {
  const map = { '#1c2333': '#f5d90a', '#e2573b': '#ff8a65', '#3657e8': '#7aa2ff', '#0f9d8a': '#5ee0b3', '#8b5cf6': '#d0a8ff' };
  return map[c] || c;
}

// Miniatura per l'elenco appunti
export function thumb(blocks, w = 240, h = 120) {
  const ink = blocks.find((b) => b.type === 'ink' && b.strokes?.length);
  if (!ink) return null;
  const c = document.createElement('canvas');
  const dpr = 2;
  c.width = w * dpr; c.height = h * dpr;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const dark = document.documentElement.classList.contains('is-dark');
  for (const s of ink.strokes) drawStroke(ctx, dark && s.c === '#1c2333' ? { ...s, c: '#e6e9f2' } : s, w / W);
  return c;
}

// Anteprima di una tavola a mano per la galleria (larghezza in px, altezza tagliata a maxH)
export function inkPreview(block, w = 600, maxH = 520) {
  const scale = w / W;
  let bottom = 0;
  for (const s of block.strokes || []) for (let i = 1; i < s.p.length; i += 3) bottom = Math.max(bottom, s.p[i]);
  const h = Math.min(maxH, Math.max(60, (bottom + 30) * scale));
  const c = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = w * dpr; c.height = h * dpr;
  c.style.width = '100%'; c.style.height = 'auto'; c.style.aspectRatio = `${w} / ${h}`;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const dark = document.documentElement.classList.contains('is-dark');
  for (const s of block.strokes || []) drawStroke(ctx, dark && s.c === '#1c2333' ? { ...s, c: '#e6e9f2' } : s, scale);
  return c;
}

// --- inchiostro in SVG (2026.11.7, per il PDF con stile) -------------------------------------------------------
// Stesse curve del disegno su tela (inkCurve / inkRibbon) scritte da un «registratore» che imita Path2D e produce il
// testo di un <path>: nel PDF la scrittura resta vettoriale e nitida a ogni ingrandimento. I colori sono quelli del
// tratto (sulla carta stampata il blu scuro resta blu scuro, anche se l'app è in tema scuro).
class SvgRec {
  constructor() { this.d = ''; }
  moveTo(x, y) { this.d += `M${+x.toFixed(2)} ${+y.toFixed(2)}`; }
  lineTo(x, y) { this.d += `L${+x.toFixed(2)} ${+y.toFixed(2)}`; }
  bezierCurveTo(a, b, c, d, x, y) { this.d += `C${+a.toFixed(2)} ${+b.toFixed(2)} ${+c.toFixed(2)} ${+d.toFixed(2)} ${+x.toFixed(2)} ${+y.toFixed(2)}`; }
  arc(x, y, r) { const R = +r.toFixed(2); this.d += `M${+(x + r).toFixed(2)} ${+y.toFixed(2)}A${R} ${R} 0 1 0 ${+(x - r).toFixed(2)} ${+y.toFixed(2)}A${R} ${R} 0 1 0 ${+(x + r).toFixed(2)} ${+y.toFixed(2)}`; }
  closePath() { this.d += 'Z'; }
}
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Altezza utile della tavola: fino all'ultimo tratto (o alla pagina PDF), non i fogli vuoti sotto
export function inkHeight(block) {
  let bottom = block.bg ? (W * block.bg.ph) / block.bg.pw : 0;
  for (const s of block.strokes || []) { const b = strokeBox(s); bottom = Math.max(bottom, b[3]); }
  return Math.max(bottom + STEP, STEP * 2);
}
// SVG della tavola tra y0 e y1 (unità della tavola, larghezza 1000). opts: { paper: 'grid'|'lines'|'dots'|'blank', bgHref, color }
export function inkToSvg(block, y0 = 0, y1 = inkHeight(block), opts = {}) {
  const parts = [];
  const paper = opts.paper || 'blank';
  const grid = opts.color || 'rgba(54, 87, 232, 0.16)';
  const top = block.bg ? (W * block.bg.ph) / block.bg.pw : 0;
  if (paper === 'grid' || paper === 'lines' || paper === 'dots') {
    let d = '';
    const from = Math.max(y0, top);
    if (paper === 'grid') {
      for (let x = 0; x <= W; x += STEP) d += `M${x} ${from}V${y1}`;
      for (let y = Math.ceil(from / STEP) * STEP; y <= y1; y += STEP) d += `M0 ${y}H${W}`;
      parts.push(`<path d="${d}" stroke="${grid}" stroke-width="0.8" fill="none"/>`);
    } else if (paper === 'lines') {
      const g = STEP * 1.4;
      for (let y = Math.ceil(from / g) * g; y <= y1; y += g) d += `M0 ${y.toFixed(1)}H${W}`;
      parts.push(`<path d="${d}" stroke="${grid}" stroke-width="0.9" fill="none"/>`);
    } else {
      for (let y = Math.floor(from / STEP) * STEP + STEP / 2; y < y1; y += STEP) for (let x = STEP / 2; x < W; x += STEP) d += `M${x + 1.3} ${y}A1.3 1.3 0 1 0 ${x - 1.3} ${y}A1.3 1.3 0 1 0 ${x + 1.3} ${y}`;
      parts.push(`<path d="${d}" fill="${grid}"/>`);
    }
  }
  if (block.bg && opts.bgHref && y0 < top) parts.push(`<image href="${esc(opts.bgHref)}" x="0" y="0" width="${W}" height="${top}" preserveAspectRatio="none"/>`);
  for (const s of block.strokes || []) {
    const b = strokeBox(s);
    if (b[3] < y0 || b[1] > y1) continue;
    const p = drawPoints(s);
    const n = p.length / 3;
    if (!n) continue;
    if (s.t === 'txt') { parts.push(`<text x="${p[0]}" y="${p[1]}" font-size="${s.w}" font-style="italic" font-family="'Times New Roman', Georgia, serif" text-anchor="middle" dominant-baseline="middle" fill="${esc(s.c)}">${esc(s.s || '')}</text>`); continue; }
    if (s.g) {
      let d = `M${p[0]} ${p[1]}`;
      for (let i = 1; i < n; i++) d += `L${p[i * 3]} ${p[i * 3 + 1]}`;
      if (n === 1) d += `l0.1 0`;
      parts.push(`<path d="${d}" fill="none" stroke="${esc(s.c)}" stroke-width="${s.w * 0.95}" stroke-linecap="round" stroke-linejoin="round"/>`);
      continue;
    }
    const rec = new SvgRec();
    let even = true;
    for (let i = 5; i < p.length; i += 3) if (p[i] !== p[2]) { even = false; break; }
    const hl = s.t === 'hl' ? ' opacity="0.32" style="mix-blend-mode:multiply"' : '';
    if (s.t === 'hl' || (even && !s.v)) { inkCurve(rec, p, 0, n - 1); parts.push(`<path d="${rec.d}" fill="none" stroke="${esc(s.c)}" stroke-width="${inkR(s, p[2]) * 2}" stroke-linecap="round" stroke-linejoin="round"${hl}/>`); }
    else { inkRibbon(rec, p, 0, n - 1, (i) => inkR(s, p[i * 3 + 2])); parts.push(`<path d="${rec.d}" fill="${esc(s.c)}" fill-rule="nonzero"${hl}/>`); }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${y0} ${W} ${y1 - y0}" preserveAspectRatio="xMidYMin meet">${parts.join('')}</svg>`;
}
// Dove tagliare la tavola tra una pagina e l'altra: il punto più basso, tra `from` e `to`, che non attraversa nessun
// tratto (si risale al massimo fino a `min`); se non c'è, `to`.
export function inkCut(block, min, to) {
  const boxes = (block.strokes || []).map(strokeBox).filter((b) => b[3] > min && b[1] < to);
  for (let y = to; y > min; y -= 4) if (!boxes.some((b) => b[1] < y && b[3] > y)) return y;
  return to;
}
