// Quadretto — amministrazione da riga di comando sul server.
//   node admin.js create-user <nome> [nome da mostrare]   crea un account con password casuale salvata in ../<nome>.credentials (permessi 600)
//   node admin.js reset-first <nome>                       toglie la password: al prossimo accesso l'utente ne sceglie una nuova
//   node admin.js new-password <nome>                      nuova password casuale in ../<nome>.credentials (mai per il proprietario)
//   node admin.js list                                     elenca gli account
//   node admin.js set-lang <nome> <en|it>                  lingua dell'interfaccia dell'account (2026-11-24: predefinita l'inglese)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { hashPassword, validUsername } from './auth.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(APP, '.env')); } catch {}
const pool = new pg.Pool({ max: 1 });
const [cmd, name, ...rest] = process.argv.slice(2);
try {
  if (cmd === 'create-user') {
    if (!validUsername(name)) throw new Error('Nome utente non valido');
    const pw = crypto.randomBytes(18).toString('base64url');
    await pool.query('insert into users (username, display_name, pass_hash) values ($1,$2,$3)', [name, rest.join(' ') || name, hashPassword(pw)]);
    const file = path.join(APP, `${name}.credentials`);
    fs.writeFileSync(file, JSON.stringify({ username: name, password: pw }) + '\n', { mode: 0o600 });
    console.log(`Account ${name} creato. Credenziali in ${file}`);
  } else if (cmd === 'new-password') {
    const u = (await pool.query('select id, is_owner from users where username = $1', [name])).rows[0];
    if (!u) throw new Error('Account non trovato');
    if (u.is_owner) throw new Error('La password del proprietario la sceglie solo lui: usa reset-first');
    const pw = crypto.randomBytes(18).toString('base64url');
    await pool.query('update users set pass_hash = $2 where id = $1', [u.id, hashPassword(pw)]);
    await pool.query('delete from sessions where user_id = $1', [u.id]);
    const file = path.join(APP, `${name}.credentials`);
    fs.writeFileSync(file, JSON.stringify({ username: name, password: pw }) + '\n', { mode: 0o600 });
    fs.chmodSync(file, 0o600);
    console.log(`Nuova password di ${name} in ${file}; sessioni chiuse`);
  } else if (cmd === 'reset-first') {
    const r = await pool.query('update users set pass_hash = null where username = $1', [name]);
    await pool.query('delete from sessions where user_id = (select id from users where username = $1)', [name]);
    console.log(r.rowCount ? `Password di ${name} azzerata` : 'Account non trovato');
  } else if (cmd === 'set-lang') {
    const l = rest[0];
    if (l !== 'en' && l !== 'it') throw new Error('Lingua: en oppure it');
    const r = await pool.query(`update users set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('lang', $2::text) where username = $1`, [name, l]);
    console.log(r.rowCount ? `Lingua di ${name}: ${l} (vale dal prossimo avvio dell'app)` : 'Account non trovato');
  } else if (cmd === 'list') {
    const r = await pool.query(`select username, display_name, is_owner, pass_hash is not null as has_password, created_at::date,
      (select count(*) from notebooks n where n.user_id = u.id) as quaderni, (select count(*) from notes n where n.user_id = u.id) as appunti from users u order by created_at`);
    console.table(r.rows);
  } else console.log('Comandi: create-user <nome> [nome da mostrare] | new-password <nome> | reset-first <nome> | set-lang <nome> <en|it> | list');
} catch (e) { console.error(e.message); process.exitCode = 1; } finally { await pool.end(); }
