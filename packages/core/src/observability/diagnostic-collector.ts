import type { ErrorCategory, ErrorSeverity } from '@kmind/shared';

export interface Diagnostic {
  category: ErrorCategory;
  severity: ErrorSeverity;
  message: string;
  path?: string;
  suggestion?: string;
}

/**
 * Collect non-fatal issues during compile; present grouped at the end.
 */
export class DiagnosticCollector {
  private readonly items: Diagnostic[] = [];

  /** Add a diagnostic entry. */
  add(diagnostic: Diagnostic): void {
    this.items.push(diagnostic);
  }

  /** Return all diagnostics. */
  all(): Diagnostic[] {
    return [...this.items];
  }

  /** Group diagnostics by category. */
  byCategory(): Record<string, Diagnostic[]> {
    const groups: Record<string, Diagnostic[]> = {};
    for (const item of this.items) {
      const list = groups[item.category] ?? [];
      list.push(item);
      groups[item.category] = list;
    }
    return groups;
  }

  /** Render Markdown report. */
  toMarkdown(): string {
    if (this.items.length === 0) {
      return '# Diagnostics\n\nNo issues.\n';
    }
    const lines = ['# Diagnostics', ''];
    const groups = this.byCategory();
    for (const [category, list] of Object.entries(groups)) {
      lines.push(`## ${category}`, '');
      for (const d of list) {
        lines.push(`- **[${d.severity}]** ${d.message}${d.path ? ` (\`${d.path}\`)` : ''}`);
        if (d.suggestion) {
          lines.push(`  - Next: ${d.suggestion}`);
        }
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  clear(): void {
    this.items.length = 0;
  }
}
