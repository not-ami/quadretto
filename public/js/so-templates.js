// Quadretto — modelli di repository per Sistemi Operativi (2026.11.4).
// IPC POSIX e monitor con pthread, come in un tipico corso di Sistemi Operativi. Scritti per Quadretto:
// struttura header.h / procedure.c / main.c come nelle esercitazioni, commenti in italiano, tutto si compila e
// gira nella gabbia del server (gcc -pthread -lrt). Ognuno è un punto di partenza, non la soluzione di una traccia.

import { t } from './i18n.js';

const MAKE = (objs, extra = '') => `# Sul tuo PC: make && ./programma   (in Quadretto basta Esegui)
CC = gcc
CFLAGS = -Wall -Wextra -g
LDLIBS = -pthread -lrt
${extra}
programma: ${objs}
\t$(CC) $(CFLAGS) -o $@ $^ $(LDLIBS)

clean:
\trm -f *.o programma
`;

const MODELLI = [
  {
    course: 'so', k: 'prodcons-sem', ico: 'proc', short: 'Semafori e memoria condivisa tra processi', label: 'Produttori e consumatori', name: 'prodcons-semafori',
    desc: 'Buffer circolare in memoria condivisa (shm_open + mmap), semafori POSIX senza nome condivisi tra processi (sem_init con pshared = 1 dentro la struct), produttori e consumatori creati con fork.',
    files: [
      { path: 'header.h', text: `#ifndef HEADER_H
#define HEADER_H
#include <semaphore.h>

#define DIM 4            // posti nel buffer
#define NUM_PROD 2
#define NUM_CONS 2
#define PRODUZIONI 4     // per ogni produttore

typedef struct {
    int buffer[DIM];
    int testa, coda;     // dove consumare, dove produrre
    sem_t spazio;        // posti liberi
    sem_t messaggi;      // posti pieni
    sem_t mutex_p;       // mutua esclusione tra produttori
    sem_t mutex_c;       // mutua esclusione tra consumatori
} Buffer;

void inizializza(Buffer *b);
void produci(Buffer *b, int valore);
int consuma(Buffer *b);
void distruggi(Buffer *b);

#endif
` },
      { path: 'procedure.c', text: `#include <stdio.h>
#include "header.h"

void inizializza(Buffer *b) {
    b->testa = b->coda = 0;
    // pshared = 1: i semafori sono usati da processi diversi (e stanno in memoria condivisa)
    sem_init(&b->spazio, 1, DIM);
    sem_init(&b->messaggi, 1, 0);
    sem_init(&b->mutex_p, 1, 1);
    sem_init(&b->mutex_c, 1, 1);
}

void produci(Buffer *b, int valore) {
    sem_wait(&b->spazio);
    sem_wait(&b->mutex_p);
    b->buffer[b->coda] = valore;
    b->coda = (b->coda + 1) % DIM;
    sem_post(&b->mutex_p);
    sem_post(&b->messaggi);
}

int consuma(Buffer *b) {
    sem_wait(&b->messaggi);
    sem_wait(&b->mutex_c);
    int v = b->buffer[b->testa];
    b->testa = (b->testa + 1) % DIM;
    sem_post(&b->mutex_c);
    sem_post(&b->spazio);
    return v;
}

void distruggi(Buffer *b) {
    sem_destroy(&b->spazio);
    sem_destroy(&b->messaggi);
    sem_destroy(&b->mutex_p);
    sem_destroy(&b->mutex_c);
}
` },
      { path: 'main.c', text: `#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/wait.h>
#include "header.h"

#define NOME_SHM "/prodcons_buffer"

int main(void) {
    shm_unlink(NOME_SHM); // se è rimasta da un'esecuzione precedente
    int fd = shm_open(NOME_SHM, O_CREAT | O_RDWR, 0660);
    if (fd < 0) { perror("shm_open"); return 1; }
    if (ftruncate(fd, sizeof(Buffer)) < 0) { perror("ftruncate"); return 1; }
    Buffer *b = mmap(NULL, sizeof(Buffer), PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    if (b == MAP_FAILED) { perror("mmap"); return 1; }
    close(fd);
    inizializza(b);

    for (int p = 0; p < NUM_PROD; p++) {
        if (fork() == 0) {
            for (int i = 0; i < PRODUZIONI; i++) {
                int v = (p + 1) * 100 + i;
                produci(b, v);
                printf("[P%d] prodotto %d\\n", getpid(), v);
                fflush(stdout);
            }
            exit(0);
        }
    }
    int per_cons = NUM_PROD * PRODUZIONI / NUM_CONS;
    for (int c = 0; c < NUM_CONS; c++) {
        if (fork() == 0) {
            for (int i = 0; i < per_cons; i++) {
                int v = consuma(b);
                printf("        [C%d] consumato %d\\n", getpid(), v);
                fflush(stdout);
            }
            exit(0);
        }
    }
    for (int i = 0; i < NUM_PROD + NUM_CONS; i++) wait(NULL);

    distruggi(b);
    munmap(b, sizeof(Buffer));
    shm_unlink(NOME_SHM);
    printf("Fine: tutti i processi sono terminati\\n");
    return 0;
}
` },
      { path: 'Makefile', text: MAKE('main.o procedure.o') },
    ],
  },
  {
    course: 'so', k: 'monitor-pthread', ico: 'lock', short: 'Mutex e condition variable con i thread', label: 'Monitor con pthread', name: 'monitor-prodcons',
    desc: 'Monitor con pthread_mutex e due condition variable (signal-and-continue: la condizione si ricontrolla in un while), buffer circolare, thread produttori e consumatori.',
    files: [
      { path: 'header.h', text: `#ifndef HEADER_H
#define HEADER_H
#include <pthread.h>

#define DIM 3
#define NUM_PROD 3
#define NUM_CONS 2
#define PRODUZIONI 4

typedef struct {
    int buffer[DIM];
    int testa, coda, count;
    pthread_mutex_t mutex;
    pthread_cond_t ok_prod;   // c'è spazio
    pthread_cond_t ok_cons;   // c'è almeno un elemento
} Monitor;

void inizializza(Monitor *m);
void produci(Monitor *m, int valore);
int consuma(Monitor *m);
void distruggi(Monitor *m);

#endif
` },
      { path: 'procedure.c', text: `#include "header.h"

void inizializza(Monitor *m) {
    m->testa = m->coda = m->count = 0;
    pthread_mutex_init(&m->mutex, NULL);
    pthread_cond_init(&m->ok_prod, NULL);
    pthread_cond_init(&m->ok_cons, NULL);
}

void produci(Monitor *m, int valore) {
    pthread_mutex_lock(&m->mutex);
    while (m->count == DIM)                  // while, non if: signal-and-continue
        pthread_cond_wait(&m->ok_prod, &m->mutex);
    m->buffer[m->coda] = valore;
    m->coda = (m->coda + 1) % DIM;
    m->count++;
    pthread_cond_signal(&m->ok_cons);
    pthread_mutex_unlock(&m->mutex);
}

int consuma(Monitor *m) {
    pthread_mutex_lock(&m->mutex);
    while (m->count == 0)
        pthread_cond_wait(&m->ok_cons, &m->mutex);
    int v = m->buffer[m->testa];
    m->testa = (m->testa + 1) % DIM;
    m->count--;
    pthread_cond_signal(&m->ok_prod);
    pthread_mutex_unlock(&m->mutex);
    return v;
}

void distruggi(Monitor *m) {
    pthread_mutex_destroy(&m->mutex);
    pthread_cond_destroy(&m->ok_prod);
    pthread_cond_destroy(&m->ok_cons);
}
` },
      { path: 'main.c', text: `#include <stdio.h>
#include <stdlib.h>
#include "header.h"

static Monitor m;

typedef struct { int id; int quanti; } Arg;

void *produttore(void *x) {
    Arg *a = x;
    for (int i = 0; i < a->quanti; i++) {
        int v = a->id * 10 + i;
        produci(&m, v);
        printf("produttore %d: %d\\n", a->id, v);
    }
    return NULL;
}

void *consumatore(void *x) {
    Arg *a = x;
    for (int i = 0; i < a->quanti; i++) printf("        consumatore %d: %d\\n", a->id, consuma(&m));
    return NULL;
}

int main(void) {
    pthread_t t[NUM_PROD + NUM_CONS];
    Arg arg[NUM_PROD + NUM_CONS];     // un argomento per thread: mai &i del ciclo
    inizializza(&m);
    for (int i = 0; i < NUM_PROD; i++) {
        arg[i] = (Arg){ i + 1, PRODUZIONI };
        pthread_create(&t[i], NULL, produttore, &arg[i]);
    }
    for (int i = 0; i < NUM_CONS; i++) {
        int k = NUM_PROD + i;
        arg[k] = (Arg){ i + 1, NUM_PROD * PRODUZIONI / NUM_CONS };
        pthread_create(&t[k], NULL, consumatore, &arg[k]);
    }
    for (int i = 0; i < NUM_PROD + NUM_CONS; i++) pthread_join(t[i], NULL);
    distruggi(&m);
    printf("Fine\\n");
    return 0;
}
` },
      { path: 'Makefile', text: MAKE('main.o procedure.o') },
    ],
  },
  {
    course: 'so', k: 'lettscritt', ico: 'lock', short: 'Più lettori insieme, uno scrittore alla volta', label: 'Lettori e scrittori', name: 'lettori-scrittori',
    desc: 'Monitor con pthread: più lettori insieme, uno scrittore alla volta, con precedenza agli scrittori in attesa (niente attesa infinita degli scrittori).',
    files: [
      { path: 'main.c', text: `#include <stdio.h>
#include <pthread.h>
#include <unistd.h>

#define LETTORI 4
#define SCRITTORI 2

typedef struct {
    int valore;
    int lettori_attivi, scrittore_attivo, scrittori_in_attesa;
    pthread_mutex_t mutex;
    pthread_cond_t ok_lettura, ok_scrittura;
} Monitor;

static Monitor m = { 0, 0, 0, 0, PTHREAD_MUTEX_INITIALIZER, PTHREAD_COND_INITIALIZER, PTHREAD_COND_INITIALIZER };

int leggi(void) {
    pthread_mutex_lock(&m.mutex);
    // precedenza agli scrittori: un lettore nuovo aspetta se uno scrittore scrive o è in attesa
    while (m.scrittore_attivo || m.scrittori_in_attesa > 0)
        pthread_cond_wait(&m.ok_lettura, &m.mutex);
    m.lettori_attivi++;
    pthread_mutex_unlock(&m.mutex);

    int v = m.valore;                // lettura fuori dal mutex: più lettori insieme
    usleep(1000);

    pthread_mutex_lock(&m.mutex);
    if (--m.lettori_attivi == 0) pthread_cond_signal(&m.ok_scrittura);
    pthread_mutex_unlock(&m.mutex);
    return v;
}

void scrivi(int v) {
    pthread_mutex_lock(&m.mutex);
    m.scrittori_in_attesa++;
    while (m.scrittore_attivo || m.lettori_attivi > 0)
        pthread_cond_wait(&m.ok_scrittura, &m.mutex);
    m.scrittori_in_attesa--;
    m.scrittore_attivo = 1;
    pthread_mutex_unlock(&m.mutex);

    m.valore = v;                    // scrittura: da solo
    usleep(1000);

    pthread_mutex_lock(&m.mutex);
    m.scrittore_attivo = 0;
    if (m.scrittori_in_attesa > 0) pthread_cond_signal(&m.ok_scrittura);
    else pthread_cond_broadcast(&m.ok_lettura);
    pthread_mutex_unlock(&m.mutex);
}

void *lettore(void *x) {
    long id = (long)x;
    for (int i = 0; i < 3; i++) printf("lettore %ld legge %d\\n", id, leggi());
    return NULL;
}
void *scrittore(void *x) {
    long id = (long)x;
    for (int i = 1; i <= 2; i++) { scrivi((int)id * 100 + i); printf("    scrittore %ld scrive %ld\\n", id, id * 100 + i); }
    return NULL;
}

int main(void) {
    pthread_t t[LETTORI + SCRITTORI];
    for (long i = 0; i < SCRITTORI; i++) pthread_create(&t[i], NULL, scrittore, (void *)(i + 1));
    for (long i = 0; i < LETTORI; i++) pthread_create(&t[SCRITTORI + i], NULL, lettore, (void *)(i + 1));
    for (int i = 0; i < LETTORI + SCRITTORI; i++) pthread_join(t[i], NULL);
    printf("valore finale %d\\n", m.valore);
    return 0;
}
` },
      { path: 'Makefile', text: MAKE('main.o') },
    ],
  },
  {
    course: 'so', k: 'mq-clientserver', ico: 'queue', short: 'Un server e più client con le code POSIX', label: 'Client e server con code', name: 'code-client-server',
    desc: 'Un server e più client (fork) con code di messaggi POSIX: una coda per le richieste, una coda di risposta per ogni client (in POSIX non c\'è il «tipo» di System V). Buffer di mq_receive grande quanto mq_msgsize.',
    files: [
      { path: 'header.h', text: `#ifndef HEADER_H
#define HEADER_H
#include <mqueue.h>

#define CODA_RICHIESTE "/richieste"
#define NUM_CLIENT 3
#define RICHIESTE 2

typedef struct {
    int client;          // chi chiede (per scegliere la coda di risposta)
    int a, b;            // operandi
} Richiesta;

typedef struct {
    int risultato;
} Risposta;

// nome della coda di risposta del client i: "/risposte_<i>"
void nome_risposte(int client, char *out, int len);
mqd_t apri_coda(const char *nome, int crea, long msgsize);

#endif
` },
      { path: 'procedure.c', text: `#include <stdio.h>
#include <fcntl.h>
#include "header.h"

void nome_risposte(int client, char *out, int len) {
    snprintf(out, len, "/risposte_%d", client);
}

mqd_t apri_coda(const char *nome, int crea, long msgsize) {
    struct mq_attr at = { .mq_maxmsg = 10, .mq_msgsize = msgsize };
    mqd_t q = crea ? mq_open(nome, O_CREAT | O_RDWR, 0660, &at) : mq_open(nome, O_RDWR);
    if (q == (mqd_t)-1) perror(nome);
    return q;
}
` },
      { path: 'main.c', text: `#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>
#include "header.h"

static void server(void) {
    mqd_t req = apri_coda(CODA_RICHIESTE, 0, sizeof(Richiesta));
    for (int n = 0; n < NUM_CLIENT * RICHIESTE; n++) {
        Richiesta r;
        // il buffer deve essere grande almeno mq_msgsize: qui la coda è creata con msgsize = sizeof(Richiesta)
        if (mq_receive(req, (char *)&r, sizeof(r), NULL) < 0) { perror("mq_receive"); exit(1); }
        Risposta out = { r.a + r.b };
        char nome[32];
        nome_risposte(r.client, nome, sizeof nome);
        mqd_t q = apri_coda(nome, 0, sizeof(Risposta));
        mq_send(q, (char *)&out, sizeof(out), 0);
        mq_close(q);
        printf("server: %d + %d per il client %d\\n", r.a, r.b, r.client);
    }
    mq_close(req);
    exit(0);
}

static void client(int id) {
    char nome[32];
    nome_risposte(id, nome, sizeof nome);
    mqd_t mie = apri_coda(nome, 0, sizeof(Risposta));
    mqd_t req = apri_coda(CODA_RICHIESTE, 0, sizeof(Richiesta));
    for (int i = 0; i < RICHIESTE; i++) {
        Richiesta r = { id, id * 10, i };
        mq_send(req, (char *)&r, sizeof(r), 0);
        Risposta out;
        mq_receive(mie, (char *)&out, sizeof(out), NULL);
        printf("    client %d: %d + %d = %d\\n", id, r.a, r.b, out.risultato);
    }
    mq_close(mie); mq_close(req);
    exit(0);
}

int main(void) {
    char nome[32];
    // le code si creano prima delle fork, così esistono quando i figli le aprono
    mq_unlink(CODA_RICHIESTE);
    mq_close(apri_coda(CODA_RICHIESTE, 1, sizeof(Richiesta)));
    for (int i = 1; i <= NUM_CLIENT; i++) { nome_risposte(i, nome, sizeof nome); mq_unlink(nome); mq_close(apri_coda(nome, 1, sizeof(Risposta))); }

    if (fork() == 0) server();
    for (int i = 1; i <= NUM_CLIENT; i++) if (fork() == 0) client(i);
    for (int i = 0; i < NUM_CLIENT + 1; i++) wait(NULL);

    mq_unlink(CODA_RICHIESTE);
    for (int i = 1; i <= NUM_CLIENT; i++) { nome_risposte(i, nome, sizeof nome); mq_unlink(nome); }
    printf("Fine\\n");
    return 0;
}
` },
      { path: 'Makefile', text: MAKE('main.o procedure.o') },
    ],
  },
  {
    course: 'so', k: 'send-sincrona', ico: 'queue', short: 'REQUEST_TO_SEND / OK_TO_SEND', label: 'Send sincrona', name: 'send-sincrona',
    desc: 'Comunicazione sincrona con code POSIX: prima della send il mittente manda REQUEST_TO_SEND e aspetta OK_TO_SEND sulla seconda coda di servizio; solo allora invia il messaggio.',
    files: [
      { path: 'main.c', text: `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <mqueue.h>
#include <sys/wait.h>

#define Q_RTS  "/rts"     // REQUEST_TO_SEND: mittente → destinatario
#define Q_OTS  "/ots"     // OK_TO_SEND: destinatario → mittente
#define Q_DATI "/dati"
#define MSG 64

static mqd_t apri(const char *n) {
    struct mq_attr at = { .mq_maxmsg = 5, .mq_msgsize = MSG };
    mqd_t q = mq_open(n, O_CREAT | O_RDWR, 0660, &at);
    if (q == (mqd_t)-1) { perror(n); exit(1); }
    return q;
}

static void send_sincrona(mqd_t rts, mqd_t ots, mqd_t dati, const char *testo) {
    char buf[MSG] = "REQUEST_TO_SEND";
    mq_send(rts, buf, sizeof buf, 0);
    mq_receive(ots, buf, sizeof buf, NULL);          // si blocca finché il destinatario è pronto
    strncpy(buf, testo, MSG - 1); buf[MSG - 1] = 0;
    mq_send(dati, buf, sizeof buf, 0);
}

static void receive_sincrona(mqd_t rts, mqd_t ots, mqd_t dati, char *out) {
    char buf[MSG];
    mq_receive(rts, buf, sizeof buf, NULL);
    strcpy(buf, "OK_TO_SEND");
    mq_send(ots, buf, sizeof buf, 0);
    mq_receive(dati, out, MSG, NULL);
}

int main(void) {
    mq_unlink(Q_RTS); mq_unlink(Q_OTS); mq_unlink(Q_DATI);
    mqd_t rts = apri(Q_RTS), ots = apri(Q_OTS), dati = apri(Q_DATI);
    if (fork() == 0) {
        for (int i = 1; i <= 3; i++) {
            char t[MSG];
            snprintf(t, sizeof t, "messaggio %d", i);
            printf("mittente: invio «%s»…\\n", t); fflush(stdout);
            send_sincrona(rts, ots, dati, t);
            printf("mittente: consegnato\\n"); fflush(stdout);
        }
        exit(0);
    }
    for (int i = 1; i <= 3; i++) {
        sleep(1);                                    // il destinatario arriva dopo: il mittente aspetta
        char m[MSG];
        receive_sincrona(rts, ots, dati, m);
        printf("    destinatario: ricevuto «%s»\\n", m); fflush(stdout);
    }
    wait(NULL);
    mq_unlink(Q_RTS); mq_unlink(Q_OTS); mq_unlink(Q_DATI);
    return 0;
}
` },
      { path: 'Makefile', text: MAKE('main.o') },
    ],
  },
  {
    course: 'so', k: 'scheletro', ico: 'doc', short: 'header.h, procedure.c, main.c da completare', label: 'Scheletro d\'esame', name: 'scheletro-esame',
    desc: 'La struttura dei compiti: header.h con la struct condivisa, procedure.c con le funzioni da completare, main.c che crea memoria condivisa e processi e alla fine pulisce tutto. I TODO dicono cosa scrivere.',
    files: [
      { path: 'header.h', text: `#ifndef HEADER_H
#define HEADER_H
#include <semaphore.h>

#define NOME_SHM "/esame"
#define NUM_PROC 4

typedef struct {
    // TODO: i dati condivisi della traccia (vettore, contatori, stati…)
    int dato;
    // TODO: i semafori (sem_t, inizializzati con sem_init(…, 1, valore))
    sem_t mutex;
} Condiviso;

void inizializza(Condiviso *c);
void operazione(Condiviso *c, int id);
void rimuovi(Condiviso *c);

#endif
` },
      { path: 'procedure.c', text: `#include <stdio.h>
#include <unistd.h>
#include "header.h"

void inizializza(Condiviso *c) {
    c->dato = 0;
    sem_init(&c->mutex, 1, 1);
}

void operazione(Condiviso *c, int id) {
    sem_wait(&c->mutex);
    // TODO: la sezione critica della traccia
    c->dato++;
    printf("processo %d (pid %d): dato = %d\\n", id, getpid(), c->dato);
    fflush(stdout);
    sem_post(&c->mutex);
}

void rimuovi(Condiviso *c) {
    sem_destroy(&c->mutex);
}
` },
      { path: 'main.c', text: `#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/wait.h>
#include "header.h"

int main(void) {
    shm_unlink(NOME_SHM);
    int fd = shm_open(NOME_SHM, O_CREAT | O_RDWR, 0660);
    if (fd < 0) { perror("shm_open"); return 1; }
    if (ftruncate(fd, sizeof(Condiviso)) < 0) { perror("ftruncate"); return 1; }
    Condiviso *c = mmap(NULL, sizeof(Condiviso), PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    if (c == MAP_FAILED) { perror("mmap"); return 1; }
    close(fd);
    inizializza(c);

    for (int i = 0; i < NUM_PROC; i++) {
        pid_t p = fork();
        if (p < 0) { perror("fork"); return 1; }
        if (p == 0) {
            operazione(c, i);   // TODO: cosa fa ogni processo
            exit(0);
        }
    }
    for (int i = 0; i < NUM_PROC; i++) {
        int st;
        pid_t p = wait(&st);
        if (WIFEXITED(st)) printf("terminato %d con stato %d\\n", p, WEXITSTATUS(st));
    }
    rimuovi(c);
    munmap(c, sizeof(Condiviso));
    shm_unlink(NOME_SHM);
    return 0;
}
` },
      { path: 'Makefile', text: MAKE('main.o procedure.o') },
    ],
  },
  {
    course: 'so', k: 'fork-albero', ico: 'tree', short: 'Indovina, poi guarda l\'albero dei processi', label: 'Quanti processi?', name: 'quanti-processi',
    desc: 'L\'esercizio classico: indovina quanti processi crea il programma e cosa stampa, poi eseguilo e guarda l\'albero dei processi nella radiografia (c\'è anche la printf che compare due volte).',
    files: [
      { path: 'main.c', text: `#include <stdio.h>
#include <unistd.h>
#include <sys/wait.h>

// Prima di eseguire: quanti processi in tutto? quante righe «ciao»?
int main(void) {
    printf("inizio ");            // niente \\n e niente fflush: guarda la radiografia
    for (int i = 0; i < 2; i++) {
        if (fork() == 0) {
            if (i == 1) fork();
        }
    }
    printf("ciao da %d (padre %d)\\n", getpid(), getppid());
    while (wait(NULL) > 0) ;
    return 0;
}
` },
    ],
  },
  {
    course: 'so', k: 'deadlock', ico: 'warn', short: 'Due mutex presi in ordine opposto', label: 'Deadlock', name: 'deadlock-ordine',
    desc: 'Due thread prendono due mutex in ordine opposto: si bloccano a vicenda. Eseguilo e guarda «Perché si è piantato» nella radiografia; poi correggi l\'ordine e ripeti la prova di stress.',
    files: [
      { path: 'main.c', text: `#include <stdio.h>
#include <pthread.h>
#include <unistd.h>

pthread_mutex_t conto_a = PTHREAD_MUTEX_INITIALIZER;
pthread_mutex_t conto_b = PTHREAD_MUTEX_INITIALIZER;
int saldo_a = 100, saldo_b = 100;

void *da_a_a_b(void *x) {
    (void)x;
    pthread_mutex_lock(&conto_a);
    usleep(1000);
    pthread_mutex_lock(&conto_b);     // aspetta conto_b…
    saldo_a -= 10; saldo_b += 10;
    pthread_mutex_unlock(&conto_b);
    pthread_mutex_unlock(&conto_a);
    return NULL;
}

void *da_b_a_a(void *x) {
    (void)x;
    pthread_mutex_lock(&conto_b);     // ordine opposto: è qui il problema
    usleep(1000);
    pthread_mutex_lock(&conto_a);
    saldo_b -= 20; saldo_a += 20;
    pthread_mutex_unlock(&conto_a);
    pthread_mutex_unlock(&conto_b);
    return NULL;
}

int main(void) {
    pthread_t t1, t2;
    pthread_create(&t1, NULL, da_a_a_b, NULL);
    pthread_create(&t2, NULL, da_b_a_a, NULL);
    pthread_join(t1, NULL);
    pthread_join(t2, NULL);
    printf("saldi: %d %d\\n", saldo_a, saldo_b);
    return 0;
}
` },
    ],
  },
];

