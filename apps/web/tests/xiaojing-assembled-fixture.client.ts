/** Xiaojing-owned assembled Client responses and render/teardown error checks. */
import { ok, type RemoteMock } from '@deepseek-ai/dsh-remote-mock'
import { afterEach, beforeEach, expect, vi } from 'vitest'

/** Assert render-time publication and teardown subscriber errors while forwarding every console error. */
export function installAssembledRenderErrorCheck(): void {
  let renderErrors: unknown[][] = []
  let restore: (() => void) | undefined
  beforeEach(() => {
    renderErrors = []
    const originalError = console.error.bind(console)
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      const message = String(args[0])
      if (message.includes('Cannot update a component') || message.includes('[client-store] subscriber failed:')) {
        renderErrors.push(args)
      }
      originalError(...args)
    })
    restore = () => { spy.mockRestore() }
  })
  afterEach(() => {
    try {
      expect(renderErrors).toEqual([])
    } finally {
      restore?.()
    }
  })
}

/**
 * Add empty finance and zero usage answers required by the Xiaojing Client.
 * @param mock - case-owned transport receiving the explicit responses.
 */
export function loadXiaojingAssembledResponses(mock: RemoteMock): void {
  if (process.env['DSH_CLIENT_BUILD_PROFILE'] !== 'xiaojing') return
  mock.load({
    unary: {
      'financeClients/list': ok({ revision: 0, clients: [] }),
      'financeClients/workspaces': ok({
        workspaceRoot: '/fixture/finance',
        standard: { workspaceId: 'fixture-finance', kind: 'standard', title: 'Consultation', startable: true },
        consultations: [], clients: [], listedWorkspaceIds: ['fixture-finance'],
      }),
      'usageAccounting/snapshot': ok({
        revision: 0, month: '2026-10', today: '2026-10-01', trackingSince: '2026-10-01', keyConfigured: false, days: [],
        total: {
          date: '2026-10', cacheHitInputTokens: 0, cacheMissInputTokens: 0, outputTokens: 0, totalTokens: 0,
          cacheHitInputCostNanoyuan: '0', cacheMissInputCostNanoyuan: '0', outputCostNanoyuan: '0',
          costNanoyuan: '0', unpricedTokens: 0,
        },
      }),
    },
  })
}
