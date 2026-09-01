import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { FinanceManagedFileId } from '@deepseek-ai/dsh-xiaojing-finance-domain/types'
import { financeDocumentSources } from '../src/compat.ts'

describe('Finance document source adapter', () => {
  it('exposes only consultation uploads owned by the calling session', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore).await()
    ctx.provide('xiaojingFinanceDomain', {
      currentClientBinding: () => undefined,
      localUploadRoot: () => 'E:/harness/uploads',
    } as never)
    const session = ctx.sessions.create(SessionId('consultation-session'), {
      meta: { agentPreset: 'finance', cwd: 'E:/Finance/咨询' },
    })
    session.append('finance/consultation-file-imported', {
      schemaVersion: 1,
      file: {
        id: FinanceManagedFileId('consultation-file'),
        sessionId: session.id,
        path: 'E:/harness/uploads/document.pdf',
        name: 'document.pdf',
        sha256: 'a'.repeat(64),
        size: 42,
        createdAt: 1,
      },
    })
    session.append('finance/consultation-file-imported', {
      schemaVersion: 1,
      file: {
        id: FinanceManagedFileId('other-session-file'),
        sessionId: 'another-session',
        path: 'E:/harness/uploads/other.pdf',
        name: 'other.pdf',
        sha256: 'b'.repeat(64),
        size: 21,
        createdAt: 2,
      },
    })
    const agent = { session } as Agent

    expect(financeDocumentSources(ctx, agent)).toEqual([{
      sourceRoot: 'E:/harness/uploads',
      cacheScope: `session:${session.id}`,
      file: {
        id: FinanceManagedFileId('consultation-file'),
        sessionId: session.id,
        path: 'E:/harness/uploads/document.pdf',
        name: 'document.pdf',
        sha256: 'a'.repeat(64),
        size: 42,
        createdAt: 1,
      },
    }])
    await ctx.fiber.dispose()
  })
})
