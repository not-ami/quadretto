// Quadretto — schede delle chiamate di sistema (2026.11.4).
// Tocchi una chiamata nel codice e vedi prototipo, #include, flag di link, valori di ritorno ed errori tipici.
// Le API sono quelle POSIX di un corso di Sistemi Operativi (IPC POSIX, monitor con pthread). Le chiamate System V
// hanno una scheda che dice cosa usare al loro posto.
// Testi scritti per Quadretto, sintetici: per i dettagli c'è `man 3 <nome>`.

import { t } from './i18n.js';

const P = (proto, inc, extra = {}) => ({ proto, inc, ...extra });

export const REF = {
  // --- processi
  fork: P('pid_t fork(void);', ['unistd.h'], { ret: '0 nel figlio, il pid del figlio nel padre, -1 se fallisce.', note: 'Il figlio riceve una copia di tutto, anche del buffer di printf non ancora scritto: per questo una printf senza \\n prima della fork può comparire due volte. Usa fflush(stdout) prima di fork().' }),
  wait: P('pid_t wait(int *status);', ['sys/wait.h'], { ret: 'Il pid del figlio terminato, -1 se non ci sono figli (errno ECHILD).', note: 'Leggi lo stato con WIFEXITED(st) e WEXITSTATUS(st). Senza wait il figlio terminato resta «zombie».' }),
  waitpid: P('pid_t waitpid(pid_t pid, int *status, int options);', ['sys/wait.h'], { ret: 'Il pid atteso, 0 con WNOHANG se nessuno ha finito, -1 in caso di errore.', note: 'pid = -1 aspetta un figlio qualsiasi. Con WNOHANG non si blocca.' }),
  exit: P('void exit(int status);', ['stdlib.h'], { note: 'Svuota i buffer di stdio e chiama gli atexit. Nel figlio dopo una fork va bene; _exit() invece non svuota i buffer.' }),
  _exit: P('void _exit(int status);', ['unistd.h'], { note: 'Termina subito, senza svuotare i buffer di stdio.' }),
  getpid: P('pid_t getpid(void);', ['unistd.h']),
  getppid: P('pid_t getppid(void);', ['unistd.h'], { note: 'Se il padre è già terminato, il figlio «orfano» viene adottato (di solito da init, pid 1).' }),
  execl: P('int execl(const char *path, const char *arg0, ..., (char *) NULL);', ['unistd.h'], { ret: 'Non ritorna se riesce; -1 se fallisce.', note: 'L\'elenco degli argomenti finisce con (char *) NULL. Per cercare nel PATH: execlp.' }),
  execlp: P('int execlp(const char *file, const char *arg0, ..., (char *) NULL);', ['unistd.h'], { ret: 'Non ritorna se riesce; -1 se fallisce.' }),
  execv: P('int execv(const char *path, char *const argv[]);', ['unistd.h'], { ret: 'Non ritorna se riesce; -1 se fallisce.', note: 'argv[0] è il nome del programma, l\'ultimo elemento è NULL.' }),
  execvp: P('int execvp(const char *file, char *const argv[]);', ['unistd.h'], { ret: 'Non ritorna se riesce; -1 se fallisce.' }),
  pipe: P('int pipe(int fd[2]);', ['unistd.h'], { ret: '0 o -1.', note: 'fd[0] si legge, fd[1] si scrive. Chiudi le estremità che non usi, altrimenti read() non vede mai la fine.' }),
  dup2: P('int dup2(int oldfd, int newfd);', ['unistd.h'], { note: 'Per redirigere: dup2(fd[1], STDOUT_FILENO).' }),
  kill: P('int kill(pid_t pid, int sig);', ['signal.h']),
  perror: P('void perror(const char *s);', ['stdio.h'], { note: 'Stampa s seguito dal messaggio di errno. Usalo dopo ogni chiamata che restituisce -1.' }),

  // --- memoria condivisa POSIX
  shm_open: P('int shm_open(const char *name, int oflag, mode_t mode);', ['sys/mman.h', 'sys/stat.h', 'fcntl.h'], { link: '-lrt (su glibc recenti non serve, ma non fa danni)', ret: 'Un descrittore di file, -1 se fallisce.', err: 'EEXIST con O_CREAT|O_EXCL se c\'è già (rimasta da un\'esecuzione prima: shm_unlink all\'inizio). ENOENT senza O_CREAT se nessuno l\'ha creata.', note: 'Il nome inizia con "/" (es. "/shm_buffer"). Dopo la creazione serve ftruncate() per darle una dimensione, poi mmap().' }),
  ftruncate: P('int ftruncate(int fd, off_t length);', ['unistd.h'], { note: 'Dopo shm_open(O_CREAT) la memoria è lunga 0: senza ftruncate, accedere alla mmap dà SIGBUS.' }),
  mmap: P('void *mmap(void *addr, size_t len, int prot, int flags, int fd, off_t off);', ['sys/mman.h'], { ret: 'L\'indirizzo, o MAP_FAILED (non NULL!) se fallisce.', note: 'Per la memoria condivisa: mmap(NULL, sizeof(T), PROT_READ|PROT_WRITE, MAP_SHARED, fd, 0). Fatta prima della fork, il figlio la eredita allo stesso indirizzo.' }),
  munmap: P('int munmap(void *addr, size_t len);', ['sys/mman.h']),
  shm_unlink: P('int shm_unlink(const char *name);', ['sys/mman.h'], { note: 'Toglie il nome: la memoria sparisce quando tutti hanno fatto munmap. Senza, resta in /dev/shm anche dopo la fine del programma.' }),

  // --- semafori POSIX
  sem_open: P('sem_t *sem_open(const char *name, int oflag, mode_t mode, unsigned int value);', ['semaphore.h', 'fcntl.h'], { link: '-pthread', ret: 'Il semaforo, o SEM_FAILED se fallisce.', err: 'EEXIST con O_CREAT|O_EXCL: è rimasto da un\'esecuzione prima (sem_unlink all\'inizio, o togli O_EXCL). Il valore iniziale conta solo quando il semaforo viene creato.', note: 'Semaforo con nome, per processi che non sono parenti. Nome con "/" iniziale. Alla fine: sem_close e sem_unlink.' }),
  sem_close: P('int sem_close(sem_t *sem);', ['semaphore.h']),
  sem_unlink: P('int sem_unlink(const char *name);', ['semaphore.h'], { note: 'Senza, il semaforo resta in /dev/shm (sem.<nome>) col valore che aveva: la prossima esecuzione parte sbagliata.' }),
  sem_init: P('int sem_init(sem_t *sem, int pshared, unsigned int value);', ['semaphore.h'], { link: '-pthread', note: 'Semaforo senza nome. pshared = 1 per usarlo tra processi: allora il sem_t deve stare in memoria condivisa (mmap MAP_SHARED), non in una variabile normale. pshared = 0 per i thread.' }),
  sem_destroy: P('int sem_destroy(sem_t *sem);', ['semaphore.h']),
  sem_wait: P('int sem_wait(sem_t *sem);', ['semaphore.h'], { ret: '0, o -1 (EINTR se interrotto da un segnale).', note: 'La P(): se il valore è 0 si blocca finché qualcuno fa sem_post.' }),
  sem_trywait: P('int sem_trywait(sem_t *sem);', ['semaphore.h'], { ret: '0, o -1 con errno EAGAIN se il valore è 0 (non si blocca).' }),
  sem_post: P('int sem_post(sem_t *sem);', ['semaphore.h'], { note: 'La V(): incrementa e sveglia uno in attesa.' }),
  sem_getvalue: P('int sem_getvalue(sem_t *sem, int *sval);', ['semaphore.h'], { note: 'Utile per il debug; non usarlo per decidere se fare wait (tra il controllo e la wait il valore può cambiare).' }),

  // --- code di messaggi POSIX
  mq_open: P('mqd_t mq_open(const char *name, int oflag, mode_t mode, struct mq_attr *attr);', ['mqueue.h', 'fcntl.h'], { link: '-lrt', ret: 'Il descrittore della coda, (mqd_t)-1 se fallisce.', err: 'EINVAL se mq_maxmsg o mq_msgsize superano i limiti di sistema (tipicamente 10 messaggi e 8192 byte). EEXIST con O_EXCL.', note: 'Con attr = NULL valgono i valori di sistema. In POSIX non c\'è il «tipo» di System V: una coda per classe di messaggi, o le priorità.' }),
  mq_send: P('int mq_send(mqd_t q, const char *msg, size_t len, unsigned prio);', ['mqueue.h'], { ret: '0 o -1.', err: 'EMSGSIZE se len > mq_msgsize. Si blocca se la coda è piena (senza O_NONBLOCK).', note: 'Passa la struct: mq_send(q, (char *)&m, sizeof(m), 0).' }),
  mq_receive: P('ssize_t mq_receive(mqd_t q, char *buf, size_t len, unsigned *prio);', ['mqueue.h'], { ret: 'I byte ricevuti, -1 se fallisce.', err: 'EMSGSIZE se len è più piccolo di mq_msgsize della coda (anche se il messaggio è piccolo!).', note: 'Il buffer deve essere grande almeno mq_msgsize: leggilo con mq_getattr. Esce prima il messaggio con priorità più alta.' }),
  mq_getattr: P('int mq_getattr(mqd_t q, struct mq_attr *attr);', ['mqueue.h'], { note: 'attr.mq_msgsize è la dimensione da usare per il buffer di mq_receive.' }),
  mq_close: P('int mq_close(mqd_t q);', ['mqueue.h']),
  mq_unlink: P('int mq_unlink(const char *name);', ['mqueue.h'], { note: 'Senza, la coda resta (con i messaggi dentro) fino al riavvio.' }),

  // --- thread e monitor
  pthread_create: P('int pthread_create(pthread_t *t, const pthread_attr_t *attr, void *(*fn)(void *), void *arg);', ['pthread.h'], { link: '-pthread', ret: '0, o un codice d\'errore (non -1 e non errno!).', note: 'Non passare l\'indirizzo della variabile del ciclo (&i): cambia prima che il thread la legga. Passa un valore o una struct per thread.' }),
  pthread_join: P('int pthread_join(pthread_t t, void **ret);', ['pthread.h'], { note: 'Senza join, main può finire prima dei thread e terminarli tutti.' }),
  pthread_exit: P('void pthread_exit(void *ret);', ['pthread.h']),
  pthread_mutex_init: P('int pthread_mutex_init(pthread_mutex_t *m, const pthread_mutexattr_t *attr);', ['pthread.h'], { note: 'Oppure: pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;' }),
  pthread_mutex_lock: P('int pthread_mutex_lock(pthread_mutex_t *m);', ['pthread.h'], { note: 'Ogni lock ha il suo unlock su ogni percorso, anche nei return anticipati.' }),
  pthread_mutex_unlock: P('int pthread_mutex_unlock(pthread_mutex_t *m);', ['pthread.h']),
  pthread_mutex_destroy: P('int pthread_mutex_destroy(pthread_mutex_t *m);', ['pthread.h']),
  pthread_cond_init: P('int pthread_cond_init(pthread_cond_t *c, const pthread_condattr_t *attr);', ['pthread.h'], { note: 'Oppure: pthread_cond_t c = PTHREAD_COND_INITIALIZER;' }),
  pthread_cond_wait: P('int pthread_cond_wait(pthread_cond_t *c, pthread_mutex_t *m);', ['pthread.h'], { note: 'Semantica signal-and-continue: chi viene svegliato riparte dopo, quando riprende il mutex, e la condizione può essere di nuovo falsa. Sempre dentro un while, mai un if: while (pieno) pthread_cond_wait(&c, &m);' }),
  pthread_cond_signal: P('int pthread_cond_signal(pthread_cond_t *c);', ['pthread.h'], { note: 'Sveglia al più un thread in attesa; se nessuno aspetta, il segnale si perde (non è un semaforo).' }),
  pthread_cond_broadcast: P('int pthread_cond_broadcast(pthread_cond_t *c);', ['pthread.h'], { note: 'Sveglia tutti: ognuno ricontrolla la condizione nel suo while.' }),
  pthread_cond_destroy: P('int pthread_cond_destroy(pthread_cond_t *c);', ['pthread.h']),
};

