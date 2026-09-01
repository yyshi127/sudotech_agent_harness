/** Finance-preset tool and shared presentation for deterministic document reading. */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { FinanceManagedFileId } from '@deepseek-ai/dsh-xiaojing-finance-domain/types'
import type {
  DocumentListItem,
  DocumentReadResult,
  DocumentVisualReadResult,
  FinanceDocumentListItem,
  FinanceDocumentReadResult,
  FinanceDocumentVisualReadResult,
} from './types.ts'

/** Loader-visible plugin name. */
export const name = 'xiaojing-finance-documents-tool'

/** Required services for the Finance document consumer. */
export const inject = ['tools', 'llm', 'xiaojingFinanceDocuments']

const SUMMARY_SCHEMA = {
  type: 'object',
  required: true,
  additionalProperties: false,
  properties: {
    pageCount: { type: 'integer' },
    slideCount: { type: 'integer' },
    visualCount: { type: 'integer' },
    sheetNames: { type: 'array', items: { type: 'string' } },
    rowCount: { type: 'integer' },
    unitCount: { type: 'integer', required: true },
    charCount: { type: 'integer', required: true },
  },
} as const

const LIST_ITEM_PROPERTIES = {
  documentId: { type: 'string', required: true },
  name: { type: 'string', required: true },
  kind: { type: 'string', required: true, enum: ['pdf', 'docx', 'xlsx', 'pptx', 'xml', 'ofd', 'csv', 'txt', 'image', 'unsupported'] },
  status: { type: 'string', required: true, enum: ['parsed', 'vision-required', 'native-vision', 'unsupported', 'failed'] },
  summary: SUMMARY_SCHEMA,
  warnings: { type: 'array', required: true, items: { type: 'string' } },
} as const

/** Shared output schema for Finance and ordinary-session document tools. */
export const DOCUMENT_TOOL_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', required: true, enum: ['list', 'read', 'visuals'] },
    documents: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, properties: LIST_ITEM_PROPERTIES },
    },
    document: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ...LIST_ITEM_PROPERTIES,
        cursor: { type: 'integer', required: true },
        units: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              index: { type: 'integer', required: true },
              kind: { type: 'string', required: true, enum: ['text', 'row'] },
              locator: { type: 'string', required: true },
              text: { type: 'string', required: true },
            },
          },
        },
        visuals: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              attachment: {
                type: 'object',
                required: true,
                additionalProperties: false,
                properties: {
                  attachmentId: { type: 'string', required: true },
                  mediaType: { type: 'string', required: true, enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] },
                  bytes: { type: 'integer', required: true },
                  width: { type: 'integer', required: true },
                  height: { type: 'integer', required: true },
                  name: { type: 'string' },
                  originalDimensions: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      width: { type: 'integer', required: true },
                      height: { type: 'integer', required: true },
                    },
                  },
                },
              },
              locator: { type: 'string', required: true },
            },
          },
        },
        nextCursor: { type: 'integer' },
      },
    },
  },
} as const

/** Shared parameters for Finance and ordinary-session document tools. */
export const DOCUMENT_TOOL_PARAMETERS = {
  action: {
    type: 'string',
    required: true,
    enum: ['list', 'read', 'visuals'],
    description: 'List current documents, read normalized text, or return a document image batch for native vision.',
  },
  document_id: {
    type: 'string',
    description: 'Required for read and visuals; document_id returned by action=list.',
  },
  cursor: {
    type: 'integer',
    description: 'Optional zero-based unit or image cursor returned as next_cursor; defaults to 0.',
  },
} as const

/** Structured list output shared by both session adapters. */
export interface ListOutput<TId extends string> {
  action: 'list'
  documents: DocumentListItem<TId>[]
}

/** Structured text output shared by both session adapters. */
export interface ReadOutput<TId extends string> {
  action: 'read'
  document: DocumentReadResult<TId>
}

