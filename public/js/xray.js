// Quadretto — radiografia dei programmi C multiprocesso e multithread (2026.11.4).
// Legge il registro di server/qtrace.c (una riga per evento: microsecondi pid tid evento argomenti…) e mostra:
// perché il programma si è fermato (chi aspetta cosa, il ciclo del deadlock), la linea del tempo per processo e
// thread, l'albero dei processi con l'uscita di ognuno a colori, le IPC rimaste nel sistema. Anche la prova di stress.
// Qui la traduzione si chiama T(), come negli altri file grandi (vedi i18n.js).
import { t as T, tn } from './i18n.js';
// Gli esiti della prova di stress arrivano dal server in italiano (servono anche come chiavi): si traducono solo a video.
const esito = (o) => { const m = /^(uscita|segnale) (.+)$/.exec(o); return m ? T(m[1] === 'uscita' ? 'uscita {codice}' : 'segnale {s}', { codice: m[2], s: m[2] }) : T(o); };

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.setAttribute('style', v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
}
const unesc = (s) => (s || '').replace(/\\(\\|n|s|x([0-9a-f]{2}))/g, (_, c, x) => (c === '\\' ? '\\' : c === 'n' ? '\n' : c === 's' ? ' ' : String.fromCharCode(parseInt(x, 16))));
const BLOCK = { mlock: 'mutex', cwait: 'cond', swait: 'sem', mqsendb: 'mqsend', mqrecvb: 'mqrecv', waitb: 'wait', joinb: 'join' };
const UNBLOCK = { macq: 'mutex', cwake: 'cond', sacq: 'sem', mqsende: 'mqsend', mqrecve: 'mqrecv', waite: 'wait', joine: 'join' };
const SIGNAMES = { 6: 'SIGABRT', 8: 'SIGFPE', 9: 'SIGKILL', 11: 'SIGSEGV', 13: 'SIGPIPE', 15: 'SIGTERM', 7: 'SIGBUS' };
const HUES = [215, 150, 20, 280, 45, 330, 190, 95, 0, 255];

