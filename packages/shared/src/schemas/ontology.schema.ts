import { z } from 'zod';

export const PropertyDefSchema = z.object({
  type: z.enum([
    'string',
    'text',
    'number',
    'float',
    'boolean',
    'datetime',
    'list',
    'enum',
    'record',
  ]),
  required: z.boolean().default(false),
  nullable: z.boolean().default(false),
  values: z.array(z.string()).optional(),
  range: z.tuple([z.number(), z.number()]).optional(),
  default: z.unknown().optional(),
  description: z.string().optional(),
});
export type PropertyDef = z.infer<typeof PropertyDefSchema>;

export const ClassDefSchema = z.object({
  parent: z.string().optional(),
  abstract: z.boolean().default(false),
  description: z.string().optional(),
  properties: z.record(PropertyDefSchema),
});
export type ClassDef = z.infer<typeof ClassDefSchema>;

export const RelationDefSchema = z.object({
  from: z.string(),
  to: z.string(),
  symmetric: z.boolean().default(false),
  transitive: z.boolean().default(false),
  description: z.string().optional(),
});
export type RelationDef = z.infer<typeof RelationDefSchema>;

export const OntologySchema = z.object({
  version: z.string().regex(/^\d+\.\d+$/),
  classes: z.record(ClassDefSchema),
  relations: z.record(RelationDefSchema),
});
export type Ontology = z.infer<typeof OntologySchema>;
