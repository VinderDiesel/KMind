export {
  selectModules,
  type SelectModulesOptions,
  type SelectModulesResult,
} from './select.js';
export {
  matchCandidateType,
  loadBootstrapRules,
  type TypeMatch,
} from './rules.js';
export { matchPathGlob } from './glob.js';
export {
  groupModules,
  groupLabel,
  digTaskId,
  MAX_TASKS_PER_GROUP,
  type ExistingAssetHint,
  type GroupModulesOptions,
} from './group.js';
export {
  buildBootstrapPlan,
  type BuildBootstrapPlanOptions,
} from './plan.js';
export {
  buildBootstrapPlanForVault,
  type VaultBootstrapPlanOptions,
} from './vault-plan.js';
export {
  applyBootstrapPlanToFeatureTree,
  BOOTSTRAP_TREE_START,
  BOOTSTRAP_TREE_END,
  type ApplyFeatureTreeResult,
} from './apply-feature-tree.js';
export {
  bootstrapProgressPath,
  loadBootstrapProgress,
  saveBootstrapProgress,
  hashBootstrapPlan,
  mergeProgressIntoPlan,
  upsertProgressTask,
  emptyBootstrapProgress,
} from './progress.js';
export {
  markBootstrapProgressTask,
  type MarkBootstrapProgressTaskInput,
  type MarkBootstrapProgressTaskResult,
} from './mark-task.js';
export {
  findDigTask,
  lookupDigTaskCandidateType,
  resolveBootstrapCandidateType,
} from './lookup-task.js';
export {
  enrichSuggestedAnchors,
  extractExportNames,
} from './anchors.js';
export {
  OllamaBootstrapLlm,
  modulesFromLlmGroups,
  type BootstrapLlmClient,
  type LlmGroupResult,
  type ModuleGroupMeta,
  type OllamaBootstrapLlmOptions,
} from './llm.js';
export {
  buildDigPacket,
  resolveDigGroup,
  pickRecommendedNextGroup,
  summarizeDelegateGroups,
  type BuildDigPacketOptions,
  type DelegateGroupsSummary,
  type DelegateGroupSummaryRow,
} from './delegate.js';
