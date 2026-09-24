/** Persist a compact, business-facing card alongside each successful Finance result. */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

/**
 * Preserve the existing Host presenter as durable Client display metadata.
 * @param tool - One Finance tool with a Host-local result presenter.
 * @returns The same tool with a replayable success-card projection.
 */
export function withFinanceCard(tool: ToolDefinition): ToolDefinition {
  const output = tool.output
  return {
    ...tool,
    output: {
      ...output,
      presentationMeta(args, value) {
        const existing = output.presentationMeta?.(args, value)
        const content = output.render(args, value)
        const view = tool.presentResult?.(args, {
          content, isError: false, ...existing === undefined ? {} : { meta: existing },
        })
        if (view?.card !== 'generic') return { kind: 'xiaojing-finance-card', title: '财务结果已返回', text: '' }
        const visible = view.content ?? content
        return {
          kind: 'xiaojing-finance-card',
          title: view.title ?? tool.name,
          text: visible.filter(block => block.type === 'text').map(block => block.text).join('\n'),
        }
      },
    },
  }
}
