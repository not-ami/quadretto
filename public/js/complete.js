// Quadretto — suggerimenti di completamento nell'editor del codice (2026.11.4).
// Mentre scrivi, una riga di pulsanti sotto il codice propone come finire la parola: nomi del tuo progetto (variabili,
// funzioni, tipi, campi delle struct dopo -> e .), chiamate POSIX e della libreria, parole chiave, header dopo
// #include <, e piccoli modelli (for, if, while, main…). Sopra, la firma della funzione di cui stai scrivendo gli
// argomenti. Tocco o Tab = accetta il primo; Esc = nascondi. Tutto sul dispositivo, senza rete.
import { REF } from './posix-ref.js';

const C_KW = 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false NULL size_t ssize_t pid_t off_t mode_t uint8_t uint32_t int64_t FILE'.split(' ');
const CPP_KW = 'class namespace template typename public private protected virtual override new delete this nullptr using std vector string map unordered_map cout cin endl thread mutex lock_guard unique_lock condition_variable'.split(' ');
const C_LIB = 'printf fprintf sprintf snprintf scanf fgets puts putchar getchar malloc calloc realloc free memcpy memset strcpy strncpy strcmp strncmp strlen strcat strtok atoi atol strtol rand srand time sleep usleep exit abort assert fflush fopen fclose fread fwrite perror strerror'.split(' ');
const PY_KW = 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield print len range enumerate zip list dict set tuple str int float bool input open sorted sum min max abs isinstance super self __init__ append extend items keys values join split strip format'.split(' ');
const JS_KW = 'async await break case catch class const continue default delete do else export extends false finally for function if import in instanceof let new null return super switch this throw true try typeof undefined var void while yield console log map filter reduce forEach push pop length JSON parse stringify Math Promise setTimeout'.split(' ');
const HEADERS = ['stdio.h', 'stdlib.h', 'string.h', 'unistd.h', 'fcntl.h', 'pthread.h', 'semaphore.h', 'mqueue.h', 'sys/mman.h', 'sys/stat.h', 'sys/types.h', 'sys/wait.h', 'signal.h', 'errno.h', 'time.h', 'stdbool.h', 'stdint.h', 'assert.h', 'math.h', 'ctype.h', 'limits.h', 'iostream', 'vector', 'string', 'thread', 'mutex', 'condition_variable', 'algorithm'];
// modelli: ▮ è dove finisce il cursore
const SNIP = {
  c: [
    ['for', 'for (int i = 0; i < ▮; i++) {\n    \n}'],
    ['if', 'if (▮) {\n    \n}'],
    ['while', 'while (▮) {\n    \n}'],
    ['main', 'int main(void) {\n    ▮\n    return 0;\n}'],
    ['struct', 'typedef struct {\n    ▮\n} Nome;'],
    ['fork', 'pid_t pid = fork();\nif (pid < 0) { perror("fork"); exit(1); }\nif (pid == 0) {\n    ▮\n    exit(0);\n}'],
    ['lock', 'pthread_mutex_lock(&▮);\n\npthread_mutex_unlock(&);'],
    ['cwait', 'while (▮)\n    pthread_cond_wait(&, &);'],
  ],
  python: [['def', 'def ▮():\n    '], ['for', 'for ▮ in :\n    '], ['if', 'if ▮:\n    '], ['main', 'if __name__ == "__main__":\n    ▮']],
  js: [['function', 'function ▮() {\n  \n}'], ['for', 'for (let i = 0; i < ▮; i++) {\n  \n}'], ['if', 'if (▮) {\n  \n}']],
};
SNIP.cpp = SNIP.c;

export const langOfPath = (p) => (/\.py$/i.test(p) ? 'python' : /\.m?js$/i.test(p) ? 'js' : /\.(cpp|cc|cxx|hpp|hh)$/i.test(p) ? 'cpp' : /\.[ch]$/i.test(p) ? 'c' : null);

