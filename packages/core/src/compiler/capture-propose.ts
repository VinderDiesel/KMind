import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  CAPTURE_PROPOSAL_VERSION,
  CaptureProposalSchema,
  KMindError,
  type CaptureProposal,
  type CaptureProposalFields,
} from '@kmind/shared';
import type { Vault } from '../storage/vault.js';

const PROPOSALS_DIRNAME = 'proposals';

export interface CommitCaptureProposalResult {
  proposal: CaptureProposal;
  assetId?: string;
}

export interface ManualCaptureDeps {
  /**
   * Execute the confirmed capture (write raw + compile). Must not mark proposal.
   */
  execute: (
    fields: CaptureProposalFields,
  ) => Promise<{ assetId?: string }>;
}

/**
 * Directory for staged capture proposals under vault audit/.
 */
export function captureProposalsDir(vault: Vault): string {
  return path.join(vault.auditDir, PROPOSALS_DIRNAME);
}

function proposalPath(vault: Vault, id: string): string {
  return path.join(captureProposalsDir(vault), `${id}.json`);
}

function newProposalId(now = new Date()): string {
  const day = now.toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = randomBytes(3).toString('hex');
  return `prop-${day}-${suffix}`;
}

/**
 * Stage a capture proposal on disk (status=open). Does not write knowledge.
 */
export async function createCaptureProposal(
  vault: Vault,
  fields: CaptureProposalFields,
  options?: { suggestionsDigest?: string; now?: Date },
): Promise<CaptureProposal> {
  const now = options?.now ?? new Date();
  const proposal = CaptureProposalSchema.parse({
    version: CAPTURE_PROPOSAL_VERSION,
    id: newProposalId(now),
    status: 'open',
    fields,
    suggestionsDigest: options?.suggestionsDigest,
    createdAt: now.toISOString(),
  });
  await fs.mkdir(captureProposalsDir(vault), { recursive: true });
  const file = proposalPath(vault, proposal.id);
  await fs.writeFile(file, `${JSON.stringify(proposal, null, 2)}\n`, 'utf8');
  return proposal;
}

/**
 * Load a capture proposal by id, or null if missing/invalid.
 */
export async function loadCaptureProposal(
  vault: Vault,
  proposalId: string,
): Promise<CaptureProposal | null> {
  const id = proposalId.trim();
  if (!id) return null;
  try {
    const raw = await fs.readFile(proposalPath(vault, id), 'utf8');
    const parsed = CaptureProposalSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function saveProposal(
  vault: Vault,
  proposal: CaptureProposal,
): Promise<void> {
  const file = proposalPath(vault, proposal.id);
  await fs.writeFile(
    file,
    `${JSON.stringify(CaptureProposalSchema.parse(proposal), null, 2)}\n`,
    'utf8',
  );
}

/**
 * Commit an open proposal via deps.execute; marks committed (or errors if consumed).
 */
export async function commitCaptureProposal(
  vault: Vault,
  proposalId: string,
  deps: ManualCaptureDeps,
  now = new Date(),
): Promise<CommitCaptureProposalResult> {
  const existing = await loadCaptureProposal(vault, proposalId);
  if (!existing) {
    throw new KMindError(`capture proposal not found: ${proposalId}`, {
      category: 'CAPTURE_ERROR',
      severity: 'medium',
      retryable: true,
      suggestion: 'kmind_capture_propose first; check proposal id',
    });
  }
  if (existing.status !== 'open') {
    throw new KMindError(
      `capture proposal already ${existing.status}: ${proposalId}`,
      {
        category: 'CAPTURE_ERROR',
        severity: 'medium',
        retryable: false,
        suggestion: 'Create a new proposal; committed proposals are consumed',
      },
    );
  }
  const { assetId } = await deps.execute(existing.fields);
  const proposal = CaptureProposalSchema.parse({
    ...existing,
    status: 'committed',
    committedAt: now.toISOString(),
    assetId,
  });
  await saveProposal(vault, proposal);
  return { proposal, assetId };
}

/**
 * Optional digest of suggestion ids for audit trails.
 */
export function digestSuggestionIds(ids: string[]): string {
  return createHash('sha256').update(ids.sort().join('|')).digest('hex').slice(0, 16);
}
