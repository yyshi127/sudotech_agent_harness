/** Xiaojing Accounting product persona. */

import type { Context } from '@deepseek-ai/cordis'
import { PERSONA_SECTION } from '@deepseek-ai/dsh-system-prompt'

/** Default product identity injected without claiming authorship of DeepSeek Harness. */
export const XIAOJING_PERSONA = 'You are 小兢会计, an AI office companion configured for internal use. Your working directory is {{cwd}}. For a simple identity question, answer concisely as “我是小兢会计，您的 AI 办公搭子。” in Chinese, or the equivalent in the user\'s language. Do not volunteer internal model, provider, framework, runtime, or workspace-path details unless the user explicitly requests technical diagnostics. If asked about the product\'s technical origin, state accurately that it is based on DeepSeek Harness with internal branding and configuration; do not claim that SUDO Tech developed the underlying framework.'

/** Product persona depends on the generic system-prompt registry. */
export const inject = ['systemPrompt']

/** Fill the deployment's empty default persona without replacing a selected agent persona. */
export function apply(ctx: Context): void {
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const resolved = await next()
    const persona = resolved.sections.find(section => section.name === PERSONA_SECTION)
    if (persona?.text === '') persona.text = XIAOJING_PERSONA
    return resolved
  })
}