/** Structured visual output shared by both session adapters. */
export interface VisualOutput<TId extends string> {
  action: 'visuals'
  document: DocumentVisualReadResult<TId>
}

/** Structured output shared by both session adapters. */
export type DocumentToolOutput<TId extends string> = ListOutput<TId> | ReadOutput<TId> | VisualOutput<TId>

function statusText(item: DocumentListItem<string>): string {
  switch (item.status) {
    case 'parsed': return '已完成本地结构化解析'
    case 'vision-required': return '需要视觉读取；若无可用图片才需要 OCR 或格式转换'
    case 'native-vision': return '图片应由原生视觉模型读取'
    case 'unsupported': return '当前格式不支持本地解析'
    case 'failed': return '本地解析失败'
  }
}

function warningText(code: string): string {
  if (code === 'content-truncated') return '内容超过本地保留上限，结果已明确截断。'
  if (code === 'pdf-text-layer-missing') return '未检测到足够的 PDF 文本层，不得把空内容当作识别结果。'
  if (code.startsWith('pdf-rendered-pages-available:')) return `已把 ${code.split(':')[1]} 个文字不足的 PDF 页面渲染为图片；使用 action=visuals 交给当前视觉模型读取。`
  if (code.startsWith('pdf-rendered-pages-truncated:')) return `有 ${code.split(':')[1]} 个文字不足的 PDF 页面超过本地视觉上限，未进入视觉批次。`
  if (code.startsWith('pdf-pages-without-text:')) return `有 ${code.split(':')[1]} 页没有文本层，当前结果可能不完整。`
  if (code === 'xlsx-formulas-not-evaluated') return 'Excel 公式不会在本地执行，只读取文件中保存的单元格值。'
  if (code.startsWith('docx-parser-warnings:')) return 'Word 解析器报告了格式兼容提醒，请核对复杂版式。'
  if (code.startsWith('pptx-slides-without-text:')) return `有 ${code.split(':')[1]} 张幻灯片没有可提取文字。`
  if (/^(?:pdf|docx|xlsx|pptx|ofd)-embedded-images-available:/u.test(code)) return `文档包含 ${code.split(':')[1]} 张可读取图片；使用 action=visuals 交给当前视觉模型查看。`
  if (/^(?:pdf|docx|xlsx|pptx|ofd)-embedded-images-truncated:/u.test(code)) return `有 ${code.split(':')[1]} 张文档图片超过本地保留上限或无法编码，未进入视觉批次。`
  if (/^(?:docx|xlsx|pptx|ofd)-unsupported-visuals:/u.test(code)) return `文档还有 ${code.split(':')[1]} 个当前不能作为原生视觉图片读取的对象。`
  if (code.startsWith('document-visual-too-large:')) return `第 ${Number(code.split(':')[1]) + 1} 个文档图片超过当前视觉附件限制，已跳过。`
  if (code === 'pptx-non-text-content-not-extracted') return '图片可通过 action=visuals 查看；图表、SmartArt、嵌入对象等非文字内容仍需结合原文件核对。'
  if (code === 'pptx-text-layer-missing') return '演示文稿没有可提取文字；如存在可用图片，请使用 action=visuals 查看。'
  if (code === 'docx-text-layer-missing') return 'Word 文件没有可提取文字；如存在可用图片，请使用 action=visuals 查看。'
  if (code === 'xlsx-cell-content-missing') return 'Excel 文件没有可提取单元格内容；如存在可用图片，请使用 action=visuals 查看。'
  if (code === 'ofd-text-layer-missing') return 'OFD 文件没有可提取文字；如存在可用图片，请使用 action=visuals 查看。'
  if (code === 'digital-invoice-xml-detected') return '已按数电发票 XML 字段提取客观数据。'
  if (code === 'digital-invoice-ofd-detected') return '已识别为数电发票 OFD 并提取页面文字。'
  if (code === 'digital-invoice-ofd-structured-data-detected') return '已读取 OFD 内嵌的数电发票 XML/XBRL 结构字段。'
  if (code === 'digital-invoice-signature-not-verified') return '当前仅解析内容，未验证电子签名、来源真实性或发票状态。'
  if (code === 'xml-not-recognized-as-digital-invoice') return '该 XML 未满足数电发票字段特征，未按普通 XML 展开。'
  if (code.startsWith('spreadsheet-')) return '表格超过本地安全上限，结果已明确截断。'
  if (code === 'use-native-vision') return '该文件是图片，应直接使用当前模型的原生视觉能力。'
  if (code === 'unsupported-document-format') return '当前仅本地解析 PDF、DOCX、XLSX、PPTX、数电发票 XML、OFD、CSV 和 TXT。'
  if (code === 'parse-failed') return '解析器无法确定性读取该文件，请检查文件是否损坏或受密码保护。'
  if (code === 'timeout') return '本地解析超过安全时限，未生成不完整结果。'
  if (code === 'file-size-limit-exceeded') return '文件超过本地解析大小上限。'
  if (code === 'source-digest-changed' || code === 'source-size-changed') return '上传文件在登记后发生变化，请重新上传。'
  if (code === 'source-outside-authorized-root') return '文件不在当前会话授权的上传目录中，已拒绝读取。'
  if (code === 'source-unavailable') return '上传文件已不存在或当前无法读取。'
  return `本地解析状态：${code}`
}

