import type { ReactNode } from 'react';

/**
 * Minimal Markdown renderer for knowledge bodies (no heavy deps).
 * Supports headings, lists, bold/code, fenced blocks, paragraphs.
 */
export function FocusMarkdown({ source }: { source: string }) {
  const blocks = parseBlocks(source.trim());
  return (
    <div className="md-body">
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'h2':
            return <h3 key={i}>{inline(b.text)}</h3>;
          case 'h3':
            return <h4 key={i}>{inline(b.text)}</h4>;
          case 'pre':
            return (
              <pre key={i}>
                <code>{b.text}</code>
              </pre>
            );
          case 'ul':
            return (
              <ul key={i}>
                {b.items.map((item, j) => (
                  <li key={j}>{inline(item)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i}>
                {b.items.map((item, j) => (
                  <li key={j}>{inline(item)}</li>
                ))}
              </ol>
            );
          case 'p':
            return <p key={i}>{inline(b.text)}</p>;
          default:
            return null;
        }
      })}
    </div>
  );
}

type Block =
  | { type: 'h2' | 'h3' | 'p' | 'pre'; text: string }
  | { type: 'ul' | 'ol'; items: string[] };

function parseBlocks(src: string): Block[] {
  const lines = src.split('\n');
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.startsWith('```')) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) {
        buf.push(lines[i] ?? '');
        i += 1;
      }
      i += 1;
      out.push({ type: 'pre', text: buf.join('\n') });
      continue;
    }
    if (/^##\s+/.test(line)) {
      out.push({ type: 'h2', text: line.replace(/^##\s+/, '') });
      i += 1;
      continue;
    }
    if (/^###\s+/.test(line)) {
      out.push({ type: 'h3', text: line.replace(/^###\s+/, '') });
      i += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^\s*[-*]\s+/, ''));
        i += 1;
      }
      out.push({ type: 'ul', items });
      continue;
    }
    if (/^\s*\d+[.)、]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)、]\s+/.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^\s*\d+[.)、]\s+/, ''));
        i += 1;
      }
      out.push({ type: 'ol', items });
      continue;
    }
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const buf: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() &&
      !/^(##|###|\s*[-*]|\s*\d+[.)、]|```)/.test(lines[i] ?? '')
    ) {
      buf.push(lines[i] ?? '');
      i += 1;
    }
    out.push({ type: 'p', text: buf.join(' ') });
  }
  return out;
}

function inline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith('**')) {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else {
      parts.push(<code key={key++}>{token.slice(1, -1)}</code>);
    }
    last = m.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : text;
}
