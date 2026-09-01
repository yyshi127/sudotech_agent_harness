import { describe, expect, it } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { FinanceManagedFileId } from '@deepseek-ai/dsh-xiaojing-finance-domain/types'
import { renderDocumentContent, renderFinanceDocumentOutput } from '../src/tool.ts'

describe('Finance document transcript rendering', () => {
  it('renders list state, opaque identity, counts, and material limitations', () => {
    const rendered = renderFinanceDocumentOutput({
      action: 'list',
      documents: [{
        documentId: FinanceManagedFileId('file-1'),
        name: '扫描发票.pdf',
        kind: 'pdf',
        status: 'vision-required',
        summary: { unitCount: 0, charCount: 0, pageCount: 1, visualCount: 1 },
        warnings: ['pdf-text-layer-missing', 'pdf-rendered-pages-available:1'],
      }],
    })

    expect(rendered).toContain('扫描发票.pdf')
    expect(rendered).toContain('document_id: file-1')
    expect(rendered).toContain('需要视觉读取')
    expect(rendered).toContain('不得把空内容当作识别结果')
    expect(rendered).toContain('已把 1 个文字不足的 PDF 页面渲染为图片')
  })

  it('renders bounded source-located content and the next cursor', () => {
    const rendered = renderFinanceDocumentOutput({
      action: 'read',
      document: {
        documentId: FinanceManagedFileId('file-2'),
        name: '凭证.xlsx',
        kind: 'xlsx',
        status: 'parsed',
        summary: { unitCount: 2, charCount: 20, sheetNames: ['凭证'], rowCount: 2 },
        warnings: ['xlsx-formulas-not-evaluated'],
        cursor: 0,
        nextCursor: 1,
        units: [{ index: 0, kind: 'row', locator: '工作表“凭证”第1行', text: '科目\t金额' }],
      },
    })

    expect(rendered).toContain('下一位置：1')
    expect(rendered).toContain('### 工作表“凭证”第1行')
    expect(rendered).toContain('Excel 公式不会在本地执行')
  })

  it('returns document visuals as native image blocks with source locations', () => {
    const content = renderDocumentContent({
      action: 'visuals',
      document: {
        documentId: FinanceManagedFileId('file-3'),
        name: '经营简报.pptx',
        kind: 'pptx',
        status: 'parsed',
        summary: { unitCount: 1, charCount: 4, slideCount: 2, visualCount: 1 },
        warnings: ['pptx-embedded-images-available:1'],
        cursor: 0,
        visuals: [{
          attachment: {
            attachmentId: AttachmentId('attachment-1'),
            mediaType: 'image/png',
            bytes: 100,
            width: 20,
            height: 10,
          },
          locator: '幻灯片 2',
        }],
      },
    }, '当前会话')

    expect(content).toHaveLength(3)
    const header = content[0]
    if (header?.type !== 'text') throw new Error('Expected a text header before PPTX visuals')
    expect(header.text).toContain('可读取图片')
    expect(content[1]).toEqual({ type: 'text', text: '幻灯片 2' })
    expect(content[2]).toMatchObject({ type: 'image', attachment: { attachmentId: 'attachment-1' } })
  })
})