// Lingua (2026-11-25): nomi, descrizioni, commenti del codice e testi stampati seguono la lingua dell'interfaccia
// (traduzioni in lang/en.js). Gli identificatori dei programmi (spazio, testa, /richieste…) restano italiani.
// I testi stampati sono scritti qui come compaiono nel sorgente C.
const STAMPE = [
  '[P%d] prodotto %d\\n', '        [C%d] consumato %d\\n', 'Fine: tutti i processi sono terminati\\n', 'produttore %d: %d\\n',
  '        consumatore %d: %d\\n', 'Fine\\n', 'lettore %ld legge %d\\n', '    scrittore %ld scrive %ld\\n', 'valore finale %d\\n',
  'server: %d + %d per il client %d\\n', 'messaggio %d', 'mittente: invio «%s»…\\n', 'mittente: consegnato\\n',
  '    destinatario: ricevuto «%s»\\n', 'processo %d (pid %d): dato = %d\\n', 'terminato %d con stato %d\\n', 'inizio ',
  'ciao da %d (padre %d)\\n', 'saldi: %d %d\\n',
];
// il commento dopo // (nei sorgenti) o dopo # a inizio riga (nel Makefile)
const commento = (riga) => riga.replace(/(\/\/\s?|^# )(\S.*?)(\s*)$/, (m, inizio, testo, spazi) => inizio + t(testo) + spazi);
const nellaLingua = (testo) => STAMPE.reduce((x, p) => x.replaceAll(`"${p}"`, () => `"${t(p)}"`), testo.split('\n').map(commento).join('\n'));
export const TEMPLATES = MODELLI.map((m) => ({
  ...m, short: t(m.short), label: t(m.label), name: t(m.name), desc: t(m.desc),
  files: m.files.map((f) => ({ ...f, text: nellaLingua(f.text) })),
}));
