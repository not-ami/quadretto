// Quadretto — server HTTP(S) + API su PostgreSQL. Nessun framework: solo node:http e pg.
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runProject, runInfo } from './run.js';
import { tr } from '../public/js/i18n.js'; // stesso dizionario dell'interfaccia: i messaggi d'errore nella lingua dell'utente
import { COOKIE, SESSION_DAYS, proxyInfo, hashPassword, checkPassword, newToken, tokenHash, readCookie, sessionCookie, clearCookie, validUsername, validPassword, tooManyAttempts, noteFailure, clearFailures } from './auth.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(ROOT, '..');
try { process.loadEnvFile(path.join(APP, '.env')); } catch {}
const VERSION = (() => { try { return fs.readFileSync(path.join(APP, 'VERSION'), 'utf8').trim(); } catch { return 'sviluppo'; } })();

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8790);
const PUBLIC = path.join(APP, 'public');
const NM = path.join(ROOT, 'node_modules');
const CERT = path.join(APP, 'certs', 'ts.crt');
const KEY = path.join(APP, 'certs', 'ts.key');
const tls = fs.existsSync(CERT) && fs.existsSync(KEY); // TLS proprio, dormiente: l'HTTPS lo fa tailscale serve

const pool = new pg.Pool({ max: 8 });
pool.on('error', (e) => console.error('pg pool', e.message));
const q = (text, params) => pool.query(text, params);

// --- file statici -----------------------------------------------------------
const VENDOR = {
  'katex/': path.join(NM, 'katex/dist/'),
  'hljs/': path.join(NM, '@highlightjs/cdn-assets/'),
  'marked/': path.join(NM, 'marked/lib/'),
  'purify/': path.join(NM, 'dompurify/dist/'),
  'font-display/': path.join(NM, '@fontsource-variable/space-grotesk/'),
  'font-mono/': path.join(NM, '@fontsource-variable/jetbrains-mono/'),
  'pyodide/': path.join(NM, 'pyodide/'),
  'fflate/': path.join(NM, 'fflate/esm/'),
  'pdfjs/': path.join(NM, 'pdfjs-dist/'),   // 2026.11.6: PDF da annotare (build/, wasm/, cmaps/, standard_fonts/)
};
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.wasm': 'application/wasm', '.zip': 'application/zip', '.whl': 'application/zip', '.tar': 'application/x-tar', '.map': 'application/json',
  '.pdf': 'application/pdf', '.pfb': 'application/octet-stream', '.bcmap': 'application/octet-stream',
};
const gzCache = new Map();

function serveFile(req, res, file, immutable) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, { error: 'Non trovato' });
    const ext = path.extname(file);
    const type = MIME[ext] || 'application/octet-stream';
    const headers = {
      'Content-Type': type,
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'Last-Modified': st.mtime.toUTCString(),
    };
    if (req.headers['if-modified-since'] === headers['Last-Modified']) { res.writeHead(304, headers); return res.end(); }
    const compressible = /text|json|svg|manifest|wasm/.test(type);
    if (compressible && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      const k = file + st.mtimeMs;
      let buf = gzCache.get(k);
      if (!buf) { buf = zlib.gzipSync(fs.readFileSync(file)); gzCache.set(k, buf); }
      res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': buf.length, Vary: 'Accept-Encoding' });
      return res.end(buf);
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}

function safeJoin(base, rel) {
  const p = path.resolve(base, '.' + path.sep + rel);
  return p.startsWith(base) ? p : null;
}

