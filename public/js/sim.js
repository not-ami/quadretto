// Quadretto — simulatori passo passo di Sistemi Operativi (2026.11.7): mutex e starvation.
// Scelta dell'utente (2026-11-24): «passo passo + riproduci». Il motore dei thread è quello del cacciatore di race
// condition (race.js: stesso linguaggio, stessa semantica pthread); qui si avanza UN passo alla volta, scegliendo
// chi va avanti a mano o con una politica (a turno, a caso, priorità fissa), con lock e semafori equi (in coda) o no.
// La starvation della CPU usa sched.js (priorità, SJF, MLFQ) messa a confronto col suo rimedio.
// Si calcola solo al tocco o durante la riproduzione, e mai mentre la penna scrive (ctx.quiet).
// Qui t è anche una variabile locale: la traduzione si chiama T() (vedi i18n.js).
import { t as T, tp } from './i18n.js';
import { compile, machine } from './race.js';
import { schedule, parseProcs, ALGOS } from './sched.js';

// --- il motore passo passo ---------------------------------------------------------------------------------------
export const POLICIES = [
  { k: 'manuale', label: T('Scegli tu'), sub: 'tocca il thread che fa il prossimo passo' },
  { k: 'giro', label: T('A turno'), sub: T('un passo a testa, in ordine') },
  { k: 'caso', label: T('A caso'), sub: T('sempre lo stesso caso: «Rimescola» per cambiarlo') },
  { k: 'prio', label: T('Priorità fissa'), sub: T('va avanti il primo dell\'elenco che può') },
];

// rand riproducibile (si salva nello stato, così «indietro» e «avanti» danno la stessa storia)
const lcg = (x) => (Math.imul(x, 1664525) + 1013904223) >>> 0;

