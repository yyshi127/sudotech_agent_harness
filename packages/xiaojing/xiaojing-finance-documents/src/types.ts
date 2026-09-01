/** Public types for Xiaojing's shared deterministic document parser. */

import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { FinanceManagedFileId } from '@deepseek-ai/dsh-xiaojing-finance-domain/types'

/** Opaque identity for an ordinary-session upload discovered from its durable user message. */
export type XiaojingDocumentId = Branded<'XiaojingDocumentId'>

/**
 * Brand one ordinary-session document identity.
 * @param value - Stable opaque identity derived by the Host adapter.
 * @returns Branded ordinary-session document identity.
 */
export function XiaojingDocumentId(value: string): XiaojingDocumentId {
  return value as XiaojingDocumentId
}

/** File families handled by the shared document normalizer. */
export type FinanceDocumentKind = 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'xml' | 'ofd' | 'csv' | 'txt' | 'image' | 'unsupported'

/** Durable normalization outcomes. */
export type FinanceDocumentStatus = 'parsed' | 'vision-required' | 'native-vision' | 'unsupported' | 'failed'

/** One bounded, source-located unit extracted without model inference. */
export interface FinanceDocumentUnit {
  /** Zero-based position in the normalized unit stream. */
  index: number
  /** Plain prose or one delimited spreadsheet row. */
  kind: 'text' | 'row'
  /** Human-readable source location such as a page, paragraph, slide, line range, or sheet row. */
  locator: string
  /** Deterministically extracted text. */
  text: string
}

/** One supported raster image referenced by a document. */
export interface FinanceDocumentVisual {
  /** Zero-based position in the document's visual stream. */
  index: number
  /** Format-owned opaque key used to re-extract the exact image. */
  sourceKey: string
  /** Image type accepted by the Harness attachment service. */
  mediaType: ImageMediaType
  /** Exact encoded byte length returned by visual extraction. */
  bytes: number
  /** Human-readable page, slide, paragraph, sheet-cell, or package location. */
  locator: string
}

/** Source-level counts retained with one normalized document. */
export interface FinanceDocumentSummary {
  /** Number of source pages when the format is PDF. */
  pageCount?: number
  /** Number of source slides when the format is PPTX. */
  slideCount?: number
  /** Number of supported document-referenced raster images. */
  visualCount?: number
  /** Source sheet names when the format is XLSX. */
  sheetNames?: string[]
  /** Number of retained spreadsheet or CSV rows. */
  rowCount?: number
  /** Number of retained normalized units. */
  unitCount: number
  /** Number of retained text characters. */
  charCount: number
}

/** Versioned local cache record keyed by content hash and format. */
export interface FinanceNormalizedDocument {
  /** Durable schema version. */
  schemaVersion: 3
  /** Parser behavior version; changes invalidate old cache entries without rewriting them. */
  normalizerVersion: 4
  /** Lowercase SHA-256 digest verified from the source bytes. */
  sha256: string
  /** Verified source byte length. */
  size: number
  /** Detected document family. */
  kind: FinanceDocumentKind
  /** Deterministic normalization outcome. */
  status: FinanceDocumentStatus
  /** Completion time as Unix epoch milliseconds. */
  normalizedAt: number
  /** Retained source counts. */
  summary: FinanceDocumentSummary
  /** Bounded source-located units. */
  units: FinanceDocumentUnit[]
  /** Supported document images represented only by extraction metadata. */
  visuals: FinanceDocumentVisual[]
  /** Stable warning codes; no parser stacks or source content. */
  warnings: string[]
  /** Stable failure code when status is `failed`. */
  failureCode?: string
}

/** One parsed file visible to a session-scoped document tool. */
export interface DocumentListItem<TId extends string> {
  /** Session-local opaque source identity. */
  documentId: TId
  /** User-facing uploaded filename. */
  name: string
  /** Detected document family. */
  kind: FinanceDocumentKind
  /** Current normalization outcome. */
  status: FinanceDocumentStatus
  /** Retained source counts. */
  summary: FinanceDocumentSummary
  /** Stable warnings suitable for the model and user. */
  warnings: string[]
}

/** Finance-session document list item. */
export type FinanceDocumentListItem = DocumentListItem<FinanceManagedFileId>

/** Ordinary-session document list item. */
export type XiaojingDocumentListItem = DocumentListItem<XiaojingDocumentId>

/** Paginated normalized content returned only to the owning session. */
export interface DocumentReadResult<TId extends string> extends DocumentListItem<TId> {
  /** Cursor used for this page. */
  cursor: number
  /** Source-located units admitted under the model-output limit. */
  units: FinanceDocumentUnit[]
  /** Next cursor, absent at end of document. */
  nextCursor?: number
}

