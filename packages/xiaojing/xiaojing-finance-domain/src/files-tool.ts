/** Finance-preset tool for formal publication and explicit archival of client files. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { financeModelCall } from './model-result.ts'
import { financeResultContent } from './result-presentation.ts'
import { withFinanceCard } from './finance-card.ts'

/** Loader-visible plugin name. */
export const name = 'xiaojing-finance-files-tool'

/** Required services for the Finance file consumer. */
export const inject = ['tools', 'xiaojingFinanceDomain']

/** Register the Finance-only controlled file lifecycle tool. @param ctx - Finance agent scope. */
export function apply(ctx: Context): void {
  ctx.tools.register(withFinanceCard(defineTool({
    name: 'finance_files',
    description: [
      'Commit files in the current client-bound Finance workspace.',
      'Use action=publish when the user asks for a final version, formal output, export, delivery, or saved deliverable.',
      'The source must already exist in this session\'s 03-会话作业 directory.',
      'Keep drafts, previews, trial calculations, and ambiguous work in 03-会话作业 without calling this tool.',
      'Use action=archive only when the user explicitly asks to archive a file already in this client\'s managed directories.',
      'When the user names an archive folder, pass archiveFolder so the file is copied there once instead of first creating a dated archive copy.',
      'Both actions preserve the source file.',
    ].join(' '),
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['publish', 'archive'],
        description: 'publish a formal deliverable, or archive an existing managed file.',
      },
      sourcePath: {
        type: 'string',
        required: true,
        description: 'Absolute source path allowed by the selected action.',
      },
      preferredName: {
        type: 'string',
        description: 'Optional final filename, preserving the source name when omitted.',
      },
      archiveFolder: {
        type: 'string',
        description: 'Optional single folder name directly under 05-归档; valid only for action=archive.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true, enum: ['publish', 'archive'] },
          path: { type: 'string', required: true },
          name: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.action === 'publish'
          ? `财务成果已保存：${value.path}`
          : `财务文件已归档：${value.path}`,
      }],
    },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('请在客户帐套的财务会话中保存文件。')
      const agent = exec.agent
      const request = {
        sourcePath: args.sourcePath,
        ...args.preferredName === undefined ? {} : { preferredName: args.preferredName },
        ...args.archiveFolder === undefined ? {} : { archiveFolder: args.archiveFolder },
      }
      if (args.action === 'publish' && args.archiveFolder !== undefined) {
        throw new Error('保存财务成果时不能指定归档文件夹。')
      }
      const file = await financeModelCall(() => args.action === 'publish'
        ? ctx.xiaojingFinanceDomain.publishFile(agent, request)
        : ctx.xiaojingFinanceDomain.archiveFile(agent, request))
      return {
        action: args.action,
        path: file.path,
        name: file.name,
      }
    },
    presentCall: args => ({
      card: 'generic',
      title: args.action === 'publish' ? '保存财务成果' : '归档财务文件',
      kind: 'other',
    }),
    presentResult: (args, result) => ({
      card: 'generic',
      title: result.isError ? '财务文件处理未完成' : args.action === 'publish' ? '财务成果已保存' : '财务文件已归档',
      content: financeResultContent(result.content, result.isError, 'file'),
    }),
  })))
}
