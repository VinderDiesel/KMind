import type { BootstrapPlan, DigTask } from '@kmind/shared';

export const BOOTSTRAP_TREE_START = '<!-- kmind:bootstrap-dig-tasks:start -->';
export const BOOTSTRAP_TREE_END = '<!-- kmind:bootstrap-dig-tasks:end -->';

export interface ApplyFeatureTreeResult {
  next: string;
  action: 'created_section' | 'updated' | 'unchanged';
  rowsWritten: number;
}

/**
 * Upsert a FEATURE_TREE section from BootstrapPlan todo/done tasks.
 * Idempotent on task id; does not capture knowledge.
 */
export function applyBootstrapPlanToFeatureTree(
  existingMarkdown: string,
  plan: BootstrapPlan,
): ApplyFeatureTreeResult {
  const section = renderBootstrapSection(plan);
  const start = existingMarkdown.indexOf(BOOTSTRAP_TREE_START);
  const end = existingMarkdown.indexOf(BOOTSTRAP_TREE_END);

  if (start !== -1 && end !== -1 && end > start) {
    const previousSection = existingMarkdown.slice(
      start,
      end + BOOTSTRAP_TREE_END.length,
    );
    const before = existingMarkdown.slice(0, start);
    const after = existingMarkdown.slice(end + BOOTSTRAP_TREE_END.length);
    const next = `${before}${section}${trimLeadingNewlines(after)}`;
    // generatedAt changes on every run; ignore it so apply-tree stays idempotent.
    if (comparableSection(section) === comparableSection(previousSection)) {
      return { next: existingMarkdown, action: 'unchanged', rowsWritten: countTasks(plan) };
    }
    return {
      next: ensureTrailingNewline(next),
      action: 'updated',
      rowsWritten: countTasks(plan),
    };
  }

  const base = existingMarkdown.replace(/\s*$/, '');
  const next =
    base.length === 0
      ? ensureTrailingNewline(section)
      : `${base}\n\n${ensureTrailingNewline(section)}`;
  return {
    next,
    action: 'created_section',
    rowsWritten: countTasks(plan),
  };
}

function renderBootstrapSection(plan: BootstrapPlan): string {
  const lines: string[] = [
    BOOTSTRAP_TREE_START,
    '## Bootstrap dig tasks (ADR-004)',
    '',
    `project: \`${plan.project}\` · generated: ${plan.generatedAt}`,
    '',
    '| 功能点 | 候选 type | 关键路径 | 状态 |',
    '|--------|-----------|----------|------|',
  ];

  for (const group of plan.groups) {
    for (const task of group.tasks) {
      lines.push(renderRow(group.label, task));
    }
  }

  lines.push(BOOTSTRAP_TREE_END);
  return ensureTrailingNewline(lines.join('\n'));
}

function renderRow(groupLabel: string, task: DigTask): string {
  const status =
    task.status === 'done'
      ? `done${task.assetId ? ` \`${task.assetId}\`` : ''}`
      : task.status;
  const paths = task.paths.join(', ');
  const title = `${groupLabel}: ${task.titleHint}`.replace(/\|/g, '/');
  return `| ${title} | ${task.candidateType} | ${paths} | ${status} |`;
}

function countTasks(plan: BootstrapPlan): number {
  return plan.groups.reduce((n, g) => n + g.tasks.length, 0);
}

function ensureTrailingNewline(s: string): string {
  return s.endsWith('\n') ? s : `${s}\n`;
}

function trimLeadingNewlines(s: string): string {
  return s.replace(/^\n*/, '\n');
}

function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Whitespace-insensitive view that drops the per-run generatedAt stamp. */
function comparableSection(s: string): string {
  return collapseWs(s.replace(/generated:\s*[^\s|·]+/g, 'generated:'));
}
