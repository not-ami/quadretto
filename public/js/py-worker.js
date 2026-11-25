// Quadretto — Python nel browser (Pyodide), in un worker: non tocca il thread della penna.
// I pacchetti (numpy, sympy, …) li serve il server dalla sua cache; dopo il primo uso restano sull'iPad.
import { loadPyodide } from '/vendor/pyodide/pyodide.mjs';

let py = null;
let booting = null;
const boot = () => (booting ||= loadPyodide({ indexURL: '/vendor/pyodide/' }).then((p) => (py = p)));

self.onmessage = async (e) => {
  const { id, files, main, stdin } = e.data;
  const send = (k, s) => self.postMessage({ id, k, s });
  try {
    if (!py) send('status', 'Avvio di Python: la prima volta servono alcuni secondi…');
    const pyo = await boot();
    pyo.setStdout({ batched: (s) => send('out', s + '\n') });
    pyo.setStderr({ batched: (s) => send('err', s + '\n') });
    let given = false;
    pyo.setStdin({ stdin: () => { if (given || !stdin) return null; given = true; return stdin; } });
    // una cartella per esecuzione, con tutti i file del progetto (import tra file compresi)
    const dir = `/progetto-${id}`;
    for (const f of files) {
      const p = `${dir}/${f.path}`;
      pyo.FS.mkdirTree(p.slice(0, p.lastIndexOf('/')));
      pyo.FS.writeFile(p, f.text);
    }
    pyo.FS.chdir(dir);
    const code = files.find((f) => f.path === main)?.text ?? '';
    await pyo.loadPackagesFromImports(code, { messageCallback: (m) => send('status', m), errorCallback: (m) => send('err', m + '\n') });
    const g = pyo.globals.get('dict')();
    g.set('__name__', '__main__');
    pyo.runPython(`import sys\nif ${JSON.stringify(dir)} not in sys.path: sys.path.insert(0, ${JSON.stringify(dir)})`);
    await pyo.runPythonAsync(code, { globals: g, filename: main });
    g.destroy();
    send('done', 'ok');
  } catch (err) {
    let msg = String(err?.message || err);
    if (/EOFError/.test(msg)) msg += '\nIl programma chiede un input: scrivilo nel riquadro «Input (stdin)».';
    send('err', msg + '\n');
    send('done', 'error');
  }
};
