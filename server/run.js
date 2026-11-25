// Quadretto — compila ed esegue programmi C e C++ dei progetti degli appunti, in una gabbia.
//
// Gabbia (sul Debian): bubblewrap senza rete né processi esterni visibili, con /usr in sola lettura e una
// cartella di lavoro usa e getta; dentro, limiti di CPU, memoria e file (ulimit). Se c'è `systemd-run`,
// tutto gira anche in uno scope dell'utente con TasksMax e MemoryMax, contro i fork infiniti.
// Sullo stesso server possono girare altri servizi: senza bubblewrap l'esecuzione è spenta, non «aperta».
//
// RUN_SANDBOX: `off` (predefinito) · `bwrap` · `unsafe-local` (SOLO prove sul Mac di sviluppo: esegue senza gabbia).
// Dal 2026-11-24 (pubblicazione su GitHub) l'esecuzione si accende solo se la si chiede, anche con bubblewrap installato:
// chi installa Quadretto decide lui se far girare codice altrui sulla sua macchina.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const BWRAP = ['/usr/bin/bwrap', '/bin/bwrap'].find((f) => fs.existsSync(f));
const MODE = ['bwrap', 'unsafe-local'].includes(process.env.RUN_SANDBOX) ? process.env.RUN_SANDBOX : 'off';
const SCOPE = process.platform === 'linux' && process.env.RUN_SCOPE !== '0' && spawnSync('systemd-run', ['--version']).status === 0;

export const runInfo = () => ({ available: MODE === 'bwrap' ? !!BWRAP : MODE === 'unsafe-local', mode: MODE, trace: !!qtraceLib });

const LIMITS = { files: 300, fileBytes: 512 * 1024, totalBytes: 3 * 1024 * 1024, out: 64 * 1024, compileMs: 40000, runMs: 10000 };
const SAFE_PATH = /^(?!.*(^|\/)\.\.(\/|$))[A-Za-z0-9_\-.+@ ][A-Za-z0-9_\-.+@ /]{0,200}$/;
const C_SRC = /\.c$/i, CPP_SRC = /\.(cpp|cc|cxx|c\+\+)$/i;
// nomi riservati dentro la cartella di lavoro (radiografia e /dev/shm della gabbia)
const RESERVED = /^\.(qtrace|shm)(\/|$)/;
const LINUX = process.platform === 'linux';

