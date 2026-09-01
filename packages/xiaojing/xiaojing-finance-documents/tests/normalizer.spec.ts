import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FinanceClientId,
  FinanceManagedFileId,
} from '@deepseek-ai/dsh-xiaojing-finance-domain/types'
import type { FinanceDocumentSource } from '../src/compat.ts'
import { FinanceDocumentNormalizer } from '../src/normalizer.ts'
import { FinanceDocumentStore } from '../src/store.ts'
import type { FinanceDocumentParseLimits } from '../src/types.ts'

const roots: string[] = []
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
)
const SCANNED_PDF = Buffer.from(
  'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9YT2JqZWN0IDw8IC9JbTAgNCAwIFIgPj4gPj4gL0NvbnRlbnRzIDUgMCBSID4+CmVuZG9iago0IDAgb2JqCjw8IC9UeXBlIC9YT2JqZWN0IC9TdWJ0eXBlIC9JbWFnZSAvV2lkdGggMSAvSGVpZ2h0IDEgL0NvbG9yU3BhY2UgL0RldmljZVJHQiAvQml0c1BlckNvbXBvbmVudCA4IC9MZW5ndGggMyA+PgpzdHJlYW0K/wAACmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvTGVuZ3RoIDMxID4+CnN0cmVhbQpxIDE2IDAgMCAxNiA3MiA3MDAgY20gL0ltMCBEbyBRCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQ1IDAwMDAwIG4gCjAwMDAwMDAzOTAgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo0NzEKJSVFT0YK',
  'base64',
)
const limits: FinanceDocumentParseLimits = {
  maxFileBytes: 1_000_000,
  maxPdfPages: 10,
  maxPresentationSlides: 10,
  maxDocumentVisuals: 20,
  maxDocumentVisualBytes: 1_000_000,
  minPdfTextChars: 1,
  pdfRenderWidthPx: 600,
  maxPdfRenderPixels: 1_000_000,
  maxTextChars: 10_000,
  maxUnitChars: 1_000,
  maxSpreadsheetSheets: 10,
  maxSpreadsheetRows: 1_000,
  maxSpreadsheetColumns: 100,
  maxSpreadsheetCells: 10_000,
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function digest(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

async function fixture(
  clientId = 'client-A',
  file: { name: string; data: Buffer } = { name: '说明.txt', data: Buffer.from('第一行\n第二行') },
): Promise<{
  source: FinanceDocumentSource
  store: FinanceDocumentStore
  normalizer: FinanceDocumentNormalizer
  controller: AbortController
  sourcePath: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'xiaojing-finance-documents-normalizer-'))
  roots.push(root)
  const workspacePath = join(root, 'workspace')
  const sourceDirectory = join(workspacePath, '02-原始资料')
  await mkdir(sourceDirectory, { recursive: true })
  const sourcePath = join(sourceDirectory, file.name)
  await writeFile(sourcePath, file.data)
  const store = new FinanceDocumentStore(join(root, 'dsh-home'))
  await store.init()
  const controller = new AbortController()
  return {
    source: {
      sourceRoot: sourceDirectory,
      cacheScope: clientId,
      file: {
        id: FinanceManagedFileId('file-1'),
        clientId: FinanceClientId(clientId),
        sessionId: 'session-1',
        action: 'import',
        stage: 'source',
        path: sourcePath,
        name: file.name,
        sha256: digest(file.data),
        size: file.data.length,
        createdAt: 123,
      },
    },
    store,
    normalizer: new FinanceDocumentNormalizer(store, limits, 10_000, 128, controller.signal),
    controller,
    sourcePath,
  }
}

