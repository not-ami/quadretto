// Quadretto — strumenti dei corsi nei quaderni smart (2026.11.4). Per ora Sistemi Operativi:
// scheduling con Gantt, cacciatore di race condition, quiz con penalità. Ogni strumento è un blocco «tool»
// dell'appunto: { type: 'tool', tool: 'sched' | 'race' | 'quiz', src: testo, … } (testo salvato, cercabile).
// Si calcola solo quando lo chiedi, e mai mentre la penna scrive (ctx.quiet).
// Qui t è anche una variabile locale: la traduzione si chiama T() (vedi i18n.js).
import { t as T, tn, getLang } from './i18n.js';
import { ALGOS, schedule, parseProcs } from './sched.js';
import { mutexTool, starveTool, MUTEX_EXAMPLES, STARVE_EXAMPLES } from './sim.js';
export { TEMPLATES } from './so-templates.js';

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
const shortDate = () => new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });

const RACE_EXAMPLE = `# Cacciatore di race condition: prova TUTTI gli ordini di esecuzione dei thread.
# Questo è il prod/cons con monitor della lezione, scritto con un «if» invece del «while»:
# premi «Cerca» e guarda la sequenza che porta cont sotto zero. Poi cambia «if» in «while».
const N = 1
shared cont = 0
mutex m
cond pieno, vuoto

thread Produttore x2:
    lock m
    if cont == N:
        wait pieno, m
    cont = cont + 1
    signal vuoto
    unlock m

thread Consumatore x2:
    lock m
    if cont == 0:
        wait vuoto, m
    cont = cont - 1
    signal pieno
    unlock m

always cont >= 0 && cont <= N
finally cont == 0
`;

const QUIZ_EXAMPLE = `# Quiz: «?» domanda, «+» risposta giusta, «-» sbagliata, «>» spiegazione (dopo la consegna), «##» una parte.
# Punteggio come all'esame: +1 giusta, 0 non data, −0,25 sbagliata. Scrivi pure le tue domande.

## Processi
? Dopo pid = fork(), che cosa vale pid nel processo figlio?
- il pid del padre
+ 0
- il pid del figlio
- -1
> fork restituisce 0 nel figlio, il pid del figlio nel padre e -1 se non riesce.

? Un programma fa printf("a") (senza \\n) e poi fork(), con lo stdout su una pipe. Cosa si vede?
- «a» una volta
+ «a» due volte
- niente
- dipende dallo scheduler
> Il testo è ancora nel buffer di stdio: il figlio ne riceve una copia e alla fine lo scrivono entrambi.

? Un figlio termina ma il padre non chiama mai wait. In che stato resta il figlio?
- orfano
+ zombie
- bloccato
- in esecuzione
> Resta nella tabella dei processi finché il padre non ne legge lo stato (o il padre termina).

## Memoria condivisa e semafori POSIX
? Subito dopo shm_open con O_CREAT, quanto è grande la memoria?
+ 0 byte: serve ftruncate
- una pagina
- quanto chiesto da mmap
- 4096 byte
> Senza ftruncate, accedere alla memoria mappata dà SIGBUS.

? Cosa restituisce mmap se fallisce?
- NULL
+ MAP_FAILED
- -1 come int
- 0
> MAP_FAILED vale (void *) -1: confrontare con NULL non trova l'errore.

? sem_init(&s, 1, 1) tra processi creati con fork funziona se…
- s è una variabile globale
- s è una variabile locale di main
+ s sta in una memoria condivisa (mmap MAP_SHARED)
- s è dichiarata static
> Con pshared = 1 il semaforo deve stare in memoria che i processi condividono davvero: dopo la fork le variabili normali sono copie.

? Un programma termina senza sem_unlink del semaforo con nome. Alla prossima esecuzione con sem_open(nome, O_CREAT, 0660, 1)…
- il semaforo riparte da 1
+ ritrova il semaforo vecchio, col valore che aveva
- sem_open fallisce sempre
- il kernel lo ha già rimosso
> Il valore iniziale conta solo quando il semaforo viene creato davvero.

## Code di messaggi e thread
? La coda è stata creata con mq_msgsize = 128. mq_receive con un buffer di 64 byte e un messaggio di 10 byte…
- riceve i 10 byte
+ fallisce con EMSGSIZE
- tronca il messaggio a 64 byte
- si blocca
> Il buffer deve essere grande almeno mq_msgsize, qualunque sia la lunghezza del messaggio.

? Nelle code POSIX, come si fa la «ricezione selettiva per tipo» di System V?
- con il campo mtype
+ non c'è: si usano più code (o le priorità)
- con mq_receive(..., tipo)
- con mq_notify
> In POSIX il messaggio non ha tipo: si usa per esempio una coda di risposta per ogni client.

? Perché pthread_cond_wait va dentro un while e non un if?
- per efficienza
+ con signal-and-continue chi si sveglia può trovare la condizione di nuovo falsa
- perché pthread_cond_wait non rilascia il mutex
- perché signal sveglia sempre tutti
> Tra il signal e il momento in cui il thread riprende il mutex, un altro può aver cambiato lo stato (e ci sono anche i risvegli spuri).

? pthread_cond_signal su una condizione su cui nessuno aspetta…
- resta memorizzato per il prossimo che fa wait
+ si perde
- blocca chi lo chiama
- dà errore
> Le condition variable non hanno memoria: per questo la condizione si controlla sempre prima di aspettare.

? pthread_create(&t[i], NULL, f, &i) dentro un for: cosa può succedere?
- niente di strano
+ più thread leggono lo stesso valore di i (o uno già cambiato)
- il programma non compila
- i thread partono in ordine
> Tutti ricevono l'indirizzo della stessa variabile, che il ciclo intanto incrementa.
`;

