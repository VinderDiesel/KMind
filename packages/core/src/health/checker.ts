import type { Vault } from '../storage/vault.js';
import { SqliteStore } from '../storage/sqlite-store.js';
import { OntologyRegistry } from '../ontology/ontology-registry.js';
import { loadOntology } from '../ontology/ontology-loader.js';
import { checkExpiry, type HealthIssue } from './rules/expiry.js';
import { checkBrokenLinks } from './rules/broken-links.js';
import { checkContradictions } from './rules/contradictions.js';
import { checkOrphans } from './rules/orphans.js';
import { checkOntologyDrift } from './rules/ontology-drift.js';

export interface HealthReport {
  issues: HealthIssue[];
  markdown: string;
  checkedAt: string;
}

/**
 * Run all health rules and produce a Markdown report.
 */
export async function runHealthCheck(
  vault: Vault,
  store?: SqliteStore,
): Promise<HealthReport> {
  const sqlite = store ?? new SqliteStore(vault.indexPath);
  const config = await vault.getConfig();
  const assets = await sqlite.queryAssets({ limit: 100_000 });
  const relations = await sqlite.getRelations();
  const registry = new OntologyRegistry();
  registry.load(await loadOntology(vault.ontologyDir));

  const issues: HealthIssue[] = [
    ...checkExpiry(assets, config.healthCheck.expiryDays),
    ...checkBrokenLinks(assets),
    ...checkContradictions(relations),
    ...checkOrphans(assets, relations),
    ...checkOntologyDrift(assets, registry),
  ];

  const checkedAt = new Date().toISOString();
  const markdown = renderMarkdown(issues, checkedAt);
  return { issues, markdown, checkedAt };
}

function renderMarkdown(issues: HealthIssue[], checkedAt: string): string {
  const lines = [
    '# KMind Health Report',
    '',
    `Checked at: ${checkedAt}`,
    `Issues: ${issues.length}`,
    '',
  ];
  if (issues.length === 0) {
    lines.push('All checks passed.');
    return lines.join('\n');
  }
  const byRule = new Map<string, HealthIssue[]>();
  for (const issue of issues) {
    const list = byRule.get(issue.rule) ?? [];
    list.push(issue);
    byRule.set(issue.rule, list);
  }
  for (const [rule, list] of byRule) {
    lines.push(`## ${rule}`, '');
    for (const i of list) {
      lines.push(`- **[${i.severity}]** ${i.message}${i.assetId ? ` (\`${i.assetId}\`)` : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
