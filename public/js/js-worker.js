// Quadretto — JavaScript in un worker: console.log va nell'uscita, input() legge le righe dello stdin.
self.onmessage = async (e) => {
  const { id, files, main, stdin } = e.data;
  const send = (k, s) => self.postMessage({ id, k, s });
  const fmt = (a) => a.map((x) => (typeof x === 'string' ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })())).join(' ') + '\n';
  const con = { log: (...a) => send('out', fmt(a)), info: (...a) => send('out', fmt(a)), warn: (...a) => send('err', fmt(a)), error: (...a) => send('err', fmt(a)) };
  const lines = (stdin || '').split('\n');
  let i = 0;
  const input = () => (i < lines.length && !(i === lines.length - 1 && lines[i] === '') ? lines[i++] : null);
  try {
    const code = files.find((f) => f.path === main)?.text ?? '';
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await new AsyncFunction('console', 'input', code)(con, input);
    send('done', 'ok');
  } catch (err) {
    send('err', String(err?.stack || err) + '\n');
    send('done', 'error');
  }
};
