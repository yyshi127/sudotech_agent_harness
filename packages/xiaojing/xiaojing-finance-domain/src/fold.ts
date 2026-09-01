/** Strict fold over immutable Finance client-binding events. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import { FinanceClientId, type FinanceClientBinding, type FinanceClientProjectionState } from './types.ts'

const optionalText = (max: number) => z.string().min(1).max(max).optional()
/** Durable Finance client-binding payload schema. */
export const financeClientBindingSchema = z.object({
  schemaVersion: z.literal(1),
  clientVersion: z.number().int().positive(),
  workspacePath: z.string().min(1),
  client: z.object({
    id: z.uuid().transform(FinanceClientId),
    legalName: z.string().min(1).max(200),
    shortName: optionalText(100),
    unifiedSocialCreditCode: z.string().regex(/^[0-9A-HJ-NPQRTUWXY]{18}$/u).optional(),
    taxpayerType: z.enum(['general-vat', 'small-scale-vat', 'other']),
    registeredRegion: z.string().min(1).max(100),
    accountingStandard: z.enum(['enterprise', 'small-enterprise', 'government', 'nonprofit', 'other']),
    industry: optionalText(100),
    financePolicyNotes: optionalText(10_000),
    chartMappings: z.array(z.object({
      localAccountCode: z.string().min(1).max(100),
      externalAccountCode: z.string().min(1).max(100),
    }).strict()).max(500),
    externalSystemRefs: z.array(z.object({
      system: z.enum(['youcheng', 'sdoo']),
      tenantId: optionalText(200),
      companyId: optionalText(200),
      accountSetId: optionalText(200),
    }).strict()).max(20),
  }).strict(),
}).strict().transform(value => value as FinanceClientBinding)

/** Empty Finance binding fold state. */
export const EMPTY_FINANCE_CLIENT_STATE: FinanceClientProjectionState = Object.freeze({ state: 'unbound' })

/**
 * Decode one binding payload from a durable event.
 * @param value - Untrusted restored payload.
 * @returns Validated binding.
 */
export function decodeFinanceClientBinding(value: unknown): FinanceClientBinding {
  return financeClientBindingSchema.parse(value)
}

/**
 * Apply one event and reject a second binding.
 * @param state - Prior fold state.
 * @param event - Candidate event.
 * @returns Next fold state.
 */
export function applyFinanceClientEvent(
  state: FinanceClientProjectionState,
  event: SessionEvent,
): FinanceClientProjectionState {
  if (event.type !== 'finance/client-bound') return state
  if (state.state === 'bound') throw new Error('a Finance session may bind a client only once')
  return { state: 'bound', binding: decodeFinanceClientBinding(event.data) }
}

/**
 * Fold a complete session log.
 * @param events - Ordered session events.
 * @returns Immutable client-binding state.
 */
export function foldFinanceClientEvents(events: readonly SessionEvent[]): FinanceClientProjectionState {
  let state = EMPTY_FINANCE_CLIENT_STATE
  for (const event of events) state = applyFinanceClientEvent(state, event)
  return state
}
