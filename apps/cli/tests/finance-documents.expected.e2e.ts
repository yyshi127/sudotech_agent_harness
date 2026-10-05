import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const binScript = fileURLToPath(new URL('./fixtures/finance-documents/snapshot.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../../../packages/bundle/base/tests/fixtures/root.cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.base.json', import.meta.url))

describe('Xiaojing Finance document assembled snapshot', () => {
  it('normalizes and reads an imported customer document through the shipped tool', async () => {
    const result = await runLoaderSmoke({
      label: 'Xiaojing Finance document snapshot',
      tempDirPrefix: 'xiaojing-finance-document-snapshot-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [],
      tsconfigPath,
      env: { DSH_CLIENT_BUILD_PROFILE: 'xiaojing' },
      processTimeoutMs: LOADER_SMOKE_TEST_TIMEOUT_MS * 2,
    })

    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchInlineSnapshot(`
      {
        "list": [
          {
            "text": "## 当前 Finance 会话文档

      1. 经营简报.pptx
         - document_id: snapshot-document
         - 状态：已完成本地结构化解析
         - 格式：pptx；文本单元：1；保留字符：30；可读图片：0",
            "type": "text",
          },
        ],
        "ordinaryToolVisible": false,
        "read": [
          {
            "text": "## 经营简报.pptx

      - 状态：已完成本地结构化解析
      - 格式：pptx
      - 读取位置：0

      ### 第1张幻灯片

      经营简报
      营业收入 & 税额

      演讲者备注：
      备注：核对税率
      ",
            "type": "text",
          },
        ],
        "tool": {
          "description": "Read PDF, DOCX, XLSX, PPTX, digital-invoice XML, OFD, CSV, and TXT files uploaded through the current Finance conversation without trying shell, Python, Office applications, or ad-hoc converters. Use action=list, then action=read for source-located text. For any supported document with visual_count, use action=visuals to inspect rendered scanned PDF pages or embedded raster images with the current native visual model. Digital-invoice XML and OFD parsing extracts content only; it does not verify electronic signatures, authenticity, or invoice status. Continue with next_cursor until the required text or image range is covered. Treat truncation and parser warnings as material limitations. This Finance-only adapter reads only durable original-material import events in the current Finance session and preserves customer isolation.",
          "name": "finance_document",
          "parameters": {
            "properties": {
              "action": {
                "description": "List current documents, read normalized text, or return a document image batch for native vision.",
                "enum": [
                  "list",
                  "read",
                  "visuals",
                ],
                "type": "string",
              },
              "cursor": {
                "description": "Optional zero-based unit or image cursor returned as next_cursor; defaults to 0.",
                "type": "integer",
              },
              "document_id": {
                "description": "Required for read and visuals; document_id returned by action=list.",
                "type": "string",
              },
            },
            "required": [
              "action",
            ],
            "type": "object",
          },
        },
      }
    `)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS * 2)

  it('registers and reads an uploaded general-consultation document through the shipped tool', async () => {
    const result = await runLoaderSmoke({
      label: 'Xiaojing Finance consultation document snapshot',
      tempDirPrefix: 'xiaojing-finance-consultation-document-snapshot-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: ['--consultation'],
      tsconfigPath,
      env: { DSH_CLIENT_BUILD_PROFILE: 'xiaojing' },
      processTimeoutMs: LOADER_SMOKE_TEST_TIMEOUT_MS * 2,
    })

    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchInlineSnapshot(`
      {
        "list": [
          {
            "text": "## 当前 Finance 会话文档

      1. 咨询资料.csv
         - document_id: snapshot-consultation-document
         - 状态：已完成本地结构化解析
         - 格式：csv；文本单元：2；保留字符：15",
            "type": "text",
          },
        ],
        "ordinaryToolVisible": false,
        "read": [
          {
            "text": "## 咨询资料.csv

      - 状态：已完成本地结构化解析
      - 格式：csv
      - 读取位置：0

      ### 第1行

      项目	金额

      ### 第2行

      云服务费	88.00
      ",
            "type": "text",
          },
        ],
        "tool": {
          "description": "Read PDF, DOCX, XLSX, PPTX, digital-invoice XML, OFD, CSV, and TXT files uploaded through the current Finance conversation without trying shell, Python, Office applications, or ad-hoc converters. Use action=list, then action=read for source-located text. For any supported document with visual_count, use action=visuals to inspect rendered scanned PDF pages or embedded raster images with the current native visual model. Digital-invoice XML and OFD parsing extracts content only; it does not verify electronic signatures, authenticity, or invoice status. Continue with next_cursor until the required text or image range is covered. Treat truncation and parser warnings as material limitations. This Finance-only adapter reads only durable original-material import events in the current Finance session and preserves customer isolation.",
          "name": "finance_document",
          "parameters": {
            "properties": {
              "action": {
                "description": "List current documents, read normalized text, or return a document image batch for native vision.",
                "enum": [
                  "list",
                  "read",
                  "visuals",
                ],
                "type": "string",
              },
              "cursor": {
                "description": "Optional zero-based unit or image cursor returned as next_cursor; defaults to 0.",
                "type": "integer",
              },
              "document_id": {
                "description": "Required for read and visuals; document_id returned by action=list.",
                "type": "string",
              },
            },
            "required": [
              "action",
            ],
            "type": "object",
          },
        },
      }
    `)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS * 2)

  it('renders a scanned customer PDF for the native visual route', async () => {
    const result = await runLoaderSmoke({
      label: 'Xiaojing Finance scanned PDF snapshot',
      tempDirPrefix: 'xiaojing-finance-scanned-pdf-snapshot-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: ['--scan'],
      tsconfigPath,
      env: { DSH_CLIENT_BUILD_PROFILE: 'xiaojing' },
      processTimeoutMs: LOADER_SMOKE_TEST_TIMEOUT_MS * 2,
    })

    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchInlineSnapshot(`
      {
        "list": [
          {
            "text": "## 当前 Finance 会话文档

      1. 扫描发票.pdf
         - document_id: snapshot-scan-document
         - 状态：需要视觉读取；若无可用图片才需要 OCR 或格式转换
         - 格式：pdf；文本单元：0；保留字符：0；可读图片：1
         - 提醒：未检测到足够的 PDF 文本层，不得把空内容当作识别结果。
         - 提醒：已把 1 个文字不足的 PDF 页面渲染为图片；使用 action=visuals 交给当前视觉模型读取。",
            "type": "text",
          },
        ],
        "ordinaryToolVisible": false,
        "read": [
          {
            "text": "## 扫描发票.pdf

      - 状态：需要视觉读取；若无可用图片才需要 OCR 或格式转换
      - 格式：pdf
      - 读取位置：0
      - 提醒：未检测到足够的 PDF 文本层，不得把空内容当作识别结果。
      - 提醒：已把 1 个文字不足的 PDF 页面渲染为图片；使用 action=visuals 交给当前视觉模型读取。
      ",
            "type": "text",
          },
        ],
        "tool": {
          "description": "Read PDF, DOCX, XLSX, PPTX, digital-invoice XML, OFD, CSV, and TXT files uploaded through the current Finance conversation without trying shell, Python, Office applications, or ad-hoc converters. Use action=list, then action=read for source-located text. For any supported document with visual_count, use action=visuals to inspect rendered scanned PDF pages or embedded raster images with the current native visual model. Digital-invoice XML and OFD parsing extracts content only; it does not verify electronic signatures, authenticity, or invoice status. Continue with next_cursor until the required text or image range is covered. Treat truncation and parser warnings as material limitations. This Finance-only adapter reads only durable original-material import events in the current Finance session and preserves customer isolation.",
          "name": "finance_document",
          "parameters": {
            "properties": {
              "action": {
                "description": "List current documents, read normalized text, or return a document image batch for native vision.",
                "enum": [
                  "list",
                  "read",
                  "visuals",
                ],
                "type": "string",
              },
              "cursor": {
                "description": "Optional zero-based unit or image cursor returned as next_cursor; defaults to 0.",
                "type": "integer",
              },
              "document_id": {
                "description": "Required for read and visuals; document_id returned by action=list.",
                "type": "string",
              },
            },
            "required": [
              "action",
            ],
            "type": "object",
          },
        },
      }
    `)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS * 2)
})
