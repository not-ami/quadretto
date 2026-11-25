// Quadretto — scheduling della CPU con diagramma di Gantt (2026.11.4).
// Algoritmi del programma di Sistemi Operativi: FCFS, SJF/SPN (non preemptive), SRTF/SRT, Round Robin,
// priorità (con e senza prelazione; numero più basso = priorità più alta), code multiple con retroazione (MLFQ).
// Convenzioni (scritte anche nell'interfaccia): a parità vince chi è arrivato prima, poi chi viene prima
// nell'elenco; in Round Robin un processo che arriva nello stesso istante in cui un altro esaurisce il quanto
// entra in coda PRIMA di quello prelazionato.

// Qui t è il tempo: la traduzione si chiama T() (vedi i18n.js).
import { t as T, fmtNum } from './i18n.js';

export const ALGOS = [
  { k: 'fcfs', label: 'FCFS', long: T('First Come First Served') },
  { k: 'sjf', label: T('SJF / SPN'), long: T('Shortest Job (Process) Next, senza prelazione') },
  { k: 'srtf', label: T('SRTF / SRT'), long: T('Shortest Remaining Time, con prelazione') },
  { k: 'rr', label: T('Round Robin'), long: T('a turno, quanto q') },
  { k: 'prio', label: T('Priorità'), long: T('senza prelazione (numero basso = priorità alta)') },
  { k: 'priop', label: T('Priorità con prelazione'), long: T('con prelazione (numero basso = priorità alta)') },
  { k: 'mlfq', label: T('Code con retroazione'), long: T('MLFQ: chi consuma tutto il quanto scende di coda') },
  // 2026.11.7, per il simulatore di starvation: i rimedi classici
  { k: 'hrrn', label: 'HRRN', long: T('Highest Response Ratio Next: (attesa + durata) / durata, senza prelazione') },
  { k: 'prioa', label: T('Priorità con invecchiamento'), long: T('con prelazione; ogni «età» unità di attesa la priorità migliora di 1') },
];

