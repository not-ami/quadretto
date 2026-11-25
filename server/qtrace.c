// qtrace.c — «radiografia» dei programmi C/C++ multiprocesso e multithread di Quadretto (2026.11.4).
//
// Caricata con LD_PRELOAD solo dentro la gabbia (server/run.js), si mette davanti alle chiamate di
// sincronizzazione e IPC POSIX (fork, wait, pthread, mutex, condition variable, semafori, memoria condivisa,
// code di messaggi) e scrive un evento per riga nel file $QTRACE:
//
//     <microsecondi> <pid> <tid> <evento> [argomenti…]
//
// Con QTRACE_JITTER=<seme> aggiunge piccole pause casuali prima delle operazioni di sincronizzazione: è la
// «prova di stress», che fa emergere le race condition rare. Il client (public/js/xray.js) legge gli eventi e
// ricostruisce chi aspetta cosa, la linea del tempo, l'albero dei processi e le IPC rimaste.
//
// Regole: mai chiamare funzioni intercettate da qui dentro (si scrive con syscall(SYS_write)), niente malloc
// tranne il trampolino di pthread_create, e nessun cambiamento di comportamento del programma (lo stdout resta
// bufferizzato come quando esce su una pipe: anche l'output duplicato dopo una fork si vede com'è davvero).
#define _GNU_SOURCE
#include <dlfcn.h>
#include <link.h>
#include <errno.h>
#include <fcntl.h>
#include <mqueue.h>
#include <pthread.h>
#include <sched.h>
#include <semaphore.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#define MAXEV 60000
static int tfd = -1;
static long nev = 0;
static int jitter = 0;
static unsigned rs = 1;

static long long now_us(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (long long)t.tv_sec * 1000000LL + t.tv_nsec / 1000;
}

static void emit(const char *fmt, ...) {
  if (tfd < 0 || nev >= MAXEV) return;
  int e = errno;
  char buf[720];
  int n = snprintf(buf, sizeof buf, "%lld %d %ld ", now_us(), (int)getpid(), (long)syscall(SYS_gettid));
  va_list ap;
  va_start(ap, fmt);
  n += vsnprintf(buf + n, sizeof buf - n, fmt, ap);
  va_end(ap);
  if (n > (int)sizeof buf - 2) n = sizeof buf - 2;
  buf[n++] = '\n';
  syscall(SYS_write, tfd, buf, n);
  nev++;
  if (nev == MAXEV) { static const char m[] = "0 0 0 cut\n"; syscall(SYS_write, tfd, m, sizeof m - 1); }
  errno = e;
}

// pause casuali (solo nella prova di stress)
static void jit(void) {
  if (!jitter) return;
  rs = rs * 1103515245u + 12345u;
  unsigned r = (rs >> 16) % 100;
  if (r < 25) usleep(50 + (rs >> 8) % 900);
  else if (r < 55) sched_yield();
}
static void seed(void) { rs = (unsigned)(jitter * 2654435761u) ^ (unsigned)getpid() * 40503u ^ (unsigned)now_us(); }

// i nomi senza spazi, così la riga resta divisibile
static const char *clean(const char *s, char *out, size_t n) {
  size_t i = 0;
  if (!s) s = "?";
  for (; s[i] && i < n - 1; i++) out[i] = (s[i] == ' ' || s[i] == '\n' || s[i] == '\t') ? '_' : s[i];
  out[i] = 0;
  return out;
}

// --- uscita del programma: stdout e stderr passano da qui, con il pid di chi scrive ------------------------
static void out_ev(int fd, const char *b, size_t n) {
  if (tfd < 0) return;
  char esc[460];
  size_t i = 0;
  while (i < n) {
    size_t k = 0;
    for (; i < n && k < sizeof esc - 6; i++) {
      unsigned char c = (unsigned char)b[i];
      if (c == '\\') { esc[k++] = '\\'; esc[k++] = '\\'; }
      else if (c == '\n') { esc[k++] = '\\'; esc[k++] = 'n'; }
      else if (c == ' ') { esc[k++] = '\\'; esc[k++] = 's'; }
      else if (c < 32 || c == 127) { k += snprintf(esc + k, 6, "\\x%02x", c); }
      else esc[k++] = (char)c;
    }
    esc[k] = 0;
    emit("out %d %s", fd, esc);
  }
}
static ssize_t ck_write(void *c, const char *b, size_t n) {
  int fd = (int)(long)c;
  ssize_t r = syscall(SYS_write, fd, b, n);
  if (r > 0) out_ev(fd, b, (size_t)r);
  return r;
}