// --- analisi ---------------------------------------------------------------------------------------------------
export function analyze(run) {
  const lines = (run.trace || '').split('\n');
  const ev = [];
  let cut = false;
  for (const l of lines) {
    if (!l) continue;
    const f = l.split(' ');
    if (f[3] === 'cut') { cut = true; continue; }
    if (f.length < 4) continue;
    ev.push({ t: +f[0], pid: f[1], tid: f[2], ev: f[3], a: f.slice(4) });
  }
  const t0 = ev.length ? ev[0].t : 0;
  // nomi degli oggetti: simboli globali del programma, nomi delle IPC, altrimenti un numero progressivo
  const base = new Map();
  for (const e of ev) if (e.ev === 'base' && !base.has(e.pid)) base.set(e.pid, BigInt(e.a[0]));
  const syms = run.syms || [];
  const named = new Map(); // pid|addr -> nome della IPC
  const labels = new Map(), counters = { mutex: 0, cond: 0, sem: 0 };
  const symName = (pid, addr) => {
    const b = base.get(pid) ?? [...base.values()][0];
    if (b == null || !addr?.startsWith('0x')) return null;
    const off = Number(BigInt(addr) - b);
    for (const [s, size, name] of syms) if (off >= s && off < s + Math.max(size, 1)) return off === s ? name : `${name}+${off - s}`;
    return null;
  };
  const objKey = (kind, pid, addr) => (kind === 'sem' && named.has(pid + '|' + addr) ? 'sem:' + named.get(pid + '|' + addr) : kind + ':' + addr);
  const label = (kind, pid, addr) => {
    const k = objKey(kind, pid, addr);
    if (!labels.has(k)) {
      const nm = kind === 'sem' && named.get(pid + '|' + addr);
      const sym = symName(pid, addr);
      const what = { mutex: 'mutex', cond: T('condizione'), sem: T('semaforo') }[kind];
      labels.set(k, nm ? `${what} ${nm}` : sym ? `${what} ${sym}` : `${what} n.${++counters[kind]}${kind === 'sem' ? ' (senza nome)' : ''}`);
    }
    return labels.get(k);
  };

  const procs = new Map(), actors = new Map(), order = [];
  const actor = (e) => {
    const k = e.pid + '/' + e.tid;
    if (!actors.has(k)) { actors.set(k, { k, pid: e.pid, tid: e.tid, thread: e.pid !== e.tid, blocked: null, segs: [], marks: [], dead: false, first: ev.indexOf(e) }); order.push(k); }
    return actors.get(k);
  };
  const proc = (pid) => { if (!procs.has(pid)) procs.set(pid, { pid, ppid: null, kids: [], outs: [], exit: null, dead: false }); return procs.get(pid); };
  const holder = new Map(), semVal = new Map(), condWaiters = new Map(), lostSignals = [];
  const mq = new Map(); // pid|fd -> { name, msgsize, maxmsg }
  const created = new Map(), unlinked = new Set(); // nome -> { kind, i }
  let msgsizeErr = null;

  ev.forEach((e, i) => {
    const a = actor(e), p = proc(e.pid);
    const close = (kind) => { if (a.blocked && a.blocked.kind === kind) { a.segs.push({ from: a.blocked.i, to: i, kind, what: a.blocked.what }); a.blocked = null; } };
    const block = (kind, what, extra = {}) => { a.blocked = { kind, what, i, ...extra }; };
    switch (e.ev) {
      case 'start': { if (p.ppid == null) p.ppid = e.a[0]; const pp = procs.get(e.a[0]); if (pp && !pp.kids.includes(e.pid)) pp.kids.push(e.pid); break; }
      case 'fork': a.marks.push({ i, kind: 'fork', what: `fork → P${e.a[0]}` }); { const c = proc(e.a[0]); c.ppid = e.pid; if (!p.kids.includes(e.a[0])) p.kids.push(e.a[0]); } break;
      case 'tstart': a.parent = e.a[0]; break;
      case 'tend': a.dead = true; a.endI = i; break;
      case 'exit': if (p.exit == null) p.exit = { code: +e.a[0] }; p.dead = true; break;
      case 'end': p.dead = true; break;
      case 'waitb': block('wait', e.a[0] === '-1' ? 'un figlio qualsiasi' : `P${e.a[0]}`); break;
      case 'waite': close('wait'); if (e.a[1] === 'x' || e.a[1] === 's') { const c = proc(e.a[0]); c.dead = true; c.exit = e.a[1] === 'x' ? { code: +e.a[2] } : { signal: SIGNAMES[e.a[2]] || 'segnale ' + e.a[2] }; } break;
      case 'joinb': block('join', T('la fine di un thread (pthread_join)')); break;
      case 'joine': close('join'); break;
      case 'mlock': block('mutex', label('mutex', e.pid, e.a[0]), { obj: objKey('mutex', e.pid, e.a[0]) }); break;
      case 'macq': close('mutex'); holder.set(objKey('mutex', e.pid, e.a[0]), a.k); label('mutex', e.pid, e.a[0]); break;
      case 'munlock': holder.delete(objKey('mutex', e.pid, e.a[0])); break;
      case 'cwait': {
        holder.delete(objKey('mutex', e.pid, e.a[1]));
        const c = objKey('cond', e.pid, e.a[0]);
        condWaiters.set(c, (condWaiters.get(c) || 0) + 1);
        block('cond', label('cond', e.pid, e.a[0]), { obj: c, mutex: label('mutex', e.pid, e.a[1]) });
        break;
      }
      case 'cwake': { close('cond'); const c = objKey('cond', e.pid, e.a[0]); condWaiters.set(c, Math.max(0, (condWaiters.get(c) || 1) - 1)); holder.set(objKey('mutex', e.pid, e.a[1]), a.k); break; }
      case 'csig': case 'cbc': {
        const c = objKey('cond', e.pid, e.a[0]);
        a.marks.push({ i, kind: 'signal', what: `${e.ev === 'cbc' ? 'broadcast' : 'signal'} ${label('cond', e.pid, e.a[0])}` });
        if (!(condWaiters.get(c) > 0)) lostSignals.push({ i, who: a.k, what: label('cond', e.pid, e.a[0]) });
        break;
      }
      case 'sinit': semVal.set(objKey('sem', e.pid, e.a[0]), +e.a[1]); label('sem', e.pid, e.a[0]); break;
      case 'sopen': if (e.a[4] === '0') { named.set(e.pid + '|' + e.a[0], e.a[1]); if (e.a[2] !== '0') { created.set(e.a[1], { kind: 'sem', i }); if (!semVal.has('sem:' + e.a[1])) semVal.set('sem:' + e.a[1], +e.a[3]); } } break;
      case 'swait': block('sem', label('sem', e.pid, e.a[0]), { obj: objKey('sem', e.pid, e.a[0]), val: +e.a[1] }); break;
      case 'sacq': close('sem'); semVal.set(objKey('sem', e.pid, e.a[0]), +e.a[1]); break;
      case 'spost': a.marks.push({ i, kind: 'post', what: `sem_post ${label('sem', e.pid, e.a[0])} → ${e.a[1]}` }); semVal.set(objKey('sem', e.pid, e.a[0]), +e.a[1]); break;
      case 'sunlink': if (e.a[1] === '0') unlinked.add('sem:' + e.a[0]); break;
      case 'shmopen': if (e.a[1] === '1' && e.a[3] === '0') created.set(e.a[0], { kind: 'shm', i }); break;
      case 'shmunlink': if (e.a[1] === '0') unlinked.add('shm:' + e.a[0]); break;
      case 'mqopen': if (e.a[5] === '0') { mq.set(e.pid + '|' + e.a[0], { name: e.a[1], maxmsg: +e.a[3], msgsize: +e.a[4] }); if (e.a[2] === '1') created.set(e.a[1], { kind: 'mq', i }); } break;
      case 'mqsendb': block('mqsend', T('spazio nella coda') + ' ' + (mq.get(e.pid + '|' + e.a[0])?.name || e.a[0])); a.marks.push({ i, kind: 'send', what: T('mq_send su {c}', { c: mq.get(e.pid + '|' + e.a[0])?.name || T('coda') }) }); break;
      case 'mqsende': close('mqsend'); break;
      case 'mqrecvb': block('mqrecv', T('un messaggio sulla coda') + ' ' + (mq.get(e.pid + '|' + e.a[0])?.name || e.a[0])); break;
      case 'mqrecve': close('mqrecv'); if (e.a[2] === '90') msgsizeErr = { q: mq.get(e.pid + '|' + e.a[0]), len: null }; break;
      case 'mqunlink': if (e.a[1] === '0') unlinked.add('mq:' + e.a[0]); break;
      case 'out': p.outs.push({ i, fd: +e.a[0], text: unesc(e.a[1]) }); break;
    }
  });
  const N = ev.length;
  // stato finale: chi è ancora fermo (i processi morti non contano)
  const alive = (x) => !x.dead && !procs.get(x.pid)?.dead;
  const stuckList = [];
  for (const k of order) {
    const x = actors.get(k);
    if (x.blocked) { x.segs.push({ from: x.blocked.i, to: N, kind: x.blocked.kind, what: x.blocked.what, open: true }); if (alive(x)) stuckList.push(x); }
  }
  const name = (k) => {
    const x = actors.get(k);
    if (!x) return k;
    const p = procs.get(x.pid);
    const role = p && procs.get(p.ppid) ? 'figlio' : 'main';
    return x.thread ? T('thread T{t} di P{p}', { t: x.tid, p: x.pid }) : `P${x.pid}${role === 'main' ? ' (main)' : ''}`;
  };
  // ciclo nel grafo delle attese (mutex → chi lo tiene)
  const waitsOn = (x) => x.blocked?.kind === 'mutex' ? holder.get(x.blocked.obj) : null;
  let cycle = null;
  for (const x of stuckList) {
    const seen = [x.k];
    let cur = waitsOn(x);
    while (cur && !cycle) {
      const j = seen.indexOf(cur);
      if (j >= 0) { cycle = seen.slice(j); break; }
      seen.push(cur);
      cur = waitsOn(actors.get(cur) || {});
    }
    if (cycle) break;
  }
  const liveCount = order.filter((k) => alive(actors.get(k))).length;
  const allStuck = stuckList.length > 0 && stuckList.length === liveCount;
  const why = stuckList.map((x) => {
    const b = x.blocked;
    let s = T('{x} è fermo: aspetta ', { x: name(x.k) });
    if (b.kind === 'mutex') { const hk = holder.get(b.obj); s += T('il {w}', { w: b.what }) + (hk ? T(', tenuto da {x}', { x: name(hk) }) + (actors.get(hk)?.blocked ? ' ' + T('(che a sua volta aspetta {w})', { w: (actors.get(hk).blocked.kind === 'mutex' ? T('il {w}', { w: actors.get(hk).blocked.what }) : actors.get(hk).blocked.what) }) : '') : ''); }
    else if (b.kind === 'sem') s += T('il {w} (valore {v})', { w: b.what, v: semVal.get(b.obj) ?? b.val }) + (allStuck ? T(': nessuno farà sem_post, sono tutti fermi') : '');
    else if (b.kind === 'cond') s += T('un signal sulla {w} (ha rilasciato il {m})', { w: b.what, m: b.mutex }) + (allStuck ? T(': nessuno lo manderà') : '');
    else if (b.kind === 'wait') s += T('la fine di {w} (wait)', { w: b.what });
    else s += b.what;
    return { k: x.k, text: s + '.' };
  });
  const lost = lostSignals.filter((l) => stuckList.some((x) => x.blocked.kind === 'cond' && x.blocked.what === l.what && x.blocked.i > l.i));
  // IPC rimaste: /dev/shm della gabbia + code create e mai rimosse
  const left = [];
  for (const f of run.shm || []) left.push(f.startsWith('sem.') ? { kind: 'sem', name: '/' + f.slice(4), fix: `sem_unlink("/${f.slice(4)}")` } : { kind: 'shm', name: '/' + f, fix: `shm_unlink("/${f}")` });
  for (const [nm, c] of created) if (c.kind === 'mq' && !unlinked.has('mq:' + nm)) left.push({ kind: 'mq', name: nm, fix: `mq_unlink("${nm}")` });
  return { ev, N, t0, cut, procs, actors, order, name, stuckList, why, cycle, allStuck, lost, left, msgsizeErr, semVal, holder };
}

