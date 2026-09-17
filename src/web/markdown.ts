import { el } from './dom.ts';

// A small Markdown subset for agent messages: headings, paragraphs, fenced code, lists, quotes,
// rules, inline code, bold, italics, and links. It builds DOM nodes and never parses HTML, so
// transcript content can't inject markup; links are limited to http(s) and mailto.

export type Inline =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'code'; readonly text: string }
  | { readonly type: 'strong'; readonly children: readonly Inline[] }
  | { readonly type: 'em'; readonly children: readonly Inline[] }
  | { readonly type: 'link'; readonly href: string; readonly children: readonly Inline[] };

export type Block =
  | { readonly type: 'paragraph'; readonly children: readonly Inline[] }
  | { readonly type: 'heading'; readonly level: number; readonly children: readonly Inline[] }
  | { readonly type: 'code'; readonly language: string; readonly text: string }
  | {
      readonly type: 'list';
      readonly ordered: boolean;
      readonly items: readonly (readonly Inline[])[];
    }
  | { readonly type: 'quote'; readonly children: readonly Inline[] }
  | { readonly type: 'rule' };

const FENCE = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s*>\s?(.*)$/;
const LIST_ITEM = /^\s*([-*+]|\d{1,9}[.)])\s+(.*)$/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  const startsBlock = (line: string) =>
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    LIST_ITEM.test(line);

  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1] ?? '```';
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith(marker))
        body.push(lines[i++] ?? '');
      i++; // Closing fence (or end of input).
      blocks.push({ type: 'code', language: fence[2] ?? '', text: body.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1]?.length ?? 1,
        children: parseInline(heading[2] ?? ''),
      });
      i++;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: 'rule' });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i] ?? ''))
        body.push(QUOTE.exec(lines[i++] ?? '')?.[1] ?? '');
      blocks.push({ type: 'quote', children: parseInline(body.join('\n')) });
      continue;
    }

    const first = LIST_ITEM.exec(line);
    if (first) {
      const ordered = /\d/.test(first[1] ?? '');
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i] ?? '';
        const item = LIST_ITEM.exec(current);
        if (item && /\d/.test(item[1] ?? '') === ordered) {
          items.push(item[2] ?? '');
        } else if (
          current.trim() &&
          /^\s+/.test(current) &&
          items.length &&
          !startsBlock(current)
        ) {
          // Continuation of the previous item.
          const lastIndex = items.length - 1;
          items[lastIndex] = `${items[lastIndex] ?? ''}\n${current.trim()}`;
        } else {
          break;
        }
        i++;
      }
      blocks.push({ type: 'list', ordered, items: items.map(parseInline) });
      continue;
    }

    const body: string[] = [];
    while (i < lines.length && (lines[i] ?? '').trim() && !startsBlock(lines[i] ?? ''))
      body.push(lines[i++] ?? '');
    blocks.push({ type: 'paragraph', children: parseInline(body.join('\n')) });
  }
  return blocks;
}

// Inline code first so its contents are never formatted, then links, bold, and italics.
// Underscore emphasis is deliberately unsupported: it mangles snake_case identifiers.
const INLINE =
  /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*(?=\S)([\s\S]*?\S)\*\*|\*(?=[^\s*])([\s\S]*?[^\s*])\*/g;

export function parseInline(text: string): Inline[] {
  const result: Inline[] = [];
  // Neighbouring text is merged, so rejected syntax (like an unsafe link) reads back as one run.
  const pushText = (value: string) => {
    const previous = result.at(-1);
    if (previous?.type === 'text') {
      result[result.length - 1] = { type: 'text', text: previous.text + value };
    } else {
      result.push({ type: 'text', text: value });
    }
  };

  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index;
    if (index > last) pushText(text.slice(last, index));
    const [whole, , code, linkText, href, strong, em] = match;
    if (code !== undefined) {
      result.push({
        type: 'code',
        text: code.trim() === '' ? code : code.replace(/^ (.*) $/, '$1'),
      });
    } else if (linkText !== undefined && href !== undefined) {
      if (safeHref(href)) result.push({ type: 'link', href, children: parseInline(linkText) });
      else pushText(whole);
    } else if (strong !== undefined) {
      result.push({ type: 'strong', children: parseInline(strong) });
    } else if (em !== undefined) {
      result.push({ type: 'em', children: parseInline(em) });
    }
    last = index + whole.length;
  }
  if (last < text.length) pushText(text.slice(last));
  return result;
}

export function safeHref(href: string): boolean {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(href).protocol);
  } catch {
    return false;
  }
}

export function renderMarkdown(source: string): HTMLElement {
  return el('div', { className: 'md' }, parseMarkdown(source).map(renderBlock));
}

function renderBlock(block: Block): HTMLElement {
  switch (block.type) {
    case 'paragraph':
      return el('p', {}, renderInlines(block.children));
    case 'heading':
      return el(
        'p',
        { className: `md-heading md-h${Math.min(block.level, 4)}` },
        renderInlines(block.children),
      );
    case 'code':
      return el('pre', { className: 'md-code' }, [
        el('code', {
          text: block.text,
          attrs: block.language ? { 'data-language': block.language } : {},
        }),
      ]);
    case 'list':
      return el(
        block.ordered ? 'ol' : 'ul',
        {},
        block.items.map((item) => el('li', {}, renderInlines(item))),
      );
    case 'quote':
      return el('blockquote', {}, renderInlines(block.children));
    case 'rule':
      return el('hr');
  }
}

function renderInlines(inlines: readonly Inline[]): Node[] {
  return inlines.map((inline): Node => {
    switch (inline.type) {
      case 'text':
        return document.createTextNode(inline.text);
      case 'code':
        return el('code', { text: inline.text });
      case 'strong':
        return el('strong', {}, renderInlines(inline.children));
      case 'em':
        return el('em', {}, renderInlines(inline.children));
      case 'link':
        return el(
          'a',
          { attrs: { href: inline.href, target: '_blank', rel: 'noopener noreferrer' } },
          renderInlines(inline.children),
        );
    }
  });
}
