import * as readline from 'node:readline';
import { createInterface } from 'node:readline/promises';

export interface PromptStreams {
  input: NodeJS.ReadStream;
  output: NodeJS.WriteStream;
}

export interface SelectChoice<T> {
  value: T;
  label: string;
  /** Dimmed hint rendered to the right of the label. */
  hint?: string;
}

/** True when both stdin and stdout are a TTY (interactive prompts are safe). */
export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/**
 * Render one select menu frame as plain lines (ANSI decorations included).
 * Pure function so the layout can be unit-tested without a terminal.
 */
export function renderSelectFrame<T>(params: {
  message: string;
  choices: SelectChoice<T>[];
  index: number;
}): string[] {
  const lines = [
    `? ${params.message}  \x1b[2m(↑/↓ 选择，Enter 确认，Esc 取消)\x1b[0m`,
  ];
  params.choices.forEach((choice, i) => {
    const active = i === params.index;
    const cursor = active ? '❯' : ' ';
    const label = active ? `\x1b[36m${choice.label}\x1b[0m` : choice.label;
    const hint = choice.hint ? `  \x1b[2m${choice.hint}\x1b[0m` : '';
    lines.push(`  ${cursor} ${label}${hint}`);
  });
  return lines;
}

/**
 * Map a keypress to a select action.
 * Pure function: no stream access, safe to unit-test with synthetic keys.
 */
export function applySelectKey(key: {
  name?: string;
  ctrl?: boolean;
  sequence?: string;
}): 'prev' | 'next' | 'confirm' | 'cancel' | null {
  if (key.ctrl && key.name === 'c') return 'cancel';
  if (key.name === 'escape' || key.name === 'q') return 'cancel';
  if (key.name === 'up' || key.name === 'k') return 'prev';
  if (key.name === 'down' || key.name === 'j') return 'next';
  if (key.name === 'return' || key.name === 'enter') return 'confirm';
  return null;
}

/** Move the selection index with wrap-around. */
export function stepIndex(
  index: number,
  action: 'prev' | 'next',
  count: number,
): number {
  if (count <= 0) return 0;
  return action === 'prev'
    ? (index - 1 + count) % count
    : (index + 1) % count;
}

/**
 * Arrow-key single choice prompt. Resolves with the chosen value, or null when
 * the user cancels (Esc / Ctrl-C / q).
 */
export async function promptSelect<T>(
  message: string,
  choices: SelectChoice<T>[],
  options: { initialIndex?: number; streams?: Partial<PromptStreams> } = {},
): Promise<T | null> {
  if (choices.length === 0) return null;
  const input = options.streams?.input ?? process.stdin;
  const output = options.streams?.output ?? process.stdout;
  let index = Math.min(
    Math.max(options.initialIndex ?? 0, 0),
    choices.length - 1,
  );

  const rawCapable =
    typeof (input as { setRawMode?: unknown }).setRawMode === 'function';
  const previousRaw = (input as { isRaw?: boolean }).isRaw ?? false;
  let drawn = 0;

  const draw = () => {
    if (drawn > 0) output.write(`\x1b[${drawn}A`);
    const lines = renderSelectFrame({ message, choices, index });
    for (const line of lines) output.write(`\x1b[2K${line}\n`);
    drawn = lines.length;
  };

  if (rawCapable) (input as unknown as NodeJS.ReadStream).setRawMode(true);
  input.resume();
  readline.emitKeypressEvents(input);

  return new Promise<T | null>((resolve) => {
    const cleanup = () => {
      input.removeListener('keypress', onKey);
      if (rawCapable) {
        (input as unknown as NodeJS.ReadStream).setRawMode(previousRaw);
      }
      input.pause();
    };
    const onKey = (_sequence: string, key: readline.Key) => {
      const action = applySelectKey(key);
      if (action === 'prev' || action === 'next') {
        index = stepIndex(index, action, choices.length);
        draw();
        return;
      }
      if (action === 'confirm') {
        cleanup();
        resolve(choices[index]?.value ?? null);
        return;
      }
      if (action === 'cancel') {
        cleanup();
        resolve(null);
      }
    };
    input.on('keypress', onKey);
    draw();
  });
}

/**
 * Single-line text prompt with an optional default and validator.
 * Resolves with the trimmed value, or null on cancel (Ctrl-C / EOF).
 */
export async function promptText(
  message: string,
  options: {
    defaultValue?: string;
    placeholder?: string;
    validate?: (value: string) => string | null;
    streams?: Partial<PromptStreams>;
  } = {},
): Promise<string | null> {
  const input = options.streams?.input ?? process.stdin;
  const output = options.streams?.output ?? process.stdout;
  const suffix = options.defaultValue
    ? ` [\x1b[2m${options.defaultValue}\x1b[0m]`
    : options.placeholder
      ? ` \x1b[2m(${options.placeholder})\x1b[0m`
      : '';
  const rl = createInterface({ input, output });
  try {
    for (;;) {
      let answer: string;
      try {
        answer = await rl.question(`? ${message}${suffix} `);
      } catch {
        return null;
      }
      const value = answer.trim() || options.defaultValue || '';
      const problem = options.validate?.(value) ?? null;
      if (problem) {
        output.write(`  ✗ ${problem}\n`);
        continue;
      }
      return value;
    }
  } finally {
    rl.close();
  }
}

/** Yes/no prompt; `defaultValue` decides what bare Enter means. */
export async function promptConfirm(
  message: string,
  options: {
    defaultValue?: boolean;
    streams?: Partial<PromptStreams>;
  } = {},
): Promise<boolean> {
  const yes = options.defaultValue !== false;
  const answer = await promptText(`${message} ${yes ? '[Y/n]' : '[y/N]'}`, {
    ...(options.streams ? { streams: options.streams } : {}),
    validate: (value) => {
      const normalized = value.trim().toLowerCase();
      if (!normalized) return null;
      return ['y', 'yes', 'n', 'no'].includes(normalized)
        ? null
        : '请输入 y 或 n';
    },
  });
  if (answer === null) return false;
  const normalized = answer.trim().toLowerCase();
  if (!normalized) return yes;
  return normalized === 'y' || normalized === 'yes';
}