// --- vista ------------------------------------------------------------------------------------------------------
const KIND_IT = { mutex: 'mutex', cond: 'condizione', sem: 'semaforo', mqsend: 'coda piena', mqrecv: 'coda vuota', wait: 'wait', join: 'join' };

export function renderXray(res, { onLoc, files = [] } = {}) {
  const run = res.run || res;
  const A = analyze(run);
  if (!A.N) return null;
  const root = h('div', { class: 'xray' });
  const procList = [...A.procs.values()];
  const hue = new Map(procList.map((p, i) => [p.pid, HUES[i % HUES.length]]));
  const color = (pid) => `hsl(${hue.get(pid) ?? 215} 70% 45%)`;
  const threads = A.order.filter((k) => A.actors.get(k).thread).length;

  // riepilogo
  const sum = [];
  sum.push(tn(procList.length, '{n} processo', '{n} processi') + (threads ? `, ${threads} thread` : '') + ', ' + T('{n} eventi', { n: A.N }));
  const head = h('div', { class: 'xray-head' }, h('strong', {}, T('Radiografia')), h('span', {}, sum.join(' · ')));
  root.append(head);
  if (A.cut) root.append(h('p', { class: 'xray-note' }, T('Il registro è stato tagliato (troppi eventi): l\'analisi vale per la prima parte dell\'esecuzione.')));

  const tabs = h('div', { class: 'seg xray-tabs' });
  const body = h('div', { class: 'xray-body' });
  const views = [];
  const stuck = run.stuck || (run.timedOut && A.stuckList.length);
  if (stuck || A.stuckList.length) views.push(['why', stuck ? T('Perché si è piantato') : T('Chi è fermo'), () => whyView(A)]);
  views.push(['time', T('Linea del tempo'), () => timeView(A, color)]);
  views.push(['proc', T('Processi e uscita'), () => procView(A, color)]);
  if (A.left.length) views.push(['ipc', T('IPC rimaste ({n})', { n: A.left.length }), () => ipcView(A, files, onLoc)]);
  const show = (k) => {
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
    body.replaceChildren(views.find((v) => v[0] === k)[2]());
  };
  for (const [k, l] of views) tabs.append(h('button', { type: 'button', 'data-k': k, onclick: () => show(k) }, l));
  root.append(tabs, body);
  show(views[0][0]);
  return root;
}

