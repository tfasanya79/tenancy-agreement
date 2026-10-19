/**
 * A deliberately small Markdown parser.
 *
 * Legal documents need headings, paragraphs, lists, tables, callouts and page
 * breaks — not the whole CommonMark specification. Supporting only a documented
 * subset means a template author can never hit a construct we quietly mangle.
 *
 * Supported:  # ## ### headings · paragraphs · - bullets · 1. numbered ·
 *             **bold** · *italic* · | tables | · > callouts · --- rules ·
 *             \newpage
 */

export type Inline = { text: string; bold?: boolean; italic?: boolean };

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; inlines: Inline[] }
  | { type: 'paragraph'; inlines: Inline[] }
  | { type: 'bullets'; items: Inline[][] }
  | { type: 'numbered'; items: Inline[][] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'quote'; inlines: Inline[] }
  | { type: 'rule' }
  | { type: 'pagebreak' };

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^[-*+]\s+(.*)$/;
const NUMBERED = /^(\d+)[.)]\s+(.*)$/;
const TABLE_DIVIDER = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;
const RULE = /^(-{3,}|\*{3,}|_{3,})$/;

/** Parse `**bold**` and `*italic*` inside a line of text. */
export function parseInline(text: string): Inline[] {
  const runs: Inline[] = [];
  const pattern = /(\*\*)(.+?)\1|(\*)(.+?)\3/g;
  let last = 0;
  let match: RegExpExecArray | null = pattern.exec(text);
  while (match !== null) {
    if (match.index > last) runs.push({ text: text.slice(last, match.index) });
    if (match[2] !== undefined) runs.push({ text: match[2], bold: true });
    else if (match[4] !== undefined) runs.push({ text: match[4], italic: true });
    last = match.index + match[0].length;
    match = pattern.exec(text);
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  if (runs.length === 0) runs.push({ text: '' });
  return runs;
}

function splitRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|').map((cell) => cell.trim());
}

function startsBlock(line: string): boolean {
  return (
    line.trim() === '' ||
    HEADING.test(line) ||
    BULLET.test(line) ||
    NUMBERED.test(line) ||
    line.startsWith('>') ||
    line.startsWith('|') ||
    RULE.test(line.trim()) ||
    line.trim() === '\\newpage'
  );
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    if (trimmed === '') {
      i += 1;
      continue;
    }

    if (trimmed === '\\newpage') {
      blocks.push({ type: 'pagebreak' });
      i += 1;
      continue;
    }

    if (RULE.test(trimmed)) {
      blocks.push({ type: 'rule' });
      i += 1;
      continue;
    }

    const heading = HEADING.exec(trimmed);
    if (heading) {
      const hashes = heading[1] ?? '#';
      const level = Math.min(hashes.length, 3) as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, inlines: parseInline(heading[2] ?? '') });
      i += 1;
      continue;
    }

    // Tables ---------------------------------------------------------------
    if (trimmed.startsWith('|') && TABLE_DIVIDER.test((lines[i + 1] ?? '').trim())) {
      const headers = splitRow(trimmed);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length) {
        const rowLine = (lines[i] ?? '').trim();
        if (!rowLine.startsWith('|')) break;
        rows.push(splitRow(rowLine));
        i += 1;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    // Callouts -------------------------------------------------------------
    if (trimmed.startsWith('>')) {
      const collected: string[] = [];
      while (i < lines.length) {
        const quoteLine = (lines[i] ?? '').trim();
        if (!quoteLine.startsWith('>')) break;
        collected.push(quoteLine.replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ type: 'quote', inlines: parseInline(collected.join(' ').trim()) });
      continue;
    }

    // Lists ----------------------------------------------------------------
    if (BULLET.test(trimmed)) {
      const items: Inline[][] = [];
      while (i < lines.length) {
        const itemLine = (lines[i] ?? '').trim();
        const bullet = BULLET.exec(itemLine);
        if (!bullet) break;
        items.push(parseInline(bullet[1] ?? ''));
        i += 1;
      }
      blocks.push({ type: 'bullets', items });
      continue;
    }

    if (NUMBERED.test(trimmed)) {
      const items: Inline[][] = [];
      while (i < lines.length) {
        const itemLine = (lines[i] ?? '').trim();
        const numbered = NUMBERED.exec(itemLine);
        if (!numbered) break;
        // Keep the author's own numbering ("2.1", "1.") visible in the text.
        items.push(parseInline(itemLine.replace(/^(\d+)[.)]\s+/, '$1. ')));
        i += 1;
      }
      blocks.push({ type: 'numbered', items });
      continue;
    }

    // Paragraph ------------------------------------------------------------
    const paragraph: string[] = [];
    while (i < lines.length) {
      const current = lines[i] ?? '';
      if (paragraph.length > 0 && startsBlock(current)) break;
      if (current.trim() === '') break;
      paragraph.push(current.trim());
      i += 1;
    }
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', inlines: parseInline(paragraph.join(' ')) });
    }
  }

  return blocks;
}

/** Plain-text rendering, used for previews and full-text search. */
export function blocksToPlainText(blocks: Block[]): string {
  const inlineText = (inlines: Inline[]) => inlines.map((run) => run.text).join('');
  const out: string[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case 'heading': out.push(inlineText(block.inlines)); break;
      case 'paragraph': out.push(inlineText(block.inlines)); break;
      case 'quote': out.push(inlineText(block.inlines)); break;
      case 'bullets':
      case 'numbered':
        for (const item of block.items) out.push(`- ${inlineText(item)}`);
        break;
      case 'table':
        out.push(block.headers.join(' | '));
        for (const row of block.rows) out.push(row.join(' | '));
        break;
      case 'pagebreak': out.push(''); break;
      case 'rule': break;
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
