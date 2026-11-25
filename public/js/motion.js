// Quadretto — movimento naturale: molle fisiche e gesti che seguono il dito.
//
// Due strumenti, la stessa fisica:
// · curve CSS `linear()` calcolate da una molla vera (girano sul compositore: il thread principale resta libero);
// · molle in JavaScript per i gesti, che partono dalla velocità del dito: quando lo lasci, l'oggetto continua
//   con la sua spinta e si assesta, invece di «saltare» a destinazione.
// Regola della penna (BUG-006): niente molle in JavaScript né transizioni di vista mentre la penna scrive.
// I gesti partono solo dal dito (mai dalla Pencil). «Riduci movimento» di iPadOS spegne tutto.

let busy = () => false;
export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// --- molle ----------------------------------------------------------------------------------------
// Posizione di una molla smorzata da 0 a 1 (velocità iniziale 0), in forma chiusa
function springAt(t, w, z) {
  if (z < 1) { const wd = w * Math.sqrt(1 - z * z); return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t)); }
  return 1 - Math.exp(-w * t) * (1 + w * t); // smorzamento critico
}
// Curva CSS linear() e durata (ms) di una molla: response = periodo in secondi, z = smorzamento (1 = niente rimbalzo)
function springCurve(response, z, n = 40) {
  const w = (2 * Math.PI) / response;
  let T = 0.05;
  while (T < 3 && !(Math.abs(1 - springAt(T, w, z)) < 0.002 && Math.abs(1 - springAt(T + 0.05, w, z)) < 0.002)) T += 0.01;
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(+springAt((i / n) * T, w, z).toFixed(4));
  pts[n] = 1;
  return { css: `linear(${pts.join(', ')})`, ms: Math.round(T * 1000) };
}
export const SPRINGS = {
  gentle: springCurve(0.42, 0.82),   // viste, schede, liste
  snappy: springCurve(0.3, 0.9),     // pulsanti, interruttori
  bouncy: springCurve(0.38, 0.62),   // popup, pallini, elementi che «arrivano»
};
function setupEasing() {
  const ok = window.CSS?.supports?.('transition-timing-function', 'linear(0, 1)');
  const root = document.documentElement.style;
  for (const [k, s] of Object.entries(SPRINGS)) {
    root.setProperty(`--spring-${k}`, ok ? s.css : 'cubic-bezier(.2, .9, .25, 1.05)');
    root.setProperty(`--spring-${k}-ms`, `${ok ? s.ms : 380}ms`);
  }
}
export const easing = (k = 'gentle') => (window.CSS?.supports?.('transition-timing-function', 'linear(0, 1)') ? SPRINGS[k].css : 'cubic-bezier(.2, .9, .25, 1.05)');

// Molla in JavaScript per i gesti: parte da `from` con la velocità del dito (px/ms) e arriva a `to`
export function spring({ from, to, velocity = 0, stiffness = 380, damping = 34, onUpdate, onDone }) {
  if (reduced()) { onUpdate(to); onDone?.(); return { stop() {} }; }
  let x = from, v = velocity * 1000, last = performance.now(), raf = 0, stopped = false;
  const step = (now) => {
    if (stopped) return;
    const dt = Math.min(0.034, (now - last) / 1000); last = now;
    for (let i = 0; i < 4; i++) { const h = dt / 4; v += (-stiffness * (x - to) - damping * v) * h; x += v * h; }
    if (Math.abs(v) < 8 && Math.abs(x - to) < 0.4) { onUpdate(to); onDone?.(); return; }
    onUpdate(x);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return { stop() { stopped = true; cancelAnimationFrame(raf); } };
}

// Elastico oltre i limiti (come lo scorrimento di iOS)
export const rubber = (d, dim = 600, c = 0.55) => (d === 0 ? 0 : Math.sign(d) * (1 - 1 / ((Math.abs(d) * c) / dim + 1)) * dim);

// --- gesti: un dito che trascina ---------------------------------------------------------------------
// opts.start(x0, y0, dx, dy, e) → true per prendere il gesto (dopo 8 px di movimento); da lì niente scorrimento nativo.
// opts.move(dx, dy) · opts.end(dx, dy, vx, vy) con velocità in px/ms. Anche il mouse, per il computer.
export function drag(el, opts) {
  let s = null;
  const begin = (x, y, e) => { if (busy() || reduced() && !opts.evenReduced) return; s = { x0: x, y0: y, on: false, off: false, hist: [[performance.now(), x, y]], target: e.target }; };
  const moveTo = (x, y, e) => {
    if (!s || s.off) return false;
    const dx = x - s.x0, dy = y - s.y0;
    s.hist.push([performance.now(), x, y]); if (s.hist.length > 6) s.hist.shift();
    if (!s.on) {
      if (Math.hypot(dx, dy) < 8) return false;
      if (!opts.start(s.x0, s.y0, dx, dy, s.target)) { s.off = true; return false; }
      s.on = true; s.dx0 = dx; s.dy0 = dy;
    }
    opts.move(dx, dy);
    return true;
  };
  const finish = () => {
    if (!s) return;
    const was = s; s = null;
    if (!was.on) return;
    const a = was.hist[0], b = was.hist[was.hist.length - 1];
    const dt = Math.max(16, b[0] - a[0]);
    opts.end(b[1] - was.x0, b[2] - was.y0, (b[1] - a[1]) / dt, (b[2] - a[2]) / dt);
  };
  el.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    if (e.touches.length !== 1 || t.touchType === 'stylus') { s = null; return; }
    begin(t.clientX, t.clientY, e);
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (!s) return;
    if (e.touches.length !== 1) { if (s.on) opts.end(0, 0, 0, 0, true); s = null; return; }
    if (moveTo(e.touches[0].clientX, e.touches[0].clientY, e) && e.cancelable) e.preventDefault();
  }, { passive: false });
  el.addEventListener('touchend', finish);
  el.addEventListener('touchcancel', () => { if (s?.on) opts.end(0, 0, 0, 0, true); s = null; });
  // mouse (computer): gli ascoltatori di movimento esistono solo durante il trascinamento
  const mm = (e) => moveTo(e.clientX, e.clientY, e);
  const mu = () => { removeEventListener('pointermove', mm); removeEventListener('pointerup', mu); finish(); };
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    begin(e.clientX, e.clientY, e);
    addEventListener('pointermove', mm); addEventListener('pointerup', mu);
  });
}