export function stepper(src, { policy = 'giro', fair = false, seed = 7 } = {}) {
  const P = compile(src);
  const M = machine(P);
  const nThreads = M.T;
  const names = P.inst.map((x) => x.name);
  const zero = () => names.map(() => 0);
  const first = { s: M.init, ev: null, rng: seed >>> 0 || 7, last: -1, since: names.map(() => null),
    moves: zero(), acq: zero(), waitNow: zero(), waitMax: zero(), cells: [] };
  const hist = [first];
  let at = 0;
  const cur = () => hist[at];
  const opOf = (s, i) => P.inst[i].th.code[s.pc[i]];
  const res = (x) => (x?.op === 'lock' ? 'm:' + x.m : x?.op === 'P' ? 's:' + x.s : null);
  // mosse consentite: quelle del motore, meno quelle che un lock/semaforo equo non permette (chi è in coda prima passa prima)
  const allowed = (h, i) => {
    const mv = M.moves(h.s, i);
    if (!mv.length || !fair) return mv;
    const r = res(opOf(h.s, i));
    if (!r || h.s.st[i] !== 'r') return mv;
    const mine = h.since[i];
    for (let j = 0; j < nThreads; j++) {
      if (j === i || h.since[j] == null || res(opOf(h.s, j)) !== r || h.s.st[j] !== 'r') continue;
      if (mine == null || h.since[j] < mine || (h.since[j] === mine && j < i)) return [];
    }
    return mv;
  };
  const why = (h, i) => {
    const s = h.s, v = s.st[i];
    if (v === 'e') return 'ha finito';
    if (v.startsWith('c:')) return T('dorme su {c}: aspetta un signal', { c: v.slice(2) });
    const x = opOf(s, i);
    if (v === 'w') return T('svegliato, aspetta di riprendere {m}', { m: s.wm[i] });
    if (x.op === 'lock' && s.own[x.m] !== -1 && s.own[x.m] !== i) return T('aspetta {m}, tenuto da {t}', { m: x.m, t: names[s.own[x.m]] });
    if (x.op === 'P' && s.sem[x.s] <= 0) return T('aspetta {s} (vale 0)', { s: x.s });
    if (fair && !allowed(h, i).length && M.moves(s, i).length) return T('in coda per {x}: c\'è chi aspetta da prima', { x: x.op === 'lock' ? x.m : x.s });
    return 'pronto';
  };
  const runnable = (h) => names.map((_, i) => i).filter((i) => allowed(h, i).length);
  const finished = (h) => h.s.st.every((v) => v === 'e');
  // esito: null se si può continuare
  const outcome = (h) => {
    if (h.ev?.err) return { kind: 'error', msg: `${names[h.ev.t]}: ${h.ev.err} (` + T('riga {n}', { n: h.ev.n }) + ')' };
    if (h.bad) return { kind: 'always', msg: T('l\'invariante «{x}» è falso', { x: h.bad }) };
    if (finished(h)) {
      const env = M.envOf(h.s, null);
      const wrong = P.finally.filter((f) => { try { return !evalIn(f, env); } catch { return true; } });
      return wrong.length ? { kind: 'finally', msg: T('hanno finito tutti, ma «{x}» è falso', { x: wrong.map((w) => w.src).join(', ') }) } : { kind: 'done', msg: 'hanno finito tutti' + (P.finally.length ? `: ${P.finally.map((f) => f.src).join(', ')} ✓` : '') };
    }
    if (!runnable(h).length) return { kind: 'deadlock', msg: T('nessun thread può più andare avanti'), stuck: M.describeStuck(h.s) };
    return null;
  };
  const evalIn = (inv, env) => { const v = inv.fn ? inv.fn(env) : null; return v; };
  for (const inv of [...P.always, ...P.finally]) inv.fn = (env) => evalExpr(inv.e, env);

  function step(i, k = 0) {
    const h = cur();
    if (outcome(h)) return false;
    const mv = allowed(h, i);
    if (!mv.length) return false;
    const pick = mv[Math.min(k, mv.length - 1)];
    const n = M.clone(pick.s);
    M.settle(n, i);
    const acquired = /^(lock|P )/.test(pick.what) || /riprende/.test(pick.what);
    const nh = { s: n, ev: { t: i, what: pick.what, n: pick.n, err: pick.err }, rng: h.rng, last: i, since: h.since.slice(),
      moves: h.moves.slice(), acq: h.acq.slice(), waitNow: h.waitNow.slice(), waitMax: h.waitMax.slice() };
    nh.moves[i]++; if (acquired) nh.acq[i]++;
    const cell = [];
    for (let j = 0; j < nThreads; j++) {
      if (j === i) { nh.waitNow[j] = 0; nh.since[j] = null; cell.push(acquired ? 'acq' : 'mv'); continue; }
      if (h.s.st[j] === 'e') { cell.push('end'); continue; }
      nh.waitNow[j]++; nh.waitMax[j] = Math.max(nh.waitMax[j], nh.waitNow[j]);
      cell.push(M.moves(h.s, j).length ? 'rdy' : 'blk');
    }
    // da quando ciascuno è fermo davanti a un lock/semaforo (per la coda equa)
    for (let j = 0; j < nThreads; j++) {
      if (n.st[j] !== 'r') { nh.since[j] = null; continue; }
      const r = res(opOf(n, j));
      if (!r) { nh.since[j] = null; continue; }
      if (nh.since[j] == null && !M.moves(n, j).length) nh.since[j] = hist.length;
    }
    nh.cells = [...h.cells.slice(-119), cell];
    const bad = P.always.find((inv) => { try { return !inv.fn(M.envOf(n, null)); } catch { return true; } });
    if (bad) nh.bad = bad.src;
    hist.length = at + 1;
    hist.push(nh); at++;
    return true;
  }
  // un passo secondo la politica; restituisce false se non c'è niente da fare (o la politica è «a mano»)
  function auto() {
    const h = cur();
    if (outcome(h)) return false;
    const r = runnable(h);
    if (!r.length || policy === 'manuale') return false;
    let i;
    if (policy === 'prio') i = r[0];
    else if (policy === 'caso') { const x = lcg(h.rng); i = r[x % r.length]; const ok = step(i, (x >>> 8) % 4); if (ok) cur().rng = lcg(x); return ok; }
    else i = r.find((j) => j > h.last) ?? r[0];
    return step(i, 0);
  }
  return {
    P, names,
    get at() { return at; }, get len() { return hist.length; },
    cur, step, auto, why, runnable: () => runnable(cur()), outcome: () => outcome(cur()),
    back() { if (at > 0) at--; }, fwd() { if (at < hist.length - 1) { at++; return true; } return false; },
    reset() { at = 0; },
    line: (i) => { const s = cur().s; if (s.st[i] === 'e') return ''; return (P.srcLines[opOf(s, i).n - 1] || '').trim(); },
    lineNo: (i) => { const s = cur().s; return s.st[i] === 'e' ? null : opOf(s, i).n; },
    set policy(p) { policy = p; }, get policy() { return policy; },
    set fair(f) { fair = !!f; }, get fair() { return fair; },
    reseed(x) { cur().rng = x >>> 0 || 7; },
  };
}
// valuta un'espressione già compilata da race.js (stessa semantica)
function evalExpr(e, env) {
  switch (e.k) {
    case 'num': return e.v;
    case 'id': { const v = env(e.v); if (v === undefined) throw new Error(T('variabile «{x}» sconosciuta', { x: e.v })); return v; }
    case 'un': return e.op === '-' ? -evalExpr(e.a, env) : +!evalExpr(e.a, env);
    default: {
      const a = evalExpr(e.a, env);
      if (e.op === '&&') return a ? +!!evalExpr(e.b, env) : 0;
      if (e.op === '||') return a ? 1 : +!!evalExpr(e.b, env);
      const b = evalExpr(e.b, env);
      switch (e.op) {
        case '+': return a + b; case '-': return a - b; case '*': return a * b;
        case '/': return b ? Math.trunc(a / b) : 0; case '%': return b ? a % b : 0;
        case '==': return +(a === b); case '!=': return +(a !== b); case '<': return +(a < b); case '<=': return +(a <= b); case '>': return +(a > b); case '>=': return +(a >= b);
      }
    }
  }
  return 0;
}