// --- radiografia (2026.11.4): server/qtrace.c compilato una volta, caricato con LD_PRELOAD nella gabbia ----------
// Si accende solo se il programma usa fork, thread, semafori, mutex, memoria condivisa o code di messaggi.
const QTRACE_SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'qtrace.c');
let qtraceLib = null, qtraceErr = '';
function buildQtrace() {
  if (!LINUX || MODE !== 'bwrap' || !fs.existsSync(QTRACE_SRC)) return;
  const src = fs.readFileSync(QTRACE_SRC);
  const out = path.join(os.tmpdir(), `quadretto-qtrace-${crypto.createHash('sha256').update(src).digest('hex').slice(0, 12)}.so`);
  if (!fs.existsSync(out)) {
    const r = spawnSync('gcc', ['-O2', '-shared', '-fPIC', '-o', out + '.tmp', QTRACE_SRC, '-ldl', '-lpthread', '-lrt'], { encoding: 'utf8' });
    if (r.status !== 0) { qtraceErr = (r.stderr || r.error?.message || 'gcc').slice(0, 400); return; }
    fs.renameSync(out + '.tmp', out);
  }
  qtraceLib = out;
}
buildQtrace();
export const traceInfo = () => ({ available: !!qtraceLib, error: qtraceErr || null });
const USES_SYNC = /\b(fork|vfork|pthread_\w+|sem_\w+|shm_open|mq_\w+|std::thread|std::mutex|waitpid|wait)\s*\(|std::(thread|mutex|jthread)/;

let running = 0;
const busyUsers = new Set();
const fail = (status, msg) => Object.assign(new Error(msg), { status });

function bwrapArgs(dir, env = {}) {
  const a = ['--unshare-all', '--die-with-parent', '--new-session', '--ro-bind', '/usr', '/usr'];
  for (const d of ['/bin', '/lib', '/lib64', '/sbin']) {
    let st; try { st = fs.lstatSync(d); } catch { continue; }
    if (st.isSymbolicLink()) a.push('--symlink', fs.readlinkSync(d), d); // Debian con /usr unificato
    else a.push('--ro-bind', d, d);
  }
  for (const f of ['/etc/ld.so.cache', '/etc/alternatives']) if (fs.existsSync(f)) a.push('--ro-bind', f, f);
  // niente /proc: sul Debian (contenitore LXC) bubblewrap non può montarlo, e a gcc e agli esercizi non serve
  // /dev/shm della gabbia è una cartella del lavoro: alla fine si vede quali semafori e memorie condivise sono rimasti
  a.push('--dev', '/dev', '--bind', path.join(dir, '.shm'), '/dev/shm', '--tmpfs', '/tmp', '--bind', dir, '/work', '--chdir', '/work',
    '--clearenv', '--setenv', 'PATH', '/usr/bin:/bin', '--setenv', 'HOME', '/work', '--setenv', 'LANG', 'C.UTF-8', '--setenv', 'TMPDIR', '/tmp');
  if (env.trace && qtraceLib) a.push('--ro-bind', qtraceLib, '/opt/qtrace.so');
  return a;
}

// Lancia argv nella gabbia; raccoglie al massimo LIMITS.out byte per flusso
function jailed(dir, argv, { stdin = '', timeoutMs, cpu, trace = false, jitter = 0, idleMs = 2000 }) {
  trace = trace && !!qtraceLib && MODE === 'bwrap';
  // LD_PRELOAD solo per il programma (non per la shell che imposta gli ulimit)
  if (trace) argv = ['/usr/bin/env', 'LD_PRELOAD=/opt/qtrace.so', 'QTRACE=/work/.qtrace', `QTRACE_JITTER=${jitter | 0}`, ...argv];
  // ulimit: memoria virtuale 1 GiB, CPU, file scritti al massimo 20 MiB
  const sh = ['/bin/sh', '-c', `ulimit -v 1048576 2>/dev/null; ulimit -t ${cpu}; ulimit -f 40960; exec "$@"`, 'sh', ...argv];
  let cmd, args, cwd = dir;
  if (MODE === 'bwrap') {
    cmd = BWRAP; args = [...bwrapArgs(dir, { trace }), ...sh];
    if (SCOPE) { args = ['--user', '--scope', '--quiet', '-p', 'TasksMax=64', '-p', 'MemoryMax=768M', '-p', 'CPUQuota=100%', '--', cmd, ...args]; cmd = 'systemd-run'; }
  } else { cmd = sh[0]; args = sh.slice(1); }
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    const out = { stdout: '', stderr: '', cut: false };
    const take = (k) => (b) => { if (out[k].length < LIMITS.out) out[k] += b.toString('utf8'); else out.cut = true; };
    p.stdout.on('data', take('stdout'));
    p.stderr.on('data', take('stderr'));
    p.stdin.on('error', () => {});
    p.stdin.end(stdin);
    let timedOut = false, stuck = false;
    const kill = () => { try { process.kill(-p.pid, 'SIGKILL'); } catch { try { p.kill('SIGKILL'); } catch {} } };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    // con la radiografia: se tutti i thread vivi sono fermi su un'attesa e niente si muove da 2 s, è un blocco
    let watch = null;
    if (trace) {
      let lastSize = -1, still = 0;
      watch = setInterval(() => {
        let size = 0; try { size = fs.statSync(path.join(dir, '.qtrace')).size; } catch {}
        if (size !== lastSize) { lastSize = size; still = 0; return; }
        if ((still += 200) < idleMs || Date.now() - t0 < Math.min(1200, idleMs)) return;
        let txt = ''; try { txt = fs.readFileSync(path.join(dir, '.qtrace'), 'utf8'); } catch {}
        if (allBlocked(txt)) { stuck = true; timedOut = true; kill(); }
      }, 200);
    }
    p.on('error', (e) => { clearTimeout(timer); clearInterval(watch); resolve({ code: -1, stdout: '', stderr: e.message, timedOut, ms: Date.now() - t0 }); });
    p.on('close', (code, signal) => {
      clearTimeout(timer); clearInterval(watch);
      if (out.stdout.length > LIMITS.out) out.stdout = out.stdout.slice(0, LIMITS.out);
      if (out.stderr.length > LIMITS.out) out.stderr = out.stderr.slice(0, LIMITS.out);
      // bubblewrap riporta un programma ucciso da un segnale come uscita 128 + numero del segnale
      if (!signal && code > 128 && code < 160) signal = Object.keys(os.constants.signals).find((k) => os.constants.signals[k] === code - 128) || null;
      const res = { code: code ?? -1, signal, ...out, timedOut, stuck, ms: Date.now() - t0 };
      if (trace) Object.assign(res, collectTrace(dir));
      resolve(res);
    });
  });
}

