import type {
  ClassDef,
  KnowledgeAsset,
  KnowledgeType,
  Ontology,
  RelationDef,
} from '@kmind/shared';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const TYPE_TO_CLASS: Record<KnowledgeType, string> = {
  problem: 'Problem',
  outcome: 'Outcome',
  problem_solution: 'ProblemSolution',
  best_practice: 'BestPractice',
  architecture_design: 'ArchitectureDesign',
  tool_usage: 'ToolUsage',
  pitfall: 'Pitfall',
  code_snippet: 'CodeSnippet',
  process_spec: 'ProcessSpec',
};

/**
 * In-memory ontology registry with hot-reload support.
 */
export class OntologyRegistry {
  private ontology: Ontology | null = null;
  private readonly fixedClasses = new Set([
    'KnowledgeAsset',
    'Problem',
    'Outcome',
    'ProblemSolution',
    'BestPractice',
    'ArchitectureDesign',
    'ToolUsage',
    'Pitfall',
    'CodeSnippet',
    'ProcessSpec',
    'Entity',
  ]);

  /** Load (or hot-reload) an ontology. */
  load(ontology: Ontology): void {
    this.ontology = ontology;
  }

  getClass(name: string): ClassDef | null {
    return this.ontology?.classes[name] ?? null;
  }

  getRelation(name: string): RelationDef | null {
    return this.ontology?.relations[name] ?? null;
  }

  getAllClasses(): Array<{ name: string; def: ClassDef }> {
    if (!this.ontology) return [];
    return Object.entries(this.ontology.classes).map(([name, def]) => ({
      name,
      def,
    }));
  }

  getAllRelations(): Array<{ name: string; def: RelationDef }> {
    if (!this.ontology) return [];
    return Object.entries(this.ontology.relations).map(([name, def]) => ({
      name,
      def,
    }));
  }

  isFixed(className: string): boolean {
    return this.fixedClasses.has(className);
  }

  /**
   * Infer ontology class name from knowledge type.
   */
  inferClass(asset: Partial<KnowledgeAsset>): string {
    if (asset.ontologyClass) return asset.ontologyClass;
    if (asset.type) return TYPE_TO_CLASS[asset.type];
    return 'BestPractice';
  }

  /**
   * Validate an asset against the loaded ontology.
   */
  validate(asset: KnowledgeAsset): ValidationResult {
    const errors: string[] = [];
    if (!this.ontology) {
      errors.push('Ontology not loaded');
      return { valid: false, errors };
    }
    const className = asset.ontologyClass || this.inferClass(asset);
    const cls = this.getClass(className);
    if (!cls) {
      errors.push(`Unknown class: ${className}`);
    } else if (cls.abstract) {
      errors.push(`Cannot instantiate abstract class: ${className}`);
    }
    if (!asset.title) errors.push('title is required');
    if (!asset.context?.decision) errors.push('context.decision is required');
    return { valid: errors.length === 0, errors };
  }

  describe(className?: string): Record<string, unknown> {
    if (!this.ontology) return { loaded: false };
    if (className) {
      const def = this.getClass(className);
      return def
        ? { name: className, ...def, fixed: this.isFixed(className) }
        : { error: `Unknown class: ${className}` };
    }
    return {
      version: this.ontology.version,
      classes: this.getAllClasses().map((c) => c.name),
      relations: this.getAllRelations().map((r) => r.name),
    };
  }
}