// Nomi del progetto: funzioni (con la firma), tipi, campi delle struct, altre parole
function scan(files) {
  const words = new Map(), fns = new Map(), fields = new Set();
  for (const f of files) {
    const t = f.text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/#[^\n]*/g, (m) => (m.startsWith('#define') ? m : ''));
    for (const m of t.matchAll(/\b([A-Za-z_]\w*)\s*\(([^;{}()]*)\)\s*\{/g)) if (!/^(if|while|for|switch|return|sizeof)$/.test(m[1])) {
      const pre = t.slice(Math.max(0, m.index - 60), m.index).split(/[;}\n]/).pop().trim();
      fns.set(m[1], `${pre ? pre + ' ' : ''}${m[1]}(${m[2].trim()})`);
    }
    for (const m of t.matchAll(/\bdef\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g)) fns.set(m[1], `def ${m[1]}(${m[2].trim()})`);
    for (const m of t.matchAll(/\bfunction\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g)) fns.set(m[1], `function ${m[1]}(${m[2].trim()})`);
    // campi: «int testa, coda;», «sem_t *s;», «int v[4];» → testa, coda, s, v
    for (const m of t.matchAll(/\bstruct\b[^{;]*\{([^{}]*)\}/g)) for (const d of m[1].split(';')) for (const part of d.split(',')) { const n = /([A-Za-z_]\w*)\s*(\[[^\]]*\])*\s*$/.exec(part.trim()); if (n && !/^(int|char|long|short|float|double|unsigned|signed|const|struct|void)$/.test(n[1])) fields.add(n[1]); }
    for (const m of t.matchAll(/\b[A-Za-z_]\w{2,}\b/g)) words.set(m[0], (words.get(m[0]) || 0) + 1);
  }
  return { words, fns, fields };
}