// --- esempi -------------------------------------------------------------------------------------------------------
// Ogni esempio: { k, label, desc, src, policy?, fair? }. Linguaggio del cacciatore di race condition.
export const MUTEX_EXAMPLES = [
  { k: 'perso', label: T('Contatore senza mutex'), desc: T('Due thread fanno cont = cont + 1: leggere e scrivere sono due passi, e un aggiornamento si perde.'), policy: 'giro', src: `# Due thread aggiungono 1 a cont, due volte ciascuno. Senza mutex:
# «A turno» li fa leggere tutti e due prima di scrivere, e un +1 si perde.
shared cont = 0

thread T x2:
    repeat 2:
        cont = cont + 1

finally cont == 4
` },
  { k: 'mutex', label: T('Contatore con il mutex'), desc: T('La stessa cosa con lock/unlock: chi arriva mentre l\'altro è dentro aspetta.'), policy: 'giro', src: `# Con il mutex la lettura e la scrittura di cont non si mescolano più.
shared cont = 0
mutex m

thread T x2:
    repeat 2:
        lock m
        cont = cont + 1
        unlock m

finally cont == 4
` },
  { k: 'dimenticato', label: T('Unlock dimenticato'), desc: T('Il primo thread esce senza rilasciare il mutex: l\'altro aspetta per sempre.'), policy: 'giro', src: `# Il primo thread non fa unlock: il mutex resta suo anche quando ha finito.
shared cont = 0
mutex m

thread T x2:
    lock m
    cont = cont + 1
    # manca: unlock m

finally cont == 2
` },
  { k: 'stallo', label: T('Deadlock: due mutex in ordine opposto'), desc: T('X prende a poi b, Y prende b poi a: a turno si bloccano a vicenda.'), policy: 'giro', src: `# Attesa circolare: X tiene a e vuole b, Y tiene b e vuole a.
mutex a, b

thread X:
    lock a
    lock b
    unlock b
    unlock a

thread Y:
    lock b
    lock a
    unlock a
    unlock b
` },
  { k: 'ordine', label: T('Stesso ordine: niente deadlock'), desc: T('Il rimedio: tutti prendono i mutex nello stesso ordine.'), policy: 'giro', src: `# Stesso ordine per tutti (prima a, poi b): l'attesa circolare non può più nascere.
mutex a, b

thread X:
    lock a
    lock b
    unlock b
    unlock a

thread Y:
    lock a
    lock b
    unlock b
    unlock a
` },
  { k: 'filosofi', label: T('Filosofi a cena (3)'), desc: T('Ognuno prende la forchetta sinistra e poi la destra: deadlock. Cambia l\'ordine di uno solo e sparisce.'), policy: 'giro', src: `# Tre filosofi, tre forchette. Tutti prendono prima la sinistra: a turno si bloccano.
# Rimedio: fai prendere al Filosofo3 prima f1 e poi f3 (un «mancino»).
mutex f1, f2, f3

thread Filosofo1:
    lock f1
    lock f2
    skip    # mangia
    unlock f2
    unlock f1

thread Filosofo2:
    lock f2
    lock f3
    skip
    unlock f3
    unlock f2

thread Filosofo3:
    lock f3
    lock f1
    skip
    unlock f1
    unlock f3
` },
  { k: 'spin', label: T('Spinlock fatto a mano (sbagliato)'), desc: T('Controllare «occupato» e poi metterlo a 1 sono due passi: entrano tutti e due.'), policy: 'giro', src: `# Un lock fatto con una variabile: controllo e assegnamento non sono atomici.
# Serve un'istruzione atomica (test-and-set) o un mutex vero.
shared occupato = 0, dentroA = 0, dentroB = 0

thread A:
    while occupato == 1:
        skip
    occupato = 1
    dentroA = 1
    dentroA = 0
    occupato = 0

thread B:
    while occupato == 1:
        skip
    occupato = 1
    dentroB = 1
    dentroB = 0
    occupato = 0

always dentroA + dentroB <= 1
` },
  { k: 'peterson', label: T('Algoritmo di Peterson'), desc: T('Mutua esclusione per due thread con sole variabili: flag e turno.'), policy: 'giro', src: `# Peterson: ognuno alza la sua bandiera e cede il turno all'altro.
shared flag0 = 0, flag1 = 0, turno = 0, dentro = 0

thread T0:
    repeat 2:
        flag0 = 1
        turno = 1
        while flag1 == 1 && turno == 1:
            skip
        dentro = dentro + 1
        dentro = dentro - 1
        flag0 = 0

thread T1:
    repeat 2:
        flag1 = 1
        turno = 0
        while flag0 == 1 && turno == 0:
            skip
        dentro = dentro + 1
        dentro = dentro - 1
        flag1 = 0

always dentro <= 1
` },
  { k: 'cond', label: T('Variabile condizione: while, non if'), desc: T('Produttori e consumatori col monitor: con «if» un consumatore svegliato può trovare il buffer già vuoto. Cambia «if» in «while» e riprova.'), policy: 'manuale', src: `# Con «if» chi viene svegliato non ricontrolla: un altro consumatore può essergli passato davanti.
# Con «Scegli tu»: Consumatore1 dorme, Produttore1 fa signal, Consumatore2 entra prima che Consumatore1 riprenda m.
shared cont = 0
mutex m
cond vuoto

thread Produttore x2:
    lock m
    cont = cont + 1
    signal vuoto
    unlock m

thread Consumatore x2:
    lock m
    if cont == 0:
        wait vuoto, m
    cont = cont - 1
    unlock m

always cont >= 0
` },
  { k: 'sem', label: T('Semaforo come mutex'), desc: T('Un semaforo inizializzato a 1 fa da mutex: P per entrare, V per uscire.'), policy: 'giro', src: `# Semaforo binario: P s entra (s passa a 0), V s esce (s torna a 1).
shared cont = 0
sem s = 1

thread T x3:
    P s
    cont = cont + 1
    V s

finally cont == 3
` },
];

