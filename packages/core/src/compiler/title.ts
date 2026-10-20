/**
 * Normalize capture titles: strip markdown headings / multi-line junk.
 */
export function sanitizeTitle(raw: string, maxLen = 120): string {
  let t = raw.replace(/\r\n/g, '\n').trim();
  if (!t) return 'untitled';

  // Prefer first ATX heading if present.
  const heading = /^#+\s+(.+)$/m.exec(t);
  if (heading?.[1]) {
    t = heading[1].trim();
  } else {
    // First non-empty line, drop leading #.
    const first = t.split('\n').map((l) => l.trim()).find(Boolean) ?? t;
    t = first.replace(/^#+\s*/, '').trim();
  }

  t = t
    .replace(/#+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\-_=*]{3,}$/g, '')
    .trim();

  if (!t || /^[\-_=*]+$/.test(t)) return 'untitled';
  // Session-id shaped filenames make poor titles.
  if (/^(kiro|cursor|claude|codex|qoder)-sess[_-]/i.test(t)) {
    return 'untitled session';
  }
  return t.slice(0, maxLen);
}
