// Lingue dell'interfaccia (2026-11-24, decisione utente: *«multilingua con default inglese»*): inglese predefinito e italiano.
//
// Le CHIAVI SONO I TESTI ITALIANI, come in gettext: t('Nuovo appunto') dà in italiano il testo stesso e in inglese la
// traduzione di lang/en.js. Così il codice resta leggibile e un testo senza traduzione si vede (in italiano) invece di
// rompersi. Valori dentro i testi: t('Ciao {nome}', { nome }). Plurali: tn(n, '{n} appunto', '{n} appunti').
// Ogni testo nuovo dell'interfaccia passa da t() e ha la sua riga in lang/en.js (regola nel CLAUDE.md).
//
// La lingua: quella salvata su questo dispositivo, poi quella dell'account (settings.lang, vince sul server), se no l'inglese.
// Lo usa anche il server (server.js) per tradurre i suoi messaggi d'errore: stesso dizionario.
import EN from './lang/en.js';

export const LANGS = [['en', 'English'], ['it', 'Italiano']];
const DICT = { en: EN };
const LOCALE = { en: 'en-GB', it: 'it-IT' };
const KEY = 'quadretto-lang';
const valid = (l) => (LANGS.some(([k]) => k === l) ? l : null);
const hasDom = typeof document !== 'undefined';

let lang = 'en';
if (hasDom) try { lang = valid(localStorage.getItem(KEY)) || 'en'; } catch {}
if (hasDom) document.documentElement.lang = lang;

export const getLang = () => lang;
export const locale = (l = lang) => LOCALE[l] || LOCALE.en;

// Cambia lingua su questo dispositivo. Chi la mostra a video ridisegna (o ricarica la pagina) all'evento 'quadretto-lang'.
export function setLang(l) {
  l = valid(l);
  if (!l || l === lang) return false;
  lang = l;
  if (hasDom) {
    try { localStorage.setItem(KEY, l); } catch {}
    document.documentElement.lang = l;
    dispatchEvent(new CustomEvent('quadretto-lang', { detail: l }));
  }
  return true;
}

const mancanti = new Set();
// Traduzione di un testo italiano nella lingua `l` (di solito quella attuale).
export function tr(l, it, vars) {
  let s = it;
  if (l !== 'it' && typeof it === 'string') {
    const d = DICT[l] || DICT.en;
    if (Object.hasOwn(d, it)) s = d[it];
    else if (!mancanti.has(it)) { mancanti.add(it); if (hasDom) console.debug(`[i18n] manca la traduzione (${l}):`, it); }
  }
  return vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}
export const t = (it, vars) => tr(lang, it, vars);
// Con un contesto, quando lo stesso testo italiano si traduce in due modi (come pgettext): tp('azione', 'Annulla') cerca
// 'azione|Annulla' nel dizionario (es. «Undo» nei toast), altrimenti fa come t('Annulla') («Cancel» nei fogli).
export function tp(ctx, it, vars) {
  const k = `${ctx}|${it}`;
  return lang !== 'it' && Object.hasOwn(DICT[lang] || DICT.en, k) ? tr('it', (DICT[lang] || DICT.en)[k], vars) : t(it, vars);
}

// Plurale: le forme italiane fanno da chiave; l'inglese ha le stesse due forme (uno / altri).
export function tn(n, uno, altri, vars = {}) {
  const forma = new Intl.PluralRules(locale()).select(n) === 'one' ? uno : altri;
  return t(forma, { n: new Intl.NumberFormat(locale()).format(n), ...vars });
}

export const fmtDate = (d, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => new Intl.DateTimeFormat(locale(), opts).format(new Date(d));
export const fmtNum = (n, opts) => new Intl.NumberFormat(locale(), opts).format(n);

// Per i test e per vedere a che punto è la traduzione: i testi chiesti in questa sessione senza traduzione inglese.
export const missingTranslations = () => [...mancanti];