export const STARVE_EXAMPLES = [
  { k: 'cpu-prio', fam: 'cpu', label: T('CPU: priorità e invecchiamento'), desc: T('Una fila continua di processi importanti: quello poco importante non entra mai in CPU. Con l\'invecchiamento la sua priorità migliora a ogni attesa.'), a: 'priop', b: 'prioa', age: 2,
    src: ['Basso 0 3 5', ...Array.from({ length: 15 }, (_, i) => `A${i + 1} ${i * 2} 2 1`)].join('\n') },
  { k: 'cpu-sjf', fam: 'cpu', label: T('CPU: SJF e HRRN'), desc: T('Con SJF un lavoro lungo viene sempre superato dai brevi. HRRN guarda anche quanto hai aspettato: (attesa + durata) / durata.'), a: 'sjf', b: 'hrrn',
    src: ['Lungo 1 8', ...Array.from({ length: 8 }, (_, i) => `B${i + 1} ${i * 2} 2`)].join('\n') },
  { k: 'cpu-mlfq', fam: 'cpu', label: T('CPU: code con retroazione e boost'), desc: T('I processi interattivi restano nella coda alta e quello lungo, sceso in fondo, non riparte. Il boost periodico rimette tutti in cima.'), a: 'mlfq', b: 'mlfq', boost: 4,
    src: ['Batch 0 6', ...Array.from({ length: 16 }, (_, i) => `I${i + 1} ${i + 1} 1`)].join('\n') },
  { k: 'rw-lettori', fam: 'sync', label: T('Lettori e scrittori: precedenza ai lettori'), desc: T('Finché c\'è un lettore dentro, gli altri lettori entrano subito: lo scrittore aspetta per sempre (guarda «accessi» e «attesa»).'), policy: 'giro', fair: false, src: `# Soluzione classica con precedenza ai lettori: il primo che entra blocca w, l'ultimo che esce lo libera.
# Se i lettori si danno il cambio, «lettori» non torna mai a 0 e lo Scrittore non entra più.
shared lettori = 0
mutex m
sem w = 1

thread Lettore x2:
    if id == 2:    # il secondo lettore parte un po' dopo
        repeat 9:
            skip
    while true:
        lock m
        lettori = lettori + 1
        if lettori == 1:
            P w
        unlock m
        skip    # legge
        skip
        skip
        skip
        skip
        skip
        lock m
        lettori = lettori - 1
        if lettori == 0:
            V w
        unlock m

thread Scrittore:
    while true:
        P w
        skip    # scrive
        V w
` },
  { k: 'rw-equo', fam: 'sync', label: T('Lettori e scrittori: con il tornello'), desc: T('Il rimedio: un semaforo «tornello» che lo scrittore chiude quando arriva, così i lettori nuovi aspettano dietro di lui. Con i semafori in coda nessuno resta indietro.'), policy: 'giro', fair: true, src: `# Tornello t: lo scrittore lo chiude mentre aspetta w, i lettori nuovi si fermano lì.
shared lettori = 0
mutex m
sem w = 1, t = 1

thread Lettore x2:
    if id == 2:    # il secondo lettore parte un po' dopo
        repeat 9:
            skip
    while true:
        P t
        V t
        lock m
        lettori = lettori + 1
        if lettori == 1:
            P w
        unlock m
        skip    # legge
        skip
        skip
        skip
        skip
        skip
        lock m
        lettori = lettori - 1
        if lettori == 0:
            V w
        unlock m

thread Scrittore:
    while true:
        P t
        P w
        V t
        skip    # scrive
        V w
` },
  { k: 'prio-fissa', fam: 'sync', label: T('Priorità fissa: chi è in fondo non parte'), desc: T('Con la priorità fissa va avanti sempre il primo che può: gli altri, pur pronti, non fanno mai un passo. Prova «A turno».'), policy: 'prio', fair: false, src: `# Tre thread sempre pronti. Con «Priorità fissa» corre solo il primo.
shared cont = 0
mutex m

thread T x3:
    while true:
        lock m
        cont = cont + 1
        unlock m
` },
];

