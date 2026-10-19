import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  expand,
  formatMoney,
  ordinal,
  parseDate,
  parseFrontMatter,
  placeholdersIn,
  splitFrontMatter,
  toNumber,
} from '../src/docs/template.ts';

describe('placeholder expansion', () => {
  it('substitutes a simple value', () => {
    assert.equal(expand('Hello {{name}}', { name: 'Alex' }), 'Hello Alex');
  });

  it('walks dotted paths', () => {
    assert.equal(expand('{{tenancy.rent_amount}}', { tenancy: { rent_amount: 1250 } }), '1250');
  });

  it('leaves a blank and reports it when a value is missing', () => {
    const missing: string[] = [];
    const out = expand('X{{nope.deep}}Y', {}, { onMissing: (key) => missing.push(key) });
    assert.equal(out, 'XY');
    assert.deepEqual(missing, ['nope.deep']);
  });

  it('formats money with the money filter', () => {
    assert.equal(expand('{{rent|money}}', { rent: 1250 }), '£1,250');
    assert.equal(expand('{{rent|money}}', { rent: '1250.50' }), '£1,250.50');
  });

  it('formats dates three ways', () => {
    const values = { when: '2026-05-01' };
    assert.equal(expand('{{when|date}}', values), '1 May 2026');
    assert.equal(expand('{{when|dateordinal}}', values), '1st May 2026');
    assert.equal(expand('{{when|dateshort}}', values), '01/05/2026');
  });

  it('renders an @if branch when the value is present', () => {
    const template = '{{#if deposit}}Yes: {{deposit}}{{else}}No deposit{{/if}}';
    assert.equal(expand(template, { deposit: 500 }), 'Yes: 500');
    assert.equal(expand(template, {}), 'No deposit');
    assert.equal(expand(template, { deposit: '' }), 'No deposit');
  });

  it('treats zero as false in @if, matching template expectations', () => {
    assert.equal(expand('{{#if x}}a{{else}}b{{/if}}', { x: 0 }), 'b');
  });

  it('loops over a list with $this scoping', () => {
    const template = '{{#each tenants}}[{{this.full_name}}]{{/each}}';
    const out = expand(template, { tenants: [{ full_name: 'Alex' }, { full_name: 'Sam' }] });
    assert.equal(out, '[Alex][Sam]');
  });

  it('falls back to the outer scope inside a loop', () => {
    const template = '{{#each tenants}}{{this.full_name}} of {{property.postcode}};{{/each}}';
    const values = { tenants: [{ full_name: 'Alex' }], property: { postcode: 'M1 2AB' } };
    assert.equal(expand(template, values), 'Alex of M1 2AB;');
  });

  it('loops over an empty list without output', () => {
    assert.equal(expand('A{{#each xs}}x{{/each}}B', { xs: [] }), 'AB');
  });

  it('applies filters inside a loop', () => {
    const values = { tenants: [{ rent: 900 }] };
    assert.equal(expand('{{#each tenants}}{{this.rent|money}}{{/each}}', values), '£900');
  });

  it('rejects an unknown filter loudly', () => {
    assert.throws(() => expand('{{x|banana}}', { x: 1 }), /Unknown filter/);
  });

  it('rejects an unclosed block', () => {
    assert.throws(() => expand('{{#if a}}oops', { a: 1 }), /unclosed/);
  });

  it('rejects a stray closing tag', () => {
    assert.throws(() => expand('{{/if}}', {}), /unexpected closing tag/);
  });

  it('handles a multi-line conditional wrapping whole blocks', () => {
    const template = 'A\n{{#if show}}\n## Heading\n\n{{/if}}\nB';
    assert.equal(expand(template, { show: true }).includes('## Heading'), true);
    assert.equal(expand(template, { show: false }).includes('Heading'), false);
  });
});

