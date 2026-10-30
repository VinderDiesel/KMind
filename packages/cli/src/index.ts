#!/usr/bin/env node
import { Command } from 'commander';
import { resolveContext } from './context.js';
import { fail } from './exit.js';
import { cmdInit } from './commands/init.js';
import { cmdCompile } from './commands/compile.js';
import { cmdSearch } from './commands/search.js';
import { cmdPack } from './commands/pack.js';
import { cmdSuggestCapture } from './commands/suggest-capture.js';
import { cmdCapture } from './commands/capture.js';
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
import { cmdCoverage } from './commands/coverage.js';
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
  .action(async () => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await resolveContext({
        vault: opts.vault,
        json: opts.json,
        allowMissing: true,
      });
      await cmdInit(ctx);
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

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

program
  .command('coverage')
  .description(
    'Assess whether a project/topic is dug deep (not catalog-only). Do not claim complete unless complete=true',
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
  .action(async (name, cmdOpts: { skipSkills?: boolean }) => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await resolveContext({
        vault: opts.vault,
        json: opts.json,
        allowMissing: true,
      });
      await cmdAdaptersInstall(ctx, name, { skipSkills: cmdOpts.skipSkills });
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
