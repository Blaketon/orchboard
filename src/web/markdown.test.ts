import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseInline, parseMarkdown, safeHref } from './markdown.ts';

describe('parseInline', () => {
  it('parses bold, italics, inline code, and links', () => {
    assert.deepEqual(
      parseInline('**Bug 2** is *really* in `loft()` — see [docs](https://example.com)'),
      [
        { type: 'strong', children: [{ type: 'text', text: 'Bug 2' }] },
        { type: 'text', text: ' is ' },
        { type: 'em', children: [{ type: 'text', text: 'really' }] },
        { type: 'text', text: ' in ' },
        { type: 'code', text: 'loft()' },
        { type: 'text', text: ' — see ' },
        { type: 'link', href: 'https://example.com', children: [{ type: 'text', text: 'docs' }] },
      ],
    );
  });

  it('does not format inside inline code', () => {
    assert.deepEqual(parseInline('`**not bold**`'), [{ type: 'code', text: '**not bold**' }]);
  });

  it('leaves snake_case and lone asterisks alone', () => {
    assert.deepEqual(parseInline('marquee_gold_frame and 2 * 3'), [
      { type: 'text', text: 'marquee_gold_frame and 2 * 3' },
    ]);
  });

  it('keeps unsafe links as plain text', () => {
    assert.deepEqual(parseInline('[click](javascript:alert(1))'), [
      { type: 'text', text: '[click](javascript:alert(1))' },
    ]);
  });
});

describe('parseMarkdown', () => {
  it('splits headings, paragraphs, lists, quotes, rules, and code', () => {
    const blocks = parseMarkdown(
      [
        '## Fix plan',
        'First line',
        'second line',
        '',
        '1. Stagger priorities',
        '2. Cap the loft ends',
        '   with end caps',
        '',
        '- a',
        '- b',
        '',
        '> quoted',
        '',
        '---',
        '```ts',
        'const x = 1;',
        '```',
      ].join('\n'),
    );
    assert.deepEqual(
      blocks.map((block) => block.type),
      ['heading', 'paragraph', 'list', 'list', 'quote', 'rule', 'code'],
    );
    assert.deepEqual(blocks[1], {
      type: 'paragraph',
      children: [{ type: 'text', text: 'First line\nsecond line' }],
    });
    assert.deepEqual(blocks[2], {
      type: 'list',
      ordered: true,
      items: [
        [{ type: 'text', text: 'Stagger priorities' }],
        [{ type: 'text', text: 'Cap the loft ends\nwith end caps' }],
      ],
    });
    assert.deepEqual(blocks[6], { type: 'code', language: 'ts', text: 'const x = 1;' });
  });

  it('keeps an unclosed code fence as code until the end', () => {
    assert.deepEqual(parseMarkdown('```\nstill typing'), [
      { type: 'code', language: '', text: 'still typing' },
    ]);
  });
});

describe('safeHref', () => {
  it('allows web and mail links only', () => {
    assert.equal(safeHref('https://example.com'), true);
    assert.equal(safeHref('mailto:me@example.com'), true);
    assert.equal(safeHref('javascript:alert(1)'), false);
    assert.equal(safeHref('data:text/html,hi'), false);
    assert.equal(safeHref('/relative'), false);
  });
});
