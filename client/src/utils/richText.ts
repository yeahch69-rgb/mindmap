const HTML_TAG_RE = /<\/?(?:p|br|strong|b|em|i|s|del|u|h[1-6]|ul|ol|li|blockquote|span|div)(?:\s[^>]*)?>/i;

export function isHtmlContent(text?: string | null): boolean {
  if (!text) return false;
  return HTML_TAG_RE.test(text);
}
