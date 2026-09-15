/** Qualified empty-ID master-data responses and auxiliary readback; no authorization or write retries. */
import { z } from 'zod'
import type { MasterDataSubmissionOutcome } from './master-data-records.ts'
import type { AuxiliaryPreparationInput, AuxiliaryReferenceSelection } from './auxiliary-preparation.ts'
import type { ReferenceResult } from './references.ts'

/**
 * Classify the qualified subject/auxiliary add envelopes without forwarding vendor prose.
 * @param value - Bounded parsed response, not an arbitrary success message.
 * @param httpOk - Whether the HTTP status was successful.
 * @returns Accepted without an ID, explicit parameter rejection, or uncertainty; none grants retry authority.
 */
export function classifyMasterDataSubmission(value: unknown, httpOk: boolean): MasterDataSubmissionOutcome {
  const parsed = z.object({ result: z.number().int(), data: z.unknown().optional() }).safeParse(value)
  if (!httpOk || !parsed.success) return { state: 'outcome-unknown' }
  if (parsed.data.result >= 200 && parsed.data.result < 300) return { state: 'rejected', code: parsed.data.result }
  if (parsed.data.result === 100 && parsed.data.data === '') return { state: 'accepted' }
  return { state: 'outcome-unknown' }
}

/** Public auxiliary queries omit status; content matches do not establish the requested enabled/disabled state. */
export interface AuxiliaryReadback {
  content: 'matched' | 'mismatch' | 'unavailable'
  status: 'unavailable'
  complete: false
}

/**
 * Compare the original category/code/name without treating missing status as enabled.
 * @param result - Independent returned item set for the reserved category and ledger.
 * @param input - Original sent business values.
 * @param selection - Reserved ledger and category identity.
 * @returns Content comparison only; a missing row cannot establish non-creation or authorize resending.
 */
export function compareAuxiliaryReadback(result: ReferenceResult, input: AuxiliaryPreparationInput,
  selection: AuxiliaryReferenceSelection): AuxiliaryReadback {
  if (result.kind !== 'auxiliary-items' || result.accountId !== selection.accountId || result.accountName !== selection.accountName
    || result.categoryCode !== selection.categoryCode || input.categoryCode !== selection.categoryCode) {
    return { content: 'mismatch', status: 'unavailable', complete: false }
  }
  const rows = result.rows.filter(row => row.code === input.itemCode)
  const content = rows.length !== 1 ? 'unavailable' : rows[0]?.name === input.itemName ? 'matched' : 'mismatch'
  return { content, status: 'unavailable', complete: false }
}
