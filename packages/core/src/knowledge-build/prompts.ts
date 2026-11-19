import type { DigTask } from '@kmind/shared';
import type { ModuleEvidence } from './scanner.js';

export interface PromptTypeOption {
  id: string;
  guidance?: string;
  scaffold?: string;
}

export interface BuildDigPromptInput {
  project: string;
  task: DigTask;
  evidence: ModuleEvidence;
  existingTitles: string[];
  maxCards: number;
  /** Enabled asset types from the vault registry. */
  typeOptions: PromptTypeOption[];
}

export interface PromptPair {
  system: string;
  user: string;
}

const DEFAULT_SECTIONS =
  '## 实现方式\n## 注意事项\n## 红线规避\n## 代码锚点';

/**
 * System prompt for evidence-grounded card generation (ADR-005).
 * Output is strict JSON so the caller can Zod-validate before capture.
 */
export function buildDigSystemPrompt(): string {
  return [
    '你是 KMind 的知识工程师，负责把代码仓库模块整理成可检索、可执行的知识卡。',
    '只输出一个 JSON 对象，格式：{"cards":[{"title":"...","type":"architecture_design","content":"...","anchors":[{"file":"path/to/file.ts","symbol":"foo"}],"confidence":0.8}]}',
    '不要输出 Markdown 代码围栏、解释、前后缀文字。',
    '',
    '硬性规则：',
    '1. 一张卡只讲一个主题（一个模块/一个机制/一个坑）；禁止把多个组件塞进一张卡。',
    '2. 只引用证据中真实出现的文件与符号；禁止编造文件、函数、命令或指标。',
    '3. 正文用中文（代码、路径、标识符保留原文）；功能/设计类正文至少 600 字。',
    '4. 功能/设计类卡必须包含这些二级标题：## 实现方式、## 注意事项、## 红线规避、## 代码锚点。',
    `5. 「## 代码锚点」下用列表写 \`- file.ts（symbol）\`，file 必须来自证据。`,
    '6. type 优先使用 candidateType；只有证据明显更像其它类型时才改，并在 notes 说明理由。',
    '7. 不要生成「总览 / 索引 / 概览」卡，总览由工具统一生成。',
    '8. 证据不足时宁可少出卡或降低 confidence，不要臆造。',
    '9. 最多生成指定数量的卡；标题必须唯一且能独立检索。',
  ].join('\n');
}

/**
 * User prompt carrying the module task + bounded evidence bundle.
 */
export function buildDigPrompt(input: BuildDigPromptInput): PromptPair {
  const { project, task, evidence } = input;
  const typeLines = input.typeOptions
    .slice(0, 12)
    .map((t) => {
      const guidance = t.guidance?.trim() ? ` — ${t.guidance.trim()}` : '';
      return `- ${t.id}${guidance}`;
    })
    .join('\n');

  const sections =
    input.typeOptions.find((t) => t.id === task.candidateType)?.scaffold?.trim() ||
    DEFAULT_SECTIONS;

  const exportsText = evidence.exports
    .map((e) => `- ${e.file}: ${e.symbols.join(', ')}`)
    .join('\n');

  const filesText = evidence.files
    .map((file) => {
      const lang = languageOf(file.path);
      const truncated = file.truncated ? '（已截断）' : '';
      return [
        `### FILE ${file.path}${truncated}`,
        `\`\`\`${lang}`,
        file.content,
        '```',
      ].join('\n');
    })
    .join('\n\n');

  const existing =
    input.existingTitles.length > 0
      ? `\n已存在的知识卡（避免重复标题/重复主题）：\n${input.existingTitles
          .slice(0, 60)
          .map((t) => `- ${t}`)
          .join('\n')}\n`
      : '';

  const user = [
    `项目：${project}`,
    `DigTask：${task.id}`,
    `模块路径：${task.paths.join(', ')}`,
    `标题提示：${task.titleHint}`,
    `candidateType：${task.candidateType}`,
    task.notes ? `任务备注：${task.notes}` : null,
    '',
    '可选 type（只能从中选择）：',
    typeLines || '- architecture_design',
    '',
    `推荐正文骨架：\n${sections}`,
    '',
    `证据文件（${evidence.files.length} 个，共 ${evidence.totalChars} 字符）：`,
    filesText || '（无可用证据文件）',
    '',
    exportsText ? `导出符号：\n${exportsText}\n` : null,
    existing || null,
    `请生成 1-${input.maxCards} 张知识卡，输出 JSON 对象。`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  return { system: buildDigSystemPrompt(), user };
}

export interface BuildRepairPromptInput {
  project: string;
  type: string;
  title: string;
  content: string;
  reasons: string[];
  evidence: ModuleEvidence;
  candidateType?: string;
}

/**
 * Ask the model to fix one card that failed the capture quality gate.
 */
export function buildRepairPrompt(input: BuildRepairPromptInput): PromptPair {
  const anchors = input.evidence.files
    .slice(0, 8)
    .map((f) => `- ${f.path}`)
    .join('\n');
  const user = [
    `项目：${input.project}`,
    `类型：${input.type}${input.candidateType ? `（candidateType=${input.candidateType}）` : ''}`,
    `标题：${input.title}`,
    '',
    '当前正文：',
    input.content,
    '',
    `质量闸门未通过原因：\n${input.reasons.map((r) => `- ${r}`).join('\n')}`,
    '',
    '可用文件（anchors.file 必须来自这里）：',
    anchors || '（无）',
    '',
    '请修正正文/锚点，使其通过闸门，只输出 JSON：{"card":{"title":"...","type":"...","content":"...","anchors":[...],"confidence":0.8}}',
  ].join('\n');

  return { system: buildDigSystemPrompt(), user };
}

function languageOf(filePath: string): string {
  if (/\.tsx?$/.test(filePath)) return 'ts';
  if (/\.jsx?$/.test(filePath)) return 'js';
  if (/\.py$/.test(filePath)) return 'python';
  if (/\.go$/.test(filePath)) return 'go';
  if (/\.rs$/.test(filePath)) return 'rust';
  if (/\.java$|\.kt$/.test(filePath)) return 'java';
  if (/\.json$/.test(filePath)) return 'json';
  if (/\.mdx?$/.test(filePath)) return 'md';
  return '';
}
