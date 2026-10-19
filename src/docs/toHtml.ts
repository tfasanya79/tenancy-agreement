/**
 * Render parsed Markdown to a stand-alone HTML page.
 *
 * This page is how the agent prints or saves a PDF: open the preview, press
 * "Print", choose "Save as PDF". No headless browser, LibreOffice or Ghostscript
 * is required, which keeps installation to a single command.
 */

import type { Block, Inline } from './markdown.ts';

export type HtmlMeta = {
  title: string;
  subtitle?: string;
  footerText?: string;
  /** Hide the on-screen toolbar (used when embedding in an iframe). */
  embedded?: boolean;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineToHtml(inlines: Inline[]): string {
  return inlines
    .map((run) => {
      const text = escapeHtml(run.text);
      if (run.bold === true && run.italic === true) return `<strong><em>${text}</em></strong>`;
      if (run.bold === true) return `<strong>${text}</strong>`;
      if (run.italic === true) return `<em>${text}</em>`;
      return text;
    })
    .join('');
}

function blockToHtml(block: Block): string {
  switch (block.type) {
    case 'heading': {
      const tag = block.level === 1 ? 'h1' : block.level === 2 ? 'h2' : 'h3';
      return `<${tag}>${inlineToHtml(block.inlines)}</${tag}>`;
    }
    case 'paragraph':
      return `<p>${inlineToHtml(block.inlines)}</p>`;
    case 'quote':
      return `<blockquote>${inlineToHtml(block.inlines)}</blockquote>`;
    case 'bullets':
      return `<ul>${block.items.map((item) => `<li>${inlineToHtml(item)}</li>`).join('')}</ul>`;
    case 'numbered':
      return `<ol class="plain">${block.items.map((item) => `<li>${inlineToHtml(item)}</li>`).join('')}</ol>`;
    case 'table': {
      const head = block.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('');
      const body = block.rows
        .map((row) => {
          const cells = block.headers
            .map((_header, index) => `<td>${escapeHtml(row[index] ?? '')}</td>`)
            .join('');
          return `<tr>${cells}</tr>`;
        })
        .join('');
      return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    }
    case 'rule':
      return '<hr />';
    case 'pagebreak':
      return '<div class="page-break"></div>';
  }
}

const CSS = `
  :root { --ink: #1a1a1a; --muted: #5a5a5a; --rule: #d8d3ca; --accent: #7a5c3e; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #eceae5; color: var(--ink);
    font-family: Georgia, 'Times New Roman', serif; font-size: 11pt; line-height: 1.55;
  }
  .toolbar {
    position: sticky; top: 0; z-index: 10; display: flex; gap: .6rem; align-items: center;
    padding: .6rem 1rem; background: #23201d; color: #f3efe8;
    font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; font-size: .82rem;
  }
  .toolbar strong { font-weight: 600; letter-spacing: .02em; }
  .toolbar .spacer { flex: 1; }
  .toolbar button {
    font: inherit; cursor: pointer; border-radius: 6px; padding: .42rem .8rem;
    border: 1px solid #4a443d; background: #322d28; color: #f3efe8;
  }
  .toolbar button:hover { background: #423b34; }
  .toolbar .hint { opacity: .68; }
  .sheet {
    max-width: 210mm; margin: 1.4rem auto; padding: 22mm 20mm; background: #fff;
    box-shadow: 0 2px 18px rgba(0,0,0,.12);
  }
  h1 { font-size: 20pt; text-align: center; margin: 0 0 .3rem; letter-spacing: .01em; }
  h1 + p { text-align: center; }
  h2 { font-size: 12.5pt; margin: 1.6rem 0 .55rem; padding-bottom: .22rem; border-bottom: 1px solid var(--rule); }
  h3 { font-size: 11pt; margin: 1.2rem 0 .4rem; }
  p { margin: 0 0 .7rem; text-align: justify; }
  ul, ol { margin: 0 0 .8rem; padding-left: 1.35rem; }
  ol.plain { list-style: none; padding-left: 0; }
  ol.plain li { margin-bottom: .45rem; text-align: justify; }
  li { margin-bottom: .3rem; }
  table { width: 100%; border-collapse: collapse; margin: .7rem 0 1.1rem; font-size: 9.6pt; }
  th, td { border: 1px solid var(--rule); padding: .42rem .55rem; text-align: left; vertical-align: top; }
  th { background: #f4f1ec; font-weight: 600; }
  blockquote {
    margin: .8rem 0 1.1rem; padding: .6rem .9rem; background: #f8f5f0;
    border-left: 3px solid var(--accent); color: var(--muted); font-size: 9.6pt; font-style: italic;
  }
  blockquote p, blockquote { text-align: left; }
  hr { border: 0; border-top: 1px solid var(--rule); margin: 1.2rem 0; }
  .page-break { break-after: page; page-break-after: always; height: 0; }
  .doc-foot {
    margin-top: 2.2rem; padding-top: .6rem; border-top: 1px solid var(--rule);
    color: var(--muted); font-size: 8.6pt; font-style: italic;
  }
  @page { size: A4; margin: 18mm; }
  @media print {
    body { background: #fff; font-size: 10.5pt; }
    .toolbar { display: none !important; }
    .sheet { margin: 0; padding: 0; box-shadow: none; max-width: none; }
    table, blockquote, h2, h3 { break-inside: avoid; }
    thead { display: table-header-group; }
  }
`;

export function renderHtml(blocks: Block[], meta: HtmlMeta): string {
  const title = escapeHtml(meta.title);
  const body = blocks.map(blockToHtml).join('\n');

  const toolbar =
    meta.embedded === true
      ? ''
      : `<div class="toolbar">
      <strong>${title}</strong>
      <span class="hint">${escapeHtml(meta.subtitle ?? '')}</span>
      <span class="spacer"></span>
      <button type="button" onclick="window.print()">Print / Save as PDF</button>
    </div>`;

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>${CSS}</style>
</head>
<body>
${toolbar}
<main class="sheet">
${body}
<div class="doc-foot">Prepared with TenancyDesk${meta.footerText !== undefined && meta.footerText !== '' ? ` · ${escapeHtml(meta.footerText)}` : ''}. Check every detail, and the current law, before signing.</div>
</main>
</body>
</html>`;
}
