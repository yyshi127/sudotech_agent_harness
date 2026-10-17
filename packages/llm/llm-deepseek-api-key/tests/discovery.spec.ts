/** Model discovery requires the API-key route's own credential. */
import { Context, Service } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { expect, it, vi } from 'vitest'
import * as ApiKey from '../src/index.ts'

it('adds missing current defaults to a legacy catalog without duplicating customized Pro entries', async () => {
  const legacy = { id: 'deepseek-v4-flash', name: 'Retained Flash' }
  const customizedPro = { id: 'deepseek-v4-pro', name: 'Custom Pro', contextWindow: 32_000 }
  const user: Record<string, unknown> = { models: [legacy, customizedPro] }
  class CatalogSettings extends Service {
    constructor(ctx: Context) { super(ctx, 'settings') }
    describe() { return [{ ns: 'llm-deepseek-api-key', user, revision: 0 }] }
    async mutate(_namespace: string, operations: Parameters<Context['settings']['mutate']>[1]): Promise<void> {
      for (const operation of operations) {
        if (operation.op !== 'set' || operation.path.join('.') !== 'models') throw new Error('Unexpected catalog migration')
        user['models'] = operation.value
      }
    }
  }
  const ctx = new Context()
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(CatalogSettings)
    await ctx.plugin(ApiKey, {})
    await vi.waitFor(() => {
      expect(user['models']).toEqual([
        expect.objectContaining({ id: 'deepseek-flash', inputModalities: ['text', 'image'] }),
        legacy,
        customizedPro,
      ])
    })
  } finally {
    await ctx.fiber.dispose()
  }
})

it.each([undefined, ''])('hides models without an API key: %j', async (key) => {
  vi.stubEnv('DEEPSEEK_API_KEY', key)
  const ctx = new Context()
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(ApiKey, {})
    expect(await ctx.llm.listModels('deepseek-official')).toEqual([])
  } finally {
    await ctx.fiber.dispose()
    vi.unstubAllEnvs()
  }
})

it('advertises configured models with an API key', async () => {
  vi.stubEnv('DEEPSEEK_API_KEY', 'fixture-api-key')
  const ctx = new Context()
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(ApiKey, {})
    expect(await ctx.llm.listModels('deepseek-official')).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'deepseek-official', id: 'deepseek-flash' }),
    ]))
  } finally {
    await ctx.fiber.dispose()
    vi.unstubAllEnvs()
  }
})

it('reports malformed credentials during discovery', async () => {
  vi.stubEnv('DEEPSEEK_API_KEY', 'invalid\nheader')
  const ctx = new Context()
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(ApiKey, {})
    await expect(ctx.llm.listModels('deepseek-official')).rejects.toMatchObject({ code: 'INVALID_CREDENTIAL' })
  } finally {
    await ctx.fiber.dispose()
    vi.unstubAllEnvs()
  }
})