export const TOOLS = {
  sched: { k: 'sched', course: 'so', short: T('Scheduling'), label: T('Scheduling (Gantt)'), sub: T('FCFS, SJF, SRTF, RR, priorità, code con retroazione: Gantt, tempi e medie'), title: () => `Scheduling — ${shortDate()}` },
  race: { k: 'race', course: 'so', short: T('Race condition'), label: T('Cacciatore di race condition'), sub: T('Prova tutti gli ordini dei thread: deadlock, aggiornamenti persi, if al posto di while'), title: () => `Race condition — ${shortDate()}` },
  mutex: { k: 'mutex', course: 'so', short: T('Mutex'), label: T('Simulatore di mutex'), sub: T('Passo passo: lock, deadlock, Peterson, filosofi, variabili condizione, semafori'), title: () => `Mutex — ${shortDate()}` },
  starve: { k: 'starve', course: 'so', short: T('Starvation'), label: T('Simulatore di starvation'), sub: T('Chi non va mai avanti: priorità, SJF, code con retroazione, lettori e scrittori, e i rimedi'), title: () => `Starvation — ${shortDate()}` },
  quiz: { k: 'quiz', course: 'so', short: T('Quiz'), label: T('Quiz con penalità'), sub: T('+1 / 0 / −0,25 come all\'esame, punteggio per parte; domande tue o di esempio'), title: () => `Quiz — ${shortDate()}` },
};
export const toolsFor = (course) => (course ? Object.values(TOOLS).filter((t) => t.course === course) : []);
export function newTool(k, uuid) {
  const base = { id: uuid(), type: 'tool', tool: k };
  if (k === 'sched') return { ...base, src: 'P1 0 8\nP2 1 4\nP3 2 9\nP4 3 5', algo: 'fcfs', q: 2, quanta: '1,2,4', prio: false };
  if (k === 'race') return { ...base, src: RACE_EXAMPLE };
  if (k === 'quiz') return { ...base, src: QUIZ_EXAMPLE, answers: {}, done: false, mode: 'take' };
  if (k === 'mutex') { const e = MUTEX_EXAMPLES[0]; return { ...base, ex: e.k, src: e.src, policy: e.policy, fair: false, speed: 'medio' }; }
  if (k === 'starve') { const e = STARVE_EXAMPLES[0]; return { ...base, ex: e.k, src: e.src, policy: 'giro', fair: false, speed: 'medio' }; }
  return base;
}

