#!/usr/bin/env node
import { Command } from 'commander';
import { resolveContext } from './context.js';
import { fail } from './exit.js';
import { cmdInit } from './commands/init.js';
import { cmdFeatureTreeEnsure } from './commands/feature-tree-cmd.js';
import { cmdCompile } from './commands/compile.js';
import { cmdSearch } from './commands/search.js';
import { cmdPack } from './commands/pack.js';
import { cmdSuggestCapture } from './commands/suggest-capture.js';
import { cmdCapture } from './commands/capture.js';
import {
  cmdCaptureCommit,
  cmdCapturePropose,
} from './commands/capture-propose.js';
import { cmdLint } from './commands/lint.js';
import { cmdExport } from './commands/export.js';
import { cmdImport } from './commands/import.js';
import { cmdMcpServe } from './commands/mcp-serve.js';
import { cmdAdaptersInstall, cmdAdaptersList } from './commands/adapters.js';
import { cmdSkillsInstall, cmdSkillsList } from './commands/skills.js';
import { cmdHook } from './commands/hook.js';
import { cmdReindex } from './commands/reindex.js';
import { cmdUi } from './commands/ui.js';
import { cmdPurgeSessions } from './commands/purge-sessions.js';
import { cmdExpiry } from './commands/expiry.js';
import { cmdCoverage } from './commands/coverage.js';
import { cmdRecallStats } from './commands/recall-stats.js';
import { cmdRecallFeedback } from './commands/recall-feedback.js';
import {
  cmdBootstrapApplyTree,
  cmdBootstrapDelegate,
  cmdBootstrapMark,
  cmdBootstrapPreview,
  cmdBootstrapRun,
  cmdBootstrapStatus,
  cmdBootstrapSyncTree,
} from './commands/bootstrap.js';
import {
  cmdLlmSet,
  cmdLlmStatus,
  cmdLlmTest,
  llmOverridesFromFlags,
} from './commands/llm.js';
import {
  cmdLlmModelInteractive,
  cmdLlmProviderInteractive,
} from './commands/llm-interactive.js';
import {
  cmdScheduleList,
  cmdScheduleRun,
  cmdScheduleSet,
  cmdScheduleStart,
  cmdScheduleStatus,
  cmdScheduleStop,
  cmdScheduleUnset,
} from './commands/schedule.js';
import {
  cmdEvolutionAck,
  cmdEvolutionScan,
  cmdEvolutionStatus,
} from './commands/evolution.js';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const program = new Command();

program
  .name('kmind')
  .description('Local-first knowledge management for AI coding terminals')
  .version('0.1.0')
  .option('--json', 'Machine-readable JSON output', false)
  .option('--vault <path>', 'Vault root path');

