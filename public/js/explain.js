// Quadretto — controllo del codice d'esame e «spiega l'errore» (2026.11.4).
// lint(files): gli errori tipici dei programmi di Sistemi Operativi (POSIX, pthread), trovati prima di compilare.
// explain(testo, risultato, radiografia): messaggi del compilatore e del programma tradotti in cosa fare.
// Qui t è anche una variabile locale: la traduzione si chiama T() (vedi i18n.js).
import { t as T } from './i18n.js';
import { REF } from './posix-ref.js';

const isC = (p) => /\.(c|h|cc|cpp|cxx|hpp|hh)$/i.test(p);
// riga (da 1) di una posizione nel testo
const lineOf = (text, i) => text.slice(0, i).split('\n').length;
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
  .replace(/"(?:\\.|[^"\\\n])*"/g, (m) => '"' + ' '.repeat(Math.max(0, m.length - 2)) + '"');

export function lint(files) {
  const out = [];
  const src = files.filter((f) => isC(f.path));
  if (!src.length) return out;
  const all = src.map((f) => f.text).join('\n');
  const code = strip(all);
  const has = (re) => re.test(code);
  const add = (f, idx, level, msg) => out.push({ path: f.path, line: lineOf(f.text, idx), level, msg });
  const each = (re, fn) => { for (const f of src) { const t = strip(f.text); for (const m of t.matchAll(re)) fn(f, m, t); } };

  // 1. if al posto di while attorno a pthread_cond_wait (signal-and-continue)
  each(/\bif\s*\(([^;{}]|\([^)]*\))*\)\s*\{?\s*pthread_cond_wait\s*\(/g, (f, m) => add(f, m.index + m[0].indexOf('pthread_cond_wait'), 'err',
    T('pthread_cond_wait dentro un if: con i pthread (signal-and-continue) chi si sveglia trova la condizione magari di nuovo falsa. Usa while (condizione) pthread_cond_wait(…);')));
  // 2. memoria condivisa creata ma mai dimensionata
  if (has(/\bshm_open\s*\([^;]*O_CREAT/) && !has(/\bftruncate\s*\(/)) each(/\bshm_open\s*\(/g, (f, m) => add(f, m.index, 'err', T('shm_open con O_CREAT ma nessuna ftruncate: la memoria è lunga 0 byte e accedervi dà SIGBUS. Dopo shm_open: ftruncate(fd, sizeof(…));')));
  // 3. IPC create e mai rimosse
  for (const [open, unl, what] of [['sem_open', 'sem_unlink', 'il semaforo'], ['shm_open', 'shm_unlink', 'la memoria condivisa'], ['mq_open', 'mq_unlink', 'la coda']]) {
    if (has(new RegExp(`\\b${open}\\s*\\([^;]*O_CREAT`)) && !has(new RegExp(`\\b${unl}\\s*\\(`)))
      each(new RegExp(`\\b${open}\\s*\\(`, 'g'), (f, m, t) => { if (/O_CREAT/.test(t.slice(m.index, t.indexOf(';', m.index)))) add(f, m.index, 'warn', T('{f} crea {cosa} ma nel progetto non c\'è {u}: resta nel sistema anche dopo la fine e la prossima esecuzione la ritrova (col valore vecchio).', { f: open, cosa: T(what), u: unl })); });
  }
  // 4. nomi delle IPC senza "/" iniziale
  for (const f of src) for (const m of f.text.matchAll(/\b(sem_open|shm_open|mq_open|sem_unlink|shm_unlink|mq_unlink)\s*\(\s*"([^"]*)"/g))
    if (!m[2].startsWith('/')) add(f, m.index, 'err', T('Il nome "{n}" deve iniziare con "/" (es. "/{n}").', { n: m[2] }));
  // 5. mq_receive senza conoscere mq_msgsize
  if (has(/\bmq_receive\s*\(/) && !has(/\bmq_getattr\s*\(/) && !has(/\bmq_msgsize\b/))
    each(/\bmq_receive\s*\(/g, (f, m) => add(f, m.index, 'warn', T('mq_receive con una coda aperta senza attributi: mq_msgsize è quello di sistema (di solito 8192) e un buffer più piccolo dà EMSGSIZE. Imposta mq_msgsize in mq_open o leggilo con mq_getattr.')));
  // 6. sem_init condiviso tra processi su una variabile che non sta in memoria condivisa
  each(/\bsem_init\s*\(\s*&\s*([A-Za-z_]\w*)\s*,\s*1\s*,/g, (f, m) => add(f, m.index, 'warn', T('sem_init(&{v}, 1, …): con pshared = 1 il semaforo deve stare in memoria condivisa (dentro la struct di una mmap MAP_SHARED). Una variabile normale dopo la fork è una copia diversa per ogni processo.', { v: m[1] })));
  // 7. fork senza wait
  if (has(/\bfork\s*\(/) && !has(/\b(wait|waitpid)\s*\(/)) each(/\bfork\s*\(/g, (f, m) => add(f, m.index, 'warn', T('fork senza wait/waitpid: il padre può finire prima dei figli (output in disordine, figli orfani) e i figli terminati restano zombie.')));
  // 8. printf senza \n e senza fflush prima di una fork
  if (has(/\bfork\s*\(/) && !has(/\bfflush\s*\(/) && !has(/setvbuf\s*\(/))
    for (const f of src) for (const m of f.text.matchAll(/\bprintf\s*\(\s*"((?:\\.|[^"\\])*)"/g))
      if (!/\\n$/.test(m[1]) && m.index < f.text.search(/\bfork\s*\(/)) add(f, m.index, 'warn', T('printf senza \\n prima della fork e nessuna fflush: il testo resta nel buffer, il figlio ne riceve una copia e lo stampa due volte. Metti fflush(stdout) prima di fork().'));
  // 9. &i del ciclo passato a pthread_create
  each(/for\s*\(\s*(?:int\s+)?([A-Za-z_]\w*)\s*=[^)]*\)[\s\S]{0,300}?pthread_create\s*\([^;]*&\s*\1\s*\)/g, (f, m) => add(f, m.index + m[0].lastIndexOf('pthread_create'), 'err',
    T('pthread_create(…, &{v}): tutti i thread ricevono l\'indirizzo della stessa variabile, che il ciclo intanto cambia. Passa un valore per thread (un vettore di argomenti, o (void *)(long) {v}).', { v: m[1] })));
  // 10. thread mai attesi
  if (has(/\bpthread_create\s*\(/) && !has(/\bpthread_join\s*\(/) && !has(/\bpthread_exit\s*\(/))
    each(/\bpthread_create\s*\(/g, (f, m) => add(f, m.index, 'warn', T('pthread_create senza pthread_join: quando main finisce, tutti i thread vengono terminati, anche a metà.')));
  // 11. lock e unlock sbilanciati
  const nl = (code.match(/\bpthread_mutex_lock\s*\(/g) || []).length, nu = (code.match(/\bpthread_mutex_unlock\s*\(/g) || []).length;
  if (nl > nu) each(/\bpthread_mutex_lock\s*\(/g, (f, m, t) => { if (m.index === t.search(/\bpthread_mutex_lock\s*\(/)) add(f, m.index, 'warn', T('{l} pthread_mutex_lock e {u} pthread_mutex_unlock: controlla che ogni percorso (anche i return anticipati) rilasci il mutex.', { l: nl, u: nu })); });
  // 12. confronti sbagliati coi valori di errore
  each(/\b(\w+)\s*==\s*NULL/g, (f, m, t) => {
    const before = t.slice(Math.max(0, m.index - 400), m.index);
    if (new RegExp(`\\b${m[1]}\\s*=\\s*(\\([^)]*\\)\\s*)?mmap\\s*\\(`).test(before)) add(f, m.index, 'err', T('mmap non restituisce NULL se fallisce ma MAP_FAILED: confronta con MAP_FAILED.'));
    if (new RegExp(`\\b${m[1]}\\s*=\\s*sem_open\\s*\\(`).test(before)) add(f, m.index, 'err', T('sem_open non restituisce NULL se fallisce ma SEM_FAILED: confronta con SEM_FAILED.'));
  });
  // 13. System V nel corso POSIX
  each(/\b(shmget|shmat|shmdt|shmctl|semget|semop|semctl|msgget|msgsnd|msgrcv|msgctl|ftok)\s*\(/g, (f, m) => add(f, m.index, 'info', T('{f} è System V. Nel corso (IPC POSIX) si usa {p}: ', { f: m[1], p: REF[m[1]].posix }) + REF[m[1]].note));
  // 14. include mancanti
  const inc = (h) => new RegExp(`#\\s*include\\s*<${h.replace('.', '\\.').replace('/', '\\/')}>`).test(all);
  for (const [re, h] of [[/\bsem_(open|init|wait|post|unlink|close|destroy|trywait|getvalue)\s*\(/, 'semaphore.h'], [/\bmq_\w+\s*\(/, 'mqueue.h'], [/\bpthread_\w+\s*\(/, 'pthread.h'], [/\b(shm_open|mmap|shm_unlink|munmap)\s*\(/, 'sys/mman.h'], [/\b(wait|waitpid)\s*\(/, 'sys/wait.h'], [/\b(fork|getpid|sleep|usleep|ftruncate|close)\s*\(/, 'unistd.h']])
    if (has(re) && !inc(h)) { const f = src.find((x) => re.test(strip(x.text))); const t = strip(f.text); add(f, t.search(re), 'warn', T('Manca #include <{h}>.', { h })); }
  return out.sort((a, b) => ({ err: 0, warn: 1, info: 2 }[a.level] - { err: 0, warn: 1, info: 2 }[b.level]) || a.path.localeCompare(b.path) || a.line - b.line);
}

// --- spiega l'errore ------------------------------------------------------------------------------------------
// Ogni regola: [regex sul testo d'uscita, (match, ctx) => spiegazione]
const RULES = [
  [/implicit declaration of function ['‘]?(\w+)/, (m) => REF[m[1]]?.inc ? T('{f}: manca #include <{h}>', { f: m[1], h: REF[m[1]].inc[0] }) + (REF[m[1]].inc.length > 1 ? ' ' + T('(e {altri})', { altri: REF[m[1]].inc.slice(1).map((x) => `<${x}>`).join(', ') }) : '') + '.' : T('{f} non è dichiarata: manca un #include o c\'è un errore di battitura nel nome.', { f: m[1] })],
  [/undefined reference to [`‘']?(\w+)/, (m) => /^(sem_|pthread_)/.test(m[1]) ? T('{f}: al link serve -pthread (qui lo aggiungo io; sul tuo PC: gcc … -pthread).', { f: m[1] }) : /^(mq_|shm_)/.test(m[1]) ? T('{f}: al link serve -lrt (gcc … -lrt).', { f: m[1] }) : m[1] === 'main' ? T('Nessun file ha la funzione main.') : T('{f} è dichiarata ma la sua definizione non c\'è: manca un file .c nel progetto o il nome è diverso.', { f: m[1] })],
  [/multiple definition of [`‘'](\w+)/, (m) => T('{f} è definita due volte: se sta in un .h incluso da più .c, nel .h metti solo la dichiarazione (extern) e definiscila in un solo .c.', { f: m[1] })],
  [/['‘](\w+)['’] undeclared/, (m) => T('{f} non è dichiarata in questo punto: controlla il nome o dichiarala prima di usarla.', { f: m[1] })],
  [/expected ['‘];['’] before/, () => T('Manca un punto e virgola, di solito alla fine della riga prima di quella indicata.')],
  [/unknown type name ['‘](\w+)/, (m) => /^(sem_t|pthread_\w+|mqd_t)$/.test(m[1]) ? T('{f}: manca #include <{h}>', { f: m[1], h: m[1] === 'sem_t' ? 'semaphore.h' : m[1] === 'mqd_t' ? 'mqueue.h' : 'pthread.h' }) + '.' : T('Tipo {f} sconosciuto: manca l\'#include del suo .h o il typedef è dopo.', { f: m[1] })],
  [/format ['‘](%\w+)['’] expects argument of type ['‘]([^'’]+)['’], but argument \d+ has type ['‘]([^'’]+)/, (m) => T('Nella printf {f} vuole {a}, ma gli passi {b}.', { f: m[1], a: m[2], b: m[3] })],
  [/control reaches end of non-void function/, () => T('Una funzione che restituisce un valore può finire senza return: aggiungilo (le funzioni dei thread devono restituire void *, anche solo NULL).')],
  [/Message too long/, (m, c) => T('EMSGSIZE: il buffer di mq_receive deve essere grande almeno quanto mq_msgsize della coda{qui}, anche se il messaggio è più piccolo. Leggilo con mq_getattr o imposta mq_msgsize in mq_open.', { qui: c.msgsize ? ' ' + T('(qui {n} byte)', { n: c.msgsize }) : '' })],
  [/File exists/, () => T('EEXIST: con O_CREAT|O_EXCL l\'oggetto (semaforo, memoria, coda) c\'era già, probabilmente rimasto da un\'esecuzione prima. All\'inizio del programma fai sem_unlink/shm_unlink/mq_unlink del nome (ignorando l\'errore), oppure togli O_EXCL.')],
  [/(sem_open|shm_open|mq_open)[^\n]*No such file or directory/, (m) => T('ENOENT: {f} senza O_CREAT cerca un oggetto che nessuno ha ancora creato. Chi lo crea deve partire prima, o usa O_CREAT anche qui.', { f: m[1] })],
  [/(mq_open)[^\n]*Invalid argument/, () => T('EINVAL in mq_open: mq_maxmsg o mq_msgsize sono oltre i limiti di sistema (di solito 10 messaggi e 8192 byte), oppure il nome non inizia con "/".')],
  [/Bad file descriptor/, () => T('EBADF: usi un descrittore già chiuso o mai aperto (controlla il valore restituito da open/shm_open/mq_open).')],
  [/Resource temporarily unavailable/, () => T('EAGAIN: operazione non bloccante (O_NONBLOCK o trywait) che avrebbe dovuto aspettare: coda vuota/piena o semaforo a 0.')],
  [/Too many open files/, () => T('Troppi file aperti: chiudi i descrittori che non usi più (close, mq_close, sem_close).')],
];

// testo: stderr + stdout; res: risposta del server; ctx: { msgsize } dalla radiografia
export function explain(text, res = {}, ctx = {}) {
  const tips = [], seen = new Set();
  for (const [re, fn] of RULES) {
    const m = re.exec(text || '');
    if (!m) continue;
    const t = fn(m, ctx);
    if (t && !seen.has(t)) { seen.add(t); tips.push(t); }
  }
  const sig = res.run?.signal;
  if (sig === 'SIGSEGV') tips.push(T('Segmentation fault: un puntatore non valido. Cerca un puntatore NULL o non inizializzato (anche il risultato di mmap/malloc non controllato), un indice fuori dal vettore o una stringa senza terminatore.'));
  if (sig === 'SIGBUS') tips.push(T('SIGBUS: di solito una memoria condivisa usata senza averle dato la dimensione con ftruncate dopo shm_open.'));
  if (sig === 'SIGFPE') tips.push(T('SIGFPE: divisione intera per zero (o resto % 0).'));
  if (sig === 'SIGABRT' && /double free|free\(\)/.test(text)) tips.push(T('free sullo stesso puntatore due volte, o su memoria non allocata con malloc.'));
  return tips;
}