export function renderTool(b, ctx) {
  const box = h('div', { class: 'tool tool-' + b.tool });
  box.addEventListener('click', (e) => e.stopPropagation());
  if (b.tool === 'sched') schedTool(b, ctx, box);
  else if (b.tool === 'race') raceTool(b, ctx, box);
  else if (b.tool === 'quiz') quizTool(b, ctx, box);
  else if (b.tool === 'mutex') mutexTool(b, ctx, box, { h, later, area, HUE, gantt });
  else if (b.tool === 'starve') starveTool(b, ctx, box, { h, later, area, HUE, gantt });
  else box.append(h('p', {}, T('Strumento sconosciuto: forse viene da una versione più nuova di Quadretto.')));
  return box;
}
const later = (ctx, fn) => { const go = () => (ctx.quiet && !ctx.quiet() ? setTimeout(go, 300) : fn()); go(); };
const area = (b, key, cls, rows, onInput) => {
  const ta = h('textarea', { class: cls, spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off', rows });
  ta.value = b[key] || '';
  ta.addEventListener('input', () => { b[key] = ta.value; onInput?.(); });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); ta.setRangeText('    ', ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); } });
  return ta;
};

// --- scheduling ------------------------------------------------------------------------------------------------
const HUE = (i) => `hsl(${[215, 150, 20, 280, 45, 330, 190, 95, 0, 255][i % 10]} 65% 52%)`;
function gantt(res, names) {
  const tot = Math.max(res.end, 1);
  const color = new Map(names.map((n, i) => [n, HUE(i)]));
  const bar = h('div', { class: 'gantt' });
  for (const s of res.segs) {
    bar.append(h('div', { class: 'g-seg' + (s.p ? '' : ' idle'), style: `left:${100 * s.start / tot}%;width:${100 * (s.end - s.start) / tot}%;${s.p ? `background:${color.get(s.p)}` : ''}`, title: `${s.p || T('CPU libera')}: ${s.start} → ${s.end}` }, s.p || ''));
  }
  const ticks = h('div', { class: 'g-ticks' });
  const marks = [...new Set([0, ...res.segs.map((s) => s.end)])];
  for (const m of marks) ticks.append(h('span', { style: `left:${100 * m / tot}%` }, String(m)));
  return h('div', { class: 'gantt-wrap' }, bar, ticks);
}
function schedTool(b, ctx, box) {
  const out = h('div', { class: 'tool-out' });
  const src = area(b, 'src', 'tool-src mono', 5, () => { ctx.onChange(); draw(); });
  const algoSel = h('select', { 'aria-label': T('Algoritmo') }, ALGOS.map((a) => h('option', { value: a.k, selected: a.k === b.algo }, a.label)));
  const q = h('input', { type: 'number', min: 1, max: 50, value: b.q || 2, 'aria-label': T('Quanto'), class: 'num' });
  const quanta = h('input', { value: b.quanta || '1,2,4', 'aria-label': T('Quanti delle code'), class: 'mono small-in' });
  const qBox = h('label', { class: 'inline' }, 'quanto ', q), mBox = h('label', { class: 'inline' }, T('quanti delle code') + ' ', quanta);
  const compare = h('button', { type: 'button', class: 'btn small' }, T('Confronta tutti'));
  algoSel.addEventListener('change', () => { b.algo = algoSel.value; ctx.onChange(); draw(); });
  q.addEventListener('input', () => { b.q = +q.value || 1; ctx.onChange(); draw(); });
  quanta.addEventListener('input', () => { b.quanta = quanta.value; ctx.onChange(); draw(); });
  let cmp = false;
  compare.addEventListener('click', () => { cmp = !cmp; compare.classList.toggle('on', cmp); draw(); });
  const opts = () => ({ q: b.q || 2, quanta: String(b.quanta || '1,2,4').split(/[\s,;]+/).map(Number).filter((x) => x > 0) });
  let t;
  const draw = () => { clearTimeout(t); t = setTimeout(() => later(ctx, render), 150); };
  const render = () => {
    qBox.hidden = b.algo !== 'rr'; mBox.hidden = b.algo !== 'mlfq';
    let procs;
    try { procs = parseProcs(b.src || ''); } catch (e) { out.replaceChildren(h('p', { class: 'tool-err' }, e.message)); return; }
    const res = schedule(b.algo, procs, opts());
    const names = procs.map((p) => p.name);
    const showPrio = b.algo === 'prio' || b.algo === 'priop';
    const f = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(2).replace('.', ','));
    const table = h('table', { class: 'tool-table' },
      h('thead', {}, h('tr', {}, [T('Processo'), T('Arrivo'), T('Durata'), showPrio ? T('Priorità') : null, T('Fine'), T('Turnaround'), T('Attesa'), T('Risposta')].filter(Boolean).map((x) => h('th', {}, x)))),
      h('tbody', {}, res.rows.map((r) => h('tr', {}, [r.name, r.arrival, r.burst, showPrio ? r.prio : null, r.end, r.turnaround, r.waiting, r.response].filter((x) => x !== null).map((x) => h('td', {}, String(x))))),
        h('tr', { class: 'avg' }, h('td', { colspan: showPrio ? 5 : 4 }, T('Media')), h('td', {}, f(res.avg.turnaround)), h('td', {}, f(res.avg.waiting)), h('td', {}, f(res.avg.response)))));
    const steps = h('details', { class: 'tool-steps' }, h('summary', {}, T('Passaggi (perché quel processo, in quel momento)')),
      h('ol', {}, res.notes.map((n) => h('li', {}, h('b', {}, `t = ${n.t}: `), n.text))));
    const kids = [gantt(res, names), table, h('p', { class: 'tool-hint' }, T('Turnaround = fine − arrivo · attesa = turnaround − durata · risposta = primo ingresso in CPU − arrivo. A parità vince chi è arrivato prima (poi chi viene prima nell\'elenco); in Round Robin chi arriva entra in coda prima del processo che ha appena finito il quanto.')), steps];
    if (cmp) {
      const all = ALGOS.map((a) => ({ a, r: schedule(a.k, procs, opts()) }));
      const bestW = Math.min(...all.map((x) => x.r.avg.waiting));
      kids.unshift(h('table', { class: 'tool-table cmp' }, h('thead', {}, h('tr', {}, [T('Algoritmo'), T('Attesa media'), T('Turnaround medio'), T('Risposta media')].map((x) => h('th', {}, x)))),
        h('tbody', {}, all.map(({ a, r }) => h('tr', { class: r.avg.waiting === bestW ? 'best' : '' }, h('td', {}, a.label), h('td', {}, f(r.avg.waiting)), h('td', {}, f(r.avg.turnaround)), h('td', {}, f(r.avg.response)))))));
    }
    out.replaceChildren(...kids);
  };
  box.append(h('div', { class: 'tool-head' }, h('strong', {}, T('Scheduling della CPU')), algoSel, qBox, mBox, compare),
    h('p', { class: 'tool-hint' }, T('Un processo per riga: nome arrivo durata [priorità]. Priorità: numero più basso = più importante.')), src, out);
  render();
}