static int base_cb(struct dl_phdr_info *i, size_t n, void *d) {
  (void)n; (void)d;
  emit("base %p", (void *)i->dlpi_addr); // il primo oggetto è il programma
  return 1;
}

__attribute__((constructor)) static void qt_init(void) {
  const char *p = getenv("QTRACE");
  if (!p || !*p) return;
  tfd = open(p, O_WRONLY | O_APPEND | O_CREAT | O_CLOEXEC, 0600);
  const char *j = getenv("QTRACE_JITTER");
  jitter = j ? atoi(j) : 0;
  seed();
  emit("start %d", (int)getppid());
  // indirizzo di caricamento del programma: con la tabella dei simboli il client dà un nome a mutex e semafori globali
  dl_iterate_phdr(base_cb, NULL);
  // stdout e stderr come prima (pieno buffer su pipe / nessun buffer), ma ogni scrittura porta il pid
  cookie_io_functions_t io = { .write = ck_write };
  FILE *o = fopencookie((void *)1L, "w", io);
  FILE *e = fopencookie((void *)2L, "w", io);
  if (o && e) {
    setvbuf(o, NULL, isatty(1) ? _IOLBF : _IOFBF, 0);
    setvbuf(e, NULL, _IONBF, 0);
    stdout = o;
    stderr = e;
  }
}

// fine del processo anche quando main fa return (exit interno di glibc, che non passa dal nostro exit)
__attribute__((destructor)) static void qt_fini(void) { emit("end"); }

#define REAL(ret, name, ...) static ret (*real_##name)(__VA_ARGS__); if (!real_##name) real_##name = dlsym(RTLD_NEXT, #name)
// le condition variable hanno due versioni in glibc: quella giusta è GLIBC_2.3.2 (dove esiste)
static void *condsym(const char *n) { void *p = dlvsym(RTLD_NEXT, n, "GLIBC_2.3.2"); return p ? p : dlsym(RTLD_NEXT, n); }

// --- processi ---------------------------------------------------------------------------------------------
pid_t fork(void) {
  REAL(pid_t, fork, void);
  jit();
  pid_t p = real_fork();
  if (p == 0) { seed(); emit("start %d", (int)getppid()); }
  else if (p > 0) emit("fork %d", (int)p);
  return p;
}
static void st_ev(pid_t p, int st) {
  if (p <= 0) emit("waite %d -1 0", (int)p);
  else if (WIFEXITED(st)) emit("waite %d x %d", (int)p, WEXITSTATUS(st));
  else if (WIFSIGNALED(st)) emit("waite %d s %d", (int)p, WTERMSIG(st));
  else emit("waite %d ? 0", (int)p);
}
pid_t wait(int *st) {
  REAL(pid_t, waitpid, pid_t, int *, int);
  int s = 0;
  emit("waitb -1");
  pid_t p = real_waitpid(-1, &s, 0);
  st_ev(p, s);
  if (st) *st = s;
  return p;
}
pid_t waitpid(pid_t pid, int *st, int opt) {
  REAL(pid_t, waitpid, pid_t, int *, int);
  int s = 0;
  if (!(opt & WNOHANG)) emit("waitb %d", (int)pid);
  pid_t p = real_waitpid(pid, &s, opt);
  if (!(opt & WNOHANG) || p > 0) st_ev(p, s);
  if (st) *st = s;
  return p;
}
void exit(int code) {
  REAL(void, exit, int);
  emit("exit %d", code);
  real_exit(code);
  __builtin_unreachable();
}
void _exit(int code) {
  REAL(void, _exit, int);
  emit("exit %d", code);
  real__exit(code);
  __builtin_unreachable();
}

