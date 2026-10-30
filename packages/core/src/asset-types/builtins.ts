import type { AssetTypeDef, AssetTypeRule, LegacyQualityProfile } from '@kmind/shared';
import { typeIdToOntologyClass } from '@kmind/shared';

interface BuiltinInput {
  id: string;
  label?: string;
  scaffold?: string;
  guidance?: string;
  requiredSections?: string[];
  rules?: AssetTypeRule[];
  classifyPatterns?: string[];
  ontologyClass?: string;
  kernel?: boolean;
  legacyProfile?: LegacyQualityProfile;
  enabled?: boolean;
}

function def(partial: BuiltinInput): AssetTypeDef {
  return {
    id: partial.id,
    enabled: partial.enabled ?? true,
    label: partial.label,
    scaffold: partial.scaffold ?? '',
    guidance: partial.guidance ?? '',
    requiredSections: partial.requiredSections ?? [],
    rules: partial.rules ?? [],
    classifyPatterns: partial.classifyPatterns ?? [],
    ontologyClass:
      partial.ontologyClass ?? typeIdToOntologyClass(partial.id),
    kernel: partial.kernel,
    legacyProfile: partial.legacyProfile,
  };
}

/**
 * Builtin asset type definitions (ADR-001). Vault YAML deep-merges on top.
 */
export const BUILTIN_ASSET_TYPES: AssetTypeDef[] = [
  def({
    id: 'problem',
    kernel: true,
    label: '问题',
    legacyProfile: 'problem',
    scaffold: `## 症状
## 复现
## 验收标准
`,
    guidance:
      '可跟踪的未解问题：症状/复现/验收。不要把解决方案写进本卡；有方案则另建 problem_solution + links.solves。',
    classifyPatterns: ['未解决', '待排查', 'open issue', '问题跟踪', '症状', '复现步骤'],
  }),
  def({
    id: 'outcome',
    kernel: true,
    label: '实施结果',
    legacyProfile: 'outcome',
    scaffold: `## 结果
## 证据
## 残留风险
`,
    guidance:
      '方案落地后的验证证据。必须 links.verifies → problem；写清命令输出/指标/日期。',
    classifyPatterns: ['实施结果', '验证结果', '上线结果', 'outcome', 'verified', '验证通过'],
  }),
  def({
    id: 'problem_solution',
    kernel: true,
    label: '问题解决方案',
    legacyProfile: 'solution',
    scaffold: `## 实现方式
## 注意事项
## 红线规避
`,
    guidance:
      '针对 problem 的可执行方案。建议 links.solves → problem；写清步骤与边界。',
    classifyPatterns: ['fix', 'fixed', 'solution', 'resolve', '解决方案'],
  }),
  def({
    id: 'best_practice',
    label: '最佳实践',
    legacyProfile: 'feature',
    scaffold: `## 实现方式
## 注意事项
## 红线规避
`,
    guidance: '可复用约定：写清怎么做、边界、禁止项。',
    classifyPatterns: ['best practice', 'recommend', '最佳实践'],
  }),
  def({
    id: 'architecture_design',
    label: '架构设计',
    legacyProfile: 'feature',
    rules: [{ requireCodeCitation: true }],
    scaffold: `## 实现方式
## 注意事项
## 红线规避
## 代码锚点
`,
    guidance:
      '架构决策须含代码锚点（## 代码锚点 / path+符号 / capture.anchors）。一卡一事。',
    classifyPatterns: ['architect', 'event-driven', 'microservice', '设计架构'],
  }),
  def({
    id: 'tool_usage',
    label: '工具使用',
    legacyProfile: 'feature',
    rules: [{ requireCodeCitation: true }],
    scaffold: `## 实现方式
## 注意事项
## 红线规避
## 代码锚点
`,
    guidance: '工具配置/技巧；含可核对路径或命令与代码锚点。',
    classifyPatterns: ['how to use', 'how to run', 'how to install', 'cli', '工具使用'],
  }),
  def({
    id: 'pitfall',
    label: '踩坑记录',
    legacyProfile: 'solution',
    scaffold: `## 现象
## 根因
## 正确做法
`,
    guidance: '写可复现的坑与正确做法；避免空泛抱怨。',
    classifyPatterns: ['pitfall', '踩坑', 'gotcha', 'bug', 'regression'],
  }),
  def({
    id: 'code_snippet',
    label: '代码片段',
    legacyProfile: 'feature',
    rules: [{ requireCodeCitation: true }],
    scaffold: `## 实现方式
## 注意事项
## 红线规避
## 代码锚点
`,
    guidance: '可复用实现；附代码锚点与适用边界。',
    classifyPatterns: ['```', 'snippet', 'code sample', '代码片段'],
  }),
  def({
    id: 'process_spec',
    label: '流程规范',
    legacyProfile: 'feature',
    rules: [{ requireCodeCitation: true }],
    scaffold: `## 实现方式
## 注意事项
## 红线规避
## 代码锚点
`,
    guidance: '团队流程固化；步骤可执行，含锚点或清单引用。',
    classifyPatterns: ['process', 'workflow', 'checklist', '流程规范'],
  }),
];
