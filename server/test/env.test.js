// BUG-016 (2026-11-25): le variabili scritte nel .env devono arrivare anche ai moduli che le leggono appena
// caricati (run.js: RUN_SANDBOX). Gli altri test passano le variabili nell'ambiente, quindi non lo vedevano.
// Non serve PostgreSQL:  cd server && node --test test/env.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SRV = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('RUN_SANDBOX scritto nel .env accende l\'esecuzione (server.js importa env.js per primo)', () => {
  const primo = fs.readFileSync(path.join(SRV, 'server.js'), 'utf8').match(/^import\s.*$/m)[0];
  assert.match(primo, /^import '\.\/env\.js';/, 'il primo import di server.js deve essere ./env.js');

  // un'app finta con il suo .env: env.js e run.js veri, e un main che li importa nello stesso ordine di server.js
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'quadretto-env-'));
  try {
    fs.mkdirSync(path.join(app, 'server'));
    for (const f of ['env.js', 'run.js']) fs.copyFileSync(path.join(SRV, f), path.join(app, 'server', f));
    fs.writeFileSync(path.join(app, 'server', 'package.json'), '{"type":"module"}');
    fs.writeFileSync(path.join(app, '.env'), 'RUN_SANDBOX=unsafe-local\n');
    fs.writeFileSync(path.join(app, 'server', 'main.js'),
      "import './env.js';\nimport { runInfo } from './run.js';\nconsole.log(JSON.stringify(runInfo()));\n");
    const env = { ...process.env }; delete env.RUN_SANDBOX;
    const r = spawnSync(process.execPath, [path.join(app, 'server', 'main.js')], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).mode, 'unsafe-local');
  } finally { fs.rmSync(app, { recursive: true, force: true }); }
});