// --- utilità ----------------------------------------------------------------
function send(res, status, body, extra = {}) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': data.length, ...extra });
  res.end(data);
}
function readBody(req, limit = 30 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('Troppo grande'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function json(req) {
  const b = await readBody(req);
  if (!b.length) return {};
  try { return JSON.parse(b.toString('utf8')); } catch { throw Object.assign(new Error('JSON non valido'), { status: 400 }); }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

const NOTE_META = `id, notebook_id, kind, title, plain, tags, pinned, paper, has_ink, rev, created_at, updated_at, deleted_at`;
const NB_COLS = `id, title, code, color, year, to_char(exam_date,'YYYY-MM-DD') AS exam_date, position, archived, legend, kind, created_at, updated_at`;
// Valori predefiniti sicuri (2026-11-24, pubblicazione su GitHub): niente proprietario e registrazione chiusa se non
// li si chiede nel .env. Il Debian li ha scritti nel suo .env (deploy.sh controlla che ci siano).
const OWNER = String(process.env.OWNER_USERNAME || '').trim().toLowerCase();
const ALLOW_SIGNUP = process.env.ALLOW_SIGNUP === '1';
const NB_KINDS = new Set(['', 'code', 'plain']);
const nbKind = (k) => (NB_KINDS.has(k) ? k : '');
const noteKind = (k) => (k === 'repo' ? 'repo' : 'note');
const notFound = (msg) => Object.assign(new Error(msg), { status: 404 });
// Legenda dei colori di un quaderno: { '#e2573b': 'Definizione', … }, al massimo 8 voci
function cleanLegend(l) {
  const out = {};
  if (l && typeof l === 'object' && !Array.isArray(l)) {
    for (const [c, t] of Object.entries(l).slice(0, 8)) if (/^#[0-9a-f]{6}$/i.test(c) && typeof t === 'string' && t.trim()) out[c.toLowerCase()] = t.trim().slice(0, 30);
  }
  return out;
}
const HTTPS_URL = (process.env.HTTPS_URL || '').replace(/\/+$/, ''); // es. https://quadretto.esempio.ts.net:8791 (tailscale serve)
// Indirizzi da cui ci si fida di X-Forwarded-For: questo server e, con TRUST_PROXY (separati da virgole), un proxy davanti
// (es. Caddy in un altro container di Docker). Senza, dietro un proxy tutti avrebbero lo stesso indirizzo per il limite dei tentativi.
const SELF = new Set(['127.0.0.1', '::1', HOST, ...String(process.env.TRUST_PROXY || '').split(',').map((s) => s.trim()).filter(Boolean)]);
const ipOf = (req) => proxyInfo(req, SELF).ip;
// Lingua dei messaggi: quella che l'app manda (X-Lang), poi quella dell'account, se no l'inglese (2026-11-24).
const reqLang = (req) => { const l = req.headers['x-lang'] || req.user?.settings?.lang; return l === 'it' ? 'it' : 'en'; };
const secureReq = (req) => tls || proxyInfo(req, SELF).viaProxy;

// --- API --------------------------------------------------------------------
// route(metodo, percorso, fn, { public: true }) — senza public serve una sessione: fn riceve req.user
const routes = [];
const route = (method, pattern, fn, opts = {}) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn, pub: !!opts.public });

const publicUser = (u) => ({ id: u.id, username: u.username, display_name: u.display_name || u.username, is_owner: u.is_owner });

async function userFromRequest(req) {
  const tok = readCookie(req);
  if (!tok) return null;
  const r = await q(`update sessions s set last_seen = now() from users u
     where s.token_hash = $1 and u.id = s.user_id and s.last_seen > now() - interval '${SESSION_DAYS} days'
     returning u.id, u.username, u.display_name, u.is_owner`, [tokenHash(tok)]);
  return r.rows[0] || null;
}
async function startSession(req, res, user) {
  const tok = newToken();
  await q('insert into sessions (token_hash, user_id, user_agent) values ($1,$2,$3)', [tokenHash(tok), user.id, String(req.headers['user-agent'] || '').slice(0, 200)]);
  res.setHeader('Set-Cookie', sessionCookie(tok, secureReq(req)));
  return { user: publicUser(user) };
}

route('GET', '/api/health', async () => {
  const r = await q('select now() as now');
  return { ok: true, db: true, version: VERSION, now: r.rows[0].now, httpsUrl: HTTPS_URL || null };
}, { public: true });

// --- account ------------------------------------------------------------------
route('GET', '/api/auth/me', async (req) => {
  const u = await userFromRequest(req);
  if (!u) throw Object.assign(new Error('Accesso richiesto'), { status: 401 });
  return { user: publicUser(u), version: VERSION };
}, { public: true });

route('GET', '/api/auth/options', async () => ({ signup: ALLOW_SIGNUP, version: VERSION, httpsUrl: HTTPS_URL || null }), { public: true });

route('POST', '/api/auth/login', async (req, _p, res) => {
  const ip = ipOf(req);
  if (tooManyAttempts(ip)) throw Object.assign(new Error('Troppi tentativi: riprova tra qualche minuto'), { status: 429 });
  const { username, password } = await json(req);
  const name = String(username || '').trim().toLowerCase();
  const u = (await q('select * from users where username = $1', [name])).rows[0];
  if (u && !u.pass_hash) return { firstAccess: true, username: u.username }; // il proprietario sceglie la password al primo accesso
  if (!u || !checkPassword(String(password || ''), u.pass_hash)) { noteFailure(ip); throw Object.assign(new Error('Nome utente o password non corretti'), { status: 401 }); }
  clearFailures(ip);
  return startSession(req, res, u);
}, { public: true });

// Primo accesso di un account creato senza password (il tuo account con i dati già esistenti)
route('POST', '/api/auth/first-password', async (req, _p, res) => {
  const ip = ipOf(req);
  if (tooManyAttempts(ip)) throw Object.assign(new Error('Troppi tentativi: riprova tra qualche minuto'), { status: 429 });
  const { username, password } = await json(req);
  if (!validPassword(password)) throw bad('La password deve avere almeno 8 caratteri');
  const r = await q('update users set pass_hash = $2 where username = $1 and pass_hash is null returning *', [String(username || '').trim().toLowerCase(), hashPassword(password)]);
  if (!r.rowCount) { noteFailure(ip); throw bad('Questo account ha già una password'); }
  return startSession(req, res, r.rows[0]);
}, { public: true });

route('POST', '/api/auth/register', async (req, _p, res) => {
  if (!ALLOW_SIGNUP) throw Object.assign(new Error('La registrazione è chiusa su questo server'), { status: 403 });
  const ip = ipOf(req);
  if (tooManyAttempts(ip)) throw Object.assign(new Error('Troppi tentativi: riprova tra qualche minuto'), { status: 429 });
  const { username, password, display_name } = await json(req);
  const name = String(username || '').trim().toLowerCase();
  if (!validUsername(name)) throw bad('Nome utente: da 2 a 32 caratteri tra lettere minuscole, numeri, punto, trattino');
  if (!validPassword(password)) throw bad('La password deve avere almeno 8 caratteri');
  noteFailure(ip); // anche le registrazioni contano nel limite
  try {
    const r = await q('insert into users (username, display_name, pass_hash) values ($1,$2,$3) returning *', [name, String(display_name || '').trim().slice(0, 60), hashPassword(password)]);
    return startSession(req, res, r.rows[0]);
  } catch (e) {
    if (e.code === '23505') throw Object.assign(new Error('Nome utente già in uso'), { status: 409 });
    throw e;
  }
}, { public: true });

route('POST', '/api/auth/logout', async (req, _p, res) => {
  const tok = readCookie(req);
  if (tok) await q('delete from sessions where token_hash = $1', [tokenHash(tok)]);
  res.setHeader('Set-Cookie', clearCookie(secureReq(req)));
  return { ok: true };
}, { public: true });

route('POST', '/api/auth/password', async (req) => {
  const { current, password } = await json(req);
  const u = (await q('select pass_hash from users where id = $1', [req.user.id])).rows[0];
  if (!checkPassword(String(current || ''), u.pass_hash)) throw Object.assign(new Error('La password attuale non è corretta'), { status: 401 });
  if (!validPassword(password)) throw bad('La nuova password deve avere almeno 8 caratteri');
  await q('update users set pass_hash = $2 where id = $1', [req.user.id, hashPassword(password)]);
  // chiudi le altre sessioni
  await q('delete from sessions where user_id = $1 and token_hash <> $2', [req.user.id, tokenHash(readCookie(req))]);
  return { ok: true };
});

// --- dati (sempre dell'utente collegato) ----------------------------------------
route('GET', '/api/bootstrap', async (req) => {
  const uid = req.user.id;
  const [nb, notes, st, study] = await Promise.all([
    q(`select ${NB_COLS} from notebooks where user_id = $1 order by position, created_at`, [uid]),
    q(`select ${NOTE_META} from notes where user_id = $1 and (deleted_at is null or deleted_at > now() - interval '30 days') order by updated_at desc`, [uid]),
    q('select settings from users where id = $1', [uid]),
    q(`select notebook_id, to_char(day, 'YYYY-MM-DD') as day, seconds from study_time where user_id = $1 and day > current_date - 40`, [uid]),
  ]);
  return { user: publicUser(req.user), notebooks: nb.rows, notes: notes.rows, settings: st.rows[0]?.settings || {}, study: study.rows, run: runInfo(), serverTime: new Date().toISOString() };
});

route('POST', '/api/notebooks', async (req) => {
  const b = await json(req);
  if (!b.title?.trim()) throw bad('Il quaderno ha bisogno di un nome');
  const uid = req.user.id;
  const pos = (await q('select coalesce(max(position),0)+1 as p from notebooks where user_id = $1', [uid])).rows[0].p;
  const r = await q(`insert into notebooks (id, user_id, title, code, color, year, exam_date, position, kind)
     values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9) returning ${NB_COLS}`,
    [UUID.test(b.id || '') ? b.id : null, uid, b.title.trim(), b.code || '', b.color || '#3657e8', b.year ?? null, b.exam_date || null, b.position ?? pos, nbKind(b.kind)]);
  return r.rows[0];
});
route('POST', '/api/notebooks/bulk', async (req) => {
  const { items } = await json(req);
  if (!Array.isArray(items)) throw bad('Elenco mancante');
  const c = await pool.connect();
  try {
    await c.query('begin');
    const base = (await c.query('select coalesce(max(position),0) as p from notebooks where user_id = $1', [req.user.id])).rows[0].p;
    const out = [];
    for (const [i, b] of items.entries()) {
      const r = await c.query(`insert into notebooks (user_id, title, code, color, year, position, kind) values ($1,$2,$3,$4,$5,$6,$7) returning ${NB_COLS}`,
        [req.user.id, b.title, b.code || '', b.color || '#3657e8', b.year ?? null, base + i + 1, nbKind(b.kind)]);
      out.push(r.rows[0]);
    }
    await c.query('commit');
    return out;
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
});
route('PATCH', '/api/notebooks/:id', async (req, p) => {
  const b = await json(req);
  const cols = ['title', 'code', 'color', 'year', 'exam_date', 'position', 'archived', 'legend', 'kind'];
  if ('legend' in b) b.legend = cleanLegend(b.legend);
  if ('kind' in b) b.kind = nbKind(b.kind);
  const sets = [], vals = [];
  for (const k of cols) if (k in b) { vals.push(b[k] === '' && (k === 'exam_date' || k === 'year') ? null : b[k]); sets.push(`${k} = $${vals.length}`); }
  if (!sets.length) throw bad('Niente da aggiornare');
  vals.push(p.id, req.user.id);
  const r = await q(`update notebooks set ${sets.join(', ')}, updated_at = now() where id = $${vals.length - 1} and user_id = $${vals.length} returning ${NB_COLS}`, vals);
  if (!r.rowCount) throw notFound('Quaderno non trovato');
  return r.rows[0];
});
route('POST', '/api/notebooks/reorder', async (req) => {
  const { ids } = await json(req);
  await q(`update notebooks n set position = x.ord from unnest($1::uuid[]) with ordinality as x(id, ord) where n.id = x.id and n.user_id = $2`, [ids, req.user.id]);
  return { ok: true };
});
route('DELETE', '/api/notebooks/:id', async (req, p) => {
  // gli appunti finiscono nel cestino, non spariscono
  await q(`update notes set deleted_at = now(), updated_at = now(), rev = rev + 1 where notebook_id = $1 and user_id = $2 and deleted_at is null`, [p.id, req.user.id]);
  await q('delete from notebooks where id = $1 and user_id = $2', [p.id, req.user.id]);
  return { ok: true };
});

route('GET', '/api/notes/:id', async (req, p) => {
  const r = await q(`select ${NOTE_META}, blocks from notes where id = $1 and user_id = $2`, [p.id, req.user.id]);
  if (!r.rowCount) throw notFound('Appunto non trovato');
  return r.rows[0];
});
route('PUT', '/api/notes/:id', async (req, p) => {
  if (!UUID.test(p.id)) throw bad('Id non valido');
  const b = await json(req);
  const uid = req.user.id;
  const c = await pool.connect();
  try {
    await c.query('begin');
    // il quaderno deve essere dell'utente, altrimenti l'appunto resta senza quaderno
    let nbId = UUID.test(b.notebook_id || '') ? b.notebook_id : null;
    if (nbId && !(await c.query('select 1 from notebooks where id = $1 and user_id = $2', [nbId, uid])).rowCount) nbId = null;
    const cur = (await c.query('select user_id, rev, title, blocks, (select max(saved_at) from note_versions v where v.note_id = notes.id) as last_v from notes where id = $1 for update', [p.id])).rows[0];
    if (cur && cur.user_id !== uid) throw notFound('Appunto non trovato');
    // una versione di sicurezza ogni 10 minuti, o se il client salva sopra una revisione diversa (altro dispositivo)
    if (cur && (!cur.last_v || Date.now() - new Date(cur.last_v) > 10 * 60e3 || (b.baseRev && b.baseRev !== cur.rev))) {
      await c.query('insert into note_versions (note_id, rev, title, blocks) values ($1,$2,$3,$4)', [p.id, cur.rev, cur.title, JSON.stringify(cur.blocks)]);
      await c.query(`delete from note_versions where note_id = $1 and id not in (select id from note_versions where note_id = $1 order by saved_at desc limit 50)`, [p.id]);
    }
    const r = await c.query(`insert into notes (id, user_id, notebook_id, title, blocks, plain, tags, pinned, paper, has_ink, created_at, updated_at, deleted_at, kind)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, coalesce($11::timestamptz, now()), now(), $12, $13)
      on conflict (id) do update set notebook_id = excluded.notebook_id, title = excluded.title, blocks = excluded.blocks, kind = excluded.kind,
        plain = excluded.plain, tags = excluded.tags, pinned = excluded.pinned, paper = excluded.paper, has_ink = excluded.has_ink,
        deleted_at = excluded.deleted_at, updated_at = now(), rev = notes.rev + 1
        where notes.user_id = excluded.user_id
      returning ${NOTE_META}`,
      [p.id, uid, nbId, String(b.title || '').slice(0, 300), JSON.stringify(b.blocks || []), String(b.plain || '').slice(0, 200000),
       Array.isArray(b.tags) ? b.tags.slice(0, 30).map(String) : [], !!b.pinned, b.paper || 'grid', !!b.has_ink, b.created_at || null, b.deleted_at || null, noteKind(b.kind)]);
    if (!r.rowCount) throw notFound('Appunto non trovato');
    await c.query('commit');
    return { ...r.rows[0], conflict: !!(cur && b.baseRev && b.baseRev !== cur.rev) };
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
});
route('PATCH', '/api/notes/:id', async (req, p) => {
  const b = await json(req);
  const cols = { notebook_id: 'uuid', pinned: 'bool', deleted_at: 'timestamptz', tags: 'text[]', title: 'text' };
  const sets = [], vals = [];
  for (const k of Object.keys(cols)) if (k in b) { vals.push(b[k]); sets.push(`${k} = $${vals.length}::${cols[k]}`); }
  if (!sets.length) throw bad('Niente da aggiornare');
  if ('notebook_id' in b && b.notebook_id && !(await q('select 1 from notebooks where id = $1 and user_id = $2', [b.notebook_id, req.user.id])).rowCount) throw bad('Quaderno non valido');
  vals.push(p.id, req.user.id);
  const r = await q(`update notes set ${sets.join(', ')}, updated_at = now(), rev = rev + 1 where id = $${vals.length - 1} and user_id = $${vals.length} returning ${NOTE_META}`, vals);
  if (!r.rowCount) throw notFound('Appunto non trovato');
  return r.rows[0];
});
route('DELETE', '/api/notes/:id', async (req, p) => {
  await q('delete from notes where id = $1 and user_id = $2', [p.id, req.user.id]);
  return { ok: true };
});
route('DELETE', '/api/trash', async (req) => {
  const r = await q('delete from notes where deleted_at is not null and user_id = $1', [req.user.id]);
  return { ok: true, deleted: r.rowCount };
});

route('GET', '/api/notes/:id/versions', async (req, p) => {
  const r = await q(`select v.id, v.rev, v.title, v.saved_at, jsonb_array_length(v.blocks) as n_blocks
     from note_versions v join notes n on n.id = v.note_id where v.note_id = $1 and n.user_id = $2 order by v.saved_at desc`, [p.id, req.user.id]);
  return r.rows;
});
route('GET', '/api/versions/:vid', async (req, p) => {
  if (!/^\d+$/.test(p.vid)) throw bad('Versione non valida');
  const r = await q(`select v.id, v.note_id, v.rev, v.title, v.blocks, v.saved_at from note_versions v join notes n on n.id = v.note_id where v.id = $1 and n.user_id = $2`, [p.vid, req.user.id]);
  if (!r.rowCount) throw notFound('Versione non trovata');
  return r.rows[0];
});

route('GET', '/api/search', async (req) => {
  const term = new URL(req.url, 'http://x').searchParams.get('q')?.trim();
  if (!term) return [];
  const r = await q(`select id, notebook_id, kind, title, updated_at,
      ts_headline('italian', plain, websearch_to_tsquery('italian', $1), 'StartSel=«, StopSel=», MaxWords=18, MinWords=6') as snippet,
      ts_rank(search, websearch_to_tsquery('italian', $1)) as rank
    from notes where user_id = $2 and deleted_at is null and (search @@ websearch_to_tsquery('italian', $1) or title ilike '%' || $1 || '%')
    order by rank desc, updated_at desc limit 40`, [term, req.user.id]);
  return r.rows;
});

route('POST', '/api/attachments', async (req) => {
  const id = req.headers['x-id'];
  if (!UUID.test(id || '')) throw bad('Id foto non valido');
  const mime = req.headers['content-type'] || 'application/octet-stream';
  const isPdf = mime === 'application/pdf';
  if (!isPdf && !/^image\/(jpeg|png|webp|gif|heic|heif)$/.test(mime)) throw bad('Sono accettati solo immagini e PDF');
  // 2026.11.6: i PDF (dispense, slide) possono essere grandi; le foto sono già rimpicciolite dall'app
  const buf = await readBody(req, (isPdf ? 100 : 15) * 1024 * 1024);
  if (isPdf && buf.subarray(0, 1024).indexOf('%PDF-') < 0) throw bad('Il file non sembra un PDF: aprilo in un\'altra app e salvalo di nuovo come PDF');
  await q('insert into attachments (id, user_id, note_id, mime, bytes) values ($1,$2,$3,$4,$5) on conflict (id) do nothing',
    [id, req.user.id, UUID.test(req.headers['x-note-id'] || '') ? req.headers['x-note-id'] : null, mime, buf]);
  return { id, url: `/api/attachments/${id}` };
});
route('GET', '/api/attachments/:id', async (req, p, res) => {
  const r = await q('select mime, bytes from attachments where id = $1 and user_id = $2', [p.id, req.user.id]);
  if (!r.rowCount) throw notFound('Allegato non trovato');
  res.writeHead(200, { 'Content-Type': r.rows[0].mime, 'Content-Length': r.rows[0].bytes.length, 'Cache-Control': 'private, max-age=31536000, immutable' });
  res.end(r.rows[0].bytes);
  return undefined;
});

// --- impostazioni dell'utente (orario delle lezioni, …) ------------------------------------
route('PUT', '/api/settings', async (req) => {
  const { settings } = await json(req);
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw bad('Impostazioni non valide');
  if (JSON.stringify(settings).length > 64 * 1024) throw bad('Impostazioni troppo grandi');
  await q('update users set settings = $2 where id = $1', [req.user.id, settings]);
  return { ok: true };
});

// --- tempo di studio: il client manda secondi da sommare, per quaderno e giorno --------------
route('POST', '/api/study', async (req) => {
  const { items } = await json(req);
  if (!Array.isArray(items) || items.length > 200) throw bad('Elenco non valido');
  for (const it of items) {
    if (!UUID.test(it?.notebook_id || '') || !/^\d{4}-\d{2}-\d{2}$/.test(it?.day || '')) continue;
    const sec = Math.round(Number(it.seconds));
    if (!(sec > 0 && sec <= 4 * 3600)) continue;
    await q(`insert into study_time (user_id, notebook_id, day, seconds)
      select $1, n.id, $3::date, $4 from notebooks n where n.id = $2 and n.user_id = $1
      on conflict (user_id, notebook_id, day) do update set seconds = least(study_time.seconds + excluded.seconds, 86400)`, [req.user.id, it.notebook_id, it.day, sec]);
  }
  return { ok: true };
});

// --- C e C++: compilazione ed esecuzione in gabbia (run.js) ----------------------------------
route('POST', '/api/run', async (req) => runProject(req.user.id, await json(req)));

// --- importazione da GitHub: il server scarica lo zip di un repository pubblico ----------------
route('GET', '/api/github', async (req, _p, res) => {
  const u = new URL(req.url, 'http://x');
  const repo = (u.searchParams.get('repo') || '').trim();
  const ref = (u.searchParams.get('ref') || '').trim();
  if (!/^[\w.-]{1,100}\/[\w.-]{1,100}$/.test(repo)) throw bad('Repository non valido: scrivi proprietario/nome, per esempio torvalds/linux');
  if (ref && !/^[\w./-]{1,200}$/.test(ref)) throw bad('Ramo non valido');
  if (repo.split('/').some((x) => /^\.+$/.test(x)) || ref.split('/').some((x) => /^\.+$/.test(x))) throw bad('Repository non valido');
  let r;
  try { r = await fetch(`https://codeload.github.com/${repo}/zip/${ref ? encodeURI(ref) : 'HEAD'}`, { redirect: 'follow', signal: AbortSignal.timeout(30000) }); }
  catch { throw Object.assign(new Error('GitHub non risponde: riprova tra poco'), { status: 502 }); }
  if (r.status === 404) throw notFound('Repository non trovato, o privato: si importano solo repository pubblici');
  if (!r.ok) throw Object.assign(new Error(`GitHub ha risposto ${r.status}`), { status: 502 });
  const chunks = []; let size = 0;
  for await (const c of r.body) { size += c.length; if (size > 25 * 1024 * 1024) throw Object.assign(new Error('Repository troppo grande (oltre 25 MB): scarica lo zip e importa solo la cartella che ti serve'), { status: 413 }); chunks.push(c); }
  const buf = Buffer.concat(chunks);
  res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
  res.end(buf);
  return undefined;
});

route('GET', '/api/export', async (req, _p, res) => {
  const [nb, notes] = await Promise.all([
    q(`select ${NB_COLS} from notebooks where user_id = $1 order by position`, [req.user.id]),
    q(`select ${NOTE_META}, blocks from notes where user_id = $1 order by created_at`, [req.user.id])]);
  const body = Buffer.from(JSON.stringify({ app: 'quadretto', version: VERSION, user: req.user.username, exported_at: new Date().toISOString(), notebooks: nb.rows, notes: notes.rows }));
  const name = `quadretto-${req.user.username}-${new Date().toISOString().slice(0, 10)}.json`;
  res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${name}"`, 'Content-Length': body.length });
  res.end(body);
  return undefined;
});

// --- pacchetti Python (numpy, sympy, …) ------------------------------------------------------
// Non stanno nel pacchetto npm di Pyodide: alla prima richiesta il server li scarica dal CDN ufficiale,
// controlla lo sha256 scritto nel lock e li tiene in cache; poi il service worker li tiene sull'iPad.
const PYO_CACHE = path.join(APP, 'pyodide-cache');
let pyoLock = null;
const pyoPending = new Map();
async function pyodidePackage(req, res, name) {
  try {
    pyoLock ||= JSON.parse(fs.readFileSync(path.join(NM, 'pyodide/pyodide-lock.json'), 'utf8'));
    const pkg = Object.values(pyoLock.packages).find((x) => x.file_name === name);
    if (!pkg) return send(res, 404, { error: 'Pacchetto Python sconosciuto' });
    const dest = path.join(PYO_CACHE, name);
    if (!fs.existsSync(dest)) {
      if (!pyoPending.has(name)) pyoPending.set(name, (async () => {
        const ver = JSON.parse(fs.readFileSync(path.join(NM, 'pyodide/package.json'), 'utf8')).version;
        const r = await fetch(`https://cdn.jsdelivr.net/pyodide/v${ver}/full/${name}`, { signal: AbortSignal.timeout(60000) });
        if (!r.ok) throw new Error(`CDN ${r.status}`);
        const buf = Buffer.from(await r.arrayBuffer());
        if (crypto.createHash('sha256').update(buf).digest('hex') !== pkg.sha256) throw new Error('sha256 diverso dal lock');
        fs.mkdirSync(PYO_CACHE, { recursive: true });
        fs.writeFileSync(dest + '.tmp', buf); fs.renameSync(dest + '.tmp', dest);
      })().finally(() => pyoPending.delete(name)));
      await pyoPending.get(name);
    }
    return serveFile(req, res, dest, true);
  } catch (e) {
    console.error('pacchetto python', name, e.message);
    return send(res, 502, { error: `Pacchetto Python ${name} non disponibile: serve la rete la prima volta che si usa` });
  }
}

// --- dispatcher -------------------------------------------------------------
async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');

  if (p.startsWith('/api/')) {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = p.match(r.re);
      if (!m) continue;
      try {
        // le richieste che modificano dati devono arrivare dall'app stessa (difesa CSRF)
        if (req.method !== 'GET' && req.headers['x-quadretto'] !== '1') throw Object.assign(new Error('Richiesta non valida'), { status: 403 });
        if (!r.pub) {
          req.user = await userFromRequest(req);
          if (!req.user) throw Object.assign(new Error('Accesso richiesto'), { status: 401 });
        }
        const out = await r.fn(req, m.groups || {}, res);
        if (out !== undefined) send(res, 200, out);
      } catch (e) {
        if (!e.status) console.error(req.method, p, e);
        if (!res.headersSent) send(res, e.status || 500, { error: tr(reqLang(req), e.status ? e.message : 'Errore del server: riprova tra poco') });
      }
      return;
    }
    return send(res, 404, { error: 'Percorso API sconosciuto' });
  }

  if (p.startsWith('/vendor/')) {
    const rest = p.slice('/vendor/'.length);
    const key = Object.keys(VENDOR).find((k) => rest.startsWith(k));
    const file = key && safeJoin(VENDOR[key], rest.slice(key.length));
    if (file && key === 'pyodide/' && !fs.existsSync(file)) return pyodidePackage(req, res, rest.slice(key.length));
    return file ? serveFile(req, res, file, true) : send(res, 404, { error: 'Non trovato' });
  }
  const file = safeJoin(PUBLIC, p === '/' ? 'index.html' : p.slice(1));
  if (!file) return send(res, 404, { error: 'Non trovato' });
  fs.stat(file, (err) => serveFile(req, res, err ? path.join(PUBLIC, 'index.html') : file, false));
}

// --- avvio ------------------------------------------------------------------
await q(fs.readFileSync(path.join(ROOT, 'schema.sql'), 'utf8'));
// Il proprietario (solo se OWNER_USERNAME è impostato): i dati creati prima del multiutente sono suoi. La password la
// sceglie lui al primo accesso; finché non l'ha scelta, chiunque arrivi per primo con quel nome potrebbe sceglierla.
if (OWNER) {
  await q(`insert into users (username, is_owner) values ($1, true) on conflict (username) do update set is_owner = true`, [OWNER]);
  for (const t of ['notebooks', 'notes', 'attachments']) await q(`update ${t} set user_id = (select id from users where username = $1) where user_id is null`, [OWNER]);
  const o = (await q('select pass_hash from users where username = $1', [OWNER])).rows[0];
  if (!o?.pass_hash) console.warn(`⚠️ L'account proprietario «${OWNER}» non ha ancora una password: chi accede per primo con questo nome la sceglie. Fai subito il primo accesso.`);
}
await q(`delete from sessions where last_seen < now() - interval '${SESSION_DAYS} days'`);

const server = tls
  ? https.createServer({ cert: fs.readFileSync(CERT), key: fs.readFileSync(KEY) }, handler)
  : http.createServer(handler);
server.listen(PORT, HOST, () => console.log(`Quadretto ${VERSION} su ${tls ? 'https' : 'http'}://${HOST}:${PORT}`));
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => server.close(() => pool.end().then(() => process.exit(0))));
