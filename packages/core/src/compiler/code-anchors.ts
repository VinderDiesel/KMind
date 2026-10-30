import {
  CodeAnchorSchema,
  type CodeAnchor,
} from '@kmind/shared';

const ANCHOR_SECTION =
  /##\s*代码锚点\s*\n([\s\S]*?)(?=\n##\s|\n---\s*$|$)/i;

/** Bullet: `- `file` · `symbol` · kind` or `- file · symbol · kind` */
const BULLET_ANCHOR =
  /^[-*]\s*(?:`([^`]+)`|([^\s·•]+))\s*[·•]\s*(?:`([^`]+)`|(\S+))(?:\s*[·•]\s*(\w+))?/gm;

/** Inline path:foo.ts:L12 or path/foo.ts:12 */
const PATH_LINE =
  /(?:^|[\s(`])((?:[\w.@/-]+\/)+[\w.-]+\.[a-zA-Z0-9]+):L?(\d+)\b/g;

/**
 * Parse code anchors from markdown body and/or explicit list.
 * Never treats large code fences as anchors (structure citations only).
 */
export function extractCodeAnchors(
  body: string,
  explicit?: unknown,
): CodeAnchor[] {
  const byKey = new Map<string, CodeAnchor>();

  const push = (raw: Partial<CodeAnchor> & { file: string }) => {
    // Build payload without undefined keys — Zod keeps explicit `undefined`
    // values, and gray-matter/js-yaml then throws:
    // "unacceptable kind of an object to dump [object Undefined]".
    const payload: Record<string, unknown> = {
      file: raw.file.trim(),
      confidence: raw.confidence ?? 1,
    };
    const symbol = raw.symbol?.trim();
    const kind = raw.kind?.trim();
    const projectPath = raw.projectPath?.trim();
    if (symbol) payload.symbol = symbol;
    if (kind) payload.kind = kind;
    if (typeof raw.line === 'number' && Number.isFinite(raw.line)) {
      payload.line = raw.line;
    }
    if (projectPath) payload.projectPath = projectPath;
    const parsed = CodeAnchorSchema.safeParse(payload);
    if (!parsed.success) return;
    const a = stripUndefinedKeys(parsed.data);
    const key = `${a.file}|${a.symbol ?? ''}|${a.line ?? ''}`;
    if (!byKey.has(key)) byKey.set(key, a);
  };

  if (Array.isArray(explicit)) {
    for (const item of explicit) {
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        if (typeof o.file === 'string') {
          push({
            file: o.file,
            symbol: typeof o.symbol === 'string' ? o.symbol : undefined,
            kind: typeof o.kind === 'string' ? o.kind : undefined,
            line: typeof o.line === 'number' ? o.line : undefined,
            projectPath:
              typeof o.projectPath === 'string' ? o.projectPath : undefined,
            confidence: typeof o.confidence === 'number' ? o.confidence : 1,
          });
        }
      }
    }
  }

  const section = ANCHOR_SECTION.exec(body);
  if (section?.[1]) {
    BULLET_ANCHOR.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = BULLET_ANCHOR.exec(section[1])) !== null) {
      const file = (m[1] ?? m[2] ?? '').trim();
      const symbol = (m[3] ?? m[4] ?? '').trim();
      const kind = m[5]?.trim();
      if (file) push({ file, symbol: symbol || undefined, kind });
    }
  }

  PATH_LINE.lastIndex = 0;
  let pm: RegExpExecArray | null;
  while ((pm = PATH_LINE.exec(body)) !== null) {
    const file = pm[1]!;
    const line = Number.parseInt(pm[2]!, 10);
    if (file && Number.isFinite(line)) push({ file, line, confidence: 0.85 });
  }

  return [...byKey.values()].slice(0, 40);
}

/**
 * Read codeAnchors from asset metadata (validated).
 */
export function readCodeAnchors(
  metadata: Record<string, unknown> | undefined,
): CodeAnchor[] {
  const raw = metadata?.codeAnchors;
  if (!Array.isArray(raw)) return [];
  const out: CodeAnchor[] = [];
  for (const item of raw) {
    const parsed = CodeAnchorSchema.safeParse(item);
    if (parsed.success) out.push(stripUndefinedKeys(parsed.data));
  }
  return out;
}

/** Drop keys whose value is `undefined` (YAML-safe for gray-matter). */
function stripUndefinedKeys(anchor: CodeAnchor): CodeAnchor {
  const out: CodeAnchor = {
    file: anchor.file,
    confidence: anchor.confidence,
  };
  if (anchor.symbol !== undefined) out.symbol = anchor.symbol;
  if (anchor.kind !== undefined) out.kind = anchor.kind;
  if (anchor.line !== undefined) out.line = anchor.line;
  if (anchor.projectPath !== undefined) out.projectPath = anchor.projectPath;
  return out;
}

/**
 * Merge extracted anchors into metadata without wiping other keys.
 */
export function withCodeAnchorsMetadata(
  metadata: Record<string, unknown>,
  anchors: CodeAnchor[],
): Record<string, unknown> {
  if (anchors.length === 0) return { ...metadata };
  return { ...metadata, codeAnchors: anchors };
}

/**
 * Ensure metadata.codeAnchors includes anchors parsed from body (+ existing).
 * Used by compile, reindex/backfill so UI/health match ## 代码锚点.
 */
export function enrichAssetCodeAnchors<
  T extends { body: string; metadata?: Record<string, unknown> },
>(asset: T): T {
  const existing = readCodeAnchors(asset.metadata);
  const fromBody = extractCodeAnchors(asset.body, existing);
  if (fromBody.length === 0 && existing.length === 0) return asset;
  const merged =
    fromBody.length > 0
      ? fromBody
      : existing.map((a) => stripUndefinedKeys(a));
  return {
    ...asset,
    metadata: withCodeAnchorsMetadata(asset.metadata ?? {}, merged),
  };
}

/**
 * True when metadata or body cites code anchors (YAML-safe metadata preferred).
 */
export function assetHasCodeAnchors(
  body: string,
  metadata?: Record<string, unknown>,
): boolean {
  if (readCodeAnchors(metadata).length > 0) return true;
  return extractCodeAnchors(body).length > 0;
}
