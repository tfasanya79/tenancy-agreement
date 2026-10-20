/**
 * The history of a tenancy, and a printable version of it.
 *
 * Three months after move-in, a dispute turns on a simple question: what did we
 * give them, when, and can we prove it. The app already records the answers —
 * documents, notes, assistant runs — so this puts them in order and makes the page
 * something that can be printed and filed.
 */

import type { Pack } from '../db.ts';

export type TimelineKind = 'created' | 'document' | 'note' | 'assistant' | 'message' | 'status';

export type TimelineEvent = {
  at: string;
  kind: TimelineKind;
  title: string;
  detail: string;
};

const KIND_LABEL: Record<TimelineKind, string> = {
  created: 'Opened',
  document: 'Document',
  note: 'Note',
  assistant: 'Assistant',
  message: 'Message',
  status: 'Status',
};

/** Newest first: the most recent thing is usually the one being looked for. */
export function sortTimeline(events: TimelineEvent[]): TimelineEvent[] {
  return [...events].sort((a, b) => b.at.localeCompare(a.at));
}

function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const CSS = `
  :root { --ink: #1a1a1a; --muted: #5a5a5a; --rule: #d8d3ca; --accent: #1f5f4f; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #eceae5; color: var(--ink);
    font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; font-size: 11pt; line-height: 1.5; }
  .toolbar { position: sticky; top: 0; display: flex; gap: .6rem; padding: .6rem 1rem;
    background: #23201d; color: #f3efe8; font-size: .82rem; }
  .toolbar .spacer { flex: 1; }
  .toolbar button { font: inherit; cursor: pointer; border-radius: 6px; padding: .4rem .8rem;
    border: 1px solid #4a443d; background: #322d28; color: #f3efe8; }
  .sheet { max-width: 210mm; margin: 1.4rem auto; padding: 20mm 18mm; background: #fff;
    box-shadow: 0 2px 18px rgba(0,0,0,.12); }
  h1 { font-size: 18pt; margin: 0 0 .2rem; }
  .sub { color: var(--muted); font-size: .9rem; margin-bottom: 1.4rem; }
  table.facts { width: 100%; border-collapse: collapse; margin-bottom: 1.6rem; font-size: .92rem; }
  table.facts th, table.facts td { text-align: left; padding: .35rem .5rem; border-bottom: 1px solid var(--rule); }
  table.facts th { width: 34%; color: var(--muted); font-weight: 500; }
  h2 { font-size: 12pt; margin: 1.6rem 0 .6rem; padding-bottom: .2rem; border-bottom: 1px solid var(--rule); }
  ol.events { list-style: none; margin: 0; padding: 0; }
  ol.events li { display: flex; gap: .8rem; padding: .5rem 0; border-bottom: 1px solid var(--rule); }
  ol.events .at { flex: 0 0 118px; color: var(--muted); font-size: .82rem; font-variant-numeric: tabular-nums; }
  ol.events .kind { flex: 0 0 76px; font-size: .7rem; text-transform: uppercase; letter-spacing: .06em; color: var(--accent); }
  ol.events .what strong { display: block; font-size: .92rem; }
  ol.events .what span { color: var(--muted); font-size: .84rem; }
  .foot { margin-top: 1.8rem; padding-top: .6rem; border-top: 1px solid var(--rule);
    color: var(--muted); font-size: .78rem; font-style: italic; }
  @page { size: A4; margin: 16mm; }
  @media print {
    body { background: #fff; }
    .toolbar { display: none !important; }
    .sheet { margin: 0; padding: 0; box-shadow: none; max-width: none; }
    ol.events li { break-inside: avoid; }
  }
`;

export type TimelinePageInput = {
  pack: Pack;
  events: TimelineEvent[];
  facts: Array<{ label: string; value: string }>;
  footerText?: string;
};

/** A one-page, print-ready history of a tenancy. */
export function renderTimelineHtml(input: TimelinePageInput): string {
  const { pack, events, facts } = input;
  const title = pack.tenantName === '' ? 'Tenancy history' : `Tenancy history — ${pack.tenantName}`;

  const rows = facts
    .filter((fact) => fact.value.trim() !== '')
    .map((fact) => `<tr><th>${escape(fact.label)}</th><td>${escape(fact.value)}</td></tr>`)
    .join('\n');

  const items = events
    .map(
      (event) => `<li>
      <span class="at">${escape(when(event.at))}</span>
      <span class="kind">${escape(KIND_LABEL[event.kind])}</span>
      <span class="what"><strong>${escape(event.title)}</strong>${
        event.detail.trim() === '' ? '' : `<span>${escape(event.detail)}</span>`
      }</span>
    </li>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escape(title)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="toolbar">
  <strong>${escape(title)}</strong>
  <span class="spacer"></span>
  <button type="button" onclick="window.print()">Print / Save as PDF</button>
</div>
<main class="sheet">
  <h1>${escape(title)}</h1>
  <div class="sub">Reference ${escape(pack.reference)} · printed ${escape(when(new Date().toISOString()))}</div>
  <table class="facts">${rows}</table>
  <h2>What happened, and when</h2>
  <ol class="events">${items || '<li>Nothing recorded yet.</li>'}</ol>
  <div class="foot">Produced by TenancyDesk from this pack's own record. ${escape(input.footerText ?? '')}</div>
</main>
</body>
</html>`;
}
