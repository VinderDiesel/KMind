import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import YAML from 'yaml';
import { KMindConfigSchema, type KMindConfig, KMindError } from '@kmind/shared';

export interface Vault {
  readonly root: string;
  readonly knowledgeDir: string;
  readonly rawDir: string;
  readonly ontologyDir: string;
  readonly indexPath: string;
  readonly configPath: string;
  readonly auditDir: string;

  init(): Promise<void>;
  exists(): Promise<boolean>;
  getConfig(): Promise<KMindConfig>;
  saveConfig(config: KMindConfig): Promise<void>;
}

/**
 * Create a Vault rooted at the given path (default ~/.kmind).
 */
export function createVault(root?: string): Vault {
  const vaultRoot = root ?? path.join(os.homedir(), '.kmind');
  return new VaultImpl(vaultRoot);
}

class VaultImpl implements Vault {
  readonly knowledgeDir: string;
  readonly rawDir: string;
  readonly ontologyDir: string;
  readonly indexPath: string;
  readonly configPath: string;
  readonly auditDir: string;

  constructor(readonly root: string) {
    this.knowledgeDir = path.join(root, 'knowledge');
    this.rawDir = path.join(root, 'raw');
    this.ontologyDir = path.join(root, 'ontology');
    this.indexPath = path.join(root, 'index.db');
    this.configPath = path.join(root, 'config.yaml');
    this.auditDir = path.join(root, 'audit');
  }

  async exists(): Promise<boolean> {
    try {
      await fs.access(this.configPath);
      return true;
    } catch {
      return false;
    }
  }

  async init(): Promise<void> {
    await fs.mkdir(this.knowledgeDir, { recursive: true });
    await fs.mkdir(path.join(this.rawDir, 'sessions'), { recursive: true });
    await fs.mkdir(path.join(this.rawDir, 'manual'), { recursive: true });
    await fs.mkdir(this.ontologyDir, { recursive: true });
    await fs.mkdir(this.auditDir, { recursive: true });
    await fs.mkdir(path.join(this.root, 'diagnostics'), { recursive: true });

    if (!(await this.exists())) {
      const config = KMindConfigSchema.parse({
        version: '0.1.0',
        vaultPath: this.root,
      });
      await this.saveConfig(config);
    }

    const ontologyPath = path.join(this.ontologyDir, 'ontology.yaml');
    try {
      await fs.access(ontologyPath);
    } catch {
      await fs.writeFile(ontologyPath, DEFAULT_ONTOLOGY, 'utf8');
    }
  }

  async getConfig(): Promise<KMindConfig> {
    try {
      const raw = await fs.readFile(this.configPath, 'utf8');
      return KMindConfigSchema.parse(YAML.parse(raw));
    } catch (cause) {
      throw new KMindError('Failed to read vault config', {
        category: 'CONFIG_ERROR',
        severity: 'high',
        retryable: false,
        suggestion: 'Run kmind init to create config.yaml',
        cause,
      });
    }
  }

  async saveConfig(config: KMindConfig): Promise<void> {
    const parsed = KMindConfigSchema.parse(config);
    await fs.writeFile(this.configPath, YAML.stringify(parsed), 'utf8');
  }
}

const DEFAULT_ONTOLOGY = `version: "1.0"
classes:
  KnowledgeAsset:
    abstract: true
    description: Base knowledge asset
    properties:
      id: { type: string, required: true }
      type: { type: enum, required: true, values: [problem_solution, best_practice, architecture_design, tool_usage, pitfall, code_snippet, process_spec] }
      title: { type: string, required: true }
  ProblemSolution:
    parent: KnowledgeAsset
    properties:
      decision: { type: text, required: true }
  BestPractice:
    parent: KnowledgeAsset
    properties:
      decision: { type: text, required: true }
  ArchitectureDesign:
    parent: KnowledgeAsset
    properties:
      decision: { type: text, required: true }
  ToolUsage:
    parent: KnowledgeAsset
    properties:
      decision: { type: text, required: true }
  Pitfall:
    parent: KnowledgeAsset
    properties:
      decision: { type: text, required: true }
  CodeSnippet:
    parent: KnowledgeAsset
    properties:
      decision: { type: text, required: true }
  ProcessSpec:
    parent: KnowledgeAsset
    properties:
      decision: { type: text, required: true }
  Entity:
    properties:
      name: { type: string, required: true }
relations:
  derives_from: { from: KnowledgeAsset, to: KnowledgeAsset }
  supersedes: { from: KnowledgeAsset, to: KnowledgeAsset }
  contradicts: { from: KnowledgeAsset, to: KnowledgeAsset }
  related_to: { from: KnowledgeAsset, to: KnowledgeAsset, symmetric: true }
  mentions: { from: KnowledgeAsset, to: Entity }
`;
