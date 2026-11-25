// Piano di studi di riferimento: un tipico corso di laurea in Ingegneria Informatica (classe L-8) di un ateneo italiano.
// Senza il nome di un ateneo: decisione dell'utente del 2026-11-24, in vista della pubblicazione su GitHub.
// Serve solo a creare i quaderni al primo avvio: nomi, sigle e anni si cambiano dall'app.
import { t, tp } from './i18n.js';

// Nomi e sigle seguono la lingua dell'interfaccia (decisione utente 2026-11-24: il piano di studi «segue la lingua scelta
// dall'utente»); i quaderni già creati restano come sono.
export const COURSES = [
  { year: 1, title: t('Analisi Matematica I'), code: tp('sigla', 'AM1') },
  { year: 1, title: t('Geometria e Algebra'), code: tp('sigla', 'GA') },
  { year: 1, title: t('Fondamenti di Informatica'), code: tp('sigla', 'FI') },
  { year: 1, title: t('Fisica Generale I'), code: tp('sigla', 'FG1') },
  { year: 1, title: t('Analisi Matematica II'), code: tp('sigla', 'AM2') },
  { year: 1, title: t('Programmazione I'), code: tp('sigla', 'P1') },
  { year: 1, title: t('Lingua Inglese'), code: tp('sigla', 'ENG') },
  { year: 2, title: t('Fisica Generale II'), code: tp('sigla', 'FG2') },
  { year: 2, title: t('Metodi Matematici per l\'Ingegneria'), code: tp('sigla', 'MMI') },
  { year: 2, title: t('Calcolatori Elettronici I'), code: tp('sigla', 'CE1') },
  { year: 2, title: t('Elettrotecnica'), code: tp('sigla', 'ELT') },
  { year: 2, title: t('Teoria dei Segnali'), code: tp('sigla', 'TdS') },
  { year: 2, title: t('Programmazione II'), code: tp('sigla', 'P2') },
  { year: 2, title: t('Algoritmi e Strutture Dati'), code: tp('sigla', 'ASD') },
  { year: 2, title: t('Basi di Dati'), code: tp('sigla', 'BD') },
  { year: 2, title: t('Economia e Organizzazione Aziendale'), code: tp('sigla', 'EOA') },
  { year: 3, title: t('Sistemi Operativi'), code: tp('sigla', 'SO') },
  { year: 3, title: t('Reti di Calcolatori'), code: tp('sigla', 'RC') },
  { year: 3, title: t('Ingegneria del Software'), code: tp('sigla', 'IS') },
  { year: 3, title: t('Fondamenti di Automatica'), code: tp('sigla', 'FA') },
  { year: 3, title: t('Elettronica Generale'), code: tp('sigla', 'EG') },
  { year: 3, title: t('Calcolatori Elettronici II'), code: tp('sigla', 'CE2') },
  { year: 3, title: t('Tirocinio e Prova Finale'), code: tp('sigla', 'TPF') },
];

export const COLORS = ['#3657e8', '#0f9d8a', '#e2573b', '#8b5cf6', '#d9a21b', '#e0457b', '#2f8fd8', '#5b8c2a', '#c2662d', '#64748b'];

export const colorFor = (i) => COLORS[i % COLORS.length];

export function codeFrom(title) {
  const stop = new Set(['e', 'di', 'dei', 'per', 'la', 'il', 'lo', 'delle', 'del', "l'", 'ed']);
  const roman = { I: '1', II: '2', III: '3' };
  const words = title.replace(/['’]/g, ' ').split(/\s+/).filter(Boolean);
  let s = '';
  for (const w of words) {
    if (roman[w]) s += roman[w];
    else if (!stop.has(w.toLowerCase())) s += w[0].toUpperCase();
  }
  return s.slice(0, 4) || title.slice(0, 3).toUpperCase();
}

// --- 2026.11.4: profilo di studio e quaderni smart ---------------------------------------------------
// Il profilo sta nelle impostazioni dell'account (store.settings.profile): { track, smart }.
export const TRACKS = [
  { k: 'ing-inf', label: t('Ingegneria Informatica'), sub: t('L-8 · quaderni smart e strumenti dei corsi') },
  { k: 'other', label: t('Altro percorso'), sub: t('Quaderni smart di programmazione, senza gli strumenti dei corsi') },
];
// Quaderni «di programmazione»: hanno anche i repository di codice
const CODE_TITLE = /programm|informatic|sistemi operativi|algoritm|strutture dati|basi di dati|database|calcolatori|reti di calcolatori|ingegneria del software|software|computer|coding|python|java\b|linguagg|compilator|sviluppo web|\bweb\b|algorithm|data structures|operating systems|networks/i; // anche i nomi inglesi
const CODE_CODES = new Set(['P1', 'P2', 'FI', 'SO', 'ASD', 'BD', 'RC', 'IS', 'CE1', 'CE2', 'ACP', 'LP', 'PA', 'PRG1', 'PRG2', 'FCS', 'OS', 'ADS', 'DB', 'CN', 'SE', 'CA1', 'CA2']);
export const looksLikeCode = (nb) => CODE_TITLE.test(nb.title || '') || CODE_CODES.has(String(nb.code || '').toUpperCase());
// kind: '' = automatico, 'code' = programmazione, 'plain' = classico
export const isCodeNotebook = (nb) => !!nb && (nb.kind === 'code' || (!nb.kind && looksLikeCode(nb)));
// Il corso del quaderno, per gli strumenti: per ora Sistemi Operativi
export function courseOf(nb) {
  if (!nb) return null;
  const s = `${nb.title || ''} ${nb.code || ''}`;
  if (/sistemi operativi|operating systems|\bSO\b|\bOS\b/i.test(s)) return 'so';
  return null;
}
