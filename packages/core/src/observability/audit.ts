import { promises as fs } from 'node:fs';
import path from 'node:path';

export type AuditDecision = 'allowed' | 'blocked' | 'no-op' | 'approved';

export interface AuditEntry {
  terminal?: string;
  tool: string;
  argsSummary: string;
  decision: AuditDecision;
  reason: string;
  timestamp: string;
}

/**
 * Append structured MCP audit log entries under vault/audit/.
 */
export class AuditLogger {
  constructor(private readonly auditDir: string) {}

  async record(entry: Omit<AuditEntry, 'timestamp'> & { timestamp?: string }): Promise<void> {
    await fs.mkdir(this.auditDir, { recursive: true });
    const full: AuditEntry = {
      ...entry,
      timestamp: entry.timestamp ?? new Date().toISOString(),
    };
    const day = full.timestamp.slice(0, 10);
    const file = path.join(this.auditDir, `${day}.jsonl`);
    await fs.appendFile(file, `${JSON.stringify(full)}\n`, 'utf8');
  }
}
