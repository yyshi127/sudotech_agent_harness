/** Format dispatch for exact document-image extraction. */

import { extractOfdVisuals } from './invoice.ts'
import { extractOfficeVisuals } from './office-visuals.ts'
import { extractPdfVisuals } from './pdf-visuals.ts'
import { extractPptxVisuals } from './pptx.ts'
import type { FinanceDocumentExtractedVisual, FinanceDocumentVisualWorkerRequest } from './types.ts'

/** Stable generic visual-extraction failure. */
export class DocumentVisualParseError extends Error {
  /** @param code - Stable failure code. */
  constructor(readonly code: string) {
    super(`xiaojing-finance-documents: visual extraction failed (${code})`)
  }
}

/**
 * Re-extract an exact image batch selected from normalized metadata.
 * @param data - Complete verified source bytes.
 * @param request - Validated format, keys, and aggregate byte limit.
 * @returns Images in the requested order.
 */
export async function extractDocumentVisuals(
  data: Buffer,
  request: Pick<FinanceDocumentVisualWorkerRequest, 'kind' | 'visualKeys' | 'maxOutputBytes'>,
): Promise<FinanceDocumentExtractedVisual[]> {
  switch (request.kind) {
    case 'pdf': return await extractPdfVisuals(data, request.visualKeys, request.maxOutputBytes)
    case 'docx': return extractOfficeVisuals(data, 'docx', request.visualKeys, request.maxOutputBytes)
    case 'xlsx': return extractOfficeVisuals(data, 'xlsx', request.visualKeys, request.maxOutputBytes)
    case 'pptx': return extractPptxVisuals(data, request.visualKeys, request.maxOutputBytes).map(visual => ({
      sourceKey: visual.archivePart,
      mediaType: visual.mediaType,
      data: visual.data,
    }))
    case 'ofd': return extractOfdVisuals(data, request.visualKeys, request.maxOutputBytes)
    case 'xml': throw new DocumentVisualParseError('xml-has-no-document-visuals')
  }
}