// --- cacciatore di race condition -------------------------------------------------------------------------------
let raceW = null, raceSeq = 0;
function raceRun(src) {
  raceW ||= new Worker('/js/race-worker.js', { type: 'module' });
  const id = ++raceSeq;
  return new Promise((resolve) => {
    const on = (e) => { if (e.data.id !== id) return; raceW.removeEventListener('message', on); resolve(e.data); };
    raceW.addEventListener('message', on);
    raceW.postMessage({ id, src, maxStates: 250000, lang: getLang() });
  });
}
function raceTool(b, ctx, box) {
  const out = h('div', { class: 'tool-out' });
  const src = area(b, 'src', 'tool-src mono', 14, () => ctx.onChange());
  const go = h('button', { type: 'button', class: 'btn small primary' }, T('Cerca'));
  const help = h('details', { class: 'tool-steps' }, h('summary', {}, T('Come si scrive')),
    h('pre', { class: 'tool-help mono' }, `shared cont = 0        variabile condivisa (intera)
const N = 3            costante
mutex m                cond pieno, vuoto         sem s = 1
thread Nome x2:        due copie (Nome1, Nome2); dentro vale «id» = 1, 2…
    lock m / unlock m
    wait pieno, m      rilascia m, dorme; al signal riprende m (pthread: signal-and-continue)
    signal vuoto / broadcast vuoto
    P s / V s          (anche sem_wait s / sem_post s)
    cont = cont + 1    su una condivisa sono DUE passi: legge, poi scrive
    local t = cont     variabile del thread
    if … :  else:  while … :  repeat 3:  assert …  skip
always cont >= 0       deve valere in ogni momento
finally cont == 0      deve valere quando tutti hanno finito`));
  go.addEventListener('click', async () => {
    go.disabled = true; out.replaceChildren(h('p', { class: 'tool-hint' }, T('Provo tutti gli ordini possibili…')));
    const t0 = performance.now();
    const res = await raceRun(b.src || '');
    go.disabled = false;
    if (!res.ok) { out.replaceChildren(h('p', { class: 'tool-err' }, res.error)); return; }
    const r = res.r, ms = Math.round(performance.now() - t0);
    const kids = [];
    if (r.found) {
      const f = r.found;
      kids.push(h('p', { class: 'xray-alert' }, { deadlock: T('Deadlock: '), always: T('Invariante violato: '), finally: T('Esito sbagliato: '), error: T('Errore: ') }[f.kind], f.msg + '.'));
      if (f.stuck) kids.push(h('ul', { class: 'xray-list' }, f.stuck.map((x) => h('li', {}, x))));
      kids.push(h('p', { class: 'tool-hint' }, T('Ecco la sequenza più corta che ci arriva ({n} passi). Le colonne a destra sono le variabili condivise dopo ogni passo.', { n: f.trace.length })));
      const lines = (b.src || '').split('\n');
      kids.push(h('table', { class: 'tool-table race' },
        h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, T('Thread')), h('th', {}, T('Fa')), h('th', {}, T('Riga')), r.shared.map((v) => h('th', {}, v)))),
        h('tbody', {}, f.trace.map((s, i) => h('tr', { class: i === f.trace.length - 1 ? 'last' : '' }, h('td', {}, String(i + 1)), h('td', { class: 'who', style: `color:${HUE(s.t)}` }, r.names[s.t]), h('td', {}, s.what),
          h('td', { class: 'mono', title: (lines[s.n - 1] || '').trim() }, `${s.n}: ${(lines[s.n - 1] || '').trim().slice(0, 28)}`), s.sh.map((v) => h('td', { class: 'mono' }, String(v))))))));
    } else kids.push(h('p', { class: 'xray-ok' }, r.truncated ? T('Nessun problema negli {n} stati esaminati, ma lo spazio è troppo grande per finire: riduci i thread o le ripetizioni per una risposta completa.', { n: r.states }) : T('Nessun problema: ho provato tutti gli ordini possibili ({n} stati) e invarianti e esiti finali valgono sempre.', { n: r.states })));
    if (r.finals.length) kids.push(h('p', { class: 'tool-hint' }, T('Esiti finali possibili: {esiti}', { esiti: r.finals.map((f) => Object.entries(f).map(([k, v]) => `${k} = ${v}`).join(', ') || '—').join(' · ') })));
    kids.push(h('p', { class: 'tool-hint' }, T('{n} stati · {ms} ms', { n: r.states, ms })));
    out.replaceChildren(...kids);
  });
  box.append(h('div', { class: 'tool-head' }, h('strong', {}, T('Cacciatore di race condition')), go), help, src, out);
}