export function attachCompletion(ta, { getFiles, getPath, bar, hint, onAccept }) {
  let cache = null, cacheKey = '', items = [], word = null, timer = 0;
  const project = () => {
    const files = getFiles();
    const key = files.map((f) => f.path + ':' + f.text.length).join('|');
    if (key !== cacheKey) { cache = scan(files); cacheKey = key; }
    return cache;
  };
  const hide = () => { bar.hidden = true; items = []; };
  const update = () => {
    const lang = langOfPath(getPath() || '');
    if (!lang) { hide(); hint.hidden = true; return; }
    const pos = ta.selectionStart;
    if (pos !== ta.selectionEnd) { hide(); return; }
    const before = ta.value.slice(0, pos);
    const line = before.slice(before.lastIndexOf('\n') + 1);
    const P = project();
    // firma della funzione di cui si stanno scrivendo gli argomenti
    let depth = 0, fn = null;
    for (let i = before.length - 1, n = 0; i >= 0 && n < 400; i--, n++) {
      const ch = before[i];
      if (ch === ')') depth++;
      else if (ch === '(') { if (depth === 0) { fn = /([A-Za-z_]\w*)\s*$/.exec(before.slice(0, i))?.[1]; break; } depth--; }
      else if (ch === ';' || ch === '{' || ch === '}') break;
    }
    const sig = fn && (P.fns.get(fn) || REF[fn]?.proto);
    hint.hidden = !sig;
    if (sig) hint.textContent = sig;
    // #include <…>
    const inc = /#\s*include\s*<([\w./]*)$/.exec(line);
    let cands = [];
    if (inc) { word = { start: pos - inc[1].length, text: inc[1], close: '>' }; cands = HEADERS.filter((x) => x.startsWith(inc[1]) && x !== inc[1]).map((x) => ({ t: x, k: 'h' })); }
    else {
      const m = /([A-Za-z_]\w*)$/.exec(line);
      const member = /(->|\.)\s*([A-Za-z_]\w*)?$/.exec(line);
      if (member && (lang === 'c' || lang === 'cpp')) {
        const pre = member[2] || '';
        word = { start: pos - pre.length, text: pre };
        cands = [...P.fields].filter((x) => x.startsWith(pre) && x !== pre).sort().map((x) => ({ t: x, k: 'f' }));
      } else if (m && m[1].length >= 1) {
        const pre = m[1];
        word = { start: pos - pre.length, text: pre };
        const seen = new Set([pre]);
        const add = (t, k, extra) => { if (!seen.has(t) && t.startsWith(pre)) { seen.add(t); cands.push({ t, k, ...extra }); } };
        for (const [s, body] of SNIP[lang] || []) if (s.startsWith(pre) && pre.length >= 2) { cands.push({ t: s, k: 's', body }); seen.add(s); }
        for (const f of [...P.fns.keys()].sort()) add(f, 'fn');
        if (lang === 'c' || lang === 'cpp') for (const r of Object.keys(REF).sort()) if (!REF[r].sysv) add(r, 'fn');
        const kw = lang === 'python' ? PY_KW : lang === 'js' ? JS_KW : lang === 'cpp' ? [...C_KW, ...CPP_KW, ...C_LIB] : [...C_KW, ...C_LIB];
        for (const w of [...P.words].sort((a, b) => b[1] - a[1]).map((x) => x[0])) add(w, 'w');
        for (const k of kw) add(k, C_LIB.includes(k) ? 'fn' : 'k');
        if (pre.length < 2) cands = cands.filter((c) => c.k === 'w' || c.k === 'fn').slice(0, 6);
      } else word = null;
    }
    items = cands.slice(0, 8);
    if (!items.length) { hide(); return; }
    const ico = { fn: 'ƒ', w: '·', k: '#', s: '⤷', h: '<>', f: '→' };
    bar.replaceChildren(...items.map((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cmp-item' + (i === 0 ? ' first' : '');
      b.innerHTML = `<span class="cmp-k">${ico[c.k]}</span>`;
      b.append(c.t);
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); accept(c); });
      return b;
    }));
    bar.hidden = false;
  };
  const accept = (c) => {
    if (!word) return;
    const pos = ta.selectionStart;
    let text = c.t, caret = null;
    if (c.k === 's') { caret = c.body.indexOf('▮'); text = c.body.replace('▮', ''); }
    else if (c.k === 'fn' && ta.value[pos] !== '(') { text += '()'; caret = text.length - 1; }
    else if (c.k === 'h' && ta.value[pos] !== '>') text += '>';
    // rientro della riga per i modelli su più righe
    if (c.k === 's') { const ls = ta.value.lastIndexOf('\n', word.start - 1) + 1; const ind = /^\s*/.exec(ta.value.slice(ls, word.start))[0]; text = text.replace(/\n/g, '\n' + ind); if (caret != null) caret += (c.body.slice(0, c.body.indexOf('▮')).match(/\n/g) || []).length * ind.length; }
    ta.setRangeText(text, word.start, pos, 'end');
    if (caret != null) { const p = word.start + caret; ta.setSelectionRange(p, p); }
    ta.dispatchEvent(new Event('input'));
    hide();
    onAccept?.();
    ta.focus();
  };
  const later = () => { clearTimeout(timer); timer = setTimeout(update, 60); };
  ta.addEventListener('input', later);
  ta.addEventListener('click', later);
  ta.addEventListener('keyup', (e) => { if (e.key.startsWith('Arrow')) later(); });
  ta.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== ta) { hide(); hint.hidden = true; } }, 150));
  // Tab accetta il primo suggerimento (se c'è), altrimenti rientra; Esc nasconde
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !bar.hidden && items.length) { e.preventDefault(); e.stopImmediatePropagation(); accept(items[0]); }
    else if (e.key === 'Escape' && !bar.hidden) { e.preventDefault(); hide(); }
  }, true);
  return { refresh: later, hide };
}