program
  .command('init')
  .description('Initialize a KMind vault')
  .option(
    '--project',
    'Create .kmind-knowledge/ in the git repo (team share) + FEATURE_TREE + AGENTS + hooks',
    false,
  )
  .action(async (cmdOpts: { project?: boolean }) => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await resolveContext({
        vault: opts.vault,
        json: opts.json,
        allowMissing: true,
      });
      await cmdInit(ctx, { project: cmdOpts.project });
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

const featureTreeCmd = program
  .command('feature-tree')
  .description('Project FEATURE_TREE.md helpers');

featureTreeCmd
  .command('ensure')
  .description(
    'Ensure vault FEATURE_TREE.md exists (create or refresh guide block)',
  )
  .action(async () => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await resolveContext({
        vault: opts.vault,
        json: opts.json,
        allowMissing: true,
      });
      await cmdFeatureTreeEnsure(ctx);
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

const bootstrapCmd = program
  .command('bootstrap')
  .description(
    'Knowledge-init: deterministic plan by default (ADR-004); --write runs LLM dig + capture (ADR-005)',
  );

bootstrapCmd
  .command('run')
  .description(
    'One-shot init: vault files → reindex → plan → FEATURE_TREE → coverage；--write 额外执行 LLM 扫描、质量闸门与写入知识库',
  )
  .requiredOption('--project <name>', 'Project name (required, not global)')
  .option('--repo <path>', 'Code repo root (default: vault code root)')
  .option('--no-tree', 'Skip writing FEATURE_TREE bootstrap rows')
  .option('--no-reindex', 'Skip rebuilding the sqlite index')
  .option('--topic <t>', 'Topic filter for the coverage summary')
  .option('--write', 'ADR-005: LLM dig + quality gate + capture knowledge bodies', false)
  .option('--dry-run', 'Dig and quality-check with the LLM, but write nothing', false)
  .option('--group <label>', 'Only dig this DigGroup label')
  .option('--max-tasks <n>', 'Cap tasks in this run')
  .option('--max-cards <n>', 'Cards requested per task (1-4, default 2)')
  .option('--min-confidence <n>', 'Skip cards below this confidence (0-1, default 0.55)')
  .option('--no-repair', 'Disable the one-shot LLM repair attempt')
  .option('--provider <p>', 'LLM provider: ollama | openai | openai-compatible | anthropic | azure-openai')
  .option('--model <m>', 'LLM model id (overrides config)')
  .option('--base-url <url>', 'Custom OpenAI-format endpoint, e.g. https://gateway/v1 (overrides config)')
  .option('--api-key-env <name>', 'Env var holding the API key (never persisted)')
  .action(
    async (cmdOpts: {
      project: string;
      repo?: string;
      tree?: boolean;
      reindex?: boolean;
      topic?: string;
      write?: boolean;
      dryRun?: boolean;
      group?: string;
      maxTasks?: string;
      maxCards?: string;
      minConfidence?: string;
      repair?: boolean;
      provider?: string;
      model?: string;
      baseUrl?: string;
      apiKeyEnv?: string;
    }) => {
      const opts = program.opts<{ json?: boolean; vault?: string }>();
      try {
        const ctx = await withVaultOrPrompt(opts);
        await cmdBootstrapRun(ctx, {
          project: cmdOpts.project,
          repo: cmdOpts.repo,
          tree: cmdOpts.tree,
          reindex: cmdOpts.reindex,
          topic: cmdOpts.topic,
          write: cmdOpts.write,
          dryRun: cmdOpts.dryRun,
          group: cmdOpts.group,
          maxTasks: toNumeric(cmdOpts.maxTasks),
          maxCardsPerTask: toNumeric(cmdOpts.maxCards),
          minConfidence: toNumeric(cmdOpts.minConfidence),
          repair: cmdOpts.repair,
          provider: cmdOpts.provider,
          model: cmdOpts.model,
          baseUrl: cmdOpts.baseUrl,
          apiKeyEnv: cmdOpts.apiKeyEnv,
        });
        ctx.store.close();
      } catch (err) {
        fail(err, opts.json);
      }
    },
  );

bootstrapCmd
  .command('preview')
  .description('Preview DigGroup/DigTask plan for a repo (read-only)')
  .requiredOption('--project <name>', 'Project name (required, not global)')
  .option('--repo <path>', 'Code repo root (default: vault code root)')
  .action(async (cmdOpts: { project: string; repo?: string }) => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await withVaultOrPrompt(opts);
      await cmdBootstrapPreview(ctx, {
        project: cmdOpts.project,
        repo: cmdOpts.repo,
      });
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

bootstrapCmd
  .command('apply-tree')
  .description(
    'Write bootstrap dig rows into FEATURE_TREE.md (todo checklist; no capture)',
  )
  .requiredOption('--project <name>', 'Project name (required, not global)')
  .option('--repo <path>', 'Code repo root (default: vault code root)')
  .action(async (cmdOpts: { project: string; repo?: string }) => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await withVaultOrPrompt(opts);
      await cmdBootstrapApplyTree(ctx, {
        project: cmdOpts.project,
        repo: cmdOpts.repo,
      });
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

bootstrapCmd
  .command('sync-tree')
  .description(
    'Re-apply FEATURE_TREE bootstrap section with progress-merged statuses',
  )
  .requiredOption('--project <name>', 'Project name (required, not global)')
  .option('--repo <path>', 'Code repo root (default: vault code root)')
  .action(async (cmdOpts: { project: string; repo?: string }) => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await withVaultOrPrompt(opts);
      await cmdBootstrapSyncTree(ctx, {
        project: cmdOpts.project,
        repo: cmdOpts.repo,
      });
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

bootstrapCmd
  .command('status')
  .description('Show persisted bootstrap dig progress (audit/)')
  .requiredOption('--project <name>', 'Project name (required, not global)')
  .action(async (cmdOpts: { project: string }) => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await withVaultOrPrompt(opts);
      await cmdBootstrapStatus(ctx, { project: cmdOpts.project });
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

bootstrapCmd
  .command('mark')
  .description('Mark a DigTask status in bootstrap progress (no capture)')
  .requiredOption('--project <name>', 'Project name')
  .requiredOption('--task <id>', 'DigTask id (e.g. dig-packages-core-storage)')
  .requiredOption('--status <s>', 'todo | capturing | done')
  .option('--asset <id>', 'Asset id when marking done')
  .option('--repo <path>', 'Code repo root')
  .action(
    async (cmdOpts: {
      project: string;
      task: string;
      status: string;
      asset?: string;
      repo?: string;
    }) => {
      const opts = program.opts<{ json?: boolean; vault?: string }>();
      try {
        const ctx = await withVaultOrPrompt(opts);
        await cmdBootstrapMark(ctx, cmdOpts);
        ctx.store.close();
      } catch (err) {
        fail(err, opts.json);
      }
    },
  );

bootstrapCmd
  .command('delegate')
  .description(
    'Emit DigPacket for host-agent dig (list groups or --group packet)',
  )
  .requiredOption('--project <name>', 'Project name')
  .option('--group <label>', 'DigGroup label for a DigPacket')
  .option('--repo <path>', 'Code repo root')
  .action(
    async (cmdOpts: { project: string; group?: string; repo?: string }) => {
      const opts = program.opts<{ json?: boolean; vault?: string }>();
      try {
        const ctx = await withVaultOrPrompt(opts);
        await cmdBootstrapDelegate(ctx, cmdOpts);
        ctx.store.close();
      } catch (err) {
        fail(err, opts.json);
      }
    },
  );

program
  .command('compile')
  .description('Compile raw sessions into knowledge assets')
  .option('--incremental', 'Skip unchanged raw files', true)
  .option('--no-incremental', 'Force process all raw files')
  .option('--project <name>', 'Project name')
  .option('--force', 'Ignore hashes and force recompile', false)
  .action(async (cmdOpts) => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await withVaultOrPrompt(opts);
      await cmdCompile(ctx, cmdOpts);
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

program
  .command('search')
  .description('Hybrid search knowledge base')
  .argument('<query>', 'Search query')
  .option('--type <t>', 'Knowledge type filter')
  .option('--limit <n>', 'Max results', '10')
  .option('--project <name>', 'Project filter')
  .action(async (query, cmdOpts) => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await withVaultOrPrompt(opts);
      await cmdSearch(ctx, query, {
        type: cmdOpts.type,
        limit: Number(cmdOpts.limit),
        project: cmdOpts.project,
      });
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

program
  .command('pack')
  .description('Context Pack: focus + neighborhood + anchors (ADR-002)')
  .argument('[query]', 'Search query (optional if --id)')
  .option('--id <id>', 'Exact asset id (k-YYYY-MM-DD-NNN)')
  .option('--type <t>', 'Type filter when resolving via search')
  .option('--project <name>', 'Project filter')
  .option('--depth <n>', 'Ego hop depth (1-3)', '1')
  .option('--neighbor-cap <n>', 'Max neighborhood nodes', '24')
  .action(async (query, cmdOpts) => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await withVaultOrPrompt(opts);
      await cmdPack(ctx, {
        id: cmdOpts.id,
        query: query || undefined,
        type: cmdOpts.type,
        project: cmdOpts.project,
        depth: Number(cmdOpts.depth),
        neighborCap: Number(cmdOpts.neighborCap),
      });
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

program
  .command('suggest-capture')
  .description(
    'Smart-write suggestions without writing (ADR-002); confirm then kmind capture',
  )
  .argument('<content>', 'Draft content to analyze')
  .option('--type <t>', 'Knowledge type hint')
  .option('--title <title>', 'Title')
  .option('--project <name>', 'Project')
  .option(
    '--anchors <json>',
    'Code anchors JSON array, e.g. \'[{"file":"a.ts","symbol":"foo"}]\'',
  )
  .option(
    '--related <ids>',
    'Comma-separated related asset ids (k-YYYY-MM-DD-NNN)',
  )
  .option(
    '--links <json>',
    'Typed links JSON, e.g. \'[{"id":"k-…-001","relation":"solves"}]\'',
  )
  .action(async (content, cmdOpts) => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await withVaultOrPrompt(opts);
      await cmdSuggestCapture(ctx, content, cmdOpts);
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

program
  .command('capture')
  .description('Manually capture knowledge')
  .argument('<content>', 'Content to capture')
  .option('--type <t>', 'Knowledge type')
  .option('--title <title>', 'Title')
  .option('--project <name>', 'Project')
  .option(
    '--anchors <json>',
    'Code anchors JSON array, e.g. \'[{"file":"a.ts","symbol":"foo"}]\'',
  )
  .option(
    '--related <ids>',
    'Comma-separated related asset ids (k-YYYY-MM-DD-NNN)',
  )
  .option(
    '--links <json>',
    'Typed links JSON, e.g. \'[{"id":"k-…-001","relation":"solves"}]\'',
  )
  .option(
    '--bootstrap-task <id>',
    'After successful capture, mark DigTask done in bootstrap progress',
  )
  .action(async (content, cmdOpts) => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await withVaultOrPrompt(opts);
      await cmdCapture(ctx, content, cmdOpts);
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

program
  .command('capture-propose')
  .description(
    'ADR-002 stage capture proposal under audit/ (no knowledge write)',
  )
  .argument('<content>', 'Content to stage')
  .option('--type <t>', 'Knowledge type')
  .option('--title <title>', 'Title')
  .requiredOption('--project <name>', 'Project')
  .option(
    '--anchors <json>',
    'Code anchors JSON array, e.g. \'[{"file":"a.ts","symbol":"foo"}]\'',
  )
  .option('--related <ids>', 'Comma-separated related asset ids (k-YYYY-MM-DD-NNN)')
  .option(
    '--links <json>',
    'Typed links JSON, e.g. \'[{"id":"k-…-001","relation":"solves"}]\'',
  )
  .option('--bootstrap-task <id>', 'DigTask id to mark on later commit')
  .action(async (content, cmdOpts) => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await withVaultOrPrompt(opts);
      await cmdCapturePropose(ctx, content, cmdOpts);
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

program
  .command('capture-commit')
  .description('ADR-002 commit a staged capture proposal by id')
  .argument('<proposalId>', 'Proposal id from capture-propose')
  .action(async (proposalId: string) => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await withVaultOrPrompt(opts);
      await cmdCaptureCommit(ctx, proposalId);
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

program
  .command('purge-sessions')
  .description(
    'Remove session-derived knowledge assets (keep manual captures and raw/)',
  )
  .option('--dry-run', 'Report matches without deleting', false)
  .action(async (cmdOpts) => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await withVaultOrPrompt(opts);
      await cmdPurgeSessions(ctx, { dryRun: Boolean(cmdOpts.dryRun) });
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

program
  .command('expiry')
  .description(
    'Retire expired knowledge cards: list | deprecate | supersede | refresh | deprecate-all',
  )
  .argument(
    '<action>',
    'list | deprecate | supersede | refresh | deprecate-all',
  )
  .option('--id <assetId>', 'Target expired asset id')
  .option('--by <assetId>', 'Replacement asset id (supersede)')
  .option('--project <name>', 'Project scope (list / deprecate-all)')
  .option('--expires-at <iso>', 'New expiresAt for refresh (omit to clear)')
  .option('--dry-run', 'Report without writing', false)
  .action(async (action, cmdOpts) => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await withVaultOrPrompt(opts);
      await cmdExpiry(ctx, {
        action: String(action),
        id: cmdOpts.id,
        by: cmdOpts.by,
        project: cmdOpts.project,
        expiresAt: cmdOpts.expiresAt,
        dryRun: Boolean(cmdOpts.dryRun),
      });
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

program
  .command('lint')
  .description('Run health checks')
  .action(async () => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await withVaultOrPrompt(opts);
      await cmdLint(ctx);
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

for (const name of ['coverage', 'quality'] as const) {
  program
    .command(name)
    .description(
      name === 'quality'
        ? 'Three-dimension knowledge quality (coverage/content/diversity scores); same as coverage + quality block'
        : 'Assess whether a project/topic is dug deep (not catalog-only). Do not claim complete unless complete=true',
    )
    .requiredOption('--project <name>', 'Project scope')
    .option('--topic <t>', 'Topic filter (e.g. 问数)')
    .option('--hub-id <id>', 'Overview asset id to score')
    .action(async (cmdOpts) => {
      const opts = program.opts<{ json?: boolean; vault?: string }>();
      try {
        const ctx = await withVaultOrPrompt(opts);
        await cmdCoverage(ctx, {
          project: cmdOpts.project,
          topic: cmdOpts.topic,
          hubId: cmdOpts.hubId,
        });
        ctx.store.close();
      } catch (err) {
        fail(err, opts.json);
      }
    });
}

program
  .command('recall-stats')
  .description(
    'ADR-002 local recall stats from audit/search-queries (emptyRate, pack vs search)',
  )
  .option('--project <name>', 'Optional project filter')
  .option('--window-hours <n>', 'Lookback hours (1–168)', '24')
  .action(async (cmdOpts: { project?: string; windowHours?: string }) => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await withVaultOrPrompt(opts);
      await cmdRecallStats(ctx, {
        project: cmdOpts.project,
        windowHours: Number(cmdOpts.windowHours),
      });
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

program
  .command('recall-feedback')
  .description(
    'Record local pack/search usefulness feedback (audit JSONL only; never writes knowledge)',
  )
  .requiredOption('--useful <bool>', 'true|false')
  .option('--focus-id <id>', 'Pack focus asset id')
  .option('--query <q>', 'Original query string')
  .option('--note <text>', 'Optional short note')
  .action(
    async (cmdOpts: {
      useful: string;
      focusId?: string;
      query?: string;
      note?: string;
    }) => {
      const opts = program.opts<{ json?: boolean; vault?: string }>();
      const usefulRaw = String(cmdOpts.useful).trim().toLowerCase();
      if (usefulRaw !== 'true' && usefulRaw !== 'false') {
        fail(new Error('--useful must be true|false'), opts.json);
      }
      try {
        const ctx = await withVaultOrPrompt(opts);
        await cmdRecallFeedback(ctx, {
          useful: usefulRaw === 'true',
          focusId: cmdOpts.focusId,
          query: cmdOpts.query,
          note: cmdOpts.note,
        });
        ctx.store.close();
      } catch (err) {
        fail(err, opts.json);
      }
    },
  );

program
  .command('export')
  .description('Export vault')
  .requiredOption('--output <path>', 'Output path')
  .option('--format <fmt>', 'tar.gz or git', 'tar.gz')
  .option('--project <names...>', 'Filter by project (repeatable / comma)')
  .option('--type <types...>', 'Filter by knowledge type')
  .option('--init-git', 'When format=git, run git init + initial commit', false)
  .action(async (cmdOpts) => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await withVaultOrPrompt(opts);
      await cmdExport(ctx, cmdOpts);
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

program
  .command('import')
  .description('Import vault from tar.gz or git directory')
  .requiredOption('--input <path>', 'Input archive or directory')
  .option('--format <fmt>', 'tar.gz or git (auto-detect by extension)', '')
  .option('--merge', 'Merge with existing', false)
  .option(
    '--conflict <policy>',
    'On id conflict when merging: skip | overwrite | rename',
    'skip',
  )
  .action(async (cmdOpts) => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await withVaultOrPrompt(opts);
      await cmdImport(ctx, {
        ...cmdOpts,
        format: cmdOpts.format || undefined,
      });
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

program
  .command('mcp-serve')
  .description(
    'Start MCP server (stdio for IDE; --daemon for background HTTP)',
  )
  .option('--stdio', 'Force stdio transport (foreground)', false)
  .option('--http', 'Streamable HTTP transport (foreground)', false)
  .option('--daemon', 'Background HTTP MCP (writes pid under ~/.kmind/run)', false)
  .option('--stop', 'Stop background HTTP MCP daemon', false)
  .option('--status', 'Show background HTTP MCP daemon status', false)
  .option('--host <host>', 'HTTP bind host', '127.0.0.1')
  .option('--port <n>', 'HTTP port (default 7822)', String(7822))
  .action(async (cmdOpts) => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      await cmdMcpServe({
        vault: opts.vault,
        json: opts.json,
        stdio: Boolean(cmdOpts.stdio),
        http: Boolean(cmdOpts.http),
        daemon: Boolean(cmdOpts.daemon),
        stop: Boolean(cmdOpts.stop),
        status: Boolean(cmdOpts.status),
        host: cmdOpts.host,
        port: Number(cmdOpts.port),
      });
    } catch (err) {
      fail(err, opts.json ?? false);
    }
  });

program
  .command('ui')
  .description('Open local read-only knowledge UI (127.0.0.1)')
  .option('--port <n>', 'Port (default 7821)', '7821')
  .option('--focus <id>', 'Open with focus asset id')
  .option('--no-open', 'Do not open browser')
  .action(async (cmdOpts) => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await withVaultOrPrompt(opts);
      await cmdUi(ctx, {
        port: Number(cmdOpts.port),
        focus: cmdOpts.focus as string | undefined,
        open: cmdOpts.open as boolean,
      });
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

program
  .command('reindex')
  .description('Rebuild SQLite index from Markdown')
  .action(async () => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await withVaultOrPrompt(opts);
      await cmdReindex(ctx);
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

const schedule = program
  .command('schedule')
  .description(
    'Auto-maintain vault per adapter cron (capture→compile→lint→reindex). Does not bypass Session dual-gate.',
  );

schedule
  .command('list')
  .description('List adapter schedules and last runs')
  .action(async () => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await withVaultOrPrompt(opts);
      await cmdScheduleList(ctx);
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

schedule
  .command('set')
  .description('Set cron schedule for an adapter')
  .argument('<adapter>', 'Adapter name (cursor, claude-code, …)')
  .requiredOption('--cron <expr>', '5-field cron, e.g. "0 */6 * * *"')
  .action(async (adapter, cmdOpts: { cron: string }) => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await withVaultOrPrompt(opts);
      await cmdScheduleSet(ctx, adapter, cmdOpts.cron);
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

schedule
  .command('unset')
  .description('Clear cron schedule for an adapter')
  .argument('<adapter>', 'Adapter name')
  .action(async (adapter) => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await withVaultOrPrompt(opts);
      await cmdScheduleUnset(ctx, adapter);
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

schedule
  .command('run')
  .description(
    'Run maintenance now (due adapters, or --force / --adapter). Steps: capture→compile→lint→reindex',
  )
  .option('--adapter <name>', 'Only this adapter')
  .option('--force', 'Ignore cron due check', false)
  .action(async (cmdOpts: { adapter?: string; force?: boolean }) => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await withVaultOrPrompt(opts);
      await cmdScheduleRun(ctx, {
        adapter: cmdOpts.adapter,
        force: Boolean(cmdOpts.force),
      });
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

schedule
  .command('start')
  .description(
    'Start schedule daemon (foreground by default; --daemon for background)',
  )
  .option('--daemon', 'Detach to background and print pid', false)
  .action(async (cmdOpts: { daemon?: boolean }) => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await withVaultOrPrompt(opts);
      const detach = Boolean(cmdOpts.daemon);
      await cmdScheduleStart(ctx, { daemon: detach, vaultOpt: opts.vault });
      // Background parent exits; foreground worker owns the store until signal.
      if (detach) ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

schedule
  .command('stop')
  .description('Stop schedule daemon via PID file')
  .action(async () => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await withVaultOrPrompt(opts);
      await cmdScheduleStop(ctx);
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

schedule
  .command('status')
  .description('Show daemon PID, next due, last runs, and evolution queue preview')
  .action(async () => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await withVaultOrPrompt(opts);
      await cmdScheduleStatus(ctx);
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

const evolution = program
  .command('evolution')
  .description(
    'ADR-002 evolution queue: coverage + lint todos (diagnosis only, never auto-capture)',
  );

evolution
  .command('scan')
  .description('Refresh queue from health + per-project coverage')
  .action(async () => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await withVaultOrPrompt(opts);
      await cmdEvolutionScan(ctx);
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

evolution
  .command('status')
  .description('Show open evolution todos')
  .option('--all', 'Include done/dismissed', false)
  .option('--limit <n>', 'Max items', '50')
  .action(async (cmdOpts: { all?: boolean; limit?: string }) => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await withVaultOrPrompt(opts);
      await cmdEvolutionStatus(ctx, {
        all: Boolean(cmdOpts.all),
        limit: Number(cmdOpts.limit),
      });
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

evolution
  .command('ack')
  .description('Mark a todo done|dismissed|open after human/Agent handled it')
  .argument('<id>', 'Todo id from evolution status')
  .option('--status <s>', 'done | dismissed | open', 'done')
  .action(async (id, cmdOpts: { status?: string }) => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    const status = (cmdOpts.status ?? 'done') as 'done' | 'dismissed' | 'open';
    if (!['done', 'dismissed', 'open'].includes(status)) {
      fail(
        new Error('--status must be done|dismissed|open'),
        opts.json,
      );
    }
    try {
      const ctx = await withVaultOrPrompt(opts);
      await cmdEvolutionAck(ctx, id, status);
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

const adapters = program.command('adapters').description('Manage terminal adapters');

adapters
  .command('list')
  .description('List adapters')
  .action(async () => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await resolveContext({
        vault: opts.vault,
        json: opts.json,
        allowMissing: true,
      });
      await cmdAdaptersList(ctx);
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

adapters
  .command('install')
  .description('Install MCP config + Agent Skills for an adapter')
  .argument('<name>', 'Adapter name')
  .option('--skip-skills', 'Only write MCP config', false)
  .option(
    '--project',
    'Pin MCP --vault to repo .kmind-knowledge/ (Cursor: write .cursor/mcp.json)',
    false,
  )
  .action(async (name, cmdOpts: { skipSkills?: boolean; project?: boolean }) => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await resolveContext({
        vault: opts.vault,
        json: opts.json,
        allowMissing: true,
      });
      await cmdAdaptersInstall(ctx, name, {
        skipSkills: cmdOpts.skipSkills,
        project: cmdOpts.project,
      });
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

const skills = program.command('skills').description('Install Agent Skills into AI terminals');

skills
  .command('list')
  .description('List bundled skills and target paths')
  .action(async () => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await resolveContext({
        vault: opts.vault,
        json: opts.json,
        allowMissing: true,
      });
      await cmdSkillsList(ctx);
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

skills
  .command('install')
  .description('Copy bundled skills into a terminal (global by default)')
  .argument('[name]', 'Terminal: cursor | claude-code | codex | kiro | qoder')
  .option('--all', 'Install into every supported terminal', false)
  .option('--project', 'Install into cwd project skills dir instead of ~/.…/skills', false)
  .action(async (name: string | undefined, cmdOpts: { all?: boolean; project?: boolean }) => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await resolveContext({
        vault: opts.vault,
        json: opts.json,
        allowMissing: true,
      });
      await cmdSkillsInstall(ctx, {
        name,
        all: cmdOpts.all,
        project: cmdOpts.project,
      });
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

const llmCmd = program
  .command('llm')
  .description(
    'LLM provider/model config for agentic knowledge build (API keys stay in env vars)',
  );
llmCmd
  .command('status')
  .description(
    'Show effective provider/model/baseUrl and whether the API key env is present',
  )
  .option('--provider <p>', 'Override provider for this call')
  .option('--model <m>', 'Override model for this call')
  .option('--base-url <url>', 'Override base URL for this call')
  .option('--api-key-env <name>', 'Override key env var name for this call')
  .option('--json-mode <bool>', 'Override response_format json mode for this call')
  .action(
    async (cmdOpts: {
      provider?: string;
      model?: string;
      baseUrl?: string;
      apiKeyEnv?: string;
      jsonMode?: string;
    }) => {
      const opts = program.opts<{ json?: boolean; vault?: string }>();
      try {
        const ctx = await withVaultOrPrompt(opts);
        await cmdLlmStatus(ctx, llmOverridesFromFlags(cmdOpts));
        ctx.store.close();
      } catch (err) {
        fail(err, opts.json);
      }
    },
  );

llmCmd
  .command('set')
  .description(
    'Persist provider/model settings to vault config.yaml (no flags + TTY → interactive wizard)',
  )
  .option('--provider <p>', 'ollama | openai | openai-compatible | anthropic | azure-openai')
  .option('--model <m>', 'Model id, e.g. gpt-4o-mini / claude-sonnet-4-5 / qwen2.5-coder:14b')
  .option(
    '--base-url <url>',
    'Custom OpenAI-format endpoint (required for openai-compatible), e.g. https://gateway/v1',
  )
  .option('--api-key-env <name>', 'Env var name holding the key (default KMIND_LLM_API_KEY)')
  .option('--azure-api-version <v>', 'Azure OpenAI api-version')
  .option('--azure-deployment <name>', 'Azure OpenAI deployment name')
  .option('--json-mode <bool>', 'Send response_format=json_object (true|false, default true)')
  .option('--temperature <n>', 'Sampling temperature 0-2')
  .option('--max-tokens <n>', 'Max output tokens')
  .option('--timeout-ms <n>', 'Request timeout in ms')
  .option('--max-input-chars <n>', 'Evidence budget per dig task')
  .action(
    async (cmdOpts: {
      provider?: string;
      model?: string;
      baseUrl?: string;
      apiKeyEnv?: string;
      azureApiVersion?: string;
      azureDeployment?: string;
      jsonMode?: string;
      temperature?: string;
      maxTokens?: string;
      timeoutMs?: string;
      maxInputChars?: string;
    }) => {
      const opts = program.opts<{ json?: boolean; vault?: string }>();
      try {
        const ctx = await withVaultOrPrompt(opts);
        await cmdLlmSet(ctx, cmdOpts);
        ctx.store.close();
      } catch (err) {
        fail(err, opts.json);
      }
    },
  );

llmCmd
  .command('provider')
  .description(
    'Interactive provider setup: pick provider, base URL and key env (like `ocr config provider`)',
  )
  .action(async () => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await withVaultOrPrompt(opts);
      await cmdLlmProviderInteractive(ctx);
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

llmCmd
  .command('model')
  .description(
    'Interactive model picker: lists models from the endpoint then saves the choice',
  )
  .action(async () => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await withVaultOrPrompt(opts);
      await cmdLlmModelInteractive(ctx);
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

llmCmd
  .command('test')
  .description('One minimal chat round-trip to verify provider/model/key')
  .option('--prompt <text>', 'Custom probe prompt')
  .option('--provider <p>', 'Override provider for this call')
  .option('--model <m>', 'Override model for this call')
  .option('--base-url <url>', 'Override base URL for this call')
  .option('--api-key-env <name>', 'Override key env var name for this call')
  .option('--json-mode <bool>', 'Override response_format json mode for this call')
  .action(
    async (cmdOpts: {
      prompt?: string;
      provider?: string;
      model?: string;
      baseUrl?: string;
      apiKeyEnv?: string;
      jsonMode?: string;
    }) => {
      const opts = program.opts<{ json?: boolean; vault?: string }>();
      try {
        const ctx = await withVaultOrPrompt(opts);
        await cmdLlmTest(ctx, {
          prompt: cmdOpts.prompt,
          overrides: llmOverridesFromFlags(cmdOpts),
        });
        ctx.store.close();
      } catch (err) {
        fail(err, opts.json);
      }
    },
  );

program
  .command('hook')
  .description('Lifecycle hook entrypoint')
  .argument('<event>', 'Hook event name')
  .action(async (event) => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await withVaultOrPrompt(opts);
      await cmdHook(ctx, event);
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

function toNumeric(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : Number.NaN;
}

async function withVaultOrPrompt(opts: {
  json?: boolean;
  vault?: string;
}): Promise<Awaited<ReturnType<typeof resolveContext>>> {
  try {
    return await resolveContext({ vault: opts.vault, json: opts.json });
  } catch (err) {
    if (
      !opts.json &&
      err &&
      typeof err === 'object' &&
      'category' in err &&
      (err as { category: string }).category === 'CONFIG_ERROR' &&
      process.stdin.isTTY
    ) {
      const rl = readline.createInterface({ input, output });
      const answer = await rl.question('Vault missing. Generate config now with kmind init? [Y/n] ');
      rl.close();
      if (answer.trim() === '' || /^y/i.test(answer)) {
        return resolveContext({
          vault: opts.vault,
          json: opts.json,
          allowMissing: true,
        });
      }
    }
    throw err;
  }
}

program.parseAsync(process.argv).catch((err) => fail(err, false));