// --- quiz con penalità ---------------------------------------------------------------------------------------------
export function parseQuiz(src) {
  const parts = [];
  let part = { title: T('Domande'), qs: [] }, q = null;
  for (const raw of (src || '').split('\n')) {
    const l = raw.trim();
    if (!l || l.startsWith('#') && !l.startsWith('##')) continue;
    if (l.startsWith('##')) { if (part.qs.length) parts.push(part); part = { title: l.slice(2).trim() || T('Parte'), qs: [] }; continue; }
    if (l.startsWith('?')) { q = { text: l.slice(1).trim().replace(/\\n/g, '\\n'), opts: [], ok: -1, why: '' }; part.qs.push(q); continue; }
    if (!q) continue;
    if (l.startsWith('+') || l.startsWith('-')) { if (l[0] === '+') q.ok = q.opts.length; q.opts.push(l.slice(1).trim()); }
    else if (l.startsWith('>')) q.why += (q.why ? ' ' : '') + l.slice(1).trim();
  }
  if (part.qs.length) parts.push(part);
  return parts;
}
function quizTool(b, ctx, box) {
  b.answers ||= {};
  const body = h('div', { class: 'tool-out' });
  const modeBtn = h('button', { type: 'button', class: 'btn small' });
  const draw = () => {
    modeBtn.textContent = b.mode === 'edit' ? T('Fai il quiz') : T('Modifica le domande');
    if (b.mode === 'edit') {
      body.replaceChildren(h('p', { class: 'tool-hint' }, T('«?» domanda · «+» risposta giusta · «-» sbagliata · «>» spiegazione · «##» titolo di una parte. Le righe con # sono commenti.')),
        area(b, 'src', 'tool-src mono', 18, () => ctx.onChange()));
      return;
    }
    const parts = parseQuiz(b.src);
    if (!parts.length) { body.replaceChildren(h('p', { class: 'tool-err' }, T('Nessuna domanda: tocca «Modifica le domande».'))); return; }
    let n = 0;
    const kids = [];
    const score = { c: 0, e: 0, tot: 0, parts: [] };
    for (const p of parts) {
      const ps = { title: p.title, c: 0, e: 0, tot: p.qs.length };
      kids.push(h('h4', { class: 'quiz-part' }, p.title));
      for (const q of p.qs) {
        const qi = n++;
        const ans = b.answers[qi];
        if (b.done) { if (ans === q.ok) ps.c++; else if (ans != null) ps.e++; }
        kids.push(h('div', { class: 'quiz-q' + (b.done ? (ans == null ? ' skip' : ans === q.ok ? ' right' : ' wrong') : '') },
          h('p', { class: 'quiz-text' }, h('b', {}, `${qi + 1}. `), q.text),
          h('div', { class: 'quiz-opts' }, q.opts.map((o, oi) => h('button', { type: 'button', class: 'quiz-opt' + (ans === oi ? ' on' : '') + (b.done && oi === q.ok ? ' ok' : ''), disabled: b.done || null,
            onclick: () => { if (b.answers[qi] === oi) delete b.answers[qi]; else b.answers[qi] = oi; ctx.onChange(); draw(); } }, String.fromCharCode(65 + oi) + ') ' + o))),
          b.done && q.why ? h('p', { class: 'quiz-why' }, q.why) : null));
      }
      score.c += ps.c; score.e += ps.e; score.tot += ps.tot; score.parts.push(ps);
    }
    const answered = Object.keys(b.answers).length;
    if (b.done) {
      const pts = score.c - 0.25 * score.e;
      const pct = Math.round(100 * pts / score.tot);
      const giud = pct < 55 ? T('da rivedere: guarda le parti con più errori') : pct < 70 ? T('di base: i concetti ci sono, i dettagli sono fragili') : pct < 85 ? T('buona preparazione') : T('ottima preparazione');
      kids.unshift(h('div', { class: 'quiz-score' }, h('strong', {}, `${pts.toString().replace('.', ',')} / ${score.tot} (${pct}%)`), h('span', {}, ` · ${giud}`),
        h('p', { class: 'tool-hint' }, T('{c} giuste, {e} sbagliate (−0,25 ciascuna), {n} non date. Per parte: ', { c: score.c, e: score.e, n: score.tot - score.c - score.e }) + score.parts.map((p) => `${p.title} ${p.c - 0.25 * p.e}/${p.tot}`).join(' · ').replace(/\./g, ','))));
      kids.push(h('button', { type: 'button', class: 'btn small', onclick: () => { b.done = false; b.answers = {}; ctx.onChange(); draw(); } }, T('Rifai da capo')));
    } else {
      kids.push(h('div', { class: 'quiz-foot' }, h('span', { class: 'tool-hint' }, T('{n} risposte su {tot}. Una risposta toccata di nuovo si toglie: le non date valgono 0, le sbagliate −0,25.', { n: answered, tot: score.tot })),
        h('button', { type: 'button', class: 'btn small primary', onclick: () => { b.done = true; ctx.onChange(); draw(); } }, T('Consegna'))));
    }
    body.replaceChildren(...kids);
  };
  modeBtn.addEventListener('click', () => { b.mode = b.mode === 'edit' ? 'take' : 'edit'; ctx.onChange(); draw(); });
  box.append(h('div', { class: 'tool-head' }, h('strong', {}, T('Quiz con penalità')), modeBtn), body);
  draw();
}
