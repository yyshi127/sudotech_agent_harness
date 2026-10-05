import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const binScript = fileURLToPath(new URL('./fixtures/general-documents/snapshot.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../../../packages/bundle/base/tests/fixtures/root.cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.base.json', import.meta.url))

describe('Xiaojing ordinary-session document assembled snapshot', () => {
  it('reads the current session upload through the shipped ordinary-mode tool', async () => {
    const result = await runLoaderSmoke({
      label: 'Xiaojing ordinary-session document snapshot',
      tempDirPrefix: 'xiaojing-general-document-snapshot-',
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
        "financeToolVisible": false,
        "list": [
          {
            "text": "## 当前会话文档

      1. 普通模式资料.csv
         - document_id: <document-id>
         - 状态：已完成本地结构化解析
         - 格式：csv；文本单元：2；保留字符：15",
            "type": "text",
          },
        ],
        "ordinaryPresetTools": {
          "cordis": true,
          "minimal": true,
          "ptc": true,
          "standard": true,
        },
        "read": [
          {
            "text": "## 普通模式资料.csv

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
          "description": "Read PDF, DOCX, XLSX, PPTX, digital-invoice XML, OFD, CSV, and TXT files uploaded by the user in this ordinary conversation without trying shell, Python, Office applications, or ad-hoc converters. Use action=list after an upload, then action=read for source-located text. For any supported document with visual_count, use action=visuals to inspect rendered scanned PDF pages or embedded raster images with the current native visual model. Digital-invoice XML and OFD parsing extracts content only; it does not verify electronic signatures, authenticity, or invoice status. Continue with next_cursor until the required text or image range is covered. Treat truncation and parser warnings as material limitations. The tool accepts only durable human-upload references from the current session under the Xiaojing upload directory; it cannot read arbitrary paths or uploads from another conversation.",
          "name": "document_reader",
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
