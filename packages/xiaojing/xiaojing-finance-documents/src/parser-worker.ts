/** Isolated parser worker entry. */

import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { parentPort, workerData } from 'node:worker_threads'
import { InvoiceParseError } from './invoice.ts'
import { OfficeVisualParseError } from './office-visuals.ts'
import { normalizeFinanceDocument } from './parser.ts'
import { PdfVisualParseError } from './pdf-visuals.ts'
import { PptxParseError } from './pptx.ts'
import { parseWorkerRequest } from './schema.ts'
import type { FinanceDocumentWorkerMessage } from './types.ts'
import { DocumentVisualParseError, extractDocumentVisuals } from './visuals.ts'

function post(message: FinanceDocumentWorkerMessage): void {
  if (parentPort === null) throw new Error('xiaojing-finance-documents: parser worker requires a parent port')
  parentPort.postMessage(message)
}

function failureCode(error: unknown): string {
  if (error instanceof InvoiceParseError
    || error instanceof OfficeVisualParseError
    || error instanceof PdfVisualParseError
    || error instanceof PptxParseError
    || error instanceof DocumentVisualParseError) return error.code
  return 'parse-failed'
}

async function main(): Promise<void> {
  const request = parseWorkerRequest(workerData)
  try {
    const stat = await lstat(request.sourcePath)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      post({ action: request.action, ok: false, code: 'source-not-regular-file' })
      return
    }
    if (stat.size !== request.expectedSize) {
      post({ action: request.action, ok: false, code: 'source-size-changed' })
      return
    }
    const maxFileBytes = request.action === 'normalize' ? request.limits.maxFileBytes : request.maxFileBytes
    if (stat.size > maxFileBytes) {
      post({ action: request.action, ok: false, code: 'file-size-limit-exceeded' })
      return
    }
    const data = await readFile(request.sourcePath)
    const sha256 = createHash('sha256').update(data).digest('hex')
    if (sha256 !== request.expectedSha256) {
      post({ action: request.action, ok: false, code: 'source-digest-changed' })
      return
    }
    if (request.action === 'normalize') {
      const document = await normalizeFinanceDocument(data, request.originalName, sha256, request.limits)
      post({ action: 'normalize', ok: true, document })
      return
    }
    if (request.visualKeys.length > request.maxVisuals) {
      post({ action: 'extract-visuals', ok: false, code: 'document-visual-count-limit-exceeded' })
      return
    }
    post({
      action: 'extract-visuals',
      ok: true,
      visuals: await extractDocumentVisuals(data, request),
    })
  } catch (error) {
    post({
      action: request.action,
      ok: false,
      code: failureCode(error),
    })
  }
}

void main()
