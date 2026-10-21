/**
 * Editing an existing Word document in place.
 *
 * A letting agency's agreement has their letterhead, their solicitor's numbering,
 * their fonts and their tables. Regenerating it from scratch would destroy all of
 * that. So instead we open the `.docx` (a ZIP of XML), change only the text that
 * needs changing, and close it again.
 *
 * The result is the same document, identical apart from the substituted values —
 * the formatting of the *first* run in a match is kept, so a bold rent figure
 * stays bold.
 *
 * The hard part is that Word splits a sentence into many "runs": `£9` and `80` may
 * live in two different `<w:t>` elements with different formatting, so a naive
 * search for "£980" finds nothing. These functions rebuild each paragraph's plain
 * text, locate the value in that, and map the edit back onto the real runs.
 */

import { Buffer } from 'node:buffer';

import { createZip, readZip } from '../util/zip.ts';
import { formatDateStyle } from './template.ts';

export type Replacement = {
  /** Exact text to look for, as it appears in the document. */
  find: string;
  /** What to put in its place. */
  replace: string;
  /** Replace every occurrence in a paragraph (default: only the first). */
  all?: boolean;
  /**
   * Only apply inside paragraphs that also contain this text.
   *
   * Two different details often hold the same value: a tenancy that starts on
   * 30 October may have its inventory agreed on 30 October too. Searching by
   * value alone cannot tell those apart, so a link can name the surrounding
   * words that identify the right paragraph.
   */
  near?: string;
  /** Human label, for reporting back to the user. */
  label?: string;
};

export type AppliedChange = { label: string; find: string; replace: string; count: number };

export type DocxEditResult = {
  buffer: Buffer;
  applied: AppliedChange[];
  /** Replacements whose text was not found anywhere. */
  notFound: Replacement[];
};

/** The XML parts of a Word file that contain visible text. */
const TEXT_PART = /^word\/(?:document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/;

const PARAGRAPH = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
const TEXT_ELEMENT = /<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>/g;

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');
}

