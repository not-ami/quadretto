// Quadretto — le novità di ogni versione, per la schermata «Novità» (dalla più recente).
// Si aggiorna a ogni pubblicazione che cambia qualcosa che l'utente vede: [titolo, dettaglio, frase breve].
// La frase breve (facoltativa) va nel popup che compare al primo accesso dopo l'aggiornamento: semplice, niente tecnicismi.
// I testi sono in italiano e sono anche le chiavi del dizionario inglese: ogni voce nuova va aggiunta a public/js/lang/en.js
// (app.js li traduce quando li mostra). Controllo: node scripts/i18n-mancanti.mjs --novita
export const CHANGELOG = [
  {
    v: '2026.11.8-B', date: '2026-11-27',
    items: [
      ['Componenti interni aggiornati', 'Aggiornate le librerie che mostrano testo, formule e codice, con alcune falle di sicurezza chiuse. Gli aggiornamenti futuri arrivano al dispositivo senza restare indietro.', 'Componenti aggiornati: più sicurezza.'],
    ],
  },
  {
    v: '2026.11.8', date: '2026-11-25',
    items: [
      ['La vista panoramica non perde più quello che scrivi', 'Scrivendo nella vista panoramica la pagina non si ricarica più da sola e quello che scrivi resta salvato. Ruotando l\'iPad la scrittura resta della stessa grandezza.', 'La vista panoramica non perde più quello che scrivi'],
      ['Quadretto in italiano e in inglese', 'L\'interfaccia parla italiano o inglese: la lingua si sceglie in Impostazioni e resta nel tuo account, su tutti i dispositivi.', 'Puoi usare Quadretto in italiano o in inglese.'],
      ['Appunti in diretta su tutti i dispositivi', 'Apri lo stesso appunto sull\'iPad e sul Mac: testo, scrittura a mano, codice e strumenti arrivano sull\'altro mentre scrivi. Senza rete le modifiche restano sul dispositivo e si uniscono da sole quando torna, senza conflitti.', 'Un appunto ora si aggiorna in diretta su tutti i tuoi dispositivi.'],
      ['Chi c\'è nell\'appunto', 'In alto vedi chi ha aperto l\'appunto; nel testo e nel codice vedi dove sta scrivendo, sulla tavola compare «sta scrivendo» accanto alla sua penna. Annulla toglie solo quello che hai scritto tu.', 'Vedi chi sta scrivendo e dove.'],
      ['Condividi quaderni, appunti e repository', 'Con «Condividi…» nel menu di un appunto o di un repository, o nelle impostazioni di un quaderno, li dai a un\'altra persona di questo server, che può leggere o anche modificare. Quello che ti condividono è in Home, in «Condivisi con me». La condivisione si toglie quando vuoi.', 'Ora puoi condividere quaderni e appunti con altre persone.'],
      ['Link da leggere', 'Un link apre l\'appunto o il quaderno come pagina da leggere o stampare, senza account, e scade dopo il numero di giorni che scegli. Funziona dentro la tua rete privata.'],
    ],
  },
  {
    v: '2026.11.7', date: '2026-11-24',
    items: [
      ['Formattazione con un tocco', 'Mentre scrivi un testo, la barra sopra la tastiera mette titoli, grassetto, corsivo, elenchi, cose da fare, citazioni, riquadri Definizione e Teorema, collegamenti, codice, formule e tabelle. Toccando di nuovo un pulsante acceso togli la formattazione; sotto vedi come verrà. Con la tastiera: ⌘B, ⌘I, ⌘K, ⌘1-3 e le altre scorciatoie (premi ?).', 'Formatta il testo con la barra sopra la tastiera, senza ricordare simboli'],
      ['Grafici e diagrammi', 'Il nuovo pulsante Grafico aggiunge barre, linee, torte, punti, funzioni y = f(x) e i diagrammi di Sistemi Operativi: Gantt dello scheduling, stati del processo, grafo delle risorse con il deadlock, paginazione, sostituzione delle pagine, banchiere, allocazione della memoria, albero dei processi. I dati si scrivono in una tabellina o in poche righe.', 'Aggiungi grafici e diagrammi di Sistemi Operativi ai tuoi appunti'],
      ['Esporta in PDF con stile', 'Dal menu «…» di un appunto, o con «PDF del quaderno», ottieni pagine A4 con copertina, indice con i numeri di pagina, intestazioni e quattro stili (Quaderno, Classico, Moderno, Minimale) nel colore del corso. La scrittura a mano resta nitida.', 'Esporta appunti e quaderni in PDF, con copertina e indice'],
      ['Simulatore di mutex', 'Nuovo strumento di Sistemi Operativi: guardi i thread passo passo (o li fai avanzare tu) con lock, deadlock, Peterson, filosofi a cena, variabili condizione e semafori.', 'Guarda i thread passo passo con il simulatore di mutex'],
      ['Simulatore di starvation', 'Chi non va mai avanti e perché: priorità, SJF e code con retroazione messi a confronto con i loro rimedi, e i lettori che lasciano fuori lo scrittore.', 'Scopri chi resta indietro con il simulatore di starvation'],
      ['Sposta ed elimina il codice', 'I blocchi di codice e gli strumenti hanno sempre in alto le frecce per spostarli e il cestino, come gli altri blocchi.'],
      ['Repository anche dal blocco di codice', 'Aprendo un blocco di codice in modalità IDE, un avviso ti propone di collegarlo a un repository del quaderno o di farlo diventare un repository.'],
    ],
  },
  {
    v: '2026.11.6', date: '2026-11-24',
    items: [
      ['Scrittura più precisa', 'L\'inchiostro passa esattamente dove passa la punta: angoli netti, lati dritti, bordi puliti anche ingrandendo. Il tratto comincia e finisce sotto la Pencil e non cambia quando alzi la penna.', 'La scrittura a mano è più precisa: l\'inchiostro segue la punta'],
      ['Tratto più naturale', 'Lo spessore segue la mano come una penna vera: un filo più pieno quando vai piano, più sottile nei gesti veloci, con un attacco leggero.', 'Il tratto si assottiglia nei gesti veloci, come una penna vera'],
      ['Forme solo quando le vuoi', 'Scrivendo piccolo il testo non diventa più una linea o uno zig-zag: le forme si raddrizzano solo se tieni davvero ferma la punta, e le lettere piccole restano scrittura.', 'Scrivendo piccolo il testo non si trasforma più in linee'],
      ['Vista panoramica ingrandita', 'Dopo aver ingrandito scorri la tavola con un dito (su, giù e di lato) o trascinala con due dita; con il pizzico resta fermo il punto sotto le dita. A 100 % due dita verso sinistra o destra annullano e ripristinano come prima. La barra della penna resta accesa mentre scrivi.', 'Nella vista panoramica ingrandita scorri la tavola con le dita'],
      ['Pagine infinite', 'Nella vista panoramica la tavola si allunga da sola verso il basso e verso destra mentre scorri o scrivi vicino al bordo: lo spazio non finisce mai. «Riduci» la riporta nella pagina.', 'Nella vista panoramica lo spazio per scrivere non finisce mai'],
      ['Niente più tavole vuote', 'Toccando con la Pencil sotto l\'ultima tavola, quella si allunga invece di crearne una nuova vuota ogni volta.'],
      ['IDE dagli appunti', 'Il pulsante </> in alto in un appunto apre in modalità IDE il repository collegato. Se l\'appunto non ne ha, un avviso di una riga ti propone di collegarne uno; uscendo dall\'IDE torni all\'appunto.', 'Apri l\'IDE anche da un appunto, col suo repository'],
      ['Trascina gli strumenti', 'Tieni premuto Testo, A mano, Foto, PDF o Codice nella barra in basso e trascinalo nell\'appunto: una riga ti mostra dove andrà il blocco.', 'Trascina gli strumenti nel punto dell\'appunto dove li vuoi'],
      ['Codice in IDE dagli appunti', 'Ogni blocco di codice ha il pulsante IDE: si apre a tutto schermo con l\'albero dei file; «Esci» ti riporta all\'appunto.'],
      ['PDF da annotare', 'Il pulsante PDF accanto a «Nuovo appunto», o il menu «…» di un appunto, importa un PDF: ogni pagina diventa una tavola su cui scrivere con la Pencil. Con l\'indice puoi farne un appunto per capitolo. La ricerca trova il testo delle pagine, che restano anche senza rete.', 'Importa un PDF e scrivici sopra con la Pencil'],
      ['Sottocartelle nei repository', 'Nell\'albero dei file e in modalità IDE crei cartelle e sottocartelle, anche vuote: restano e finiscono nello zip.'],
    ],
  },
  {
    v: '2026.11.5', date: '2026-11-23',
    items: [
      ['Codice a colori', 'Nei repository e nei blocchi di codice il testo è colorato per C, C++, Python, JavaScript, Java, TypeScript, Go, Rust, shell, JSON, YAML, HTML, CSS, SQL, Makefile e altri. Il pulsante con la tavolozza sceglie il tema: Automatico, Chiaro, Carta, Notte, Grafite, Contrasto.', 'Il codice ora è a colori, con il tema che preferisci'],
      ['Suggerimenti mentre scrivi', 'Sotto il codice compaiono i nomi del tuo progetto, le chiamate di sistema, i campi delle struct dopo -> e ., gli header dopo #include < e piccoli modelli (for, if, main…). Sopra, la firma della funzione che stai chiamando. Tocca un suggerimento o premi Tab.', 'Mentre scrivi codice l\'app ti suggerisce come continuare'],
      ['Scorciatoie da tastiera', 'Su Mac, PC e iPad con la tastiera: esegui, salva, vai a un file, commenta, sposta e duplica le righe, apri i quaderni, la vista panoramica… L\'elenco completo con «?» o in Impostazioni.', 'Con la tastiera vai più veloce: premi ? per le scorciatoie'],
      ['Modalità IDE', 'In un repository il pulsante IDE (o ⌘⇧E) mette il codice a tutto schermo: file a sinistra, editor a tutta altezza, esecuzione in basso. Si ricorda per i repository successivi.', 'Apri i repository in modalità IDE, a tutto schermo'],
      ['Editor più attento', 'Parentesi e virgolette si chiudono da sole, Invio tra le graffe apre il blocco rientrato, la } torna al livello giusto, Backspace toglie i rientri a blocchi. La riga del cursore e la parentesi corrispondente sono evidenziate; gli errori tipici e quelli del compilatore compaiono sui numeri di riga mentre scrivi (toccali per leggere il messaggio).', 'L\'editor chiude le parentesi, rientra da solo e segna gli errori mentre scrivi'],
      ['Nuovo repository e nuovo strumento', 'Finestre più semplici, con icone: scegli da dove partire e solo dopo le opzioni.'],
    ],
  },
  {
    v: '2026.11.4', date: '2026-11-23',
    items: [
      ['Profilo di studio', 'In Impostazioni (o dalla Home la prima volta) scegli il tuo percorso: con Ingegneria Informatica compaiono gli strumenti dei corsi.', 'Scegli il tuo percorso di studi: l\'app si adatta ai tuoi corsi'],
      ['Quaderni smart e repository', 'I quaderni dei corsi di programmazione (riconosciuti dal nome, o scelti in Modifica quaderno) hanno anche i repository: progetti con più file e cartelle, da creare vuoti, da uno zip, da GitHub o da un modello del corso, eseguibili e citabili negli appunti con [[nome]]. Un blocco di codice può diventare un repository.', 'Nei quaderni di programmazione ora puoi creare repository di codice'],
      ['Sistemi Operativi: modelli del corso', 'Repository pronti con le IPC POSIX: produttori/consumatori con semafori e con monitor pthread, lettori/scrittori, code di messaggi client/server, send sincrona, scheletro d\'esame, «quanti processi?», deadlock.'],
      ['Radiografia dei programmi', 'Per i programmi C con fork, thread, semafori o code: perché si è piantato (chi aspetta cosa, il deadlock), linea del tempo, albero dei processi con l\'uscita di ognuno, semafori e memorie rimasti nel sistema. Un programma bloccato si ferma da solo in 2 secondi.', 'Vedi perché un programma si blocca, processo per processo'],
      ['Prova di stress', 'Lo stesso programma 20 volte con pause casuali: se gli esiti cambiano, c\'è una race condition.', 'Scopri le race condition prima dell\'esame'],
      ['Controllo del codice e spiega l\'errore', 'Prima di compilare: if al posto di while con le condition variable, ftruncate dimenticata, unlink mancanti, &i passato ai thread… Gli errori del compilatore si toccano e aprono il file alla riga giusta, con un suggerimento in italiano. Tocca una chiamata (sem_open, mq_receive…) per la sua scheda.'],
      ['Strumenti di Sistemi Operativi', 'Nel quaderno di SO: scheduling con diagramma di Gantt e confronto degli algoritmi, cacciatore di race condition (prova tutti gli ordini dei thread), quiz con penalità come all\'esame.', 'Scheduling, race condition e quiz nel quaderno di Sistemi Operativi'],
      ['Pizzico e vista panoramica', 'Sulla tavola a mano: pizzica con due dita per ingrandire. Il pulsante in alto a destra apre la tavola a tutto schermo con più spazio; riducendola, rientra nel suo riquadro (che si allunga verso il basso se serve).', 'Ingrandisci la scrittura a mano e apri le tavole a tutto schermo'],
    ],
  },
  {
    v: '2026.11.3', date: '2026-11-23',
    items: [
      ['Codice eseguibile', 'Progetti in C, C++, Python e JavaScript dentro gli appunti (pulsante «Codice» in basso): più file, input da tastiera, importazione da uno zip o da un repository GitHub pubblico, esportazione in zip. Python e JavaScript girano sull\'iPad anche senza rete; C e C++ si compilano sul server.', 'Scrivi ed esegui codice C, C++, Python e JavaScript negli appunti'],
      ['Esegui nel testo', 'I blocchi di codice C, C++, Python e JavaScript scritti nel testo hanno il pulsante «Esegui».'],
      ['Collegamenti tra appunti', 'Scrivi [[ e scegli un appunto, o un titolo nuovo: toccandolo lo crei. In fondo a ogni appunto, «Citato in» mostra chi lo richiama.', 'Collega gli appunti tra loro'],
      ['Modelli di pagina', 'In un appunto nuovo: Lezione (numerata e datata), Esercizio, Dimostrazione, Esercizio di codice.', 'Modelli pronti per lezioni, esercizi e dimostrazioni'],
      ['Lezione di adesso', 'Inserisci l\'orario in Impostazioni → Orario delle lezioni: all\'ora della lezione la Home propone l\'appunto, già nel quaderno giusto.', "Inserisci l'orario: all'ora della lezione l'appunto è già pronto"],
      ['Continua da dove eri', 'La Home riapre l\'ultimo appunto, alla stessa posizione.', "Riprendi l'ultimo appunto da dove l'avevi lasciato"],
      ['Tempo di studio', 'La Home conta da sola il tempo passato su ogni corso nella settimana. Il pulsante con l\'orologio in alto avvia un timer di concentrazione da 25 o 50 minuti.', 'Vedi quanto studi ogni corso, con un timer per concentrarti'],
      ['Colori con significato', 'In Modifica quaderno dai un significato ai colori della penna (es. rosso = Definizione). Sulle pagine a mano, «Mostra» lascia in evidenza solo quei colori.', 'Dai un significato ai colori della penna'],
      ['Indirizzo sicuro', 'Quadretto passa a HTTPS: si apre anche senza rete. All\'indirizzo vecchio una barra ti porta a quello nuovo, quando tutto è salvato.', 'Quadretto si apre anche senza rete'],
      ['Novità', 'Questa schermata: dopo ogni aggiornamento un pallino ti avvisa.'],
      ['Movimento naturale', 'Fogli, cassetto dei quaderni, popup e schede si muovono con molle vere e seguono il dito: trascina giù un foglio per chiuderlo, dal bordo sinistro apri i quaderni o torni all\'elenco, scaccia gli avvisi di lato.', 'Animazioni naturali che seguono il dito'],
      ['Inchiostro morbido', 'Con l\'indirizzo sicuro la Pencil mandava molti più punti e il tratto veniva seghettato: ora è morbido come prima, anche nei tratti scritti nel frattempo.', 'La penna è di nuovo morbida'],
      ['Impostazioni nel tuo account', 'Spessore, colore e «Solo Apple Pencil» si salvano anche nel tuo account e ti seguono su ogni dispositivo.'],
    ],
  },
  {
    v: '2026.11.2', date: '2026-11-23',
    items: [
      ['Account', 'Accesso con nome utente e password; al primo accesso scegli la tua.'],
      ['Home', 'Quaderni recenti, prossimi esami e ultimi appunti; galleria con l\'anteprima delle pagine.'],
      ['Penna', 'Scrittura più pronta, gesti (due dita: annulla; tre dita: ripristina), forme modificabili con il menu, lazo.'],
    ],
  },
  { v: '2026.11.1', date: '2026-11-23', items: [['Rete', 'L\'app si usa dalla rete Tailscale di casa.']] },
  {
    v: '2026.11.0', date: '2026-11-23',
    items: [['Prima versione', 'Quaderni per corso, testo con Markdown, formule e codice, scrittura a mano con la pressione della Pencil, forme e piano cartesiano, salvataggio anche senza rete.']],
  },
];