/**
 * Enforce native-image support on the exact calling route.
 *
 * @param ctx - Tool context.
 * @param exec - Calling execution.
 */
export async function assertDocumentVisualRoute(ctx: Context, exec: ToolExecution): Promise<void> {
  const routed = exec.agent?.session.requestHeader()?.config
  const provider = routed?.provider ?? exec.agent?.options.provider
  const model = routed?.model ?? exec.agent?.options.model
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new Error('document visuals require a resolvable image-capable model route')
  }
  const active = await llm.resolveModelInfo(provider, model, exec.signal)
  if (active.inputModalities === undefined || !active.inputModalities.includes('image')) {
    throw new Error(`model "${model}" does not declare image input; switch to an image-capable model to read document images`)
  }
}

/**
 * Render a normalized-document result as source-located Markdown.
 *
 * @param output - Tool output.
 * @param heading - List heading.
 * @returns Markdown.
 */
export function renderDocumentOutput<TId extends string>(output: DocumentToolOutput<TId>, heading: string): string {
  if (output.action === 'list') {
    if (output.documents.length === 0) return `${heading}尚未上传可读取的文档。`
    return [
      `## ${heading}文档`, '',
      ...output.documents.flatMap((document, index) => [
        `${index + 1}. ${document.name}`,
        `   - document_id: ${document.documentId}`,
        `   - 状态：${statusText(document)}`,
        `   - 格式：${document.kind}；文本单元：${document.summary.unitCount}；保留字符：${document.summary.charCount}${document.summary.visualCount === undefined ? '' : `；可读图片：${document.summary.visualCount}`}`,
        ...document.warnings.map(code => `   - 提醒：${warningText(code)}`),
      ]),
    ].join('\n')
  }
  if (output.action === 'visuals') {
    const document = output.document
    return [
      `## ${document.name} · 文档图片`, '',
      `- 状态：${statusText(document)}`,
      `- 图片位置：${document.cursor}`,
      `- 本批图片：${document.visuals.length}`,
      ...document.nextCursor === undefined ? [] : [`- 下一位置：${document.nextCursor}`],
      ...document.warnings.map(code => `- 提醒：${warningText(code)}`),
    ].join('\n')
  }
  const document = output.document
  return [
    `## ${document.name}`, '',
    `- 状态：${statusText(document)}`,
    `- 格式：${document.kind}`,
    `- 读取位置：${document.cursor}`,
    ...document.nextCursor === undefined ? [] : [`- 下一位置：${document.nextCursor}`],
    ...document.warnings.map(code => `- 提醒：${warningText(code)}`), '',
    ...document.units.flatMap(unit => [`### ${unit.locator}`, '', unit.text, '']),
  ].join('\n')
}

