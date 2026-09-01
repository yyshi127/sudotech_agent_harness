/** Finance-preset tool for formal publication and explicit archival of client files. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Loader-visible plugin name. */
export const name = 'xiaojing-finance-files-tool'

/** Required services for the Finance file consumer. */
export const inject = ['tools', 'xiaojingFinanceDomain']

/** Register the Finance-only controlled file lifecycle tool. @param ctx - Finance agent scope. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'finance_files',
    description: [
      'Commit files in the current client-bound Finance workspace.',
      'Use action=publish when the user asks for a final version, formal output, export, delivery, or saved deliverable.',
      'The source must already exist in this session\'s 03-会话作业 directory.',
      'Keep drafts, previews, trial calculations, and ambiguous work in 03-会话作业 without calling this tool.',
      'Use action=archive only when the user explicitly asks to archive a file already in this client\'s managed directories.',
      'Both actions copy bytes and preserve the source file.',
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
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true, enum: ['publish', 'archive'] },
          path: { type: 'string', required: true },
          name: { type: 'string', required: true },
          sha256: { type: 'string', required: true },
          size: { type: 'integer', required: true },
          sourcePreserved: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.action === 'publish'
          ? `Published Finance deliverable: ${value.path}`
          : `Archived Finance file copy: ${value.path}`,
      }],
    },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('finance_files requires an owning agent session')
      const request = {
        sourcePath: args.sourcePath,
        ...args.preferredName === undefined ? {} : { preferredName: args.preferredName },
      }
      const file = args.action === 'publish'
        ? await ctx.xiaojingFinanceDomain.publishFile(exec.agent, request)
        : await ctx.xiaojingFinanceDomain.archiveFile(exec.agent, request)
      return {
        action: args.action,
        path: file.path,
        name: file.name,
        sha256: file.sha256,
        size: file.size,
        sourcePreserved: true,
      }
    },
    presentCall: args => ({
      card: 'generic',
      title: args.action === 'publish' ? 'Publish Finance deliverable' : 'Archive Finance file',
      kind: 'other',
      rawInput: args,
    }),
  }))
}
