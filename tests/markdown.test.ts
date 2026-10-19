import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { blocksToPlainText, parseInline, parseMarkdown } from '../src/docs/markdown.ts';

describe('inline formatting', () => {
  it('parses bold and italic', () => {
    assert.deepEqual(parseInline('a **b** c'), [
      { text: 'a ' },
      { text: 'b', bold: true },
      { text: ' c' },
    ]);
    assert.deepEqual(parseInline('a *b* c'), [
      { text: 'a ' },
      { text: 'b', italic: true },
      { text: ' c' },
    ]);
  });

  it('leaves plain text alone', () => {
    assert.deepEqual(parseInline('just words'), [{ text: 'just words' }]);
  });

  it('always returns at least one run', () => {
    assert.deepEqual(parseInline(''), [{ text: '' }]);
  });
});

describe('block parsing', () => {
  it('parses headings at three levels, clamped', () => {
    const blocks = parseMarkdown('# One\n## Two\n### Three\n#### Four\n');
    assert.deepEqual(blocks.map((block) => (block.type === 'heading' ? block.level : block.type)), [1, 2, 3, 3]);
  });

  it('parses paragraphs separated by blank lines', () => {
    const blocks = parseMarkdown('First line\ncontinues here.\n\nSecond paragraph.');
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]?.type, 'paragraph');
    assert.equal(blocksToPlainText(blocks).split('\n')[0], 'First line continues here.');
  });

  it('parses bullet lists', () => {
    const blocks = parseMarkdown('- one\n- two\n- three');
    assert.equal(blocks.length, 1);
    const block = blocks[0];
    assert.equal(block?.type, 'bullets');
    if (block?.type === 'bullets') assert.equal(block.items.length, 3);
  });

  it('keeps the author’s numbering in numbered lists', () => {
    const blocks = parseMarkdown('1. first\n2. second');
    const block = blocks[0];
    assert.equal(block?.type, 'numbered');
    if (block?.type === 'numbered') {
      assert.equal(block.items[0]?.[0]?.text, '1. first');
      assert.equal(block.items[1]?.[0]?.text, '2. second');
    }
  });

  it('parses a table with a divider row', () => {
    const blocks = parseMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |');
    const block = blocks[0];
    assert.equal(block?.type, 'table');
    if (block?.type === 'table') {
      assert.deepEqual(block.headers, ['A', 'B']);
      assert.equal(block.rows.length, 2);
      assert.deepEqual(block.rows[1], ['3', '4']);
    }
  });

  it('does not mistake a horizontal rule for a table divider', () => {
    const blocks = parseMarkdown('Text\n\n---\n\nMore');
    assert.deepEqual(blocks.map((block) => block.type), ['paragraph', 'rule', 'paragraph']);
  });

  it('parses callouts', () => {
    const blocks = parseMarkdown('> Watch out');
    const block = blocks[0];
    assert.equal(block?.type, 'quote');
    if (block?.type === 'quote') assert.equal(block.inlines[0]?.text, 'Watch out');
  });

  it('parses page breaks', () => {
    const blocks = parseMarkdown('One\n\\newpage\nTwo');
    assert.deepEqual(blocks.map((block) => block.type), ['paragraph', 'pagebreak', 'paragraph']);
  });

  it('starts a list immediately after a paragraph line', () => {
    const blocks = parseMarkdown('Intro:\n- one\n- two');
    assert.deepEqual(blocks.map((block) => block.type), ['paragraph', 'bullets']);
  });

  it('ignores leading and trailing blank lines', () => {
    assert.equal(parseMarkdown('\n\n   \n# Title\n\n\n').length, 1);
  });
});
