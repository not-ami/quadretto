// Quadretto — il cacciatore di race condition gira qui, lontano dal thread della penna.
import { check } from './race.js';
import { setLang } from './i18n.js';
self.onmessage = (e) => {
  const { id, src, maxStates, lang } = e.data;
  setLang(lang); // il worker non ha localStorage: la lingua arriva con il messaggio
  try { self.postMessage({ id, ok: true, r: check(src, { maxStates }) }); }
  catch (err) { self.postMessage({ id, ok: false, error: err.message, line: err.line || null }); }
};
