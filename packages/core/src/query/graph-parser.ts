export interface GraphPattern {
  leftVar: string;
  leftClass?: string;
  relation?: string;
  rightVar: string;
  rightClass?: string;
}

export interface ParsedGraphQuery {
  match: GraphPattern;
  where: Array<{ field: string; op: '=' | '>' | '<'; value: string | number }>;
  returns: string[];
  limit: number;
}

/**
 * Minimal Cypher-like parser supporting MATCH / WHERE / RETURN / LIMIT.
 */
export function parseGraphQuery(input: string): ParsedGraphQuery {
  const text = input.replace(/\s+/g, ' ').trim();
  const matchRe =
    /MATCH\s+\((\w+)(?::(\w+))?\)(?:-\[:(\w+)\]->\((\w+)(?::(\w+))?\))?/i;
  const m = text.match(matchRe);
  if (!m) {
    throw new Error('Invalid MATCH clause');
  }

  const match: GraphPattern = {
    leftVar: m[1]!,
    leftClass: m[2],
    relation: m[3],
    rightVar: m[4] ?? m[1]!,
    rightClass: m[5],
  };

  const where: ParsedGraphQuery['where'] = [];
  const whereMatch = text.match(/WHERE\s+(.+?)(?:\s+RETURN|\s+LIMIT|$)/i);
  if (whereMatch) {
    const parts = whereMatch[1]!.split(/\s+AND\s+/i);
    for (const part of parts) {
      const cond = part.trim().match(/(\w+)\.(\w+)\s*(=|>|<)\s*'?([^'\s]+)'?/);
      if (cond) {
        const raw = cond[4]!;
        const num = Number(raw);
        where.push({
          field: `${cond[1]}.${cond[2]}`,
          op: cond[3] as '=' | '>' | '<',
          value: Number.isFinite(num) && raw === String(num) ? num : raw,
        });
      }
    }
  }

  const retMatch = text.match(/RETURN\s+(.+?)(?:\s+LIMIT|$)/i);
  const returns = retMatch
    ? retMatch[1]!.split(',').map((s) => s.trim())
    : [match.leftVar];

  const limitMatch = text.match(/LIMIT\s+(\d+)/i);
  const limit = limitMatch ? Number(limitMatch[1]) : 20;

  return { match, where, returns, limit };
}