// --- thread -----------------------------------------------------------------------------------------------
struct tramp { void *(*fn)(void *); void *arg; long parent; };
static void *trampoline(void *x) {
  struct tramp t = *(struct tramp *)x;
  free(x);
  emit("tstart %ld", t.parent);
  void *r = t.fn(t.arg);
  emit("tend");
  return r;
}
int pthread_create(pthread_t *th, const pthread_attr_t *a, void *(*fn)(void *), void *arg) {
  REAL(int, pthread_create, pthread_t *, const pthread_attr_t *, void *(*)(void *), void *);
  struct tramp *t = malloc(sizeof *t);
  if (!t) return real_pthread_create(th, a, fn, arg);
  t->fn = fn; t->arg = arg; t->parent = (long)syscall(SYS_gettid);
  jit();
  int r = real_pthread_create(th, a, trampoline, t);
  if (r) free(t);
  return r;
}
int pthread_join(pthread_t th, void **ret) {
  REAL(int, pthread_join, pthread_t, void **);
  emit("joinb");
  int r = real_pthread_join(th, ret);
  emit("joine %d", r);
  return r;
}

// --- mutex e condition variable -----------------------------------------------------------------------------
int pthread_mutex_lock(pthread_mutex_t *m) {
  REAL(int, pthread_mutex_lock, pthread_mutex_t *);
  jit();
  emit("mlock %p", (void *)m);
  int r = real_pthread_mutex_lock(m);
  emit("macq %p %d", (void *)m, r);
  return r;
}
int pthread_mutex_trylock(pthread_mutex_t *m) {
  REAL(int, pthread_mutex_trylock, pthread_mutex_t *);
  int r = real_pthread_mutex_trylock(m);
  if (r == 0) emit("macq %p 0", (void *)m);
  return r;
}
int pthread_mutex_unlock(pthread_mutex_t *m) {
  REAL(int, pthread_mutex_unlock, pthread_mutex_t *);
  emit("munlock %p", (void *)m);
  int r = real_pthread_mutex_unlock(m);
  jit();
  return r;
}
int pthread_cond_wait(pthread_cond_t *c, pthread_mutex_t *m) {
  static int (*real)(pthread_cond_t *, pthread_mutex_t *);
  if (!real) real = condsym("pthread_cond_wait");
  emit("cwait %p %p", (void *)c, (void *)m);
  int r = real(c, m);
  emit("cwake %p %p", (void *)c, (void *)m);
  return r;
}
int pthread_cond_timedwait(pthread_cond_t *c, pthread_mutex_t *m, const struct timespec *ts) {
  static int (*real)(pthread_cond_t *, pthread_mutex_t *, const struct timespec *);
  if (!real) real = condsym("pthread_cond_timedwait");
  emit("cwait %p %p", (void *)c, (void *)m);
  int r = real(c, m, ts);
  emit("cwake %p %p", (void *)c, (void *)m);
  return r;
}
int pthread_cond_signal(pthread_cond_t *c) {
  static int (*real)(pthread_cond_t *);
  if (!real) real = condsym("pthread_cond_signal");
  jit();
  emit("csig %p", (void *)c);
  return real(c);
}
int pthread_cond_broadcast(pthread_cond_t *c) {
  static int (*real)(pthread_cond_t *);
  if (!real) real = condsym("pthread_cond_broadcast");
  jit();
  emit("cbc %p", (void *)c);
  return real(c);
}

// --- semafori POSIX -----------------------------------------------------------------------------------------
static int semval(sem_t *s) { int v = -999; sem_getvalue(s, &v); return v; }
int sem_init(sem_t *s, int pshared, unsigned v) {
  REAL(int, sem_init, sem_t *, int, unsigned);
  int r = real_sem_init(s, pshared, v);
  emit("sinit %p %u %d %d", (void *)s, v, pshared, r);
  return r;
}
sem_t *sem_open(const char *name, int oflag, ...) {
  REAL(sem_t *, sem_open, const char *, int, ...);
  char nm[120];
  sem_t *s;
  unsigned v = 0;
  if (oflag & O_CREAT) {
    va_list ap; va_start(ap, oflag);
    mode_t mode = (mode_t)va_arg(ap, int);
    v = va_arg(ap, unsigned);
    va_end(ap);
    s = real_sem_open(name, oflag, mode, v);
  } else s = real_sem_open(name, oflag);
  int e = errno;
  emit("sopen %p %s %d %u %d", (void *)s, clean(name, nm, sizeof nm), (oflag & O_CREAT) ? ((oflag & O_EXCL) ? 2 : 1) : 0, v, s == SEM_FAILED ? e : 0);
  errno = e;
  return s;
}
int sem_wait(sem_t *s) {
  REAL(int, sem_wait, sem_t *);
  jit();
  emit("swait %p %d", (void *)s, semval(s));
  int r = real_sem_wait(s);
  emit("sacq %p %d %d", (void *)s, semval(s), r);
  return r;
}
int sem_timedwait(sem_t *s, const struct timespec *ts) {
  REAL(int, sem_timedwait, sem_t *, const struct timespec *);
  emit("swait %p %d", (void *)s, semval(s));
  int r = real_sem_timedwait(s, ts);
  emit("sacq %p %d %d", (void *)s, semval(s), r);
  return r;
}
int sem_trywait(sem_t *s) {
  REAL(int, sem_trywait, sem_t *);
  int r = real_sem_trywait(s);
  if (r == 0) emit("sacq %p %d 0", (void *)s, semval(s));
  return r;
}
int sem_post(sem_t *s) {
  REAL(int, sem_post, sem_t *);
  jit();
  int r = real_sem_post(s);
  emit("spost %p %d", (void *)s, semval(s));
  return r;
}
int sem_unlink(const char *name) {
  REAL(int, sem_unlink, const char *);
  char nm[120];
  int r = real_sem_unlink(name);
  emit("sunlink %s %d", clean(name, nm, sizeof nm), r ? errno : 0);
  return r;
}

