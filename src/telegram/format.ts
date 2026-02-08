const LANGUAGE_ID_PATTERN = /^[\w.+-]+$/;
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tg:', 'ftp:', 'tel:']);

interface InlineCodeMatch {
  code: string;
  nextIndex: number;
}

interface DelimitedMatch {
  content: string;
  nextIndex: number;
}

interface LinkMatch {
  label: string;
  url: string;
  nextIndex: number;
}

export function renderTelegramHtmlText(markdown: string): string {
  if (!markdown) {
    return '';
  }

  let result = '';
  const codeBlockRegex = /```([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;

  while ((match = codeBlockRegex.exec(markdown)) !== null) {
    result += renderInlineSegment(markdown.slice(lastIndex, match.index));
    result += renderCodeBlock(match[1]);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < markdown.length) {
    result += renderInlineSegment(markdown.slice(lastIndex));
  }

  return result;
}

export function renderHtmlMessage(text: string): string {
  return renderTelegramHtmlText(text);
}

export function escapeTelegramHtml(text: string): string {
  return escapeHtml(text);
}

function renderCodeBlock(rawBlock: string): string {
  let content = rawBlock;

  if (!content.startsWith('\n') && !content.startsWith('\r\n')) {
    const newlineIndex = content.indexOf('\n');
    if (newlineIndex !== -1) {
      const firstLine = content.slice(0, newlineIndex).replace(/\r$/, '');
      if (firstLine && LANGUAGE_ID_PATTERN.test(firstLine.trim())) {
        content = content.slice(newlineIndex + 1);
      }
    }
  }

  if (content.startsWith('\r\n')) {
    content = content.slice(2);
  } else if (content.startsWith('\n')) {
    content = content.slice(1);
  }

  return `<pre><code>${escapeHtml(content)}</code></pre>`;
}

function renderInlineSegment(segment: string): string {
  if (!segment) {
    return '';
  }

  let result = '';
  let i = 0;

  while (i < segment.length) {
    const char = segment[i];

    if (char === '\\') {
      if (i + 1 < segment.length) {
        result += escapeHtml(segment[i + 1]);
        i += 2;
      } else {
        result += escapeHtml('\\');
        i += 1;
      }
      continue;
    }

    if (char === '`') {
      const inlineCode = consumeInlineCode(segment, i);
      if (inlineCode) {
        result += `<code>${escapeHtml(inlineCode.code)}</code>`;
        i = inlineCode.nextIndex;
        continue;
      }
    }

    if (char === '[') {
      const link = consumeLink(segment, i);
      if (link) {
        const safeUrl = sanitizeUrl(link.url);
        if (safeUrl) {
          result += `<a href="${escapeHtml(safeUrl)}">${renderInlineSegment(link.label)}</a>`;
          i = link.nextIndex;
          continue;
        }
      }
    }

    if (segment.startsWith('~~', i)) {
      const strikeMatch = consumeDelimited(segment, i, '~~');
      if (strikeMatch) {
        result += `<s>${renderInlineSegment(strikeMatch.content)}</s>`;
        i = strikeMatch.nextIndex;
        continue;
      }
    }

    if (segment.startsWith('**', i)) {
      const boldMatch = consumeDelimited(segment, i, '**');
      if (boldMatch) {
        result += `<b>${renderInlineSegment(boldMatch.content)}</b>`;
        i = boldMatch.nextIndex;
        continue;
      }
    }

    if (segment.startsWith('__', i)) {
      const boldMatch = consumeDelimited(segment, i, '__');
      if (boldMatch) {
        result += `<b>${renderInlineSegment(boldMatch.content)}</b>`;
        i = boldMatch.nextIndex;
        continue;
      }
    }

    if (char === '*') {
      const italicMatch = consumeDelimited(segment, i, '*');
      if (italicMatch) {
        result += `<i>${renderInlineSegment(italicMatch.content)}</i>`;
        i = italicMatch.nextIndex;
        continue;
      }
    }

    if (char === '_') {
      const italicMatch = consumeDelimited(segment, i, '_');
      if (italicMatch) {
        result += `<i>${renderInlineSegment(italicMatch.content)}</i>`;
        i = italicMatch.nextIndex;
        continue;
      }
    }

    result += escapeHtml(char);
    i += 1;
  }

  return result;
}

function consumeInlineCode(text: string, start: number): InlineCodeMatch | null {
  let index = start + 1;

  while (index < text.length) {
    if (text[index] === '`' && !isEscaped(text, index)) {
      return { code: text.slice(start + 1, index), nextIndex: index + 1 };
    }
    index += 1;
  }

  return null;
}

function consumeDelimited(text: string, start: number, marker: string): DelimitedMatch | null {
  if (!text.startsWith(marker, start)) {
    return null;
  }

  let searchIndex = start + marker.length;

  while (searchIndex < text.length) {
    const nextIndex = text.indexOf(marker, searchIndex);
    if (nextIndex === -1) {
      return null;
    }

    if (!isEscaped(text, nextIndex)) {
      const content = text.slice(start + marker.length, nextIndex);
      if (!content.trim()) {
        return null;
      }

      return { content, nextIndex: nextIndex + marker.length };
    }

    searchIndex = nextIndex + marker.length;
  }

  return null;
}

function consumeLink(text: string, start: number): LinkMatch | null {
  const closingBracket = findClosingBracket(text, start);
  if (closingBracket === -1) {
    return null;
  }

  const parenStart = closingBracket + 1;
  if (parenStart >= text.length || text[parenStart] !== '(') {
    return null;
  }

  const closingParen = findClosingParen(text, parenStart);
  if (closingParen === -1) {
    return null;
  }

  const label = text.slice(start + 1, closingBracket);
  const url = text.slice(parenStart + 1, closingParen).trim();

  if (!label) {
    return null;
  }

  return { label, url, nextIndex: closingParen + 1 };
}

function findClosingBracket(text: string, start: number): number {
  let depth = 0;

  for (let i = start + 1; i < text.length; i += 1) {
    const char = text[i];

    if (char === '[' && !isEscaped(text, i)) {
      depth += 1;
      continue;
    }

    if (char === ']' && !isEscaped(text, i)) {
      if (depth === 0) {
        return i;
      }
      depth -= 1;
    }
  }

  return -1;
}

function findClosingParen(text: string, start: number): number {
  let depth = 0;

  for (let i = start + 1; i < text.length; i += 1) {
    const char = text[i];

    if (char === '(' && !isEscaped(text, i)) {
      depth += 1;
      continue;
    }

    if (char === ')' && !isEscaped(text, i)) {
      if (depth === 0) {
        return i;
      }
      depth -= 1;
    }
  }

  return -1;
}

function sanitizeUrl(rawUrl: string): string | null {
  if (!rawUrl) {
    return null;
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:')) {
    return null;
  }

  const schemeMatch = trimmed.match(/^([a-z0-9+.-]+):/i);
  if (schemeMatch && !ALLOWED_PROTOCOLS.has(`${schemeMatch[1].toLowerCase()}:`)) {
    return null;
  }

  return trimmed;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return ch;
    }
  });
}

function isEscaped(text: string, index: number): boolean {
  let slashCount = 0;
  let i = index - 1;
  while (i >= 0 && text[i] === '\\') {
    slashCount += 1;
    i -= 1;
  }
  return slashCount % 2 === 1;
}
