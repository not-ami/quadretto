// Quadretto — cacciatore di race condition (2026.11.4).
// Un piccolo linguaggio per thread che si sincronizzano (mutex, condition variable con la semantica dei pthread
// signal-and-continue, semafori) e un motore che prova TUTTI gli ordini di esecuzione possibili (ricerca in
// ampiezza sugli stati). Trova: deadlock, invarianti violati (always), assert falliti, esiti finali sbagliati
// (finally), unlock di un mutex non proprio, wait senza mutex. Restituisce il controesempio più corto.
//
// Linguaggio (rientri come in Python, commenti con # o //):
//   shared cont = 0            const N = 2          mutex m          cond pieno, vuoto          sem s = 1
//   thread Produttore x2:      (x2 = due copie, Produttore1 e Produttore2; dentro, la variabile id vale 1, 2…)
//       lock m / unlock m / wait pieno, m / signal vuoto / broadcast vuoto / P s / V s (o sem_wait s / sem_post s)
//       cont = cont + 1        (su una variabile condivisa sono DUE passi: legge, poi scrive)
//       local t = cont         (variabile del thread)
//       if … : / else: / while … : / repeat 3:   assert …   skip
//   always cont >= 0           finally cont == 0
// Qui t e T sono variabili: la traduzione si chiama TT() (vedi i18n.js). Nel worker la lingua la imposta race-worker.js.
import { t as TT } from './i18n.js';


// --- espressioni ------------------------------------------------------------------------------------------------
function tokenize(s, line) {
  const out = [];
  const re = /\s*(?:(\d+)|(true|false|and|or|not)\b|([A-Za-z_]\w*)|(==|!=|<=|>=|&&|\|\||[-+*/%<>!()]))/y;
  let i = 0;
  s = s.trim();
  while (i < s.length) {
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m) throw err(line, TT('non capisco «{x}»', { x: s.slice(i, i + 12) }));
    i = re.lastIndex;
    if (m[1]) out.push({ k: 'num', v: +m[1] });
    else if (m[2]) out.push(m[2] === 'true' ? { k: 'num', v: 1 } : m[2] === 'false' ? { k: 'num', v: 0 } : { k: 'op', v: { and: '&&', or: '||', not: '!' }[m[2]] });
    else if (m[3]) out.push({ k: 'id', v: m[3] });
    else out.push({ k: 'op', v: m[4] });
    while (i < s.length && s[i] === ' ') i++;
  }
  return out;
}
const PREC = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
function parseExpr(src, line) {
  const t = tokenize(src, line);
  let i = 0;
  const peek = () => t[i];
  const prim = () => {
    const x = t[i++];
    if (!x) throw err(line, 'espressione incompleta');
    if (x.k === 'num') return { k: 'num', v: x.v };
    if (x.k === 'id') return { k: 'id', v: x.v };
    if (x.v === '(') { const e = bin(0); if (t[i++]?.v !== ')') throw err(line, 'manca una parentesi chiusa'); return e; }
    if (x.v === '-' || x.v === '!') return { k: 'un', op: x.v, a: prim() };
    throw err(line, TT('«{x}» fuori posto', { x: x.v }));
  };
  const bin = (min) => {
    let a = prim();
    while (peek()?.k === 'op' && PREC[peek().v] > min) { const op = t[i++].v; a = { k: 'bin', op, a, b: bin(PREC[op]) }; }
    return a;
  };
  const e = bin(0);
  if (i < t.length) throw err(line, TT('«{x}» in più nell\'espressione', { x: t[i].v }));
  return e;
}
const ids = (e, out = new Set()) => { if (e.k === 'id') out.add(e.v); else if (e.k === 'un') ids(e.a, out); else if (e.k === 'bin') { ids(e.a, out); ids(e.b, out); } return out; };
function ev(e, env) {
  switch (e.k) {
    case 'num': return e.v;
    case 'id': { const v = env(e.v); if (v === undefined) throw new Error(TT('variabile «{x}» sconosciuta', { x: e.v })); return v; }
    case 'un': return e.op === '-' ? -ev(e.a, env) : +!ev(e.a, env);
    default: {
      const a = ev(e.a, env);
      if (e.op === '&&') return a ? +!!ev(e.b, env) : 0;
      if (e.op === '||') return a ? 1 : +!!ev(e.b, env);
      const b = ev(e.b, env);
      switch (e.op) {
        case '+': return a + b; case '-': return a - b; case '*': return a * b;
        case '/': if (!b) throw new Error('divisione per zero'); return Math.trunc(a / b);
        case '%': if (!b) throw new Error('resto per zero'); return a % b;
        case '==': return +(a === b); case '!=': return +(a !== b); case '<': return +(a < b); case '<=': return +(a <= b); case '>': return +(a > b); case '>=': return +(a >= b);
      }
    }
  }
  return 0;
}
const err = (line, msg) => Object.assign(new Error(TT('riga {n}: {msg}', { n: line, msg })), { line });

