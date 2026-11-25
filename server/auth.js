// Quadretto — account e sessioni. Password con scrypt, sessioni con token casuale in cookie HttpOnly.
import crypto from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const COOKIE = 'qsid';
export const SESSION_DAYS = 180;

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function checkPassword(pw, stored) {
  if (!stored) return false;
  const [kind, N, r, p, salt, key] = stored.split('$');
  if (kind !== 'scrypt') return false;
  const want = Buffer.from(key, 'base64');
  const got = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), want.length, { N: Number(N), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(want, got);
}

export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const tokenHash = (t) => crypto.createHash('sha256').update(t).digest('hex');

export function readCookie(req, name = COOKIE) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

// Con HTTPS (tailscale serve davanti al server) il cookie viaggia solo cifrato
export const sessionCookie = (token, secure = false) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`;
export const clearCookie = (secure = false) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;

// L'HTTPS lo fa `tailscale serve`, che gira su questa stessa macchina e inoltra in HTTP aggiungendo
// X-Forwarded-For. Ci si fida di quell'intestazione solo se la connessione viene da qui: un dispositivo
// della tailnet che la mandasse direttamente alla porta 8790 ha un altro indirizzo e viene ignorato.
export function proxyInfo(req, selfAddrs) {
  const remote = (req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  const fwd = req.headers['x-forwarded-for'];
  const viaProxy = selfAddrs.has(remote) && typeof fwd === 'string' && fwd.trim().length > 0;
  return { viaProxy, ip: viaProxy ? fwd.split(',')[0].trim() : remote };
}

export function validUsername(u) { return typeof u === 'string' && /^[a-z0-9._-]{2,32}$/.test(u); }
export function validPassword(p) { return typeof p === 'string' && p.length >= 8 && p.length <= 200; }

// Limite tentativi di accesso: 10 ogni 10 minuti per indirizzo
const attempts = new Map();
export function tooManyAttempts(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 10 * 60e3);
  attempts.set(ip, list);
  return list.length >= 10;
}
export function noteFailure(ip) { (attempts.get(ip) || attempts.set(ip, []).get(ip)).push(Date.now()); }
export function clearFailures(ip) { attempts.delete(ip); }
