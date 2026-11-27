// Quadretto — carica il .env dell'app PRIMA di tutti gli altri moduli.
// Va importato per primo in server.js: gli `import` ES si eseguono prima del corpo del file, quindi un
// `process.loadEnvFile` scritto in server.js arrivava dopo run.js e federation.js, che leggono le variabili
// appena caricati (BUG-016: RUN_SANDBOX=bwrap nel .env veniva ignorato e il C/C++ restava spento).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(APP, '.env')); } catch {}