// --- interfaccia -------------------------------------------------------------------------------------------------
const SPEEDS = [['lento', 700], ['medio', 280], ['veloce', 90]];
const CELL = { mv: T('fatto un passo'), acq: T('ha preso il lock / semaforo'), rdy: T('pronto, ma non scelto'), blk: T('bloccato'), end: T('finito') };

// kit: { h, later, area, HUE, gantt } da so-tools.js
function playerView(b, ctx, kit, getSrc) {
  const { h, HUE } = kit;
  const root = h('div', { class: 'sim' });
  let st = null, playing = null, err = null;
  const build = () => {
    stop();
    try { st = stepper(getSrc(), { policy: b.policy || 'giro', fair: !!b.fair, seed: b.seed || 7 }); err = null; } catch (e) { st = null; err = e.message; }
    draw();
  };
  const stop = () => { if (playing) { clearTimeout(playing); playing = null; } };
  const tick = () => {
    if (ctx.quiet && !ctx.quiet()) { playing = setTimeout(tick, 300); return; }
    const ok = st && st.auto();
    draw();
    if (!ok || st.len > 3000) { playing = null; draw(); return; }
    playing = setTimeout(tick, SPEEDS.find((s) => s[0] === (b.speed || 'medio'))[1]);
  };
  const btn = (lab, title, fn, cls = '') => h('button', { type: 'button', class: 'btn small ' + cls, title, 'aria-label': title, onclick: fn }, lab);
  const polSel = h('select', { 'aria-label': T('Chi va avanti') }, POLICIES.map((p) => h('option', { value: p.k, selected: p.k === (b.policy || 'giro') }, p.label)));
  polSel.addEventListener('change', () => { b.policy = polSel.value; ctx.onChange(); if (st) st.policy = b.policy; draw(); });
  const fairBox = h('input', { type: 'checkbox', checked: !!b.fair });
  fairBox.addEventListener('change', () => { b.fair = fairBox.checked; ctx.onChange(); if (st) st.fair = b.fair; draw(); });
  const speedSel = h('select', { 'aria-label': T('Velocità') }, SPEEDS.map(([k]) => h('option', { value: k, selected: k === (b.speed || 'medio') }, k)));
  speedSel.addEventListener('change', () => { b.speed = speedSel.value; ctx.onChange(); });
  const playBtn = btn('▶ ' + T('Riproduci'), T('Riproduci'), () => { if (playing) { stop(); draw(); } else { if (st?.outcome()) st.reset(); playing = setTimeout(tick, 0); draw(); } }, 'primary');
  const controls = h('div', { class: 'sim-controls' },
    btn('⏮', T('Dall\'inizio'), () => { stop(); st?.reset(); draw(); }),
    btn('◀', T('Un passo indietro'), () => { stop(); st?.back(); draw(); }),
    btn('▶', T('Un passo avanti'), () => { stop(); if (st && !st.fwd()) st.auto(); draw(); }),
    btn('⏭', T('Avanti di 20 passi'), () => { stop(); for (let k = 0; k < 20 && st; k++) if (!st.fwd() && !st.auto()) break; draw(); }),
    playBtn, speedSel,
    h('label', { class: 'inline' }, T('Chi va avanti '), polSel),
    h('label', { class: 'inline', title: T('Chi aspetta un lock o un semaforo da più tempo passa per primo') }, fairBox, ' ' + T('lock e semafori in coda')),
    btn(T('Rimescola'), T('Un altro caso (politica «A caso»)'), () => { b.seed = (b.seed || 7) * 31 + 17 >>> 0; ctx.onChange(); build(); }));
  const status = h('p', { class: 'sim-status', 'aria-live': 'polite' });
  const alert = h('div', { class: 'sim-alert' });
  const threads = h('div', { class: 'sim-threads' });
  const res = h('div', { class: 'sim-res' });
  const lanes = h('div', { class: 'sim-lanes' });
  const legend = h('p', { class: 'tool-hint sim-legend' }, ...Object.entries(CELL).map(([k, v]) => h('span', {}, h('i', { class: 'c-' + k }), v)));
  root.append(controls, status, alert, threads, res, lanes, legend);

  function draw() {
    playBtn.textContent = playing ? '⏸ ' + T('Pausa') : '▶ ' + T('Riproduci');
    if (err) { status.textContent = ''; alert.replaceChildren(h('p', { class: 'tool-err' }, err)); threads.replaceChildren(); res.replaceChildren(); lanes.replaceChildren(); return; }
    if (!st) return;
    const hcur = st.cur();
    const run = new Set(st.runnable());
    const ev = hcur.ev;
    status.replaceChildren(h('b', {}, T('Passo {n}', { n: st.at })), ev ? ` · ${st.names[ev.t]}: ${ev.what} (` + T('riga {n}', { n: ev.n }) + ')' : st.policy === 'manuale' ? T(' · tocca «Fai un passo» sul thread che vuoi far andare avanti') : T(' · si parte: premi ▶ o «Riproduci»'));
    // esito e starvation
    const out = st.outcome();
    const kids = [];
    if (out) kids.push(h('p', { class: out.kind === 'done' ? 'xray-ok' : 'xray-alert' }, out.kind === 'done' ? '✅ ' : '⛔ ', out.msg, out.stuck ? h('ul', {}, out.stuck.map((x) => h('li', {}, x))) : null));
    const nThr = st.names.length, lim = Math.max(12, 4 * nThr);
    const hungry = st.names.map((n, i) => ({ n, i, w: hcur.waitNow[i] })).filter((x) => hcur.s.st[x.i] !== 'e' && x.w >= lim);
    if (hungry.length && !out) kids.push(h('p', { class: 'xray-alert' }, '⚠ Starvation: ', hungry.map((x) => T('{t} non fa un passo da {n} passi', { t: x.n, n: x.w })).join('; '), T(' mentre gli altri vanno avanti.')));
    alert.replaceChildren(...kids);
    // thread
    threads.replaceChildren(...st.names.map((n, i) => {
      const w = st.why(hcur, i);
      const can = run.has(i) && !out;
      const card = h('div', { class: 'sim-th' + (ev?.t === i ? ' last' : '') + (hcur.s.st[i] === 'e' ? ' done' : can ? '' : ' wait'), style: `--c:${HUE(i)}` },
        h('div', { class: 'sim-th-head' }, h('strong', {}, n), h('span', { class: 'sim-badge' }, w)),
        h('code', { class: 'sim-line' }, st.lineNo(i) ? `${st.lineNo(i)}: ${st.line(i)}` : '—'),
        h('div', { class: 'sim-meta' }, T('passi {p} · accessi {a} · attesa {w} (max {m})', { p: hcur.moves[i], a: hcur.acq[i], w: hcur.waitNow[i], m: hcur.waitMax[i] })),
        h('button', { type: 'button', class: 'btn small', disabled: !can || null, onclick: () => { stop(); st.step(i); draw(); } }, T('Fai un passo')));
      return card;
    }));
    // risorse
    const P = st.P, s = hcur.s;
    const chips = [];
    for (const m of P.mutex) {
      const own = s.own[m];
      const q = st.names.filter((_, j) => s.st[j] === 'r' && j !== own && (() => { const x = P.inst[j].th.code[s.pc[j]]; return x.op === 'lock' && x.m === m; })());
      chips.push(h('span', { class: 'sim-chip' + (own >= 0 ? ' busy' : '') }, `🔒 ${m}: `, own >= 0 ? st.names[own] : T('libero'), q.length ? ' · ' + T('aspettano {q}', { q: q.join(', ') }) : ''));
    }
    for (const [k, v] of Object.entries(s.sem)) chips.push(h('span', { class: 'sim-chip' + (v <= 0 ? ' busy' : '') }, `🚦 ${k} = ${v}`));
    for (const c of P.cond) { const d = st.names.filter((_, j) => s.st[j] === 'c:' + c); chips.push(h('span', { class: 'sim-chip' }, `💤 ${c}: `, d.length ? d.join(', ') : 'nessuno')); }
    Object.keys(P.shared).forEach((k, j) => chips.push(h('span', { class: 'sim-chip var' }, `${k} = ${s.sh[j]}`)));
    res.replaceChildren(...chips);
    // linea del tempo: ultimi passi, una riga per thread
    const cells = hcur.cells.slice(-60);
    lanes.replaceChildren(...st.names.map((n, i) => h('div', { class: 'sim-lane', style: `--c:${HUE(i)}` }, h('span', { class: 'sim-lane-n' }, n),
      h('div', { class: 'sim-cells' }, cells.map((c) => h('i', { class: 'c-' + c[i], title: CELL[c[i]] }))))));
  }
  build();
  root.rebuild = build;
  root.stop = stop;
  return root;
}

