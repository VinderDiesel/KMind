/** Edge colors by relation type (ego + legend). */
export const RELATION_COLOR: Record<string, string> = {
  part_of: '#5eead4',
  derives_from: '#8ab4f8',
  supersedes: '#c4a5f5',
  solves: '#6bcb8e',
  verifies: '#5eb0e8',
  results_in: '#9aa8b8',
  related_to: '#e8b86d',
  contradicts: '#f07178',
  mentions: '#7a8b9e',
};

const FALLBACK = 'rgba(122,139,158,0.4)';

/**
 * CSS/rgba color for a relation type.
 */
export function relationColor(relationType: string, alpha = 0.75): string {
  const hex = RELATION_COLOR[relationType] ?? '#7a8b9e';
  if (alpha >= 1) return hex;
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  if (Number.isNaN(r)) return FALLBACK;
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Ordered legend keys for ego edge types. */
export const RELATION_LEGEND = [
  'part_of',
  'derives_from',
  'supersedes',
  'solves',
  'verifies',
  'related_to',
  'contradicts',
] as const;
