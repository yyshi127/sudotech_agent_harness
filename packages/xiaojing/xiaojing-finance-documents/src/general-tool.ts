/** Ordinary-session consumer for Xiaojing's shared deterministic document parser. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { XiaojingDocumentId } from './types.ts'
import type {
  XiaojingDocumentListItem,
  XiaojingDocumentReadResult,
  XiaojingDocumentVisualReadResult,
} from './types.ts'
import {
  assertDocumentVisualRoute,
  DOCUMENT_TOOL_OUTPUT_SCHEMA,
  DOCUMENT_TOOL_PARAMETERS,
  renderDocumentContent,
} from './tool.ts'

/** Loader-visible plugin name. */
export const name = 'xiaojing-document-reader-tool'

/** Services required by the ordinary-session document consumer. */
export const inject = ['tools', 'llm', 'xiaojingFinanceDocuments']

type GeneralToolOutput =
  | { action: 'list'; documents: XiaojingDocumentListItem[] }
  | { action: 'read'; document: XiaojingDocumentReadResult }
  | { action: 'visuals'; document: XiaojingDocumentVisualReadResult }

/** Register deterministic document reading for every non-Finance Xiaojing preset. @param ctx - Host tool context. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'document_reader',
    description: [
      'Read PDF, DOCX, XLSX, PPTX, digital-invoice XML, OFD, CSV, and TXT files uploaded by the user in this ordinary conversation without trying shell, Python, Office applications, or ad-hoc converters.',
      'Use action=list after an upload, then action=read for source-located text. For any supported document with visual_count, use action=visuals to inspect rendered scanned PDF pages or embedded raster images with the current native visual model.',
      'Digital-invoice XML and OFD parsing extracts content only; it does not verify electronic signatures, authenticity, or invoice status.',
      'Continue with next_cursor until the required text or image range is covered. Treat truncation and parser warnings as material limitations.',
      'The tool accepts only durable human-upload references from the current session under the Xiaojing upload directory; it cannot read arbitrary paths or uploads from another conversation.',
    ].join(' '),
    parameters: DOCUMENT_TOOL_PARAMETERS,
    output: {
      schema: DOCUMENT_TOOL_OUTPUT_SCHEMA,
      render: (_args, value) => renderDocumentContent(value as unknown as GeneralToolOutput, '当前会话'),
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (!exec.agent) throw new Error('document_reader requires an owning agent session')
      if (args.action === 'list') {
        return { action: 'list' as const, documents: await ctx.xiaojingFinanceDocuments.listGeneralDocuments(exec.agent, exec.signal) }
      }
      if (args.document_id === undefined || args.document_id.length === 0) {
        throw new Error(`document_reader action=${args.action} requires document_id from action=list`)
      }
      const documentId = XiaojingDocumentId(args.document_id)
      if (args.action === 'visuals') {
        await assertDocumentVisualRoute(ctx, exec)
        return {
          action: 'visuals' as const,
          document: await ctx.xiaojingFinanceDocuments.readGeneralDocumentVisuals(exec.agent, documentId, args.cursor ?? 0, exec.signal),
        }
      }
      return {
        action: 'read' as const,
        document: await ctx.xiaojingFinanceDocuments.readGeneralDocument(exec.agent, documentId, args.cursor ?? 0, exec.signal),
      }
    },
    presentCall: args => ({
      card: 'generic',
      title: args.action === 'list' ? '整理上传文档' : args.action === 'visuals' ? '查看文档图片' : '读取上传文档',
      kind: args.action === 'read' ? 'read' : 'search',
    }),
  }))
}