function exampleSelect(h, list, b, onPick) {
  const sel = h('select', { 'aria-label': T('Esempio') }, h('option', { value: '' }, T('Esempi…')), list.map((e) => h('option', { value: e.k, selected: e.k === b.ex }, e.label)));
  sel.addEventListener('change', () => { const e = list.find((x) => x.k === sel.value); if (e) onPick(e); });
  return sel;
}

export function mutexTool(b, ctx, box, kit) {
  const { h, area } = kit;
  const desc = h('p', { class: 'tool-hint' });
  const showDesc = () => { const e = MUTEX_EXAMPLES.find((x) => x.k === b.ex); desc.textContent = e ? e.desc : T('Il tuo programma, nel linguaggio del cacciatore di race condition.'); };
  let t;
  const src = area(b, 'src', 'tool-src mono', 10, () => { ctx.onChange(); clearTimeout(t); t = setTimeout(() => kit.later(ctx, () => { b.ex = MUTEX_EXAMPLES.find((x) => x.src === b.src)?.k || ''; showDesc(); player.rebuild(); }), 500); });
  let player = playerView(b, ctx, kit, () => b.src || '');
  const pick = (e) => {
    const old = { src: b.src, ex: b.ex, policy: b.policy, fair: b.fair };
    const own = b.src && !MUTEX_EXAMPLES.some((x) => x.src === b.src);
    Object.assign(b, { ex: e.k, src: e.src, policy: e.policy || b.policy, fair: !!e.fair });
    ctx.onChange(); src.value = b.src; showDesc(); rebuildAll();
    if (own) ctx.toast?.(T('Caricato l\'esempio al posto del tuo programma'), { label: tp('azione', 'Annulla'), fn: () => { Object.assign(b, old); ctx.onChange(); src.value = b.src; showDesc(); rebuildAll(); } });
  };
  const rebuildAll = () => { const np = playerView(b, ctx, kit, () => b.src || ''); player.stop(); player.replaceWith(np); player = np; };
  const edit = h('details', { class: 'tool-steps' }, h('summary', {}, T('Il programma (modificalo come vuoi)')), src);
  box.append(h('div', { class: 'tool-head' }, h('strong', {}, T('Simulatore di mutex')), exampleSelect(h, MUTEX_EXAMPLES, b, pick)), desc, edit, player);
  showDesc();
}

