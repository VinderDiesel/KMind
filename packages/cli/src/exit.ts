import { ExitCode, KMindError, exitCodeForError, type ExitCodeValue } from '@kmind/shared';

/**
 * Print error with three-element UX and exit.
 */
export function fail(err: unknown, json = false): never {
  if (err instanceof KMindError) {
    if (json) {
      process.stderr.write(`${JSON.stringify(err.toJSON())}\n`);
    } else {
      process.stderr.write(`${err.formatUserMessage()}\n`);
    }
    process.exit(exitCodeForError(err));
  }
  const message = err instanceof Error ? err.message : String(err);
  if (json) {
    process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  } else {
    process.stderr.write(
      `失败: ${message}\n原因: unexpected error\n下一步: Re-run with --json for details or check logs\n`,
    );
  }
  process.exit(ExitCode.GENERAL);
}

export function success(payload: unknown, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } else if (typeof payload === 'string') {
    process.stdout.write(`${payload}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }
}

export { ExitCode, type ExitCodeValue };
