// Accesso, registrazione, primo accesso del proprietario, cambio password.
import { api } from './store.js';
import { t, getLang, setLang, LANGS } from './i18n.js';

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
};
const cache = { get() { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; } }, set(u) { try { u ? localStorage.setItem('user', JSON.stringify(u)) : localStorage.removeItem('user'); } catch {} } };

// Restituisce l'utente collegato, oppure mostra l'accesso e restituisce null
export async function ensureUser() {
  try {
    const r = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (r.ok) { const { user } = await r.json(); cache.set(user); return user; }
    if (r.status === 401) { cache.set(null); showLogin(); return null; }
    throw new Error('server');
  } catch {
    // server non raggiungibile: si lavora offline con l'ultimo account usato su questo dispositivo
    const u = cache.get();
    if (u) return u;
    showLogin({ offline: true });
    return null;
  }
}

export async function logout() {
  try { await api('POST', '/api/auth/logout', {}); } catch {}
  cache.set(null);
  location.reload();
}

export function showLogin({ offline = false, expired = false } = {}) {
  document.querySelector('.auth')?.remove();
  let mode = 'login'; // login | register | first
  let signup = true;
  const err = h('p', { class: 'auth-err', role: 'alert' });
  const user = h('input', { id: 'auth-user', name: 'username', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', required: true, placeholder: t('es. mario.rossi') });
  const pass = h('input', { id: 'auth-pass', name: 'password', type: 'password', autocomplete: 'current-password' });
  const pass2 = h('input', { id: 'auth-pass2', name: 'password2', type: 'password', autocomplete: 'new-password', placeholder: t('Ripeti la password') });
  const display = h('input', { id: 'auth-name', name: 'name', autocomplete: 'nickname', placeholder: t('Facoltativo') });
  const title = h('h1', {});
  const lead = h('p', { class: 'auth-lead' });
  const submit = h('button', { class: 'btn primary auth-submit', type: 'submit' });
  const swap = h('button', { class: 'auth-swap', type: 'button', onclick: () => setMode(mode === 'register' ? 'login' : 'register') });
  const fName = h('label', { class: 'field' }, h('span', {}, t('Nome da mostrare')), display);
  const fPass2 = h('label', { class: 'field' }, h('span', {}, t('Conferma password')), pass2);
  // Lingua (2026-11-24): si sceglie anche prima di entrare; con un account nuovo resta quella scelta qui.
  const langRow = h('div', { class: 'auth-lang', role: 'group', 'aria-label': t('Lingua') },
    LANGS.map(([k, label]) => h('button', { type: 'button', class: k === getLang() ? 'on' : '', 'aria-pressed': String(k === getLang()), lang: k,
      onclick: () => { if (setLang(k)) showLogin({ offline, expired }); } }, label)));

  function setMode(m) {
    mode = m; err.textContent = '';
    pass.required = m !== 'login';
    pass.placeholder = m === 'login' ? t('Al primo accesso lasciala vuota') : t('Almeno 8 caratteri');
    title.textContent = m === 'login' ? t('Accedi') : m === 'register' ? t('Crea un account') : t('Primo accesso');
    lead.textContent = m === 'login' ? t('I tuoi quaderni ti aspettano.')
      : m === 'register' ? t('Ogni account ha quaderni e appunti separati.')
      : t("L'account “{nome}” non ha ancora una password: sceglila ora. I quaderni già creati sono qui.", { nome: user.value });
    submit.textContent = m === 'login' ? t('Entra') : m === 'register' ? t('Crea account') : t('Imposta password ed entra');
    fName.hidden = m !== 'register';
    fPass2.hidden = m === 'login';
    pass.autocomplete = m === 'login' ? 'current-password' : 'new-password';
    user.readOnly = m === 'first';
    swap.hidden = m === 'first' || !signup;
    swap.textContent = m === 'register' ? t('Hai già un account? Accedi') : t('Nuovo qui? Crea un account');
  }

  const form = h('form', { class: 'auth-form', novalidate: true },
    title, lead,
    h('label', { class: 'field' }, h('span', {}, t('Nome utente')), user),
    fName,
    h('label', { class: 'field' }, h('span', {}, t('Password')), pass),
    fPass2,
    err, submit, swap, langRow);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const username = user.value.trim().toLowerCase();
    if (!username) { err.textContent = t('Inserisci il nome utente.'); user.focus(); return; }
    if (mode !== 'login' && !pass.value) { err.textContent = t('Scegli una password di almeno 8 caratteri.'); pass.focus(); return; }
    if (mode !== 'login' && pass.value !== pass2.value) { err.textContent = t('Le due password non coincidono.'); pass2.focus(); return; }
    submit.disabled = true;
    try {
      if (mode === 'login') {
        const r = await api('POST', '/api/auth/login', { username, password: pass.value });
        if (r.firstAccess) { user.value = r.username; pass.value = ''; setMode('first'); pass.focus(); return; }
      } else if (mode === 'first') {
        await api('POST', '/api/auth/first-password', { username, password: pass.value });
      } else {
        await api('POST', '/api/auth/register', { username, password: pass.value, display_name: display.value });
      }
      location.reload();
    } catch (e2) {
      err.textContent = e2.offline ? t('Server non raggiungibile: controlla la connessione di questo dispositivo (e la VPN, se il server ne usa una).') : e2.message;
    } finally { submit.disabled = false; }
  });

  const wrap = h('div', { class: 'auth' },
    h('div', { class: 'auth-art', 'aria-hidden': 'true' },
      h('div', { class: 'auth-brand' }, h('span', { class: 'brand-mark' }), 'Quadretto'),
      h('p', {}, t('Appunti, formule e scrittura a mano per i tuoi studi avanzati.'))),
    h('div', { class: 'auth-panel' }, form));
  if (offline) err.textContent = t('Server non raggiungibile: controlla la connessione di questo dispositivo (e la VPN, se il server ne usa una).');
  if (expired) err.textContent = t('La sessione è scaduta: accedi di nuovo. Le modifiche non inviate restano su questo dispositivo.');
  document.body.append(wrap);
  setMode('login');
  fetch('/api/auth/options').then((r) => r.json()).then((o) => { signup = o.signup; setMode(mode); }).catch(() => {});
  setTimeout(() => user.focus(), 60);
}

export function changePasswordForm(onDone) {
  const cur = h('input', { type: 'password', id: 'pw-cur', autocomplete: 'current-password' });
  const nw = h('input', { type: 'password', id: 'pw-new', autocomplete: 'new-password', placeholder: t('Almeno 8 caratteri') });
  const nw2 = h('input', { type: 'password', id: 'pw-new2', autocomplete: 'new-password' });
  const err = h('p', { class: 'auth-err', role: 'alert' });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, t('Cambia password'));
  const form = h('form', { novalidate: true },
    h('h2', {}, t('Cambia password')),
    h('p', { class: 'lead' }, t('Gli altri dispositivi collegati a questo account verranno scollegati.')),
    h('label', { class: 'field' }, h('span', {}, t('Password attuale')), cur),
    h('label', { class: 'field' }, h('span', {}, t('Nuova password')), nw),
    h('label', { class: 'field' }, h('span', {}, t('Conferma nuova password')), nw2),
    err,
    h('div', { class: 'sheet-actions' }, btn));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (nw.value !== nw2.value) { err.textContent = t('Le due password non coincidono.'); return; }
    btn.disabled = true;
    try { await api('POST', '/api/auth/password', { current: cur.value, password: nw.value }); onDone(); }
    catch (e2) { err.textContent = e2.message; } finally { btn.disabled = false; }
  });
  return form;
}