export function starveTool(b, ctx, box, kit) {
  const { h, area } = kit;
  const ex = () => STARVE_EXAMPLES.find((x) => x.k === b.ex) || STARVE_EXAMPLES[0];
  const desc = h('p', { class: 'tool-hint' });
  const body = h('div', { class: 'tool-out' });
  let player = null;
  const render = () => {
    player?.stop?.();
    const e = ex();
    desc.textContent = e.desc;
    if (e.fam === 'sync') {
      let t;
      const src = area(b, 'src', 'tool-src mono', 10, () => { ctx.onChange(); clearTimeout(t); t = setTimeout(() => kit.later(ctx, () => player.rebuild()), 500); });
      player = playerView(b, ctx, kit, () => b.src || '');
      body.replaceChildren(h('details', { class: 'tool-steps' }, h('summary', {}, T('Il programma (modificalo come vuoi)')), src), player);
      return;
    }
    player = null;
    const src = area(b, 'src', 'tool-src mono', 6, () => { ctx.onChange(); clearTimeout(tt); tt = setTimeout(() => kit.later(ctx, drawCpu), 300); });
    let tt;
    const param = e.b === 'prioa'
      ? h('label', { class: 'inline' }, T('età '), numIn(h, b, 'age', e.age || 2, () => kit.later(ctx, drawCpu), ctx))
      : e.boost ? h('label', { class: 'inline' }, T('boost ogni') + ' ', numIn(h, b, 'boost', e.boost, () => kit.later(ctx, drawCpu), ctx), T(' unità')) : null;
    const out = h('div', { class: 'sim-cmp' });
    const drawCpu = () => {
      let procs;
      try { procs = parseProcs(b.src || ''); } catch (er) { out.replaceChildren(h('p', { class: 'tool-err' }, er.message)); return; }
      const lab = (k) => ALGOS.find((a) => a.k === k)?.label || k;
      const runs = [
        { title: T('Senza rimedio: {x}', { x: lab(e.a) }), r: schedule(e.a, procs, { quanta: [1, 2, 4] }) },
        { title: e.b === 'prioa' ? T('Con l\'invecchiamento (età {n})', { n: b.age || e.age }) : e.boost ? T('Con il boost ogni {n}', { n: b.boost || e.boost }) : `Con ${lab(e.b)}`, r: schedule(e.b, procs, { quanta: [1, 2, 4], age: b.age || e.age, boost: e.boost ? (b.boost || e.boost) : 0 }) },
      ];
      const names = procs.map((p) => p.name);
      const worstOf = (r) => r.rows.reduce((a, x) => (x.longest > a.longest ? x : a), r.rows[0]);
      const before = worstOf(runs[0].r);
      out.replaceChildren(...runs.map(({ title, r }, k) => {
        const worst = worstOf(r);
        const lim = Math.max(6, 2 * Math.ceil(r.rows.reduce((a, x) => a + x.longest, 0) / r.rows.length));
        // il rimedio si giudica rispetto alla colonna senza rimedio: basta che l'attesa più lunga sia almeno dimezzata
        const same = r.rows.find((x) => x.name === before.name) || worst;
        const bad = k === 0 ? worst.longest >= lim : same.longest > before.longest / 2;
        const msg = k === 0
          ? (bad ? T('⚠ {p} resta senza CPU per {n} unità di fila', { p: worst.name, n: worst.longest }) : T('✅ attesa più lunga senza CPU: {n} ({p})', { n: worst.longest, p: worst.name }))
          : (bad ? '⚠ ' : '✅ ') + T('{p} ora aspetta al massimo {n} di fila (senza rimedio {prima})', { p: same.name, n: same.longest, prima: before.longest }) + (worst !== same ? '; ' + T('l\'attesa più lunga ora è di {p}: {n}', { p: worst.name, n: worst.longest }) : '');
        return h('div', { class: 'sim-cmp-col' }, h('h4', {}, title), kit.gantt(r, names),
          h('p', { class: bad ? 'xray-alert' : 'xray-ok' }, msg),
          h('table', { class: 'tool-table' }, h('thead', {}, h('tr', {}, [T('Processo'), T('Attesa totale'), T('Attesa più lunga'), T('Fine')].map((x) => h('th', {}, x)))),
            h('tbody', {}, r.rows.filter((x) => x.longest > 0 || x === worst || /^(Basso|Lungo|Batch)$/.test(x.name)).slice(0, 8).map((x) => h('tr', { class: x === worst ? 'best' : '' }, [x.name, x.waiting, x.longest, x.end].map((v) => h('td', {}, String(v))))))));
      }));
    };
    body.replaceChildren(h('div', { class: 'tool-head' }, h('span', { class: 'tool-hint' }, T('Un processo per riga: nome arrivo durata [priorità]')), param), src, out);
    drawCpu();
  };
  const pick = (e) => {
    const old = { ...b };
    const own = b.src && !STARVE_EXAMPLES.some((x) => x.src === b.src);
    Object.assign(b, { ex: e.k, src: e.src, policy: e.policy || 'giro', fair: !!e.fair });
    ctx.onChange(); render();
    if (own) ctx.toast?.(T('Caricato l\'esempio al posto del tuo testo'), { label: tp('azione', 'Annulla'), fn: () => { Object.assign(b, old); ctx.onChange(); render(); } });
  };
  box.append(h('div', { class: 'tool-head' }, h('strong', {}, T('Simulatore di starvation')), exampleSelect(h, STARVE_EXAMPLES, b, pick)), desc, body);
  render();
}
function numIn(h, b, key, def, onDone, ctx) {
  const i = h('input', { type: 'number', min: 1, max: 99, value: b[key] || def, class: 'num', 'aria-label': key });
  i.addEventListener('input', () => { b[key] = Math.max(1, +i.value || def); ctx.onChange(); onDone(); });
  return i;
}