describe('conditions and comparisons', () => {
  const template = '{{#if pets == "Yes"}}allowed{{else}}not allowed{{/if}}';

  it('compares a select value to a word', () => {
    assert.equal(expand(template, { pets: 'Yes' }), 'allowed');
  });

  it('does not treat the word "No" as true', () => {
    // This is the trap the comparison syntax exists to prevent.
    assert.equal(expand(template, { pets: 'No' }), 'not allowed');
    assert.equal(expand('{{#if pets}}shown{{/if}}', { pets: 'No' }), 'shown');
  });

  it('ignores case and surrounding spaces in the comparison', () => {
    assert.equal(expand(template, { pets: ' yes ' }), 'allowed');
    assert.equal(expand('{{#if pets == "yes"}}y{{/if}}', { pets: 'YES' }), 'y');
  });

  it('supports the not-equal operator', () => {
    assert.equal(expand('{{#if pets != "No"}}fine{{else}}no pets{{/if}}', { pets: 'No' }), 'no pets');
    assert.equal(expand('{{#if pets != "No"}}fine{{else}}no pets{{/if}}', { pets: 'Yes' }), 'fine');
  });

  it('supports negation of a single value', () => {
    assert.equal(expand('{{#if !deposit}}none{{/if}}', {}), 'none');
    assert.equal(expand('{{#if !deposit}}none{{/if}}', { deposit: 500 }), '');
  });

  it('compares numbers', () => {
    assert.equal(expand('{{#if rent == "1250"}}match{{/if}}', { rent: 1250 }), 'match');
  });

  it('treats a missing value as an empty string', () => {
    assert.equal(expand('{{#if pets == ""}}blank{{/if}}', {}), 'blank');
  });

  it('reports the field, not the expression, when scanning placeholders', () => {
    assert.deepEqual(placeholdersIn('{{#if pets == "Yes"}}{{pets}}{{/if}}'), ['pets']);
    assert.deepEqual(placeholdersIn('{{#if !deposit}}x{{/if}}'), ['deposit']);
  });
});

describe('formatting helpers', () => {
  it('adds English ordinals', () => {
    assert.equal(ordinal(1), '1st');
    assert.equal(ordinal(2), '2nd');
    assert.equal(ordinal(3), '3rd');
    assert.equal(ordinal(11), '11th');
    assert.equal(ordinal(21), '21st');
    assert.equal(ordinal(112), '112th');
  });

  it('parses ISO and UK dates', () => {
    assert.equal(parseDate('2026-05-01')?.getDate(), 1);
    assert.equal(parseDate('01/05/2026')?.getDate(), 1);
    assert.equal(parseDate('01/05/2026')?.getMonth(), 4);
    assert.equal(parseDate('not a date'), null);
    assert.equal(parseDate(''), null);
  });

  it('parses numbers out of money strings', () => {
    assert.equal(toNumber('£1,250.00'), 1250);
    assert.equal(toNumber(900), 900);
    assert.equal(toNumber('abc'), null);
    assert.equal(formatMoney('1250'), '£1,250');
  });
});

describe('front matter and placeholder discovery', () => {
  it('splits front matter from the body', () => {
    const source = '---\nid: x\ntitle: X\n---\n# Body\n';
    const { meta, body } = splitFrontMatter(source);
    assert.match(meta, /id: x/);
    assert.equal(body.trim(), '# Body');
  });

  it('treats a file without front matter as all body', () => {
    const { meta, body } = splitFrontMatter('# Just text');
    assert.equal(meta, '');
    assert.equal(body, '# Just text');
  });

  it('reads inline arrays and quoted strings', () => {
    const parsed = parseFrontMatter('id: test\nrequired: [a.b, c.d]\nversion: "2.0"');
    assert.equal(parsed['id'], 'test');
    assert.deepEqual(parsed['required'], ['a.b', 'c.d']);
    assert.equal(parsed['version'], '2.0');
  });

  it('finds every referenced field, including inside blocks', () => {
    const template = '{{a}} {{#if b}}{{c}}{{/if}} {{#each tenants}}{{this.x}}{{/each}} {{a}}';
    assert.deepEqual(placeholdersIn(template), ['a', 'b', 'c', 'tenants']);
  });
});