function whyView(A) {
  const box = h('div', { class: 'xray-why' });
  if (A.cycle) box.append(h('p', { class: 'xray-alert' }, 'Deadlock: ' + A.cycle.map((k, i) => T('{a} aspetta il {w}, tenuto da {b}', { a: A.name(k), w: A.actors.get(k).blocked.what, b: A.name(A.cycle[(i + 1) % A.cycle.length]) })).join('; ') + '. ' + T('Nessuno dei due può andare avanti. Rimedio tipico: prendere i mutex sempre nello stesso ordine.')));
  else if (A.allStuck) box.append(h('p', { class: 'xray-alert' }, T('Tutti i processi e i thread ancora vivi sono fermi su un\'attesa: il programma non può più andare avanti.')));
  box.append(h('ul', { class: 'xray-list' }, A.why.map((w) => h('li', {}, w.text))));
  for (const l of A.lost) box.append(h('p', { class: 'xray-tip' }, T('{chi} aveva fatto signal sulla {w} quando nessuno aspettava: con le condition variable quel segnale si perde (non resta «in memoria» come in un semaforo). Chi si mette in attesa dopo non lo riceve: controlla la condizione nel while prima di aspettare.', { chi: A.name(l.who), w: l.what })));
  if (!A.why.length) box.append(h('p', {}, T('Alla fine nessuno era fermo su un\'attesa.')));
  return box;
}

