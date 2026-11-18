import {
  BOOTSTRAP_DIG_PACKET_VERSION,
  BootstrapDigPacketSchema,
  type BootstrapDigPacket,
  type BootstrapPlan,
  type DigTask,
} from '@kmind/shared';

const DEFAULT_TOOLS = [
  'codegraph_explore',
  'kmind_pack',
  'kmind_capture_suggest',
  'kmind_capture',
  'kmind_bootstrap_mark',
  'kmind_coverage',
] as const;

export interface BuildDigPacketOptions {
  plan: BootstrapPlan;
  groupLabel: string;
  /** When true, omit status=done tasks from the packet. */
  skipDone?: boolean;
}

export interface DelegateGroupSummaryRow {
  label: string;
  priority: number;
  todoCount: number;
  doneCount: number;
  planNotes?: string;
}

export interface DelegateGroupsSummary {
  groups: DelegateGroupSummaryRow[];
  /** Highest-priority group that still has open tasks. */
  recommendedNext?: string;
  stats: {
    groupsOpen: number;
    tasksOpen: number;
    tasksDone: number;
  };
}

/**
 * Build a host-agent DigPacket for one DigGroup (ADR-004 Phase 3).
 */
export function resolveDigGroup(
  plan: BootstrapPlan,
  groupLabel: string,
): BootstrapPlan['groups'][number] | undefined {
  const want = groupLabel.trim();
  const exact = plan.groups.find((g) => g.label === want);
  if (exact) return exact;
  // Allow `--group packages/core` to hit `packages/core (1/2)`.
  const prefixed = plan.groups.filter(
    (g) => g.label === want || g.label.startsWith(`${want} (`),
  );
  if (prefixed.length === 1) return prefixed[0];
  if (prefixed.length > 1) {
    // Prefer highest-priority chunk when multiple match.
    return [...prefixed].sort((a, b) => b.priority - a.priority)[0];
  }
  return undefined;
}

export function buildDigPacket(
  options: BuildDigPacketOptions,
): BootstrapDigPacket {
  const group = resolveDigGroup(options.plan, options.groupLabel);
  if (!group) {
    throw new Error(`bootstrap delegate: unknown group ${options.groupLabel}`);
  }
  let tasks: DigTask[] = group.tasks;
  if (options.skipDone !== false) {
    tasks = tasks.filter((t) => t.status !== 'done');
  }
  const packet: BootstrapDigPacket = {
    version: BOOTSTRAP_DIG_PACKET_VERSION,
    project: options.plan.project,
    groupLabel: group.label,
    tasks,
    planNotes: group.planNotes,
    acceptance: {
      coverageTopicHint: `Run kmind_coverage project=${options.plan.project} topic=${group.label}`,
      typeMonoWarning:
        'If ≥4 architecture_design details and zero non-architecture cards, coverage type_mono blocks complete — add evidence-backed pitfall/tool_usage/problem when real.',
      completeClaimForbiddenUntil:
        'Do not claim knowledge complete until kmind_coverage returns complete=true / claimCompleteAllowed=true. Bootstrap/delegate output alone is never complete.',
    },
    toolsHint: [...DEFAULT_TOOLS],
  };
  return BootstrapDigPacketSchema.parse(packet);
}

/**
 * Highest-priority DigGroup label that still has non-done tasks.
 */
export function pickRecommendedNextGroup(
  plan: BootstrapPlan,
): string | undefined {
  const open = plan.groups
    .filter((g) => g.tasks.some((t) => t.status !== 'done'))
    .sort((a, b) => b.priority - a.priority);
  return open[0]?.label;
}

/**
 * Summarize groups for delegate listing (no full packets).
 */
export function summarizeDelegateGroups(
  plan: BootstrapPlan,
): DelegateGroupsSummary {
  const groups: DelegateGroupSummaryRow[] = plan.groups.map((g) => ({
    label: g.label,
    priority: g.priority,
    todoCount: g.tasks.filter((t) => t.status !== 'done').length,
    doneCount: g.tasks.filter((t) => t.status === 'done').length,
    planNotes: g.planNotes,
  }));
  const tasksOpen = groups.reduce((n, g) => n + g.todoCount, 0);
  const tasksDone = groups.reduce((n, g) => n + g.doneCount, 0);
  return {
    groups,
    recommendedNext: pickRecommendedNextGroup(plan),
    stats: {
      groupsOpen: groups.filter((g) => g.todoCount > 0).length,
      tasksOpen,
      tasksDone,
    },
  };
}
