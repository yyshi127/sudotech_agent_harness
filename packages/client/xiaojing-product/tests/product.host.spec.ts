import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as XiaojingProduct from '../src/index.ts'
import { XIAOJING_PERSONA } from '../src/index.ts'

describe('Xiaojing product persona', () => {
  it('fills an empty deployment persona without claiming framework authorship', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false }).await()
    await ctx.plugin(XiaojingProduct).await()

    const prompt = (await ctx.systemPrompt.assemble()).sections
      .find(section => section.name === 'deployment:persona')?.text
    expect(prompt).toBe(XIAOJING_PERSONA)
    expect(prompt).toContain('based on DeepSeek Harness')
    expect(prompt).toContain('do not claim that SUDO Tech developed the underlying framework')
    await ctx.fiber.dispose()
  })

  it('leaves an explicitly configured persona unchanged', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, persona: 'User-selected persona.' }).await()
    await ctx.plugin(XiaojingProduct).await()

    expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe('User-selected persona.')
    await ctx.fiber.dispose()
  })
})
