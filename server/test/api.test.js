// Test delle API con un PostgreSQL vero (usa e getta). Avvia server.js in un processo a parte per ogni gruppo di prove.
//   cd server && PGHOST=127.0.0.1 PGPORT=55432 PGUSER=postgres PGPASSWORD=... PGDATABASE=quadretto_test npm test
// Il database deve essere vuoto o di prova: il server ci crea le tabelle (schema.sql) e i test ci scrivono.
// Piano di pubblicazione, fase E (2026-11-24): valori predefiniti sicuri, isolamento tra account, difesa CSRF.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js');
const PG = ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'];
if (!process.env.PGDATABASE) throw new Error('Imposta PGHOST, PGPORT, PGUSER, PGPASSWORD e PGDATABASE di un database di prova');

let porta = 20000 + Math.floor(Math.random() * 20000);
async function avvia(env = {}) {
  const port = porta++;
  const base = Object.fromEntries(PG.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
  const proc = spawn(process.execPath, [SERVER], { env: { PATH: process.env.PATH, ...base, HOST: '127.0.0.1', PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) throw new Error(`Il server si è fermato:\n${log}`);
    try { if ((await fetch(`${url}/api/health`)).ok) return { url, proc, log: () => log }; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error(`Il server non risponde:\n${log}`);
}
const ferma = (s) => new Promise((r) => { if (!s || s.proc.exitCode !== null) return r(); s.proc.once('exit', r); s.proc.kill('SIGTERM'); });

// Un client con il suo cookie di sessione.
function client(url) {
  let cookie = '';
  return async (method, p, body, { csrf = true } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (csrf) headers['X-Quadretto'] = '1';
    if (cookie) headers.Cookie = cookie;
    const r = await fetch(url + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const text = await r.text();
    let data = null; try { data = JSON.parse(text); } catch {}
    return { status: r.status, data };
  };
}
const nome = (p) => `${p}${randomUUID().slice(0, 8)}`;

describe('valori predefiniti sicuri (nessuna variabile impostata)', () => {
  let s;
  before(async () => { s = await avvia(); });
  after(() => ferma(s));

  test('la registrazione è chiusa', async () => {
    const c = client(s.url);
    assert.equal((await c('GET', '/api/auth/options')).data.signup, false);
    const r = await c('POST', '/api/auth/register', { username: nome('x'), password: 'una-password-lunga' });
    assert.equal(r.status, 403);
  });

  test('non crea un proprietario senza password', async () => {
    assert.doesNotMatch(s.log(), /non ha ancora una password/);
    const r = await client(s.url)('POST', '/api/auth/login', { username: 'ami', password: 'qualsiasi-cosa' });
    assert.notEqual(r.data?.firstAccess, true);
  });
});

describe('con OWNER_USERNAME e registrazione aperta', () => {
  let s;
  const owner = nome('capo');
  before(async () => { s = await avvia({ OWNER_USERNAME: owner, ALLOW_SIGNUP: '1' }); });
  after(() => ferma(s));

  test('avvisa se il proprietario non ha ancora una password', () => {
    assert.match(s.log(), new RegExp(`«${owner}» non ha ancora una password`));
  });

  test('l\'esecuzione di C/C++ è spenta se non la si accende', async () => {
    const c = client(s.url);
    assert.equal((await c('POST', '/api/auth/register', { username: nome('c'), password: 'una-password-lunga' })).status, 200);
    assert.deepEqual((await c('GET', '/api/bootstrap')).data.run.available, false);
    const r = await c('POST', '/api/run', { lang: 'c', files: [{ path: 'a.c', content: 'int main(){return 0;}' }] });
    assert.equal(r.status, 503);
    assert.match(r.data.error, /RUN_SANDBOX=bwrap/);
  });

  test('senza l\'intestazione X-Quadretto le modifiche sono rifiutate (CSRF)', async () => {
    const c = client(s.url);
    await c('POST', '/api/auth/register', { username: nome('d'), password: 'una-password-lunga' });
    const r = await c('POST', '/api/notebooks', { title: 'Quaderno' }, { csrf: false });
    assert.ok(r.status >= 400 && r.status < 500, `stato ${r.status}`);
  });

  test('un account non vede, non trova, non modifica e non cancella i dati di un altro', async () => {
    const a = client(s.url), b = client(s.url);
    assert.equal((await a('POST', '/api/auth/register', { username: nome('a'), password: 'una-password-lunga' })).status, 200);
    assert.equal((await b('POST', '/api/auth/register', { username: nome('b'), password: 'una-password-lunga' })).status, 200);

    const nb = (await a('POST', '/api/notebooks', { title: 'Analisi' })).data;
    const id = randomUUID();
    const parola = `segreto${randomUUID().slice(0, 6)}`;
    const salvato = await a('PUT', `/api/notes/${id}`, { notebook_id: nb.id, title: 'Teorema', blocks: [{ type: 'text', md: parola }], plain: parola });
    assert.equal(salvato.status, 200);
    assert.equal((await a('GET', `/api/notes/${id}`)).status, 200);

    assert.equal((await b('GET', `/api/notes/${id}`)).status, 404, 'leggere');
    assert.deepEqual((await b('GET', `/api/search?q=${parola}`)).data, [], 'cercare');
    assert.equal((await b('GET', '/api/bootstrap')).data.notes.some((n) => n.id === id), false, 'elenco');
    assert.equal((await b('PUT', `/api/notes/${id}`, { title: 'rubato', blocks: [] })).status, 404, 'sovrascrivere');
    assert.equal((await b('PATCH', `/api/notebooks/${nb.id}`, { title: 'rubato' })).status >= 400, true, 'rinominare il quaderno');
    await b('DELETE', `/api/notes/${id}`);
    await b('DELETE', `/api/notebooks/${nb.id}`);

    const dopo = await a('GET', `/api/notes/${id}`);
    assert.equal(dopo.status, 200);
    assert.equal(dopo.data.title, 'Teorema');
    assert.equal(dopo.data.deleted_at ?? null, null, 'l\'appunto di A non è nel cestino');
    assert.equal((await a('GET', '/api/bootstrap')).data.notebooks.find((n) => n.id === nb.id)?.title, 'Analisi');
  });

  test('i messaggi d\'errore seguono la lingua (inglese se non detto)', async () => {
    const dati = { username: nome('l'), password: 'una-password-lunga' };
    await fetch(`${s.url}/api/auth/register`, { method: 'POST', headers: { 'X-Quadretto': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(dati) });
    const prova = async (lang) => {
      const headers = { 'X-Quadretto': '1', 'Content-Type': 'application/json', ...(lang ? { 'X-Lang': lang } : {}) };
      const r = await fetch(`${s.url}/api/auth/register`, { method: 'POST', headers, body: JSON.stringify(dati) });
      return [r.status, (await r.json()).error];
    };
    assert.deepEqual(await prova(), [409, 'Username already taken']);
    assert.deepEqual(await prova('en'), [409, 'Username already taken']);
    assert.deepEqual(await prova('it'), [409, 'Nome utente già in uso']);
  });

  test('troppi tentativi di accesso sbagliati vengono fermati', async () => {
    const c = client(s.url);
    let ultimo;
    for (let i = 0; i < 12; i++) ultimo = await c('POST', '/api/auth/login', { username: nome('z'), password: 'sbagliata-123' });
    assert.equal(ultimo.status, 429);
  });
});