// procs: [{ name, arrival, burst, prio }] — opts: { q, quanta: [1, 2, 4], age (prioa), boost (mlfq: ogni quante unità tutti tornano in cima) }
export function schedule(algo, procs, opts = {}) {
  const P = procs.map((p, i) => ({ ...p, i, rem: p.burst, start: null, end: null, level: 0, waitT: 0, readySince: p.arrival }));
  const age = Math.max(1, opts.age | 0 || 3);
  const boost = opts.boost > 0 ? opts.boost | 0 : 0;
  let nextBoost = boost || Infinity;
  const eff = (p) => p.prio - Math.floor(p.waitT / age); // priorità effettiva con l'invecchiamento
  const segs = [], notes = [];
  let t = 0, done = 0, cur = null, curSince = 0, quantumUsed = 0;
  const q = Math.max(1, opts.q | 0 || 2);
  const quanta = (opts.quanta && opts.quanta.length ? opts.quanta : [1, 2, 4]).map((x) => Math.max(1, x | 0));
  const ready = []; // per RR e MLFQ: coda (per MLFQ, una per livello)
  const levels = quanta.map(() => []);
  const arrived = new Set();
  const byArr = (a, b) => a.arrival - b.arrival || a.i - b.i;
  const push = (p) => { if (algo === 'mlfq') levels[p.level].push(p); else ready.push(p); };
  const admit = (time) => { for (const p of [...P].sort(byArr)) if (!arrived.has(p) && p.arrival <= time) { arrived.add(p); push(p); notes.push({ t: p.arrival, text: algo.startsWith('prio') ? T('arriva {p} (durata {d}, priorità {pr})', { p: p.name, d: p.burst, pr: p.prio }) : T('arriva {p} (durata {d})', { p: p.name, d: p.burst }) }); } };
  const pool = () => (algo === 'mlfq' ? levels.flat() : ready);
  const take = (p) => { if (algo === 'mlfq') levels[p.level].splice(levels[p.level].indexOf(p), 1); else ready.splice(ready.indexOf(p), 1); };
  const best = (key) => pool().slice().sort((a, b) => key(a) - key(b) || a.arrival - b.arrival || a.i - b.i)[0];
  const pick = () => {
    if (!pool().length) return null;
    switch (algo) {
      case 'fcfs': return best((p) => p.arrival);
      case 'sjf': return best((p) => p.burst);
      case 'srtf': return best((p) => p.rem);
      case 'prio': case 'priop': return best((p) => p.prio);
      case 'prioa': return best(eff);
      case 'hrrn': { const rr = (p) => -((t - p.readySince) + p.burst) / p.burst; return best(rr); }
      case 'rr': return ready[0];
      case 'mlfq': return levels.find((l) => l.length)[0];
    }
    return null;
  };
  const preemptive = algo === 'srtf' || algo === 'priop' || algo === 'prioa';
  const sliceOf = (p) => (algo === 'rr' ? q : algo === 'mlfq' ? quanta[p.level] : Infinity);
  const close = (until) => { if (cur && until > curSince) { const last = segs[segs.length - 1]; if (last && last.p === cur.name && last.end === curSince) last.end = until; else segs.push({ p: cur.name, start: curSince, end: until }); } };
  admit(0);
  let guard = 0;
  while (done < P.length && guard++ < 100000) {
    if (!cur) {
      const nx = pick();
      if (!nx) {
        const next = Math.min(...P.filter((p) => !arrived.has(p)).map((p) => p.arrival));
        segs.push({ p: null, start: t, end: next });
        t = next; admit(t); continue;
      }
      const why0 = why(algo, nx, pool().filter((p) => p !== nx), q, quanta, eff, t);
      take(nx); cur = nx; curSince = t; quantumUsed = 0; cur.waitT = 0;
      if (cur.start == null) cur.start = t;
      notes.push({ t, text: T('va in CPU {p}', { p: cur.name }) + why0 });
    }
    // fino al prossimo evento: fine, fine del quanto, arrivo (che può prelazionare)
    const nextArr = Math.min(Infinity, ...P.filter((p) => !arrived.has(p)).map((p) => p.arrival));
    const left = sliceOf(cur) - quantumUsed;
    let step = Math.min(cur.rem, left, preemptive || algo === 'mlfq' ? nextArr - t : Infinity);
    if (algo === 'prioa') step = Math.min(step, 1); // l'età cresce a ogni unità: si ricontrolla ogni volta
    if (algo === 'mlfq' && boost) step = Math.min(step, nextBoost - t);
    const dt = Math.max(step, 0) || Math.min(cur.rem, left);
    t += dt; cur.rem -= dt; quantumUsed += dt;
    for (const p of pool()) p.waitT += dt;
    admit(t);
    if (algo === 'mlfq' && t >= nextBoost) {
      // boost periodico: tutti tornano nella coda più alta, così chi è sceso in fondo non aspetta per sempre
      for (let l = 1; l < levels.length; l++) { for (const p of levels[l]) { p.level = 0; levels[0].push(p); } levels[l].length = 0; }
      if (cur.rem > 0) cur.level = 0;
      notes.push({ t, text: T('boost: tutti i processi tornano nella coda 1') });
      while (nextBoost <= t) nextBoost += boost;
    }
    if (cur.rem === 0) {
      close(t); cur.end = t; done++;
      notes.push({ t, text: T('{p} finisce', { p: cur.name }) });
      cur = null; continue;
    }
    if (preemptive) {
      const c = pick();
      const better = c && (algo === 'srtf' ? c.rem < cur.rem : algo === 'prioa' ? eff(c) < eff(cur) : c.prio < cur.prio);
      if (better) { close(t); notes.push({ t, text: T('{a} prelaziona {b}', { a: c.name, b: cur.name }) + ' (' + (algo === 'srtf' ? T('gli resta {x} < {y}', { x: c.rem, y: cur.rem }) : algo === 'prioa' ? T('priorità effettiva {x} < {y}', { x: eff(c), y: eff(cur) }) : T('priorità {x} < {y}', { x: c.prio, y: cur.prio })) + ')' }); cur.readySince = t; push(cur); cur = null; }
      continue;
    }
    if (algo === 'mlfq' && quantumUsed < sliceOf(cur) && levels.slice(0, cur.level).some((l) => l.length)) {
      // arriva qualcuno in una coda più alta: prelazione, chi esce resta al suo livello (in fondo)
      close(t); notes.push({ t, text: T('un processo in una coda più alta prelaziona {p}', { p: cur.name }) }); push(cur); cur = null; continue;
    }
    if (quantumUsed >= sliceOf(cur)) {
      close(t);
      if (algo === 'mlfq' && cur.level < quanta.length - 1) { cur.level++; notes.push({ t, text: T('{p} ha usato tutto il quanto: scende alla coda {n}', { p: cur.name, n: cur.level + 1 }) }); }
      else notes.push({ t, text: T('{p} ha usato tutto il quanto ({q}): torna in fondo alla coda', { p: cur.name, q: sliceOf(cur) }) });
      cur.readySince = t; push(cur); cur = null;
    }
  }
  // attesa più lunga senza CPU (per la starvation): dal momento in cui è pronto al momento in cui ci entra
  const longest = new Map(P.map((p) => [p.name, 0]));
  { const lastEnd = new Map(P.map((p) => [p.name, p.arrival])); for (const sg of segs) if (sg.p) { longest.set(sg.p, Math.max(longest.get(sg.p), sg.start - lastEnd.get(sg.p))); lastEnd.set(sg.p, sg.end); } }
  const rows = P.map((p) => ({ name: p.name, arrival: p.arrival, burst: p.burst, prio: p.prio, end: p.end, turnaround: p.end - p.arrival, waiting: p.end - p.arrival - p.burst, response: p.start - p.arrival, longest: longest.get(p.name) }));
  const avg = (k) => rows.reduce((a, r) => a + r[k], 0) / (rows.length || 1);
  return { segs, rows, notes, avg: { turnaround: avg('turnaround'), waiting: avg('waiting'), response: avg('response') }, end: t };
}
function why(algo, p, rest, q, quanta, eff, t) {
  if (!rest.length) return '';
  switch (algo) {
    case 'fcfs': return ' ' + T('(è arrivato per primo)');
    case 'sjf': return ' ' + T('(durata {d}, la più breve tra quelli pronti)', { d: p.burst });
    case 'srtf': return ' ' + T('(gli resta {r}, il minimo)', { r: p.rem });
    case 'prio': case 'priop': return ' ' + T('(priorità {p}, la più alta)', { p: p.prio });
    case 'rr': return ' ' + T('(è il primo della coda, quanto {q})', { q });
    case 'mlfq': return ' ' + T('(coda {n}, quanto {q})', { n: p.level + 1, q: quanta[p.level] });
    case 'prioa': return ' ' + T('(priorità effettiva {e}: {p} meno l\'età)', { e: eff(p), p: p.prio });
    case 'hrrn': return ' ' + T('(rapporto di risposta {r}, il più alto)', { r: fmtNum(((t - p.readySince) + p.burst) / p.burst, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) });
  }
  return '';
}

// «P1 0 5 2» per riga: nome, arrivo, durata, priorità (facoltativa)
export function parseProcs(text) {
  const out = [];
  for (const [i, raw] of text.split('\n').entries()) {
    const l = raw.replace(/#.*$/, '').trim();
    if (!l) continue;
    const f = l.split(/[\s,;]+/);
    if (f.length < 3) throw new Error(T('riga {n}: servono nome, arrivo e durata (es. P1 0 5)', { n: i + 1 }));
    const [name, a, b, pr] = f;
    const arrival = Number(a), burst = Number(b), prio = pr == null ? 0 : Number(pr);
    if (![arrival, burst, prio].every(Number.isInteger) || arrival < 0 || burst <= 0) throw new Error(T('riga {n}: arrivo, durata e priorità sono interi (durata > 0)', { n: i + 1 }));
    out.push({ name, arrival, burst, prio });
  }
  if (!out.length) throw new Error(T('Scrivi almeno un processo, una riga per processo: nome arrivo durata [priorità]'));
  if (out.length > 26) throw new Error(T('Al massimo 26 processi'));
  return out;
}