function timeView(A, color) {
  const N = Math.max(A.N, 1);
  const pct = (i) => `${(100 * i / N).toFixed(3)}%`;
  const lanes = h('div', { class: 'xray-lanes' });
  for (const k of A.order) {
    const x = A.actors.get(k);
    const lane = h('div', { class: 'xray-lane' });
    const endI = x.endI ?? N;
    lane.append(h('span', { class: 'xray-life', style: `left:${pct(x.first)};width:${pct(Math.max(1, endI - x.first))};background:${color(x.pid)}` }));
    for (const s of x.segs) {
      const t0 = A.ev[s.from]?.t, t1 = A.ev[Math.min(s.to, N - 1)]?.t;
      lane.append(h('span', { class: 'xray-seg ' + s.kind + (s.open ? ' open' : ''), style: `left:${pct(s.from)};width:${pct(Math.max(0.6, s.to - s.from))}`, title: T('in attesa: {w}', { w: s.what }) + (t0 != null && t1 != null ? ` · ${((t1 - t0) / 1000).toFixed(1)} ms` : '') + (s.open ? ' · ' + T('fino alla fine') : '') }));
    }
    for (const m of x.marks.slice(0, 300)) lane.append(h('span', { class: 'xray-mark ' + m.kind, style: `left:${pct(m.i)}`, title: m.what }));
    lanes.append(h('div', { class: 'xray-row' }, h('span', { class: 'xray-who', style: `color:${color(x.pid)}` }, x.thread ? `T${x.tid}` : `P${x.pid}`), lane));
  }
  return h('div', {}, lanes,
    h('p', { class: 'xray-legend' }, h('i', { class: 'lg life' }), 'vivo ', h('i', { class: 'lg mutex' }), T('aspetta un mutex') + ' ', h('i', { class: 'lg sem' }), T('aspetta un semaforo') + ' ', h('i', { class: 'lg cond' }), T('aspetta un signal') + ' ',
      h('i', { class: 'lg mq' }), T('aspetta una coda') + ' ', h('i', { class: 'lg wait' }), 'wait/join ', h('i', { class: 'lg open' }), T('fermo fino alla fine') + ' · ', '▲ post/signal/send · ◆ fork. ' + T('Le posizioni seguono l\'ordine degli eventi; tieni il dito su una barra per i dettagli.')));
}

