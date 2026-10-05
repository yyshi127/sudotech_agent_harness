// @vitest-environment jsdom
/** Sidebar opening diagnostics over the real assembled Client Session references. */
import { expect, onTestFinished, vi } from 'vitest'
import { createClientTest, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { SidebarSessionViews } from '../src/client/session-views.ts'

const ID = SessionId('sidebar-pending-opening')
const it = createClientTest({ roster: webApp.closure(['@deepseek-ai/dsh-api-session-controller']) })

for (const action of ['dispose', 'selection-prune'] as const) {
  it(`releases an opening reference without reporting its own ${action} cancellation`, async ({ mock, start }) => {
    const entered = Promise.withResolvers<undefined>()
    mock.remote.session.list.mockResolvedValue({ ok: true, value: {
      items: [{ sessionId: ID, updatedAt: 1, running: false, blank: true, agentAvailable: true }],
    } })
    mock.stream('session/follow', () => { entered.resolve(undefined) })
    const client = await start()
    const views = new SidebarSessionViews(client.ctx.sessions)
    onTestFinished(() => { views.dispose() })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    onTestFinished(() => { error.mockRestore() })
    views.select(ID)
    const reference = views.source.getSnapshot()[0]!.reference
    const release = vi.spyOn(reference, 'release')
    await entered.promise
    expect(client.ctx.sessions.retainInfo(ID).getSnapshot().referenceCount).toBe(1)
    if (action === 'dispose') views.dispose()
    else views.select(undefined)
    await expect(reference.ready).rejects.toThrow('is released')
    expect(release).toHaveBeenCalledOnce()
    expect(client.ctx.sessions.retainInfo(ID).getSnapshot().referenceCount).toBe(0)
    expect(() => reference.binding).toThrow('is released')
    expect(error).not.toHaveBeenCalled()
    views.dispose()
    expect(release).toHaveBeenCalledOnce()
    mock.assertNoUnmatched()
  })
}
