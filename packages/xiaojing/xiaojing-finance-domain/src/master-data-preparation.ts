/** Exact-version master-data commands and explicit proposals; business validators own accounting fields. */
import { z } from 'zod'
import { validateSubjectPreparation } from './subject-preparation.ts'
import { validateAuxiliaryPreparation } from './auxiliary-preparation.ts'
import type { MasterDataProposal } from './master-data-records.ts'

/** Untrusted preparation commands cannot supply a ledger, approval or sender parameters. */
export const masterDataPreparationRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('prepare'), proposal: z.unknown() }),
  z.strictObject({ action: z.literal('revise'), id: z.uuid(), version: z.number().int().positive(), proposal: z.unknown() }),
  z.strictObject({ action: z.literal('inspect'), id: z.uuid() }),
])
/** Creation identifies only a previously prepared exact version. */
export const masterDataCreateRequestSchema = z.strictObject({ id: z.uuid(), version: z.number().int().positive() })

/**
 * Validate a complete proposal without accounting defaults or arbitrary request fields.
 * @param input - Model-supplied or persisted proposal.
 * @param maxBytes - Complete normalized proposal limit.
 * @returns Explicit subject or auxiliary-item values.
 */
export function validateMasterDataProposal(input: unknown, maxBytes: number): MasterDataProposal {
  const parsed = z.strictObject({ kind: z.enum(['subject', 'auxiliary-item']), input: z.unknown() }).parse(input)
  const result: MasterDataProposal = parsed.kind === 'subject'
    ? { kind: parsed.kind, input: validateSubjectPreparation(parsed.input, maxBytes) }
    : { kind: parsed.kind, input: validateAuxiliaryPreparation(parsed.input, maxBytes) }
  if (Buffer.byteLength(JSON.stringify(result)) > maxBytes) throw new Error('基础资料准备内容超过大小限制。')
  return result
}