function procView(A, color) {
  const box = h('div', { class: 'xray-procs' });
  const roots = [...A.procs.values()].filter((p) => !A.procs.has(p.ppid));
  const status = (p) => p.exit ? (p.exit.signal ? T('ucciso da {s}', { s: p.exit.signal }) : `uscita ${p.exit.code}`) : p.dead ? 'terminato' : 'ancora vivo alla fine';
  const node = (p, depth) => {
    const txt = p.outs.filter((o) => o.fd === 1).map((o) => o.text).join('');
    const err = p.outs.filter((o) => o.fd === 2).map((o) => o.text).join('');
    const nThreads = A.order.filter((k) => A.actors.get(k).thread && A.actors.get(k).pid === p.pid).length;
    return h('div', { class: 'xray-proc', style: `--c:${color(p.pid)};margin-left:${depth * 18}px` },
      h('div', { class: 'xray-proc-head' }, h('span', { class: 'xray-dot' }), `P${p.pid}`, depth ? ' · ' + T('figlio di P{n}', { n: p.ppid }) : ' · main', nThreads ? ` · ${nThreads} thread` : '', ` · ${status(p)}`),
      txt ? h('pre', { class: 'xray-out' }, txt) : null, err ? h('pre', { class: 'xray-out e' }, err) : null,
      p.kids.map((c) => A.procs.get(c)).filter(Boolean).map((c) => node(c, depth + 1)));
  };
  box.append(h('p', { class: 'xray-note' }, tn(A.procs.size, 'Albero dei processi creato davvero: {n} processo.', 'Albero dei processi creato davvero: {n} processi.')));
  roots.forEach((r) => box.append(node(r, 0)));
  // l'uscita nell'ordine in cui è stata scritta, colorata per processo
  const all = [...A.procs.values()].flatMap((p) => p.outs.map((o) => ({ ...o, pid: p.pid }))).sort((a, b) => a.i - b.i);
  if (all.length) {
    box.append(h('div', { class: 'home-label' }, T('Uscita nell\'ordine in cui è stata scritta')),
      h('pre', { class: 'xray-out mixed' }, all.map((o) => h('span', { style: `color:${color(o.pid)}`, title: `P${o.pid}` }, o.text))));
    if (/fork\s*\(/.test(A.ev.map((e) => e.ev).join(' ')) || A.procs.size > 1) {
      const dup = new Map();
      for (const o of all) for (const l of o.text.split('\n').filter(Boolean)) dup.set(l, (dup.get(l) || new Set()).add(o.pid));
      const twice = [...dup].filter(([, s]) => s.size > 1).map(([l]) => l).slice(0, 3);
      if (twice.length) box.append(h('p', { class: 'xray-tip' }, T('«{x}» è stato scritto da più processi: era nel buffer di printf al momento della fork e il figlio ne ha avuto una copia. Rimedio: fflush(stdout) prima di fork().', { x: twice[0] })));
    }
  }
  return box;
}

function ipcView(A, files, onLoc) {
  const where = (name) => { for (const f of files) { const i = f.text.indexOf(`"${name}"`); if (i >= 0) return { path: f.path, line: f.text.slice(0, i).split('\n').length }; } return null; };
  const what = { sem: T('semaforo'), shm: T('memoria condivisa'), mq: T('coda di messaggi') };
  return h('div', {},
    h('p', { class: 'xray-note' }, T('Questi oggetti erano ancora nel sistema alla fine del programma. Su un PC vero restano fino al riavvio, e la prossima esecuzione li ritrova (un semaforo col valore vecchio!).')),
    h('ul', { class: 'xray-list' }, A.left.map((x) => {
      const w = where(x.name);
      return h('li', {}, T('{cosa} {nome}: manca {fix}', { cosa: what[x.kind], nome: x.name, fix: x.fix }), w && onLoc ? h('button', { type: 'button', class: 'loc-link', onclick: () => onLoc(w.path, w.line) }, `${w.path}:${w.line}`) : null);
    })));
}

// --- prova di stress ---------------------------------------------------------------------------------------------
export function renderStress(st, opts = {}) {
  const box = h('div', { class: 'xray stress' });
  const g = st.groups;
  const different = g.length > 1;
  box.append(h('div', { class: 'xray-head' }, h('strong', {}, T('Prova di stress')), h('span', {}, T('{n} esecuzioni con pause casuali vicino a wait, signal, lock e send', { n: st.runs }))));
  box.append(h('p', { class: different || g.some((x) => x.outcome !== 'uscita 0') ? 'xray-alert' : 'xray-ok' },
    different ? T('{g} esiti diversi su {n} esecuzioni: il risultato dipende dall\'ordine in cui girano processi e thread. È una race condition (o un blocco che capita solo a volte).', { g: g.length, n: st.runs })
      : g[0].outcome === 'uscita 0' ? T('Tutte le {n} esecuzioni hanno dato lo stesso risultato. Non è una prova che il programma sia corretto, ma è un buon segno.', { n: st.runs })
        : T('Tutte le {n} esecuzioni finiscono allo stesso modo: {esito}.', { n: st.runs, esito: esito(g[0].outcome) })));
  for (const x of g) {
    const slot = h('div', {});
    const btn = x.trace ? h('button', { type: 'button', class: 'btn small', onclick: () => {
      if (slot.childNodes.length) { slot.replaceChildren(); btn.textContent = T('Radiografia'); return; }
      slot.append(renderXray({ run: { trace: x.trace, shm: x.shm, syms: x.syms, stuck: x.outcome === 'bloccato', timedOut: x.outcome !== 'uscita 0' } }, opts) || h('p', {}, T('Nessun evento registrato.')));
      btn.textContent = T('Chiudi la radiografia');
    } }, T('Radiografia')) : null;
    box.append(h('div', { class: 'stress-group' },
      h('div', { class: 'stress-row' }, h('span', { class: 'stress-count' }, `${x.count}×`), h('span', { class: 'stress-out' + (x.outcome === 'uscita 0' ? '' : ' bad') }, esito(x.outcome)), h('small', {}, T('esecuzioni {elenco}', { elenco: x.runs.slice(0, 8).join(', ') + (x.runs.length > 8 ? '…' : '') })), btn),
      x.stdout ? h('pre', { class: 'xray-out' }, x.stdout.length > 1200 ? x.stdout.slice(0, 1200) + '\n…' : x.stdout) : null, slot));
  }
  return box;
}
