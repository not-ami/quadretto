// Pagina di un link in sola lettura (/l/<token>, 2026-11-24, punto 9): mostra l'appunto o il quaderno con la vista di
// stampa del PDF (print.js). Non tocca l'archivio locale né l'account: legge solo /api/public/<token>.
import { openPrint } from './print.js';
import { t } from './i18n.js';

const token = location.pathname.split('/').pop();
const root = document.getElementById('shared-root');
const msg = (title, text) => { root.innerHTML = ''; const h = document.createElement('h1'); h.textContent = title; const p = document.createElement('p'); p.textContent = text; root.append(h, p); };

async function main() {
  let data;
  try {
    const r = await fetch(`/api/public/${encodeURIComponent(token)}`, { credentials: 'omit' });
    data = await r.json();
    if (!r.ok) return msg(t('Link non valido'), data?.error || t('Link scaduto o revocato: chiedi un link nuovo a chi te l\'ha mandato'));
  } catch { return msg(t('Server non raggiungibile'), t('Questo link funziona solo dentro la rete privata di chi l\'ha creato.')); }
  // aspetta marked/katex (caricati con defer)
  await new Promise((r) => (document.readyState === 'complete' ? r() : addEventListener('load', r, { once: true })));
  root.remove();
  document.title = `${data.notes[0]?.title || data.notebook?.title || 'Quadretto'} — ${t('sola lettura')}`;
  await openPrint({
    notes: data.notes, notebook: data.notebook, user: { display_name: data.owner_name || '' }, track: '',
    prefs: {}, savePrefs() {}, imageUrl: (att) => `/api/public/${encodeURIComponent(token)}/att/${att}`, toast() {},
  });
  const note = document.createElement('div');
  note.className = 'shared-note';
  note.textContent = t('Sola lettura · il link scade il {data}', { data: new Date(data.expires_at).toLocaleDateString(document.documentElement.lang || 'it', { day: 'numeric', month: 'long', year: 'numeric' }) });
  document.body.append(note);
}
main();
