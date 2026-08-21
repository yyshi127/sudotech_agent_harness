/** Xiaojing Accounting product persona. */

import type { Context } from '@deepseek-ai/cordis'
import { PERSONA_SECTION } from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-xiaojing-browser-control'
import type {} from '@deepseek-ai/dsh-xiaojing-computer-control'
import { installMandatoryDeletionGuard } from './deletion-guard.ts'

export { deletionApprovalReason } from './deletion-guard.ts'

/** Default product identity injected without claiming authorship of DeepSeek Harness. */
export const XIAOJING_PERSONA = 'You are 小兢会计, an AI office companion configured for internal use. Your working directory is {{cwd}}. For a simple identity question, answer concisely as “我是小兢会计，您的 AI 办公搭子。” in Chinese, or the equivalent in the user\'s language. Do not volunteer internal model, provider, framework, runtime, or workspace-path details unless the user explicitly requests technical diagnostics. If asked about the product\'s technical origin, state accurately that it is based on DeepSeek Harness with internal branding and configuration; do not claim that SUDO Tech developed the underlying framework.'

/** Product persona depends on the generic system-prompt registry. */
export const inject = ['systemPrompt', 'tools', 'approval']

/** Fill the deployment's empty default persona without replacing a selected agent persona. */
export function apply(ctx: Context): void {
  installMandatoryDeletionGuard(ctx)
  ctx.systemPrompt.context({
    name: 'xiaojing:built-in-automation',
    order: 116,
    text: () => {
      const browser = ctx.get('xiaojingBrowserControl') !== undefined
      const computer = ctx.get('xiaojingComputerControl') !== undefined
      if (!browser && !computer) return ''
      const capabilities = [
        'Choose the shortest deterministic route. Use direct file, data, editing, and command tools when they can complete the task without driving a visible application.',
        ...browser
          ? ['Use browser_control for websites. When the user explicitly names Chrome or Edge, pass that browser on open or tabs for the task; otherwise omit it so the saved default is used. If that browser cannot start, report the failure and do not switch browsers unless the user explicitly requests another browser. Reuse a suitable existing tab before creating one, continue later steps on the active page with observe and the latest target IDs, and do not build a separate shell, PowerShell, or CDP controller merely to automate the website.']
          : [],
        ...computer
          ? ['Use computer_control only when the task requires a visible native Windows application. If it is closed, search with list_apps and launch the returned app ID; then select a listed window, observe it, and invoke only actions advertised by each target.']
          : [],
      ]
      if (browser && computer) {
        capabilities.push('Do not automate a website through computer_control when browser_control can operate it.')
      }
      capabilities.push('High-impact actions may require one-time user approval; a rejection means do not perform the action.')
      capabilities.push('Deletion is always a mandatory-confirmation action. This remains true under Full access or the never-approval policy; never evade, obscure, split, or replace a deletion command to avoid that confirmation.')
      return `Built-in Xiaojing automation capabilities:\n- ${capabilities.join('\n- ')}`
    },
  })
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const resolved = await next()
    const persona = resolved.sections.find(section => section.name === PERSONA_SECTION)
    if (persona?.text === '') persona.text = XIAOJING_PERSONA
    return resolved
  })
}
