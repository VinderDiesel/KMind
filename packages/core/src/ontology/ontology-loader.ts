import { promises as fs } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { OntologySchema, type Ontology, KMindError } from '@kmind/shared';

/**
 * Load and validate ontology.yaml from a directory.
 */
export async function loadOntology(ontologyDir: string): Promise<Ontology> {
  const filePath = path.join(ontologyDir, 'ontology.yaml');
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return OntologySchema.parse(YAML.parse(raw));
  } catch (cause) {
    throw new KMindError('Failed to load ontology', {
      category: 'ONTOLOGY_ERROR',
      severity: 'high',
      retryable: false,
      suggestion: 'Ensure ontology/ontology.yaml exists and is valid YAML',
      cause,
    });
  }
}

/**
 * Persist ontology to disk.
 */
export async function saveOntology(
  ontologyDir: string,
  ontology: Ontology,
): Promise<void> {
  const parsed = OntologySchema.parse(ontology);
  const filePath = path.join(ontologyDir, 'ontology.yaml');
  await fs.writeFile(filePath, YAML.stringify(parsed), 'utf8');
}
