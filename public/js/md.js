// Markdown con formule LaTeX ($…$, $$…$$), codice evidenziato, checklist e riquadri Def./Teorema/Attenzione.

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderMath(tex, display) {
  if (!window.katex) return `<code>${esc(tex)}</code>`;
  try {
    return window.katex.renderToString(tex, { displayMode: display, throwOnError: true, strict: 'ignore', output: 'html' });
  } catch (e) {
    return `<span class="math-err" title="${esc(e.message)}">${esc(display ? `$$${tex}$$` : `$${tex}$`)}</span>`;
  }
}

// Estrae le formule fuori dai blocchi di codice e le sostituisce con segnaposto
function protectMath(src) {
  const math = [], links = [];
  const parts = src.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g);
  const out = parts.map((part, i) => {
    if (i % 2 === 1) return part; // codice: non toccare
    return part
      .replace(/\[\[([^\[\]\n]{1,120})\]\]/g, (_, t) => { links.push(t.trim()); return `WIKIX${links.length - 1}X`; })
      .replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => { math.push([t.trim(), true]); return `\n\nMATHX${math.length - 1}X\n\n`; })
      .replace(/(^|[^\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, (_, pre, t) => { math.push([t, false]); return `${pre}MATHX${math.length - 1}X`; });
  }).join('');
  return { out, math, links };
}

let configured = false;
function setup() {
  if (configured || !window.marked) return;
  window.marked.use({ gfm: true, breaks: true });
  configured = true;
}

export function renderMarkdown(src) {
  setup();
  if (!window.marked) return `<p>${esc(src).replace(/\n/g, '<br>')}</p>`;
  const { out, math, links } = protectMath(src);
  let html = window.marked.parse(out);
  html = window.DOMPurify ? window.DOMPurify.sanitize(html, { ADD_ATTR: ['checked'] }) : html;
  html = html.replace(/<p>MATHX(\d+)X<\/p>/g, (_, i) => renderMath(math[i][0], true))
             .replace(/MATHX(\d+)X/g, (_, i) => renderMath(math[i][0], math[i][1]))
             // collegamenti tra appunti [[titolo]]: l'app li risolve e li apre
             .replace(/WIKIX(\d+)X/g, (_, i) => `<a class="wikilink" data-wl="${esc(links[i])}" role="link" tabindex="0">${esc(links[i])}</a>`);
  return html;
}

export function enhance(el) {
  el.querySelectorAll('pre code').forEach((c) => {
    if (window.hljs) {
      try { window.hljs.highlightElement(c); } catch {}
    }
  });
  el.querySelectorAll('blockquote').forEach((q) => {
    const t = (q.textContent || '').trim().toLowerCase();
    if (/^(def\.|definizione|definition)/.test(t)) q.classList.add('callout-def'); // anche in inglese (2026-11-24)
    else if (/^(teorema|thm|lemma|proposizione|corollario|theorem|proposition|corollary)/.test(t)) q.classList.add('callout-thm');
    else if (/^(attenzione|nota bene|n\.b\.|!|warning|caution|note well)/.test(t)) q.classList.add('callout-warn');
  });
  el.querySelectorAll('input[type=checkbox]').forEach((c, i) => { c.disabled = false; c.dataset.i = i; });
  el.querySelectorAll('a[href]:not(.wikilink)').forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });
}

// Spunta/togli la n-esima casella nel sorgente
export function toggleTask(src, n) {
  let i = -1;
  return src.replace(/^(\s*[-*+]\s+)\[( |x|X)\]/gm, (m, pre, mark) => {
    i++;
    if (i !== n) return m;
    return `${pre}[${mark === ' ' ? 'x' : ' '}]`;
  });
}

export const SNIPPETS = [
  { label: '# Titolo', insert: '## ', line: true },
  { label: '• Elenco', insert: '- ', line: true },
  { label: '☐ Da fare', insert: '- [ ] ', line: true },
  { label: '$x$', insert: '$', wrap: '$' },
  { label: '$$ Formula', insert: '$$\n', wrap: '\n$$', block: true },
  { label: '{ } Codice', insert: '```c\n', wrap: '\n```', block: true },
  { label: '▶ Python', insert: '```python\n', wrap: '\n```', block: true },
  { label: '[[ Collega', insert: '[[' },
  { label: 'Def.', insert: '> **Def.** ', line: true },
  { label: 'Teorema', insert: '> **Teorema.** ', line: true },
  { label: 'Tabella', insert: '| A | B |\n|---|---|\n|   |   |\n', block: true },
];
