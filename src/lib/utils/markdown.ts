import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('vue', xml);

marked.setOptions({
  gfm: true,
  breaks: true
});

marked.use({
  renderer: {
    code({ text, lang }) {
      const language = lang && hljs.getLanguage(lang) ? lang : null;
      const code = language
        ? hljs.highlight(text, { language }).value
        : hljs.highlightAuto(text).value;
      const langClass = language ? ` language-${language}` : '';
      return `<pre class="md-code-block"><code class="hljs${langClass}">${code}</code></pre>`;
    },
    link({ href, title, text }) {
      const titleAttr = title ? ` title="${title}"` : '';
      return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
    }
  }
});

const PURIFY_OPTIONS = {
  ADD_ATTR: ['target', 'rel', 'class'],
  ALLOWED_TAGS: [
    'p',
    'br',
    'strong',
    'em',
    'b',
    'i',
    'u',
    's',
    'del',
    'code',
    'pre',
    'span',
    'a',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'blockquote',
    'hr',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td'
  ]
};

const LIST_ITEM_RE = /^[ \t]*(?:[-*+]|\d+\.)\s/;

/** Blank lines between list items make marked emit loose lists with extra `<p>` wrappers. */
function tightenMarkdownLists(source: string): string {
  const lines = source.split('\n');
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      LIST_ITEM_RE.test(line) &&
      lines[i + 1]?.trim() === '' &&
      lines[i + 2] !== undefined &&
      LIST_ITEM_RE.test(lines[i + 2])
    ) {
      out.push(line);
      i += 1;
      continue;
    }
    out.push(line);
  }

  return out.join('\n');
}

function normalizeMarkdownHtml(html: string): string {
  return html.replace(/<li>\s*<p>([\s\S]*?)<\/p>\s*<\/li>/gi, '<li>$1</li>');
}

export function renderMarkdown(text: string): string {
  if (!text?.trim() || typeof window === 'undefined') return '';
  const prepared = tightenMarkdownLists(text);
  const html = marked.parse(prepared, { async: false }) as string;
  return DOMPurify.sanitize(normalizeMarkdownHtml(html), PURIFY_OPTIONS);
}
