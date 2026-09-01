/** Browser-safe projection of a Finance session's immutable client binding. */

import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import {
  applyFinanceClientEvent,
  EMPTY_FINANCE_CLIENT_STATE,
  financeClientBindingSchema,
} from './fold.ts'
import type { FinanceClientProjectionState } from './types.ts'

const stateSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('unbound') }).strict(),
  z.object({ state: z.literal('bound'), binding: financeClientBindingSchema }).strict(),
])

const viewSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('unbound') }).strict(),
  z.object({
    state: z.literal('bound'),
    clientName: z.string().min(1),
  }).strict(),
])

/** Projection registered by the Finance domain Host service. */
export const financeClientProjectionDefinition = {
  key: 'financeClient',
  stateVersion: 1,
  stateSchema,
  init: () => EMPTY_FINANCE_CLIENT_STATE,
  apply: applyFinanceClientEvent,
  wire: {
    viewSchema,
    view: state => state.state === 'unbound'
      ? state
      : {
        state: 'bound' as const,
        clientName: state.binding.client.shortName ?? state.binding.client.legalName,
      },
  },
} satisfies ProjectionDefinition<'financeClient', FinanceClientProjectionState>