/** Finance-session normalized read result. */
export type FinanceDocumentReadResult = DocumentReadResult<FinanceManagedFileId>

/** Ordinary-session normalized read result. */
export type XiaojingDocumentReadResult = DocumentReadResult<XiaojingDocumentId>

/** One model-visible document image and its source location. */
export interface DocumentVisualItem {
  /** Durable image attachment passed directly to the current visual model. */
  attachment: ImageAttachmentRef
  /** Human-readable source location. */
  locator: string
}

/** Paginated visual content returned only to the owning session. */
export interface DocumentVisualReadResult<TId extends string> extends DocumentListItem<TId> {
  /** Cursor used for this image batch. */
  cursor: number
  /** Document images admitted under attachment and plugin limits. */
  visuals: DocumentVisualItem[]
  /** Next cursor, absent at the end of retained document images. */
  nextCursor?: number
}

/** Finance-session document visual result. */
export type FinanceDocumentVisualReadResult = DocumentVisualReadResult<FinanceManagedFileId>

/** Ordinary-session document visual result. */
export type XiaojingDocumentVisualReadResult = DocumentVisualReadResult<XiaojingDocumentId>

/** Limits passed to the isolated parser worker. */
export interface FinanceDocumentParseLimits {
  /** Maximum accepted source bytes. */
  maxFileBytes: number
  /** Maximum accepted PDF pages. */
  maxPdfPages: number
  /** Maximum accepted PPTX slides. */
  maxPresentationSlides: number
  /** Maximum retained page renders and embedded raster images per document. */
  maxDocumentVisuals: number
  /** Maximum aggregate encoded bytes retained as document visual metadata. */
  maxDocumentVisualBytes: number
  /** Minimum extracted PDF characters before treating the file as image-only. */
  minPdfTextChars: number
  /** Preferred width for a complete rasterized PDF page. */
  pdfRenderWidthPx: number
  /** Maximum decoded pixels in one complete rasterized PDF page. */
  maxPdfRenderPixels: number
  /** Maximum retained characters across all normalized units. */
  maxTextChars: number
  /** Maximum characters in one normalized unit. */
  maxUnitChars: number
  /** Maximum accepted XLSX sheets. */
  maxSpreadsheetSheets: number
  /** Maximum retained rows across XLSX or CSV input. */
  maxSpreadsheetRows: number
  /** Maximum retained columns in one row. */
  maxSpreadsheetColumns: number
  /** Maximum inspected spreadsheet cells. */
  maxSpreadsheetCells: number
}

interface FinanceDocumentWorkerSource {
  /** Canonical source path under the adapter-authorized directory. */
  sourcePath: string
  /** User-facing filename used only for format selection. */
  originalName: string
  /** Expected digest from the durable upload fact. */
  expectedSha256: string
  /** Expected size from the durable upload fact. */
  expectedSize: number
}

/** Worker request that produces one normalized metadata and text record. */
export interface FinanceDocumentNormalizeWorkerRequest extends FinanceDocumentWorkerSource {
  /** Worker operation. */
  action: 'normalize'
  /** Resource limits resolved by the Host service. */
  limits: FinanceDocumentParseLimits
}

/** Worker request that extracts a bounded document-image batch. */
export interface FinanceDocumentVisualWorkerRequest extends FinanceDocumentWorkerSource {
  /** Worker operation. */
  action: 'extract-visuals'
  /** Verified source format selected from the normalized record. */
  kind: Exclude<FinanceDocumentKind, 'csv' | 'txt' | 'image' | 'unsupported'>
  /** Exact format-owned keys selected from the verified normalized record. */
  visualKeys: string[]
  /** Maximum returned image count. */
  maxVisuals: number
  /** Maximum accepted source bytes. */
  maxFileBytes: number
  /** Maximum aggregate encoded bytes returned by the worker. */
  maxOutputBytes: number
}

/** Validated request passed to one isolated parser worker. */
export type FinanceDocumentWorkerRequest = FinanceDocumentNormalizeWorkerRequest | FinanceDocumentVisualWorkerRequest

/** One worker-extracted document image. */
export interface FinanceDocumentExtractedVisual {
  /** Exact format-owned key selected by the Host. */
  sourceKey: string
  /** Verified image type. */
  mediaType: ImageMediaType
  /** Exact encoded raster bytes. */
  data: Uint8Array
}

/** Worker completion message. */
export type FinanceDocumentWorkerMessage =
  | { action: 'normalize'; ok: true; document: FinanceNormalizedDocument }
  | { action: 'extract-visuals'; ok: true; visuals: FinanceDocumentExtractedVisual[] }
  | { action: FinanceDocumentWorkerRequest['action']; ok: false; code: string }