function encodeXmlEntities(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

type Run = {
  /** Span of the whole `<w:t>…</w:t>` element within the paragraph. */
  elementStart: number;
  elementEnd: number;
  /** Offset of this run's text within the paragraph's plain text. */
  start: number;
  openTag: string;
  text: string;
};

function collectRuns(paragraph: string): { runs: Run[]; text: string } {
  const runs: Run[] = [];
  let text = '';
  TEXT_ELEMENT.lastIndex = 0;
  let match: RegExpExecArray | null = TEXT_ELEMENT.exec(paragraph);

  while (match !== null) {
    const openTag = `<w:t${match[1] ?? ''}>`;
    const decoded = decodeXmlEntities(match[2] ?? '');
    const elementStart = match.index;
    runs.push({
      elementStart,
      elementEnd: elementStart + match[0].length,
      start: text.length,
      openTag,
      text: decoded,
    });
    text += decoded;
    match = TEXT_ELEMENT.exec(paragraph);
  }

  return { runs, text };
}

/** Word collapses spaces unless the run says otherwise. */
function preserving(openTag: string): string {
  return /xml:space/.test(openTag) ? openTag : openTag.replace(/^<w:t/, '<w:t xml:space="preserve"');
}

/** Replace one span of a paragraph's text, keeping the first run's formatting. */
function replaceSpan(paragraph: string, start: number, end: number, replacement: string): string {
  const { runs } = collectRuns(paragraph);
  const edits: Array<{ elementStart: number; elementEnd: number; element: string }> = [];
  let first = true;

  for (const run of runs) {
    const runEnd = run.start + run.text.length;
    if (runEnd <= start || run.start >= end) continue;

    const keepLeft = start > run.start ? run.text.slice(0, start - run.start) : '';
    const keepRight = end < runEnd ? run.text.slice(end - run.start) : '';
    const newText = (first ? keepLeft + replacement : '') + keepRight;
    first = false;

    edits.push({
      elementStart: run.elementStart,
      elementEnd: run.elementEnd,
      element: `${preserving(run.openTag)}${encodeXmlEntities(newText)}</w:t>`,
    });
  }

  // Apply right-to-left so earlier offsets stay valid.
  let out = paragraph;
  for (const edit of edits.sort((a, b) => b.elementStart - a.elementStart)) {
    out = out.slice(0, edit.elementStart) + edit.element + out.slice(edit.elementEnd);
  }
  return out;
}

/** Apply one replacement inside a single paragraph — once, or everywhere. */
function editParagraph(paragraph: string, replacement: Replacement, counts: Map<string, number>): string {
  if (replacement.find === '') return paragraph;

  const key = replacement.label ?? replacement.find;
  let current = paragraph;

  for (let guard = 0; guard < 200; guard += 1) {
    const { text } = collectRuns(current);
    const index = text.indexOf(replacement.find);
    if (index === -1) break;

    current = replaceSpan(current, index, index + replacement.find.length, replacement.replace);
    counts.set(key, (counts.get(key) ?? 0) + 1);

    if (replacement.all !== true) break;
  }

  return current;
}

/** Apply replacements to a single XML part. Exported for testing. */
export function replaceInDocumentXml(
  xml: string,
  replacements: readonly Replacement[],
  counts = new Map<string, number>(),
): string {
  // Table cells contain paragraphs, and paragraphs never nest, so this walks all
  // of them without needing a full XML parser.
  return xml.replace(PARAGRAPH, (paragraph) => {
    const paragraphText = collectRuns(paragraph).text;
    let edited = paragraph;

    for (const replacement of replacements) {
      // A link that names nearby text only applies to paragraphs containing it.
      if (replacement.near !== undefined && replacement.near !== '' && !paragraphText.includes(replacement.near)) {
        continue;
      }
      edited = editParagraph(edited, replacement, counts);
    }

    return edited;
  });
}

function partText(xml: string): string {
  const parts: string[] = [];
  for (const match of xml.matchAll(PARAGRAPH)) {
    const { text } = collectRuns(match[0]);
    if (text !== '') parts.push(text);
  }
  return parts.join('\n');
}

/** The visible text of a `.docx`, paragraph by paragraph, including headers. */
export function extractDocxText(buffer: Buffer): { paragraphs: string[]; text: string } {
  const entries = readZip(buffer);
  const paragraphs: string[] = [];

  for (const [name, data] of entries) {
    if (!TEXT_PART.test(name)) continue;
    const xml = data.toString('utf8');
    for (const match of xml.matchAll(PARAGRAPH)) {
      const { text } = collectRuns(match[0]);
      if (text.trim() !== '') paragraphs.push(text);
    }
  }

  return { paragraphs, text: paragraphs.join('\n') };
}

/**
 * Substitute values into a Word document and hand back a new one.
 * Values that are not found are reported rather than silently ignored.
 */
export function fillDocx(buffer: Buffer, replacements: readonly Replacement[]): DocxEditResult {
  const entries = readZip(buffer);
  const counts = new Map<string, number>();

  for (const [name, data] of entries) {
    if (!TEXT_PART.test(name)) continue;

    const xml = data.toString('utf8');
    // Cheap check first: only touch parts that actually contain a value.
    const text = partText(xml);
    const present = replacements.filter((replacement) => replacement.find !== '' && text.includes(replacement.find));
    if (present.length === 0) continue;

    const edited = replaceInDocumentXml(xml, present, counts);
    if (edited !== xml) entries.set(name, Buffer.from(edited, 'utf8'));
  }

  const applied: AppliedChange[] = [];
  for (const replacement of replacements) {
    const count = counts.get(replacement.label ?? replacement.find) ?? 0;
    if (count > 0) {
      applied.push({
        label: replacement.label ?? replacement.find,
        find: replacement.find,
        replace: replacement.replace,
        count,
      });
    }
  }

  const notFound = replacements.filter(
    (replacement) => (counts.get(replacement.label ?? replacement.find) ?? 0) === 0,
  );

  return {
    buffer: createZip([...entries].map(([name, data]) => ({ name, data }))),
    applied,
    notFound,
  };
}

/* -------------------------------------------------------------------------- */
/*  Filling in visible blanks                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Fill `________` blanks in document order.
 *
 * A blank form cannot be matched by value — every blank looks the same — so the
 * values are applied in the order the blanks appear, which is the order the form
 * asks its questions. This is how the client's holding deposit form is filled.
 */
export function fillDocxBlanks(
  buffer: Buffer,
  values: readonly string[],
): { buffer: Buffer; filled: number; remaining: number } {
  const entries = readZip(buffer);
  const queue = [...values];
  let filled = 0;

  // Body first, then the other parts, so the order matches what a reader sees.
  const order = [...entries.keys()].sort((a, b) => {
    if (a === 'word/document.xml') return -1;
    if (b === 'word/document.xml') return 1;
    return a.localeCompare(b);
  });

  for (const name of order) {
    if (!TEXT_PART.test(name)) continue;
    if (queue.length === 0) break;

    const xml = entries.get(name)?.toString('utf8');
    if (xml === undefined) continue;

    let edited = xml.replace(PARAGRAPH, (paragraph) => {
      let current = paragraph;
      for (;;) {
        if (queue.length === 0) break;
        const { text } = collectRuns(current);
        // A run of three or more underscores is a blank to fill.
        const match = /_{3,}/.exec(text);
        if (match === null) break;
        const next = queue.shift();
        if (next === undefined) break;
        current = replaceSpan(current, match.index, match.index + match[0].length, next);
        filled += 1;
      }
      return current;
    });

    if (edited !== xml) entries.set(name, Buffer.from(edited, 'utf8'));
  }

  return {
    buffer: createZip([...entries].map(([name, data]) => ({ name, data }))),
    filled,
    remaining: queue.length,
  };
}

/* -------------------------------------------------------------------------- */
/*  Turning a pack into substitutions                                         */
/* -------------------------------------------------------------------------- */
/**
 * One link between a detail we hold and the text to look for in their document.
 *
 * `sample` is the value currently in the uploaded file — for example the previous
 * tenant's name. That is what gets searched for; `field` says which of our details
 * replaces it.
 */
export type SlotLink = {
  /** Field key, e.g. `property.room_number`. */
  field: string;
  /** The text as it appears in their document right now. */
  sample: string;
  /** Shown in the review screen, e.g. "Room number". */
  label?: string;
  /** Replace every occurrence (default: first in each paragraph). */
  all?: boolean;
  /** Only fill the paragraphs that also contain this text. */
  near?: string;
};

/**
 * Format a new value the way the sample it replaces was written.
 *
 * Their agreement says "£980", so the replacement has to be "£1,450" — not
 * "1450", and not "£1,450.00". Dates get the same treatment: whatever style the
 * document already uses is the style the new value takes.
 */
export function formatLike(sample: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '';

  const trimmed = sample.trim();

  // Money: keep the currency symbol and the thousands separators.
  if (/^£\s?[\d,]+/.test(trimmed)) {
    const numeric = typeof value === 'number' ? value : Number(String(value).replace(/[£,\s]/g, ''));
    if (!Number.isFinite(numeric)) return String(value);
    const hasPence = /\.\d{2}$/.test(trimmed);
    const body = numeric.toLocaleString('en-GB', {
      minimumFractionDigits: hasPence ? 2 : 0,
      maximumFractionDigits: hasPence ? 2 : 2,
    });
    return `£${body}`;
  }

  // Dates: reuse the style the sample was written in.
  if (/\b\d{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]+\s+\d{4}\b/.test(trimmed) || /\b\d{4}-\d{2}-\d{2}\b/.test(trimmed) || /\b\d{1,2}\/\d{1,2}\/\d{4}\b/.test(trimmed)) {
    if (/\b\d{1,2}(?:st|nd|rd|th)\s+/.test(trimmed)) return formatDateStyle(value, 'ordinal');
    if (/\b\d{1,2}\s+[A-Z][a-z]+\s+\d{4}\b/.test(trimmed)) return formatDateStyle(value, 'long');
    if (/\b\d{1,2}\/\d{1,2}\/\d{4}\b/.test(trimmed)) return formatDateStyle(value, 'short');
    return formatDateStyle(value, 'long');
  }

  return String(value);
}

export type MappingResult = {
  replacements: Replacement[];
  applied: AppliedChange[];
  notFound: Replacement[];
  /** Links whose field had no value — nothing to substitute. */
  skipped: SlotLink[];
};

/**
 * Resolve a field path, including the first tenant's details.
 * Supports `property.room_number` and `tenants[0].full_name`.
 */
export function resolveFieldPath(fields: Record<string, unknown>, path: string): unknown {
  const tenantPath = /^tenants\[(\d+)\]\.(\w+)$/.exec(path.trim());
  if (tenantPath !== null) {
    const list = fields['tenants'];
    const index = Number(tenantPath[1]);
    const key = tenantPath[2] ?? '';
    if (!Array.isArray(list)) return undefined;
    const person = list[index];
    return typeof person === 'object' && person !== null ? (person as Record<string, unknown>)[key] : undefined;
  }

  // `tenants.full_name` means the first tenant: somebody mapping a document by hand
  // should not have to know that a person's details live in an array.
  const unindexed = /^tenants\.(\w+)$/.exec(path.trim());
  if (unindexed !== null) {
    const list = fields['tenants'];
    if (!Array.isArray(list)) return undefined;
    const first = list[0];
    return typeof first === 'object' && first !== null
      ? (first as Record<string, unknown>)[unindexed[1] ?? '']
      : undefined;
  }

  return fields[path];
}

/** Turn a set of slot links plus a pack's details into ready-made replacements. */
export function buildReplacements(
  fields: Record<string, unknown>,
  links: readonly SlotLink[],
): Replacement[] {
  const replacements: Replacement[] = [];

  for (const link of links) {
    const sample = link.sample?.trim();
    if (sample === undefined || sample === '') continue;

    const value = resolveFieldPath(fields, link.field);
    if (value === undefined || value === null || value === '') continue;

    const replacement = formatLike(sample, value);
    if (replacement === '' || replacement === sample) continue;

    replacements.push({
      find: sample,
      replace: replacement,
      label: link.label ?? link.field,
      ...(link.all === true ? { all: true } : {}),
      ...(link.near === undefined ? {} : { near: link.near }),
    });
  }

  // Links that name their surrounding words run first, so a targeted date is not
  // swallowed by a wider link looking for the same value elsewhere.
  return replacements.sort((a, b) => Number(b.near !== undefined) - Number(a.near !== undefined));
}