describe('FinanceDocumentNormalizer', () => {
  it('runs the isolated parser and reuses the client-scoped hash cache', async () => {
    const value = await fixture()
    const first = await value.normalizer.ensure(value.source)
    const second = await value.normalizer.ensure(value.source)
    expect(first).toMatchObject({ status: 'parsed', kind: 'txt', sha256: value.source.file.sha256 })
    expect(first.units[0]?.text).toContain('第一行')
    expect(second).toEqual(first)
    expect(await readdir(value.store.directory)).toHaveLength(1)
    value.controller.abort()
    await value.normalizer.close()
  })

  it('re-extracts normalized Word pictures through the isolated worker', async () => {
    const data = Buffer.from(zipSync({
      '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>'),
      'word/document.xml': strToU8('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t>图文资料</w:t><w:drawing><a:blip r:embed="rIdImage"/></w:drawing></w:r></w:p></w:body></w:document>'),
      'word/_rels/document.xml.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/invoice.png"/></Relationships>'),
      'word/media/invoice.png': PNG_1X1,
    }))
    const value = await fixture('client-A', { name: '图文资料.docx', data })
    const document = await value.normalizer.ensure(value.source)
    const extracted = await value.normalizer.extractVisuals(value.source, document.visuals, 1_000_000)

    expect(document.visuals).toHaveLength(1)
    expect(extracted).toEqual([{
      sourceKey: 'word/media/invoice.png',
      mediaType: 'image/png',
      data: new Uint8Array(PNG_1X1),
    }])
    value.controller.abort()
    await value.normalizer.close()
  })

  it('renders and re-extracts a scanned PDF page through the isolated worker', async () => {
    const value = await fixture('client-A', { name: '扫描发票.pdf', data: SCANNED_PDF })
    const document = await value.normalizer.ensure(value.source)
    const extracted = await value.normalizer.extractVisuals(value.source, document.visuals, 1_000_000)

    expect(document).toMatchObject({
      status: 'vision-required',
      kind: 'pdf',
      summary: { pageCount: 1, visualCount: 1 },
      visuals: [{ sourceKey: 'pdf:page:1:render:600', locator: '第1页（完整页面）' }],
    })
    expect(extracted).toHaveLength(1)
    expect(extracted[0]).toMatchObject({
      sourceKey: 'pdf:page:1:render:600',
      mediaType: 'image/png',
    })
    expect(extracted[0]?.data.byteLength).toBe(document.visuals[0]?.bytes)
    value.controller.abort()
    await value.normalizer.close()
  })

  it('refuses changed source bytes even when a cache record exists', async () => {
    const value = await fixture()
    await value.normalizer.ensure(value.source)
    await writeFile(value.sourcePath, '替换后的内容')
    await expect(value.normalizer.ensure(value.source)).rejects.toMatchObject({ code: 'source-size-changed' })
    value.controller.abort()
    await value.normalizer.close()
  })

  it('rejects an oversized authorized source before hashing its bytes', async () => {
    const value = await fixture()
    const normalizer = new FinanceDocumentNormalizer(
      value.store,
      { ...limits, maxFileBytes: 1 },
      10_000,
      128,
      value.controller.signal,
    )
    const document = await normalizer.ensure({
      ...value.source,
      file: { ...value.source.file, sha256: 'f'.repeat(64) },
    })

    expect(document).toMatchObject({ status: 'failed', failureCode: 'file-too-large' })
    value.controller.abort()
    await Promise.all([normalizer.close(), value.normalizer.close()])
  })

  it('refuses files outside the immutable client original-materials directory', async () => {
    const value = await fixture()
    const workspacePath = dirname(value.source.sourceRoot)
    const outside = join(workspacePath, '03-会话作业', '说明.txt')
    await mkdir(join(workspacePath, '03-会话作业'), { recursive: true })
    const data = Buffer.from('外部文件')
    await writeFile(outside, data)
    const source = {
      ...value.source,
      file: { ...value.source.file, path: outside, size: data.length, sha256: digest(data) },
    }
    await expect(value.normalizer.ensure(source)).rejects.toMatchObject({ code: 'source-outside-authorized-root' })
    value.controller.abort()
    await value.normalizer.close()
  })

  it('normalizes a general-consultation upload inside its session-scoped cache', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xiaojing-finance-documents-consultation-'))
    roots.push(root)
    const uploadRoot = join(root, 'uploads')
    await mkdir(uploadRoot, { recursive: true })
    const data = Buffer.from('consultation source')
    const sourcePath = join(uploadRoot, 'consultation.txt')
    await writeFile(sourcePath, data)
    const store = new FinanceDocumentStore(join(root, 'dsh-home'))
    await store.init()
    const controller = new AbortController()
    const normalizer = new FinanceDocumentNormalizer(store, limits, 10_000, 128, controller.signal)
    const document = await normalizer.ensure({
      sourceRoot: uploadRoot,
      cacheScope: 'session:consultation-1',
      file: {
        id: FinanceManagedFileId('consultation-file-1'),
        sessionId: 'consultation-1',
        path: sourcePath,
        name: 'consultation.txt',
        sha256: digest(data),
        size: data.length,
        createdAt: 123,
      },
    })

    expect(document).toMatchObject({ status: 'parsed', kind: 'txt', sha256: digest(data) })
    expect(document.units[0]?.text).toContain('consultation source')
    expect(await readdir(store.directory)).toHaveLength(1)
    controller.abort()
    await normalizer.close()
  })
})