// --- compilazione ---------------------------------------------------------------------------------------------------
export function compile(src) {
  const lines = src.split('\n').map((raw, i) => ({ n: i + 1, raw, text: raw.replace(/(#|\/\/).*$/, '').replace(/\s+$/, '') })).filter((l) => l.text.trim());
  const P = { shared: {}, consts: {}, mutex: new Set(), cond: new Set(), sem: {}, threads: [], always: [], finally: [], srcLines: src.split('\n') };
  const indent = (l) => /^\s*/.exec(l.text.replace(/\t/g, '    '))[0].length;
  let i = 0;
  const names = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
  // blocco con rientro maggiore di `base`
  const block = (base, th) => {
    const out = [];
    if (i >= lines.length || indent(lines[i]) <= base) throw err(lines[i - 1]?.n || 1, 'qui serve un blocco rientrato');
    const lv = indent(lines[i]);
    while (i < lines.length && indent(lines[i]) >= lv) {
      if (indent(lines[i]) > lv) throw err(lines[i].n, 'rientro inatteso');
      out.push(stmt(lv, th));
    }
    return out;
  };
  const stmt = (lv, th) => {
    const l = lines[i++];
    const t = l.text.trim();
    let m;
    if ((m = /^(if|while)\s+(.+):$/.exec(t))) {
      const node = { k: m[1], e: parseExpr(m[2], l.n), body: block(lv, th), n: l.n };
      if (m[1] === 'if' && i < lines.length && indent(lines[i]) === lv && /^else\s*:$/.test(lines[i].text.trim())) { i++; node.else = block(lv, th); }
      return node;
    }
    if ((m = /^repeat\s+(.+):$/.exec(t))) return { k: 'repeat', e: parseExpr(m[1], l.n), body: block(lv, th), n: l.n };
    if ((m = /^lock\s+(\w+)$/.exec(t))) { need('mutex', m[1], l.n); return { k: 'lock', m: m[1], n: l.n }; }
    if ((m = /^unlock\s+(\w+)$/.exec(t))) { need('mutex', m[1], l.n); return { k: 'unlock', m: m[1], n: l.n }; }
    if ((m = /^wait\s+(\w+)\s*,\s*(\w+)$/.exec(t))) { need('cond', m[1], l.n); need('mutex', m[2], l.n); return { k: 'wait', c: m[1], m: m[2], n: l.n }; }
    if ((m = /^(signal|broadcast)\s+(\w+)$/.exec(t))) { need('cond', m[2], l.n); return { k: m[1], c: m[2], n: l.n }; }
    if ((m = /^(P|sem_wait|wait_sem)\s+(\w+)$/.exec(t))) { need('sem', m[2], l.n); return { k: 'P', s: m[2], n: l.n }; }
    if ((m = /^(V|sem_post|signal_sem)\s+(\w+)$/.exec(t))) { need('sem', m[2], l.n); return { k: 'V', s: m[2], n: l.n }; }
    if ((m = /^assert\s+(.+)$/.exec(t))) return { k: 'assert', e: parseExpr(m[1], l.n), n: l.n };
    if (t === 'skip') return { k: 'skip', n: l.n };
    if ((m = /^local\s+(\w+)\s*=\s*(.+)$/.exec(t))) { th.locals.add(m[1]); return { k: 'set', v: m[1], e: parseExpr(m[2], l.n), n: l.n }; }
    if ((m = /^(\w+)\s*=\s*(.+)$/.exec(t))) return { k: 'set', v: m[1], e: parseExpr(m[2], l.n), n: l.n };
    throw err(l.n, TT('istruzione sconosciuta «{x}»', { x: t }));
  };
  const need = (kind, name, n) => {
    const ok = kind === 'sem' ? name in P.sem : P[kind].has(name);
    if (!ok) throw err(n, TT({ mutex: 'il mutex «{nome}» non è dichiarato ({decl})', cond: 'la condizione «{nome}» non è dichiarata ({decl})', sem: 'il semaforo «{nome}» non è dichiarato ({decl})' }[kind], { nome: name, decl: `${kind} ${name}${kind === 'sem' ? ' = 1' : ''}` }));
  };
  while (i < lines.length) {
    const l = lines[i];
    const t = l.text.trim();
    let m;
    if (indent(l) > 0) throw err(l.n, 'rientro inatteso fuori da un thread');
    i++;
    if ((m = /^(shared|const)\s+(.+)$/.exec(t))) {
      for (const part of m[2].split(',')) {
        const mm = /^\s*(\w+)\s*(?:=\s*(.+))?$/.exec(part);
        if (!mm) throw err(l.n, TT('scrivi: shared nome = valore'));
        const v = mm[2] ? ev(parseExpr(mm[2], l.n), (x) => P.consts[x] ?? P.shared[x]) : 0;
        (m[1] === 'const' ? P.consts : P.shared)[mm[1]] = v;
      }
    } else if ((m = /^mutex\s+(.+)$/.exec(t))) names(m[1]).forEach((x) => P.mutex.add(x));
    else if ((m = /^cond\s+(.+)$/.exec(t))) names(m[1]).forEach((x) => P.cond.add(x));
    else if ((m = /^sem\s+(.+)$/.exec(t))) {
      for (const part of m[1].split(',')) { const mm = /^\s*(\w+)\s*=\s*(.+)$/.exec(part); if (!mm) throw err(l.n, TT('scrivi: sem nome = valore iniziale')); P.sem[mm[1]] = ev(parseExpr(mm[2], l.n), (x) => P.consts[x]); }
    } else if ((m = /^thread\s+(\w+)(?:\s+x\s*(\d+))?\s*:$/.exec(t))) {
      const th = { name: m[1], copies: m[2] ? +m[2] : 1, locals: new Set(['id']), n: l.n };
      th.body = block(0, th);
      P.threads.push(th);
    } else if ((m = /^always\s+(.+)$/.exec(t))) P.always.push({ e: parseExpr(m[1], l.n), n: l.n, src: m[1] });
    else if ((m = /^finally\s+(.+)$/.exec(t))) P.finally.push({ e: parseExpr(m[1], l.n), n: l.n, src: m[1] });
    else throw err(l.n, TT('non capisco «{x}» (fuori dai thread: shared, const, mutex, cond, sem, thread, always, finally)', { x: t }));
  }
  if (!P.threads.length) throw err(1, TT('manca almeno un thread («thread Nome:»)'));
  // istruzioni piatte per ogni thread
  for (const th of P.threads) {
    const code = [];
    let tmpN = 0;
    const isShared = (v) => v in P.shared;
    const readsShared = (e) => [...ids(e)].some(isShared);
    const emit = (x) => { code.push(x); return code.length - 1; };
    const gen = (list) => {
      for (const s of list) {
        if (s.k === 'if') {
          const jf = emit({ op: 'jf', e: s.e, n: s.n, vis: readsShared(s.e) });
          gen(s.body);
          if (s.else) { const j = emit({ op: 'j', n: s.n }); code[jf].to = code.length; gen(s.else); code[j].to = code.length; } else code[jf].to = code.length;
        } else if (s.k === 'while') {
          const top = code.length;
          const jf = emit({ op: 'jf', e: s.e, n: s.n, vis: readsShared(s.e) });
          gen(s.body);
          emit({ op: 'j', to: top, n: s.n });
          code[jf].to = code.length;
        } else if (s.k === 'repeat') {
          const c = `#r${tmpN++}`;
          th.locals.add(c);
          emit({ op: 'set', v: c, e: s.e, n: s.n, vis: false, hidden: true });
          const top = code.length;
          const jf = emit({ op: 'jf', e: { k: 'bin', op: '>', a: { k: 'id', v: c }, b: { k: 'num', v: 0 } }, n: s.n, vis: false, hidden: true });
          gen(s.body);
          emit({ op: 'set', v: c, e: { k: 'bin', op: '-', a: { k: 'id', v: c }, b: { k: 'num', v: 1 } }, n: s.n, vis: false, hidden: true });
          emit({ op: 'j', to: top, n: s.n });
          code[jf].to = code.length;
        } else if (s.k === 'set') {
          if (isShared(s.v) && readsShared(s.e)) { const tmp = `#t${tmpN++}`; th.locals.add(tmp); emit({ op: 'set', v: tmp, e: s.e, n: s.n, vis: true, phase: 'legge', reads: [...ids(s.e)].filter(isShared), target: s.v }); emit({ op: 'set', v: s.v, e: { k: 'id', v: tmp }, n: s.n, vis: true, phase: 'scrive' }); }
          else emit({ op: 'set', v: s.v, e: s.e, n: s.n, vis: isShared(s.v) || readsShared(s.e) });
          if (!isShared(s.v) && !th.locals.has(s.v)) throw err(s.n, TT('«{v}» non è dichiarata: shared {v} = 0 (condivisa) o local {v} = … (del thread)', { v: s.v }));
        } else if (s.k === 'skip') emit({ op: 'skip', n: s.n, vis: true });
        else emit({ op: s.k, ...s, vis: true });
      }
    };
    gen(th.body);
    emit({ op: 'end', n: th.n, vis: true });
    th.code = code;
  }
  // istanze
  P.inst = [];
  for (const th of P.threads) for (let k = 1; k <= th.copies; k++) P.inst.push({ name: th.copies > 1 ? `${th.name}${k}` : th.name, th, id: k, locals: [...th.locals] });
  return P;
}

// --- esplorazione ---------------------------------------------------------------------------------------------------
// stato: { pc[], st[] ('r' pronto, 'c:<cond>' in attesa di signal, 'w' svegliato: deve riprendere il mutex, 'e' finito),
//          loc[] (valori delle locali), sh (condivise), own (mutex → istanza), sem }
// La macchina degli stati, usata dalla ricerca qui sotto e dai simulatori passo passo (sim.js, 2026.11.7)
export function machine(P) {
  const T = P.inst.length;
  const sharedNames = Object.keys(P.shared);
  const init = {
    pc: Array(T).fill(0), st: Array(T).fill('r'),
    loc: P.inst.map((x) => x.locals.map((v) => (v === 'id' ? x.id : 0))),
    sh: sharedNames.map((v) => P.shared[v]),
    own: Object.fromEntries([...P.mutex].map((m) => [m, -1])),
    sem: { ...P.sem },
    wm: Array(T).fill(null), // mutex da riprendere dopo la wait
  };
  const envOf = (s, i) => (name) => {
    if (i != null) { const j = P.inst[i].locals.indexOf(name); if (j >= 0) return s.loc[i][j]; }
    const k = sharedNames.indexOf(name);
    if (k >= 0) return s.sh[k];
    return P.consts[name];
  };
  const clone = (s) => ({ pc: s.pc.slice(), st: s.st.slice(), loc: s.loc.map((x) => x.slice()), sh: s.sh.slice(), own: { ...s.own }, sem: { ...s.sem }, wm: s.wm.slice() });
  const key = (s) => JSON.stringify([s.pc, s.st, s.loc, s.sh, s.own, s.sem, s.wm]);
  const assign = (s, i, v, val) => { const j = P.inst[i].locals.indexOf(v); if (j >= 0) s.loc[i][j] = val; else s.sh[sharedNames.indexOf(v)] = val; };
  // esegue le istruzioni invisibili (salti, contatori) finché il thread arriva a un passo che conta
  const settle = (s, i) => {
    for (let guard = 0; guard < 10000 && s.st[i] === 'r'; guard++) {
      const x = P.inst[i].th.code[s.pc[i]];
      if (x.op === 'j') s.pc[i] = x.to;
      else if (x.op === 'jf' && !x.vis) s.pc[i] = ev(x.e, envOf(s, i)) ? s.pc[i] + 1 : x.to;
      else if (x.op === 'set' && !x.vis) { assign(s, i, x.v, ev(x.e, envOf(s, i))); s.pc[i]++; }
      else break;
    }
    if (s.st[i] === 'r' && P.inst[i].th.code[s.pc[i]].op === 'end') s.st[i] = 'e';
  };
  // le mosse possibili del thread i: [{ s: nuovo stato, what, err? }]
  const moves = (s, i) => {
    const st = s.st[i];
    if (st === 'e' || st.startsWith('c:')) return [];
    const x = P.inst[i].th.code[s.pc[i]];
    if (st === 'w') { const m = s.wm[i]; if (s.own[m] !== -1) return []; const n = clone(s); n.own[m] = i; n.st[i] = 'r'; n.wm[i] = null; n.pc[i]++; return [{ s: n, what: TT('si risveglia e riprende {m}', { m }), n: x.n }]; }
    const n = clone(s);
    const ok = (what) => { n.pc[i]++; return [{ s: n, what, n: x.n }]; };
    const bad = (msg) => [{ s: n, what: msg, n: x.n, err: msg }];
    switch (x.op) {
      case 'lock': if (s.own[x.m] === i) return bad(TT('lock {m} di un mutex che tiene già: si blocca da solo', { m: x.m })); if (s.own[x.m] !== -1) return []; n.own[x.m] = i; return ok(`lock ${x.m}`);
      case 'unlock': if (s.own[x.m] !== i) return bad(TT('unlock {m} senza tenerlo', { m: x.m })); n.own[x.m] = -1; return ok(`unlock ${x.m}`);
      case 'wait': if (s.own[x.m] !== i) return bad(TT('wait {c} senza tenere {m}', { c: x.c, m: x.m })); n.own[x.m] = -1; n.st[i] = 'c:' + x.c; n.wm[i] = x.m; return [{ s: n, what: TT('wait {c} (rilascia {m} e dorme)', { c: x.c, m: x.m }), n: x.n }];
      case 'signal': {
        const waiting = s.st.map((v, j) => (v === 'c:' + x.c ? j : -1)).filter((j) => j >= 0);
        if (!waiting.length) return ok(TT('signal {c} (nessuno aspetta: si perde)', { c: x.c }));
        // pthread: ne sveglia uno qualsiasi → una mossa per ogni scelta
        return waiting.map((j) => { const m = clone(s); m.st[j] = 'w'; m.pc[i]++; return { s: m, what: TT('signal {c} → sveglia {t}', { c: x.c, t: P.inst[j].name }), n: x.n }; });
      }
      case 'broadcast': { s.st.forEach((v, j) => { if (v === 'c:' + x.c) n.st[j] = 'w'; }); return ok(`broadcast ${x.c}`); }
      case 'P': if (s.sem[x.s] <= 0) return []; n.sem[x.s]--; return ok(`P ${x.s} → ${n.sem[x.s]}`);
      case 'V': n.sem[x.s]++; return ok(`V ${x.s} → ${n.sem[x.s]}`);
      case 'set': { let v; try { v = ev(x.e, envOf(s, i)); } catch (e) { return bad(e.message); } assign(n, i, x.v, v); return ok(x.phase === 'legge' ? TT('legge {letti} e calcola {v} (non l\'ha ancora scritto)', { letti: x.reads.map((r) => `${r} = ${envOf(s, i)(r)}`).join(', '), v }) : x.phase === 'scrive' ? TT('scrive {x} = {v}', { x: x.v, v }) : `${x.v} = ${v}`); }
      case 'jf': { const v = ev(x.e, envOf(s, i)); n.pc[i] = v ? s.pc[i] + 1 : x.to; return [{ s: n, what: v ? TT('controlla: vero') : TT('controlla: falso'), n: x.n }]; }
      case 'assert': { let v; try { v = ev(x.e, envOf(s, i)); } catch (e) { return bad(e.message); } if (!v) return bad(TT('assert falsa')); return ok(TT('assert vera')); }
      case 'skip': return ok('skip');
      default: return [];
    }
  };
  const describeStuck = (s) => s.st.map((v, j) => {
    if (v === 'e') return null;
    const x = P.inst[j].th.code[s.pc[j]];
    const who = P.inst[j].name;
    if (v.startsWith('c:')) return TT('{t} dorme su {c} (aspetta un signal che non arriverà)', { t: who, c: v.slice(2) });
    if (v === 'w') return TT('{t} è stato svegliato ma {m} è tenuto da {o}', { t: who, m: s.wm[j], o: P.inst[s.own[s.wm[j]]]?.name });
    if (x.op === 'lock') return TT('{t} aspetta {m}, tenuto da {o}', { t: who, m: x.m, o: P.inst[s.own[x.m]]?.name });
    if (x.op === 'P') return TT('{t} aspetta {s} (valore 0)', { t: who, s: x.s });
    return TT('{t} fermo alla riga {n}', { t: who, n: x.n });
  }).filter(Boolean);
  for (let i = 0; i < T; i++) settle(init, i);
  return { T, init, sharedNames, envOf, clone, key, settle, moves, describeStuck };
}

export function explore(P, { maxStates = 250000 } = {}) {
  const { T, init, sharedNames, envOf, key, settle, moves, describeStuck } = machine(P);
  const seen = new Map([[key(init), null]]);
  const queue = [init];
  const parent = [null], step = [null];
  init._i = 0;
  let found = null, deadlock = null, truncated = false;
  const finals = new Map();
  const viol = (s, inv) => { try { return !ev(inv.e, envOf(s, null)); } catch { return true; } };
  for (const inv of P.always) if (viol(init, inv)) found = { kind: 'always', msg: TT('l\'invariante «{x}» è falso già all\'inizio', { x: inv.src }), at: 0 };
  let head = 0;
  while (head < queue.length && !found) {
    const s = queue[head++];
    let any = false;
    for (let i = 0; i < T && !found; i++) {
      for (const mv of moves(s, i)) {
        any = true;
        const n = mv.s;
        settle(n, i);
        // un risveglio può rendere eseguibili anche gli altri: niente da fare, li considera il prossimo stato
        const k = key(n);
        if (seen.has(k)) continue;
        n._i = queue.length;
        seen.set(k, true);
        queue.push(n); parent.push(s._i); step.push({ t: i, what: mv.what, n: mv.n });
        if (mv.err) { found = { kind: 'error', msg: `${P.inst[i].name}: ${mv.err} (` + TT('riga {n}', { n: mv.n }) + ')', at: n._i }; break; }
        const bad = P.always.find((inv) => viol(n, inv));
        if (bad) { found = { kind: 'always', msg: TT('l\'invariante «{x}» diventa falso', { x: bad.src }), at: n._i }; break; }
        if (queue.length >= maxStates) { truncated = true; break; }
      }
      if (truncated) break;
    }
    if (truncated) break;
    if (!any && !found) {
      if (s.st.every((v) => v === 'e')) {
        const fk = JSON.stringify(s.sh);
        if (!finals.has(fk)) finals.set(fk, s._i);
        const bad = P.finally.find((inv) => viol(s, inv));
        if (bad) found = { kind: 'finally', msg: TT('alla fine «{x}» è falso', { x: bad.src }), at: s._i };
      } else if (!deadlock) deadlock = s._i;
    }
  }
  if (!found && deadlock != null) found = { kind: 'deadlock', msg: TT('nessun thread può più andare avanti, ma non tutti hanno finito'), at: deadlock };
  const trace = (at) => {
    const out = [];
    for (let j = at; j > 0; j = parent[j]) out.push({ ...step[j], sh: queue[j].sh.slice(), st: queue[j].st.slice(), own: { ...queue[j].own }, sem: { ...queue[j].sem } });
    return out.reverse();
  };
  return {
    states: queue.length, truncated,
    found: found && { ...found, trace: trace(found.at), stuck: found.kind === 'deadlock' ? describeStuck(queue[found.at]) : null },
    finals: [...finals.keys()].map((k) => Object.fromEntries(sharedNames.map((v, j) => [v, JSON.parse(k)[j]]))),
    names: P.inst.map((x) => x.name), shared: sharedNames,
  };
}

export function check(src, opts) {
  const P = compile(src);
  return explore(P, opts);
}
