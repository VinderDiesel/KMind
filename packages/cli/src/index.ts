#!/usr/bin/env node
import { Command } from 'commander';
import { resolveContext } from './context.js';
import { fail } from './exit.js';
import { cmdInit } from './commands/init.js';
import { cmdCompile } from './commands/compile.js';
import { cmdSearch } from './commands/search.js';
import { cmdCapture } from './commands/capture.js';
import { cmdLint } from './commands/lint.js';
import { cmdExport } from './commands/export.js';
import { cmdImport } from './commands/import.js';
import { cmdMcpServe } from './commands/mcp-serve.js';
import { cmdAdaptersInstall, cmdAdaptersList } from './commands/adapters.js';
import { cmdHook } from './commands/hook.js';
import { cmdReindex } from './commands/reindex.js';
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
  .command('capture')
  .description('Manually capture knowledge')
  .argument('<content>', 'Content to capture')
  .option('--type <t>', 'Knowledge type')
  .option('--title <title>', 'Title')
  .option('--project <name>', 'Project')
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
  .command('export')
  .description('Export vault')
  .requiredOption('--output <path>', 'Output path')
  .option('--format <fmt>', 'tar.gz or git', 'tar.gz')
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
  .description('Import vault from tar.gz')
  .requiredOption('--input <path>', 'Input archive')
  .option('--merge', 'Merge with existing', false)
  .action(async (cmdOpts) => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await withVaultOrPrompt(opts);
      await cmdImport(ctx, cmdOpts);
      ctx.store.close();
    } catch (err) {
      fail(err, opts.json);
    }
  });

program
  .command('mcp-serve')
  .description('Start MCP server over stdio')
  .action(async () => {
    const opts = program.opts<{ vault?: string }>();
    try {
      await cmdMcpServe(opts.vault);
    } catch (err) {
      fail(err, false);
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
  .description('Install MCP config for an adapter')
  .argument('<name>', 'Adapter name')
  .action(async (name) => {
    const opts = program.opts<{ json?: boolean; vault?: string }>();
    try {
      const ctx = await resolveContext({
        vault: opts.vault,
        json: opts.json,
        allowMissing: true,
      });
      await cmdAdaptersInstall(ctx, name);
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
