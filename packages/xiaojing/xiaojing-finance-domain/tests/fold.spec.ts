import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { FinanceClientId } from '../src/types.ts'
import { foldFinanceClientEvents } from '../src/fold.ts'

const binding = {
  schemaVersion: 1 as const,
  clientVersion: 1,
  workspacePath: 'C:\\Finance\\历史公司',
  client: {
    id: FinanceClientId('6ba7b810-9dad-11d1-80b4-00c04fd430c8'),
    legalName: '历史公司',
    taxpayerType: 'general-vat' as const,
    registeredRegion: '杭州市',
    accountingStandard: 'enterprise' as const,
    chartMappings: [],
    externalSystemRefs: [],
  },
}

describe('Finance client binding fold', () => {
  it('reconstructs a bound session after restart from its event log', () => {
    const original = Session.create(SessionId('finance-history'))
    original.append('finance/client-bound', binding)
    const restored = Session.create(SessionId('finance-history-restored'), original.snapshotEvents())
    expect(foldFinanceClientEvents(restored.snapshotEvents())).toEqual({ state: 'bound', binding })
  })

  it('rejects a second client binding', () => {
    const session = Session.create(SessionId('finance-double'))
    session.append('finance/client-bound', binding)
    session.append('finance/client-bound', binding)
    expect(() => foldFinanceClientEvents(session.snapshotEvents())).toThrow(/only once/)
  })
})