// Ultimo evento di ogni thread: se tutti quelli ancora vivi sono fermi su un'attesa, il programma è bloccato
const BLOCKING = new Set(['mlock', 'cwait', 'swait', 'mqsendb', 'mqrecvb', 'waitb', 'joinb']);
export function allBlocked(txt) {
  const last = new Map(), deadPid = new Set();
  for (const line of txt.split('\n')) {
    const f = line.split(' ');
    if (f.length < 4) continue;
    const [, pid, tid, ev] = f;
    if (ev === 'exit' || ev === 'end') deadPid.add(pid);
    else if (ev === 'waite' && f[5] && f[5] !== '-1') deadPid.add(f[4]);
    if (ev === 'out') continue;
    last.set(pid + '/' + tid, ev);
  }
  let live = 0;
  for (const [k, ev] of last) {
    if (deadPid.has(k.split('/')[0]) || ev === 'tend') continue;
    live++;
    if (!BLOCKING.has(ev)) return false;
  }
  return live > 0;
}
// Variabili globali del programma (offset, dimensione, nome): nm sul binario appena compilato, fuori dalla gabbia
// ma senza eseguirlo. Servono alla radiografia per chiamare «mutex m» quello che il registro chiama 0x55…
function symbols(dir) {
  const r = spawnSync('nm', ['--defined-only', '-S', '-C', path.join(dir, 'programma')], { encoding: 'utf8', timeout: 5000, maxBuffer: 4 << 20 });
  if (r.status !== 0) return [];
  const out = [];
  for (const line of r.stdout.split('\n')) {
    const m = /^([0-9a-f]+) ([0-9a-f]+) ([bBdD]) (.+)$/.exec(line);
    if (m && !m[4].startsWith('_') && !m[4].includes('.')) out.push([parseInt(m[1], 16), parseInt(m[2], 16), m[4]]);
    if (out.length >= 3000) break;
  }
  return out;
}
function collectTrace(dir) {
  let trace = '';
  try {
    const fd = fs.openSync(path.join(dir, '.qtrace'), 'r');
    const buf = Buffer.alloc(1536 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    trace = buf.subarray(0, n).toString('utf8');
    if (n === buf.length) trace = trace.slice(0, trace.lastIndexOf('\n') + 1) + '0 0 0 cut\n';
  } catch {}
  let shm = [];
  try { shm = fs.readdirSync(path.join(dir, '.shm')).slice(0, 50); } catch {}
  return { trace, shm };
}

export function checkFiles(files) {
  if (!Array.isArray(files) || !files.length) throw fail(400, 'Nessun file da compilare');
  if (files.length > LIMITS.files) throw fail(400, `Troppi file: al massimo ${LIMITS.files}`);
  let total = 0;
  for (const f of files) {
    if (typeof f?.path !== 'string' || typeof f?.text !== 'string' || !SAFE_PATH.test(f.path) || f.path.startsWith('/') || RESERVED.test(f.path)) throw fail(400, `Nome di file non valido: ${String(f?.path).slice(0, 80)}`);
    const n = Buffer.byteLength(f.text);
    if (n > LIMITS.fileBytes) throw fail(400, `${f.path} è troppo grande (al massimo 512 KB)`);
    total += n;
  }
  if (total > LIMITS.totalBytes) throw fail(400, 'Il progetto è troppo grande (al massimo 3 MB)');
}

// lang: 'c' | 'cpp'. Compila tutti i sorgenti del progetto e, se riesce, esegue il programma con lo stdin dato.
// stress: N > 1 esecuzioni dello stesso programma con pause casuali (prova di stress), raggruppate per esito.
export async function runProject(userId, { lang, files, stdin = '', stress = 0 }) {
  if (MODE === 'off') throw fail(503, 'Su questo server la compilazione di C e C++ è spenta: chi lo gestisce la accende con RUN_SANDBOX=bwrap (serve bubblewrap)');
  if (!runInfo().available) throw fail(503, 'Sul server la compilazione di C e C++ non è attiva (manca bubblewrap): va installato con apt');
  if (lang !== 'c' && lang !== 'cpp') throw fail(400, 'Linguaggio non supportato: solo C e C++');
  checkFiles(files);
  if (typeof stdin !== 'string' || stdin.length > 256 * 1024) throw fail(400, 'Input troppo lungo');
  if (busyUsers.has(userId)) throw fail(429, 'Un programma è già in esecuzione: aspetta che finisca');
  if (running >= 2) throw fail(429, 'Il server sta già compilando due programmi: riprova tra qualche secondo');
  busyUsers.add(userId); running++;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quadretto-run-'));
  try {
    for (const f of files) {
      const p = path.join(dir, f.path);
      if (!p.startsWith(dir + path.sep)) throw fail(400, 'Percorso non valido');
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, f.text);
    }
    const srcs = files.map((f) => f.path).filter((p) => (lang === 'c' ? C_SRC : CPP_SRC).test(p) || (lang === 'cpp' && C_SRC.test(p)));
    if (!srcs.length) throw fail(400, lang === 'c' ? 'Nessun file .c nel progetto' : 'Nessun file .cpp nel progetto');
    fs.mkdirSync(path.join(dir, '.shm'));
    // -pthread e -lrt: thread, semafori, memoria condivisa e code di messaggi POSIX (Sistemi Operativi)
    const libs = ['-lm', '-pthread', ...(LINUX ? ['-lrt'] : [])];
    const cc = lang === 'c'
      ? ['gcc', '-std=gnu17', '-O1', '-g0', '-Wall', '-Wextra', '-fdiagnostics-color=never', '-o', 'programma', ...srcs, ...libs]
      : ['g++', '-std=gnu++20', '-O1', '-g0', '-Wall', '-Wextra', '-fdiagnostics-color=never', '-o', 'programma', ...srcs, ...libs];
    if (MODE === 'unsafe-local' && process.platform === 'darwin') cc[0] = lang === 'c' ? 'cc' : 'c++';
    const compile = await jailed(dir, cc, { timeoutMs: LIMITS.compileMs, cpu: 40 });
    if (compile.code !== 0 || compile.timedOut) return { ok: false, compile, run: null };
    const trace = USES_SYNC.test(files.map((f) => f.text).join('\n'));
    const fresh = () => { for (const f of ['.qtrace']) fs.rmSync(path.join(dir, f), { force: true }); for (const f of fs.readdirSync(path.join(dir, '.shm'))) fs.rmSync(path.join(dir, '.shm', f), { force: true }); };
    if (!(stress > 1)) {
      const run = await jailed(dir, ['./programma'], { stdin, timeoutMs: LIMITS.runMs, cpu: 8, trace });
      if (run.trace) run.syms = symbols(dir);
      return { ok: true, compile, run, traced: trace && !!qtraceLib };
    }
    // prova di stress: al massimo 30 esecuzioni, 3 s ciascuna, 45 s in tutto
    const n = Math.min(30, stress | 0), groups = new Map(), t0 = Date.now();
    let done = 0;
    for (let i = 0; i < n && Date.now() - t0 < 45000; i++) {
      fresh();
      const r = await jailed(dir, ['./programma'], { stdin, timeoutMs: 3000, cpu: 3, trace, jitter: i + 1, idleMs: 800 });
      done++;
      const outcome = r.stuck ? 'bloccato' : r.timedOut ? 'tempo scaduto' : r.signal ? `segnale ${r.signal}` : `uscita ${r.code}`;
      const key = outcome + '\u0000' + r.stdout;
      const g = groups.get(key) || { outcome, stdout: r.stdout.slice(0, 4000), stderr: r.stderr.slice(0, 2000), count: 0, runs: [], trace: '', shm: [] };
      g.count++; g.runs.push(i + 1);
      if (!g.trace && r.trace) { g.syms = symbols(dir); g.trace = r.trace.length > 400000 ? r.trace.slice(0, r.trace.lastIndexOf('\n', 400000) + 1) + '0 0 0 cut\n' : r.trace; g.shm = r.shm || []; }
      groups.set(key, g);
    }
    return { ok: true, compile, stress: { runs: done, groups: [...groups.values()].sort((a, b) => b.count - a.count) }, traced: trace && !!qtraceLib };
  } finally {
    busyUsers.delete(userId); running--;
    fs.rm(dir, { recursive: true, force: true }, () => {});
  }
}