// --- memoria condivisa ---------------------------------------------------------------------------------------
int shm_open(const char *name, int oflag, mode_t mode) {
  REAL(int, shm_open, const char *, int, mode_t);
  char nm[120];
  int r = real_shm_open(name, oflag, mode);
  int e = errno;
  emit("shmopen %s %d %d %d", clean(name, nm, sizeof nm), (oflag & O_CREAT) ? 1 : 0, r, r < 0 ? e : 0);
  errno = e;
  return r;
}
int shm_unlink(const char *name) {
  REAL(int, shm_unlink, const char *);
  char nm[120];
  int r = real_shm_unlink(name);
  emit("shmunlink %s %d", clean(name, nm, sizeof nm), r ? errno : 0);
  return r;
}

// --- code di messaggi -----------------------------------------------------------------------------------------
mqd_t mq_open(const char *name, int oflag, ...) {
  REAL(mqd_t, mq_open, const char *, int, ...);
  char nm[120];
  mqd_t q;
  if (oflag & O_CREAT) {
    va_list ap; va_start(ap, oflag);
    mode_t mode = (mode_t)va_arg(ap, int);
    struct mq_attr *at = va_arg(ap, struct mq_attr *);
    va_end(ap);
    q = real_mq_open(name, oflag, mode, at);
  } else q = real_mq_open(name, oflag);
  int e = errno;
  long maxmsg = 0, msgsize = 0;
  if (q != (mqd_t)-1) { struct mq_attr a; if (mq_getattr(q, &a) == 0) { maxmsg = a.mq_maxmsg; msgsize = a.mq_msgsize; } }
  emit("mqopen %d %s %d %ld %ld %d", (int)q, clean(name, nm, sizeof nm), (oflag & O_CREAT) ? 1 : 0, maxmsg, msgsize, q == (mqd_t)-1 ? e : 0);
  errno = e;
  return q;
}
int mq_send(mqd_t q, const char *m, size_t n, unsigned prio) {
  REAL(int, mq_send, mqd_t, const char *, size_t, unsigned);
  jit();
  emit("mqsendb %d %zu %u", (int)q, n, prio);
  int r = real_mq_send(q, m, n, prio);
  emit("mqsende %d %d", (int)q, r ? errno : 0);
  return r;
}
ssize_t mq_receive(mqd_t q, char *m, size_t n, unsigned *prio) {
  REAL(ssize_t, mq_receive, mqd_t, char *, size_t, unsigned *);
  jit();
  emit("mqrecvb %d %zu", (int)q, n);
  ssize_t r = real_mq_receive(q, m, n, prio);
  emit("mqrecve %d %zd %d", (int)q, r, r < 0 ? errno : 0);
  return r;
}
int mq_unlink(const char *name) {
  REAL(int, mq_unlink, const char *);
  char nm[120];
  int r = real_mq_unlink(name);
  emit("mqunlink %s %d", clean(name, nm, sizeof nm), r ? errno : 0);
  return r;
}

// --- write diretta su 1 e 2 (senza stdio) ----------------------------------------------------------------------
ssize_t write(int fd, const void *b, size_t n) {
  ssize_t r = syscall(SYS_write, fd, b, n);
  if ((fd == 1 || fd == 2) && r > 0) out_ev(fd, b, (size_t)r);
  return r;
}