/**
 * Project one document result into model content blocks.
 *
 * @param output - Tool result.
 * @param heading - List heading.
 * @returns Model content.
 */
export function renderDocumentContent<TId extends string>(output: DocumentToolOutput<TId>, heading: string): ContentBlock[] {
  const content: ContentBlock[] = [{ type: 'text', text: renderDocumentOutput(output, heading) }]
  if (output.action !== 'visuals') return content
  for (const visual of output.document.visuals) {
    content.push({ type: 'text', text: visual.locator })
    content.push({ type: 'image', attachment: visual.attachment })
  }
  return content
}

type FinanceToolOutput =
  | { action: 'list'; documents: FinanceDocumentListItem[] }
  | { action: 'read'; document: FinanceDocumentReadResult }
  | { action: 'visuals'; document: FinanceDocumentVisualReadResult }

/**
 * Render one Finance model-visible result.
 *
 * @param output - Finance tool output.
 * @returns Markdown.
 */
export function renderFinanceDocumentOutput(output: FinanceToolOutput): string {
  return renderDocumentOutput(output, '当前 Finance 会话')
}

/** Register the Finance-only document tool. @param ctx - Finance agent scope. */
export function apply(ctx: Context): void {
  ctx.tools.restrict({ deny: ['document_reader'] })
  ctx.tools.register(defineTool({
    name: 'finance_document',
    description: [
      'Read PDF, DOCX, XLSX, PPTX, digital-invoice XML, OFD, CSV, and TXT files uploaded through the current Finance conversation without trying shell, Python, Office applications, or ad-hoc converters.',
      'Use action=list, then action=read for source-located text. For any supported document with visual_count, use action=visuals to inspect rendered scanned PDF pages or embedded raster images with the current native visual model.',
      'Digital-invoice XML and OFD parsing extracts content only; it does not verify electronic signatures, authenticity, or invoice status.',
      'Continue with next_cursor until the required text or image range is covered. Treat truncation and parser warnings as material limitations.',
      'This Finance-only adapter reads only durable original-material import events in the current Finance session and preserves customer isolation.',
    ].join(' '),
    parameters: DOCUMENT_TOOL_PARAMETERS,
    output: {
      schema: DOCUMENT_TOOL_OUTPUT_SCHEMA,
      render: (_args, value) => renderDocumentContent(value as unknown as FinanceToolOutput, '当前 Finance 会话'),
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (!exec.agent) throw new Error('finance_document requires an owning Finance agent session')
      if (args.action === 'list') {
        return { action: 'list' as const, documents: await ctx.xiaojingFinanceDocuments.listDocuments(exec.agent, exec.signal) }
      }
      if (args.document_id === undefined || args.document_id.length === 0) {
        throw new Error(`finance_document action=${args.action} requires document_id from action=list`)
      }
      const documentId = FinanceManagedFileId(args.document_id)
      if (args.action === 'visuals') {
        await assertDocumentVisualRoute(ctx, exec)
        return {
          action: 'visuals' as const,
          document: await ctx.xiaojingFinanceDocuments.readDocumentVisuals(exec.agent, documentId, args.cursor ?? 0, exec.signal),
        }
      }
      return {
        action: 'read' as const,
        document: await ctx.xiaojingFinanceDocuments.readDocument(exec.agent, documentId, args.cursor ?? 0, exec.signal),
      }
    },
    presentCall: args => ({
      card: 'generic',
      title: args.action === 'list' ? '整理财务文档' : args.action === 'visuals' ? '查看文档图片' : '读取财务文档',
      kind: args.action === 'read' ? 'read' : 'search',
    }),
  }))
}
