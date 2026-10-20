// The assistant's replies are Markdown, and the app renders them into shapes a
// person can read. This checks that rendering without needing a browser: the
// self-contained formatting section of public/app.js is loaded into a stub DOM,
// exactly as the page loads it, and the resulting tree is inspected.

import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

type StubChild = StubElement | { text: string };
type StubElement = { tag: string; attrs: Record<string, string>; children: StubChild[] };

const el = (tag: string, props: Record<string, unknown> = {}, ...children: unknown[]): StubElement => {
  const node: StubElement = { tag, attrs: {}, children: [] };
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    node.attrs[key] = value === true ? '' : String(value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || typeof child === 'boolean') continue;
    // The real `el` wraps bare strings in text nodes; so does this one.
    node.children.push(typeof child === 'string' ? { text: child } : (child as StubChild));
  }
  return node;
};

const stubDocument = { createTextNode: (value: string) => ({ text: String(value) }) };

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const start = source.indexOf('/* -- message formatting');
const end = source.indexOf('/* -- end message formatting');
assert.ok(start !== -1 && end > start, 'public/app.js should still carry the message formatting markers');

const load = new Function(
  'document',
  'el',
  `${source.slice(start, end)}
   return { renderMessageText, messagePlainText };`,
) as (document: unknown, el: unknown) => {
  renderMessageText: (text: string, options?: { markdown?: boolean }) => StubElement[];
  messagePlainText: (text: string) => string;
};

const { renderMessageText, messagePlainText } = load(stubDocument, el);

const isElement = (child: StubChild): child is StubElement => (child as StubElement).tag !== undefined;

const textOf = (node: StubChild | undefined): string => {
  if (node === undefined) return '';
  return isElement(node) ? node.children.map(textOf).join('') : node.text;
};

/** The nth node, insisting it exists — a missing node is the bug under test. */
const at = (nodes: StubChild[], index: number): StubElement => {
  const node = nodes[index];
  assert.ok(node !== undefined && isElement(node), `expected an element at position ${index}`);
  return node;
};

const tags = (nodes: StubChild[]): string[] => nodes.map((node) => (isElement(node) ? node.tag : '#text'));

const ofTag = (nodes: StubChild[], tag: string): StubElement[] =>
  nodes.filter(isElement).flatMap((node) => (node.tag === tag ? [node] : ofTag(node.children, tag)));

/** The first node with this tag, failing the test when there is none. */
const need = (nodes: StubChild[], tag: string): StubElement => {
  const [found] = ofTag(nodes, tag);
  assert.ok(found !== undefined, `expected a <${tag}> somewhere in the reply`);
  return found;
};

it('a bold label on its own line becomes a label, not asterisks', () => {
  const nodes = renderMessageText('**Email**\n\nDear Timothy,');
  const label = at(nodes, 0);
  assert.equal(label.tag, 'div');
  assert.equal(label.attrs.class, 'msg-label');
  assert.equal(textOf(label), 'Email');
});

it('bold and italic inside a sentence are rendered as such', () => {
  const paragraph = at(renderMessageText('The deposit is **£800** and due *before* the start.'), 0);
  assert.equal(paragraph.tag, 'p');
  assert.equal(textOf(need(paragraph.children, 'strong')), '£800');
  assert.equal(textOf(need(paragraph.children, 'em')), 'before');
  assert.equal(textOf(paragraph), 'The deposit is £800 and due before the start.');
});

it('a drafted letter keeps its own line breaks', () => {
  const draft = [
    'Subject: Your tenancy at 3a Fourier Grove',
    'Dear Timothy,',
    'Your tenancy starts on 1 November 2026.',
    'Kind regards,',
    'Haven Bricks Properties',
  ].join('\n');
  const nodes = renderMessageText(draft);
  assert.deepEqual(tags(nodes), ['p']);
  const paragraph = at(nodes, 0);
  // One <br> between each line, so the greeting does not run into the address.
  assert.equal(ofTag(paragraph.children, 'br').length, 4);
  assert.match(textOf(paragraph), /Dear Timothy,.*Your tenancy starts/s);
});

it('bullets, numbered steps, headings, quotes and rules each get their shape', () => {
  const nodes = renderMessageText(
    [
      '## Next steps',
      '- Send the ID',
      '- Book the check-in',
      '',
      '1. Check the details',
      '2. Send the pack',
      '',
      '> Read this before you send it.',
      '',
      '---',
      '',
      'Done.',
    ].join('\n'),
  );
  assert.deepEqual(tags(nodes), ['h4', 'ul', 'ol', 'blockquote', 'hr', 'p']);
  assert.deepEqual(ofTag(at(nodes, 1).children, 'li').map(textOf), ['Send the ID', 'Book the check-in']);
  assert.deepEqual(ofTag(at(nodes, 2).children, 'li').map(textOf), ['Check the details', 'Send the pack']);
  assert.equal(textOf(at(nodes, 3)), 'Read this before you send it.');
});

it('an indented line stays with the bullet above it', () => {
  const nodes = renderMessageText('- Right to rent — send a copy of the ID\n  due before the start');
  const item = at(ofTag(at(nodes, 0).children, 'li'), 0);
  assert.equal(ofTag(item.children, 'br').length, 1);
  assert.match(textOf(item), /Right to rent.*due before the start/s);
});

it('only real links become links', () => {
  const safe = at(renderMessageText('See [the guide](https://gov.uk/how-to-rent) first.'), 0);
  const anchor = need(safe.children, 'a');
  assert.equal(anchor.attrs.href, 'https://gov.uk/how-to-rent');
  assert.equal(anchor.attrs.rel, 'noopener noreferrer');
  assert.equal(textOf(anchor), 'the guide');

  const unsafe = renderMessageText('Tap [here](javascript:alert(1)) to lose your deposit.');
  assert.equal(ofTag(unsafe, 'a').length, 0);
  assert.equal(textOf(at(unsafe, 0)), 'Tap [here](javascript:alert(1)) to lose your deposit.');
});

it('markup in the reply is shown, never executed', () => {
  const nodes = renderMessageText('Careful: <img src=x onerror="alert(1)"> is not markup here.');
  assert.equal(ofTag(nodes, 'img').length, 0);
  assert.equal(textOf(at(nodes, 0)), 'Careful: <img src=x onerror="alert(1)"> is not markup here.');
});

it('a reply with no text at all still renders a paragraph', () => {
  assert.deepEqual(tags(renderMessageText('')), ['p']);
});

it('what is copied is the words, without the Markdown', () => {
  assert.equal(
    messagePlainText('**Email**\n\nDear *Timothy*,\n\n- Send the ID\n- `RTG` guide\n\n# Notes\n> Do not delay'),
    'Email\n\nDear Timothy,\n\n- Send the ID\n- RTG guide\n\nNotes\nDo not delay',
  );
  assert.equal(
    messagePlainText('Read the [guide](https://gov.uk/how-to-rent) tonight.'),
    'Read the guide (https://gov.uk/how-to-rent) tonight.',
  );
});

it('a message the agent typed is left exactly as typed', () => {
  const pasted = 'From the landlord: *urgent* — rent_2026_final.xlsx, £800 by 31 Oct.';
  const nodes = renderMessageText(pasted, { markdown: false });
  assert.equal(ofTag(nodes, 'em').length, 0);
  assert.equal(textOf(at(nodes, 0)), pasted);
});
