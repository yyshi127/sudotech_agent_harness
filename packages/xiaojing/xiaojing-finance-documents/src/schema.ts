/** Durable and worker-wire validation for Finance normalized documents. */

import { z } from 'zod'
import type { FinanceDocumentWorkerMessage, FinanceDocumentWorkerRequest, FinanceNormalizedDocument } from './types.ts'

const SHA256 = /^[a-f0-9]{64}$/u

const limitsSchema = z.object({
  maxFileBytes: z.number().int().positive(),
  maxPdfPages: z.number().int().positive(),
  maxPresentationSlides: z.number().int().positive(),
  maxDocumentVisuals: z.number().int().positive(),
  maxDocumentVisualBytes: z.number().int().positive(),
  minPdfTextChars: z.number().int().nonnegative(),
  pdfRenderWidthPx: z.number().int().positive(),
  maxPdfRenderPixels: z.number().int().positive(),
  maxTextChars: z.number().int().positive(),
  maxUnitChars: z.number().int().positive(),
  maxSpreadsheetSheets: z.number().int().positive(),
  maxSpreadsheetRows: z.number().int().positive(),
  maxSpreadsheetColumns: z.number().int().positive(),
  maxSpreadsheetCells: z.number().int().positive(),
}).strict()

const unitSchema = z.object({
  index: z.number().int().nonnegative(),
  kind: z.enum(['text', 'row']),
  locator: z.string().min(1),
  text: z.string(),
}).strict()

const summarySchema = z.object({
  pageCount: z.number().int().nonnegative().optional(),
  slideCount: z.number().int().nonnegative().optional(),
  visualCount: z.number().int().nonnegative().optional(),
  sheetNames: z.array(z.string()).optional(),
  rowCount: z.number().int().nonnegative().optional(),
  unitCount: z.number().int().nonnegative(),
  charCount: z.number().int().nonnegative(),
}).strict()

const visualSchema = z.object({
  index: z.number().int().nonnegative(),
  sourceKey: z.string().min(1),
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  bytes: z.number().int().positive(),
  locator: z.string().min(1),
}).strict()

/** Zod schema for one durable normalized-document record. */
export const normalizedDocumentSchema = z.object({
  schemaVersion: z.literal(3),
  normalizerVersion: z.literal(4),
  sha256: z.string().regex(SHA256),
  size: z.number().int().nonnegative(),
  kind: z.enum(['pdf', 'docx', 'xlsx', 'pptx', 'xml', 'ofd', 'csv', 'txt', 'image', 'unsupported']),
  status: z.enum(['parsed', 'vision-required', 'native-vision', 'unsupported', 'failed']),
  normalizedAt: z.number().int().nonnegative(),
  summary: summarySchema,
  units: z.array(unitSchema),
  visuals: z.array(visualSchema),
  warnings: z.array(z.string()),
  failureCode: z.string().optional(),
}).strict().superRefine((document, ctx) => {
  if (document.summary.unitCount !== document.units.length) {
    ctx.addIssue({ code: 'custom', message: 'summary.unitCount must equal units.length' })
  }
  const charCount = document.units.reduce((total, unit) => total + unit.text.length, 0)
  if (document.summary.charCount !== charCount) {
    ctx.addIssue({ code: 'custom', message: 'summary.charCount must equal retained unit text' })
  }
  if (document.status === 'parsed' && document.units.length === 0) {
    ctx.addIssue({ code: 'custom', message: 'parsed documents require at least one unit' })
  }
  if (document.status !== 'parsed' && document.units.length > 0) {
    ctx.addIssue({ code: 'custom', message: 'non-parsed documents cannot retain units' })
  }
  if (document.summary.visualCount !== undefined && document.summary.visualCount !== document.visuals.length) {
    ctx.addIssue({ code: 'custom', message: 'summary.visualCount must equal visuals.length' })
  }
  document.visuals.forEach((visual, index) => {
    if (visual.index !== index) ctx.addIssue({ code: 'custom', message: 'visual indexes must be contiguous' })
  })
  if (document.status !== 'parsed' && document.status !== 'vision-required' && document.visuals.length > 0) {
    ctx.addIssue({ code: 'custom', message: 'only parsed or vision-required documents may retain visuals' })
  }
  if ((document.status === 'failed') !== (document.failureCode !== undefined)) {
    ctx.addIssue({ code: 'custom', message: 'failureCode is required only for failed documents' })
  }
})

const workerSourceSchema = z.object({
  sourcePath: z.string().min(1),
  originalName: z.string().min(1),
  expectedSha256: z.string().regex(SHA256),
  expectedSize: z.number().int().nonnegative(),
}).strict()

const workerRequestSchema = z.discriminatedUnion('action', [
  workerSourceSchema.extend({
    action: z.literal('normalize'),
    limits: limitsSchema,
  }).strict(),
  workerSourceSchema.extend({
    action: z.literal('extract-visuals'),
    kind: z.enum(['pdf', 'docx', 'xlsx', 'pptx', 'xml', 'ofd']),
    visualKeys: z.array(z.string().min(1)).min(1),
    maxVisuals: z.number().int().positive(),
    maxFileBytes: z.number().int().positive(),
    maxOutputBytes: z.number().int().positive(),
  }).strict(),
])

const workerMessageSchema = z.union([
  z.object({ action: z.literal('normalize'), ok: z.literal(true), document: normalizedDocumentSchema }).strict(),
  z.object({
    action: z.literal('extract-visuals'),
    ok: z.literal(true),
    visuals: z.array(z.object({
      sourceKey: z.string().min(1),
      mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
      data: z.instanceof(Uint8Array),
    }).strict()),
  }).strict(),
  z.object({
    action: z.enum(['normalize', 'extract-visuals']),
    ok: z.literal(false),
    code: z.string().min(1),
  }).strict(),
])

/**
 * Parse untrusted durable JSON.
 * @param value - Parsed JSON value.
 * @returns Valid normalized document.
 */
export function parseNormalizedDocument(value: unknown): FinanceNormalizedDocument {
  return normalizedDocumentSchema.parse(value) as FinanceNormalizedDocument
}

/**
 * Parse worker boot data.
 * @param value - `workerData` value.
 * @returns Valid parser request.
 */
export function parseWorkerRequest(value: unknown): FinanceDocumentWorkerRequest {
  return workerRequestSchema.parse(value)
}

/**
 * Parse a worker completion message.
 * @param value - Worker message.
 * @returns Valid completion.
 */
export function parseWorkerMessage(value: unknown): FinanceDocumentWorkerMessage {
  return workerMessageSchema.parse(value) as FinanceDocumentWorkerMessage
}