// --- FLIP: gli elementi che cambiano posto ci arrivano scorrendo -----------------------------------------
export function measure(els) { const m = new Map(); for (const el of els) m.set(el.dataset.id, el.getBoundingClientRect()); return m; }
export function flip(before, els) {
  if (reduced() || busy()) return;
  for (const el of els) {
    const a = before.get(el.dataset.id); if (!a) continue;
    const b = el.getBoundingClientRect();
    const dx = a.left - b.left, dy = a.top - b.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: SPRINGS.gentle.ms, easing: easing('gentle') });
  }
}

// --- transizioni tra viste (View Transitions, Safari 18+) -------------------------------------------------
export function viewTransition(update, dir) {
  if (!document.startViewTransition || reduced() || busy()) { update(); return; }
  document.documentElement.dataset.nav = dir || 'fade';
  const vt = document.startViewTransition(update);
  vt.finished.finally(() => { delete document.documentElement.dataset.nav; });
}

// --- pressione: le schede si abbassano e si inclinano verso il dito -------------------------------------------
const TILT = '.nb-card-main, .note-card, .gal-card, .recent-card, .resume-card, .now-card, .next-card, .exam-chip, .study-row, .bl-chip';
function bindTilt() {
  let cur = null;
  const set = (x, y) => {
    const r = cur.getBoundingClientRect();
    const px = Math.max(-1, Math.min(1, ((x - r.left) / r.width) * 2 - 1)), py = Math.max(-1, Math.min(1, ((y - r.top) / r.height) * 2 - 1));
    const k = Math.min(6, 900 / Math.max(r.width, 120)); // le schede grandi si inclinano meno
    cur.style.setProperty('--rx', `${(px * k).toFixed(2)}deg`);
    cur.style.setProperty('--ry', `${(-py * k).toFixed(2)}deg`);
  };
  // l'ascoltatore di movimento esiste solo mentre una scheda è premuta col dito o col mouse
  const mv = (e) => { if (cur) set(e.clientX, e.clientY); };
  const release = () => {
    if (!cur) return;
    cur.classList.remove('pressed'); cur.style.removeProperty('--rx'); cur.style.removeProperty('--ry'); cur = null;
    document.removeEventListener('pointermove', mv);
    for (const t of ['pointerup', 'pointercancel']) document.removeEventListener(t, release);
    document.removeEventListener('scroll', release, true);
  };
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'pen' || busy() || reduced()) return;
    const el = e.target.closest(TILT); if (!el) return;
    release();
    cur = el; cur.classList.add('pressed'); set(e.clientX, e.clientY);
    document.addEventListener('pointermove', mv, { passive: true });
    for (const t of ['pointerup', 'pointercancel']) document.addEventListener(t, release, { passive: true });
    document.addEventListener('scroll', release, { passive: true, capture: true });
  }, { passive: true });
}

export function initMotion({ isBusy }) {
  busy = isBusy;
  setupEasing();
  bindTilt();
}
