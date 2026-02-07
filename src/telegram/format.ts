const HTML_ESCAPE_REGEX = /[&<>]/g;
const HTML_REPLACEMENTS: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

export function escapeTelegramHtml(text: string): string {
  return text.replace(HTML_ESCAPE_REGEX, (char) => HTML_REPLACEMENTS[char] ?? char);
}

export function renderHtmlMessage(text: string): string {
  const sanitized = text
    .split('\n')
    .map((line) => escapeTelegramHtml(line))
    .join('\n');
  return sanitized;
}
