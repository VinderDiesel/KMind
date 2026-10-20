import type { KnowledgeAsset } from '@kmind/shared';
import type { HealthIssue } from './expiry.js';

/**
 * Session-derived assets are a root quality failure — surface as high severity.
 */
export function checkSessionPollution(assets: KnowledgeAsset[]): HealthIssue[] {
  const victims = assets.filter(
    (a) =>
      a.source.rawPath.startsWith('sessions/') ||
      a.source.rawPath.includes('/sessions/') ||
      (a.source.terminal !== 'manual' &&
        /sess_|kiro-|cursor-/i.test(a.title)),
  );
  if (victims.length === 0) return [];

  const sample = victims
    .slice(0, 5)
    .map((a) => a.id)
    .join(', ');
  return [
    {
      rule: 'session_pollution',
      severity: 'high',
      message: `${victims.length} session/noise assets in knowledge (e.g. ${sample}). Run kmind purge-sessions; keep capture.compileSessions=false and never set KMIND_COMPILE_SESSIONS unless intentional.`,
    },
  ];
}