// System V → POSIX (si usano le IPC POSIX: le soluzioni vecchie vanno lette come problemi)
const V = (posix, how) => ({ sysv: true, posix, note: how });
Object.assign(REF, {
  shmget: V('shm_open + ftruncate', 'In POSIX: fd = shm_open("/nome", O_CREAT|O_RDWR, 0660); ftruncate(fd, sizeof(T));'),
  shmat: V('mmap', 'In POSIX: p = mmap(NULL, sizeof(T), PROT_READ|PROT_WRITE, MAP_SHARED, fd, 0);'),
  shmdt: V('munmap', 'In POSIX: munmap(p, sizeof(T));'),
  shmctl: V('shm_unlink', 'IPC_RMID diventa shm_unlink("/nome").'),
  semget: V('sem_open (o sem_init in memoria condivisa)', 'Un semaforo POSIX alla volta: niente «vettore di semafori».'),
  semop: V('sem_wait / sem_post', 'Wait_Sem diventa sem_wait, Signal_Sem diventa sem_post.'),
  semctl: V('valore iniziale in sem_open/sem_init; sem_unlink/sem_destroy', 'SETVAL si fa alla creazione; IPC_RMID diventa sem_unlink o sem_destroy.'),
  msgget: V('mq_open', 'mq_open("/nome", O_CREAT|O_RDWR, 0660, &attr).'),
  msgsnd: V('mq_send', 'Niente campo «tipo»: usa una coda per classe di messaggi o le priorità.'),
  msgrcv: V('mq_receive', 'Niente ricezione selettiva per tipo: il buffer deve essere grande almeno mq_msgsize.'),
  msgctl: V('mq_unlink', 'IPC_RMID diventa mq_unlink("/nome").'),
  ftok: V('un nome che inizia con "/"', 'In POSIX le IPC si identificano con un nome, non con una chiave.'),
});

// Lingua (2026-11-25): i testi delle schede seguono l'interfaccia (traduzioni in lang/en.js); la lingua è fissa dal
// caricamento, perché cambiandola l'app ricarica la pagina. Prototipi e #include restano come sono.
for (const scheda of Object.values(REF)) for (const k of ['ret', 'err', 'note', 'link', 'posix']) if (scheda[k]) scheda[k] = t(scheda[k]);

// La chiamata sotto il cursore (o appena prima)
export function refAt(text, pos) {
  const a = text.slice(Math.max(0, pos - 40), pos).match(/[A-Za-z_]\w*$/)?.[0] || '';
  const b = text.slice(pos, pos + 40).match(/^\w*/)?.[0] || '';
  const w = a + b;
  return REF[w] ? w : null;
}
