/** Parte de um texto de chat: texto puro ou link http/https (o resto nunca vira link nem HTML). */
export type TextPart = { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string };

const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"»]+$/;

/** Divide o texto em pedaços; só URLs http/https válidas viram links. */
export function linkify(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    let url = match[0];
    const trailing = url.match(TRAILING_PUNCTUATION)?.[0] ?? '';
    url = url.slice(0, url.length - trailing.length);
    const start = match.index ?? 0;
    if (start > last) parts.push({ kind: 'text', text: text.slice(last, start) });
    const href = safeHref(url);
    parts.push(href ? { kind: 'link', text: url, href } : { kind: 'text', text: url });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts;
}

function safeHref(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
