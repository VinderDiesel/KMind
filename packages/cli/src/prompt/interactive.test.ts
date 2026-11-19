import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  applySelectKey,
  promptConfirm,
  promptSelect,
  promptText,
  renderSelectFrame,
  stepIndex,
} from './interactive.js';

/** Minimal writable that records everything the prompt renders. */
function sink(): { stream: NodeJS.WriteStream; text: () => string } {
  const chunks: string[] = [];
  const stream = {
    write: (chunk: string) => {
      chunks.push(String(chunk));
      return true;
    },
  } as unknown as NodeJS.WriteStream;
  return { stream, text: () => chunks.join('') };
}

function stdin(lines: string[]): NodeJS.ReadStream {
  return Readable.from(lines.map((line) => `${line}\n`)) as unknown as NodeJS.ReadStream;
}

/** Feed lines one tick apart so readline can consume them sequentially. */
async function feed(input: PassThrough, lines: string[]): Promise<void> {
  for (const line of lines) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    input.write(`${line}\n`);
  }
  await new Promise((resolve) => setTimeout(resolve, 10));
  input.end();
}

describe('renderSelectFrame', () => {
  it('given two choices when render then marks the active row and hints', () => {
    const lines = renderSelectFrame({
      message: '选择 provider',
      choices: [
        { value: 'ollama', label: 'ollama', hint: '本地' },
        { value: 'openai', label: 'openai' },
      ],
      index: 1,
    });
    expect(lines[0]).toContain('选择 provider');
    expect(lines[1]).toContain('ollama');
    expect(lines[1]).toContain('本地');
    expect(lines[1].startsWith('   ')).toBe(true);
    expect(lines[2]).toContain('❯');
    expect(lines[2]).toContain('openai');
  });
});

describe('applySelectKey', () => {
  it('given arrows when map then returns navigation actions', () => {
    expect(applySelectKey({ name: 'up' })).toBe('prev');
    expect(applySelectKey({ name: 'k' })).toBe('prev');
    expect(applySelectKey({ name: 'down' })).toBe('next');
    expect(applySelectKey({ name: 'j' })).toBe('next');
  });

  it('given confirm and cancel keys when map then returns actions', () => {
    expect(applySelectKey({ name: 'return' })).toBe('confirm');
    expect(applySelectKey({ name: 'escape' })).toBe('cancel');
    expect(applySelectKey({ name: 'q' })).toBe('cancel');
    expect(applySelectKey({ name: 'c', ctrl: true })).toBe('cancel');
  });

  it('given unrelated key when map then returns null', () => {
    expect(applySelectKey({ name: 'x' })).toBe(null);
  });
});

describe('stepIndex', () => {
  it('given index at both ends when step then wraps around', () => {
    expect(stepIndex(0, 'prev', 3)).toBe(2);
    expect(stepIndex(2, 'next', 3)).toBe(0);
    expect(stepIndex(1, 'next', 3)).toBe(2);
  });

  it('given empty choices when step then stays at zero', () => {
    expect(stepIndex(0, 'next', 0)).toBe(0);
  });
});

describe('promptSelect', () => {
  it('given arrow down then enter when select then resolves the second choice', async () => {
    const input = new PassThrough();
    const { stream } = sink();
    const pending = promptSelect(
      '选择 model',
      [
        { value: 'a', label: 'a' },
        { value: 'b', label: 'b' },
      ],
      { streams: { input: input as unknown as NodeJS.ReadStream, output: stream } },
    );
    input.write('\x1b[B');
    input.write('\r');
    await expect(pending).resolves.toBe('b');
  });

  it('given escape when select then resolves null', async () => {
    const input = new PassThrough();
    const { stream } = sink();
    const pending = promptSelect(
      'pick',
      [{ value: 'a', label: 'a' }],
      { streams: { input: input as unknown as NodeJS.ReadStream, output: stream } },
    );
    input.write('\x1b');
    await expect(pending).resolves.toBe(null);
  });

  it('given no choices when select then resolves null without rendering', async () => {
    const { stream, text } = sink();
    await expect(promptSelect('pick', [], { streams: { output: stream } })).resolves.toBe(
      null,
    );
    expect(text()).toBe('');
  });
});

describe('promptText', () => {
  it('given a value when prompt then returns it trimmed', async () => {
    const { stream } = sink();
    await expect(
      promptText('model', {
        streams: { input: stdin(['  gpt-4o  ']), output: stream },
      }),
    ).resolves.toBe('gpt-4o');
  });

  it('given bare enter when prompt has default then returns the default', async () => {
    const { stream } = sink();
    await expect(
      promptText('model', {
        defaultValue: 'qwen2.5',
        streams: { input: stdin(['']), output: stream },
      }),
    ).resolves.toBe('qwen2.5');
  });

  it('given an invalid value when prompt then re-asks until valid', async () => {
    const { stream, text } = sink();
    const input = new PassThrough();
    const pending = promptText('url', {
      validate: (value) => (value.startsWith('http') ? null : '需要 http(s)'),
      streams: { input: input as unknown as NodeJS.ReadStream, output: stream },
    });
    await feed(input, ['ftp://x', 'https://ok/v1']);
    await expect(pending).resolves.toBe('https://ok/v1');
    expect(text()).toContain('需要 http(s)');
  });
});

describe('promptConfirm', () => {
  it('given y when confirm then resolves true', async () => {
    const { stream } = sink();
    await expect(
      promptConfirm('继续？', {
        streams: { input: stdin(['y']), output: stream },
      }),
    ).resolves.toBe(true);
  });

  it('given n when confirm then resolves false', async () => {
    const { stream } = sink();
    await expect(
      promptConfirm('继续？', {
        streams: { input: stdin(['n']), output: stream },
      }),
    ).resolves.toBe(false);
  });

  it('given bare enter when default is false then resolves false', async () => {
    const { stream } = sink();
    await expect(
      promptConfirm('继续？', {
        defaultValue: false,
        streams: { input: stdin(['']), output: stream },
      }),
    ).resolves.toBe(false);
  });

  it('given an invalid answer when confirm then re-asks', async () => {
    const { stream, text } = sink();
    const input = new PassThrough();
    const pending = promptConfirm('继续？', {
      streams: { input: input as unknown as NodeJS.ReadStream, output: stream },
    });
    await feed(input, ['maybe', 'yes']);
    await expect(pending).resolves.toBe(true);
    expect(text()).toContain('请输入 y 或 n');
  });
});
