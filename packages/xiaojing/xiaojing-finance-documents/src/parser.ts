/** Deterministic parsers for the bounded Xiaojing document worker. */

import { extname } from 'node:path'
import { parse as parseCsv } from 'csv-parse/sync'
import mammoth from 'mammoth'
import readXlsxFile from 'read-excel-file/node'
import { extractText, getDocumentProxy } from 'unpdf'
import { extractDigitalInvoiceXml, extractOfd, InvoiceParseError } from './invoice.ts'
import {
  extractDocxVisualMetadata,
  extractXlsxVisualMetadata,
  OfficeVisualParseError,
} from './office-visuals.ts'
import { extractPdfVisualMetadata } from './pdf-visuals.ts'
import { extractPptx, PptxParseError } from './pptx.ts'
import type {
  FinanceDocumentKind,
  FinanceDocumentParseLimits,
  FinanceDocumentUnit,
  FinanceDocumentVisual,
  FinanceNormalizedDocument,
} from './types.ts'

const SCHEMA_VERSION = 3
const NORMALIZER_VERSION = 4

class UnitCollector {
  readonly units: FinanceDocumentUnit[] = []
  readonly warnings = new Set<string>()
  private retainedChars = 0

  constructor(private readonly limits: FinanceDocumentParseLimits) {}

  /** Number of retained text characters. */
  get charCount(): number {
    return this.retainedChars
  }

  /** Add bounded chunks while preserving one source locator. */
  add(kind: FinanceDocumentUnit['kind'], locator: string, input: string): void {
    const text = normalizeText(input).trim()
    if (text.length === 0 || this.retainedChars >= this.limits.maxTextChars) {
      if (text.length > 0) this.warnings.add('content-truncated')
      return
    }
    let offset = 0
    let part = 1
    while (offset < text.length && this.retainedChars < this.limits.maxTextChars) {
      const available = Math.min(
        this.limits.maxUnitChars,
        this.limits.maxTextChars - this.retainedChars,
      )
      const chunk = text.slice(offset, offset + available)
      this.units.push({
        index: this.units.length,
        kind,
        locator: text.length <= this.limits.maxUnitChars ? locator : `${locator}，片段${part}`,
        text: chunk,
      })
      this.retainedChars += chunk.length
      offset += chunk.length
      part += 1
    }
    if (offset < text.length) this.warnings.add('content-truncated')
  }
}

function normalizeText(text: string): string {
  return text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').replaceAll('\u0000', '')
}

function kindFromName(name: string): FinanceDocumentKind {
  switch (extname(name).toLowerCase()) {
    case '.pdf': return 'pdf'
    case '.docx': return 'docx'
    case '.xlsx': return 'xlsx'
    case '.pptx': return 'pptx'
    case '.xml': return 'xml'
    case '.ofd': return 'ofd'
    case '.csv': return 'csv'
    case '.txt': return 'txt'
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.webp':
    case '.gif': return 'image'
    default: return 'unsupported'
  }
}

/**
 * Resolve the cache key's format before parsing.
 * @param name - Imported filename.
 * @returns Format hint.
 */
export function financeDocumentKindFromName(name: string): FinanceDocumentKind {
  return kindFromName(name)
}

function summary(
  collector: UnitCollector,
  extra: { pageCount?: number; slideCount?: number; visualCount?: number; sheetNames?: string[]; rowCount?: number } = {},
): FinanceNormalizedDocument['summary'] {
  return {
    ...extra,
    unitCount: collector.units.length,
    charCount: collector.charCount,
  }
}

function terminalDocument(
  sha256: string,
  size: number,
  kind: FinanceDocumentKind,
  status: Exclude<FinanceNormalizedDocument['status'], 'parsed'>,
  normalizedAt: number,
  warnings: string[],
  failureCode?: string,
): FinanceNormalizedDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    normalizerVersion: NORMALIZER_VERSION,
    sha256,
    size,
    kind,
    status,
    normalizedAt,
    summary: { unitCount: 0, charCount: 0 },
    units: [],
    visuals: [],
    warnings,
    ...failureCode === undefined ? {} : { failureCode },
  }
}

function parsedDocument(
  sha256: string,
  size: number,
  kind: FinanceDocumentKind,
  normalizedAt: number,
  collector: UnitCollector,
  extra: { pageCount?: number; slideCount?: number; visualCount?: number; sheetNames?: string[]; rowCount?: number } = {},
  visuals: FinanceNormalizedDocument['visuals'] = [],
): FinanceNormalizedDocument {
  if (collector.units.length === 0) {
    return terminalDocument(sha256, size, kind, 'failed', normalizedAt, [...collector.warnings], 'empty-document')
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    normalizerVersion: NORMALIZER_VERSION,
    sha256,
    size,
    kind,
    status: 'parsed',
    normalizedAt,
    summary: summary(collector, extra),
    units: collector.units,
    visuals,
    warnings: [...collector.warnings],
  }
}

function visionRequiredDocument(
  sha256: string,
  size: number,
  kind: FinanceDocumentKind,
  normalizedAt: number,
  warnings: readonly string[],
  visuals: FinanceDocumentVisual[],
  extra: { pageCount?: number; slideCount?: number; visualCount?: number; sheetNames?: string[]; rowCount?: number } = {},
): FinanceNormalizedDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    normalizerVersion: NORMALIZER_VERSION,
    sha256,
    size,
    kind,
    status: 'vision-required',
    normalizedAt,
    summary: { ...extra, unitCount: 0, charCount: 0 },
    units: [],
    visuals,
    warnings: [...warnings],
  }
}

interface VisualMetadata {
  sourceKey: string
  mediaType: FinanceDocumentVisual['mediaType']
  bytes: number
  locator: string
}

function retainVisuals(
  kind: 'docx' | 'xlsx' | 'pptx' | 'ofd',
  input: readonly VisualMetadata[],
  unsupportedVisualCount: number,
  limits: FinanceDocumentParseLimits,
  warnings: Set<string>,
): FinanceDocumentVisual[] {
  const retained: FinanceDocumentVisual[] = []
  let retainedBytes = 0
  let omittedVisualCount = 0
  for (const visual of input) {
    if (retained.length >= limits.maxDocumentVisuals
      || retainedBytes + visual.bytes > limits.maxDocumentVisualBytes) {
      omittedVisualCount += 1
      continue
    }
    retainedBytes += visual.bytes
    retained.push({ index: retained.length, ...visual })
  }
  if (retained.length > 0) warnings.add(`${kind}-embedded-images-available:${retained.length}`)
  if (omittedVisualCount > 0) warnings.add(`${kind}-embedded-images-truncated:${omittedVisualCount}`)
  if (unsupportedVisualCount > 0) warnings.add(`${kind}-unsupported-visuals:${unsupportedVisualCount}`)
  return retained
}

function startsWith(data: Buffer, signature: readonly number[]): boolean {
  return signature.every((value, index) => data[index] === value)
}

function decodePlainText(data: Buffer): string {
  if (startsWith(data, [0xEF, 0xBB, 0xBF])) return new TextDecoder('utf-8').decode(data.subarray(3))
  if (startsWith(data, [0xFF, 0xFE])) return new TextDecoder('utf-16le').decode(data.subarray(2))
  if (startsWith(data, [0xFE, 0xFF])) return new TextDecoder('utf-16be').decode(data.subarray(2))
  const sample = data.subarray(0, Math.min(data.length, 4_096))
  if ([...sample].filter(byte => byte === 0).length > sample.length / 100) {
    throw new Error('binary-text-input')
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    return new TextDecoder('gb18030', { fatal: true }).decode(data)
  }
}

async function parsePdf(
  data: Buffer,
  sha256: string,
  limits: FinanceDocumentParseLimits,
  normalizedAt: number,
): Promise<FinanceNormalizedDocument> {
  if (!startsWith(data, [0x25, 0x50, 0x44, 0x46, 0x2D])) {
    return terminalDocument(sha256, data.length, 'pdf', 'failed', normalizedAt, [], 'invalid-pdf-signature')
  }
  const proxy = await getDocumentProxy(new Uint8Array(data), {
    maxImageSize: 16_777_216,
  })
  try {
    if (proxy.numPages > limits.maxPdfPages) {
      return terminalDocument(sha256, data.length, 'pdf', 'failed', normalizedAt, [], 'pdf-page-limit-exceeded')
    }
    const extracted = await extractText(proxy)
    const extractedPages = Array.isArray(extracted.text) ? extracted.text : [extracted.text]
    const pages = Array.from({ length: proxy.numPages }, (_, index) => extractedPages[index] ?? '')
    const renderPageNumbers = pages.flatMap((page, index) => {
      const textLength = page.trim().length
      return textLength === 0 || textLength < limits.minPdfTextChars ? [index + 1] : []
    })
    const imageResult = await extractPdfVisualMetadata(proxy, {
      renderPageNumbers,
      renderWidthPx: limits.pdfRenderWidthPx,
      maxRenderPixels: limits.maxPdfRenderPixels,
      maxVisuals: limits.maxDocumentVisuals,
      maxOutputBytes: limits.maxDocumentVisualBytes,
    })
    const visuals = imageResult.visuals.map((visual, index) => ({ index, ...visual }))
    const visualWarnings = new Set<string>()
    if (imageResult.renderedPageCount > 0) {
      visualWarnings.add(`pdf-rendered-pages-available:${imageResult.renderedPageCount}`)
    }
    if (imageResult.omittedRenderedPageCount > 0) {
      visualWarnings.add(`pdf-rendered-pages-truncated:${imageResult.omittedRenderedPageCount}`)
    }
    if (imageResult.embeddedImageCount > 0) {
      visualWarnings.add(`pdf-embedded-images-available:${imageResult.embeddedImageCount}`)
    }
    if (imageResult.omittedEmbeddedImageCount > 0) {
      visualWarnings.add(`pdf-embedded-images-truncated:${imageResult.omittedEmbeddedImageCount}`)
    }
    const visibleChars = pages.reduce((total, page) => total + page.trim().length, 0)
    if (visibleChars === 0 || visibleChars < limits.minPdfTextChars) {
      return visionRequiredDocument(
        sha256,
        data.length,
        'pdf',
        normalizedAt,
        ['pdf-text-layer-missing', ...visualWarnings],
        visuals,
        { pageCount: proxy.numPages, visualCount: visuals.length },
      )
    }
    const collector = new UnitCollector(limits)
    let emptyPages = 0
    pages.forEach((page, index) => {
      if (page.trim().length === 0) emptyPages += 1
      else collector.add('text', `第${index + 1}页`, page)
    })
    for (const warning of visualWarnings) collector.warnings.add(warning)
    if (emptyPages > 0) collector.warnings.add(`pdf-pages-without-text:${emptyPages}`)
    return parsedDocument(sha256, data.length, 'pdf', normalizedAt, collector, {
      pageCount: proxy.numPages,
      visualCount: visuals.length,
    }, visuals)
  } finally {
    const destroy = (proxy as typeof proxy & { destroy?: () => Promise<void> }).destroy
    if (destroy !== undefined) await destroy.call(proxy)
  }
}

async function parseDocx(
  data: Buffer,
  sha256: string,
  limits: FinanceDocumentParseLimits,
  normalizedAt: number,
): Promise<FinanceNormalizedDocument> {
  if (!startsWith(data, [0x50, 0x4B, 0x03, 0x04])) {
    return terminalDocument(sha256, data.length, 'docx', 'failed', normalizedAt, [], 'invalid-docx-container')
  }
  const result = await mammoth.extractRawText({ buffer: data })
  const collector = new UnitCollector(limits)
  const paragraphs = normalizeText(result.value).split(/\n{2,}/u)
  paragraphs.forEach((paragraph, index) => { collector.add('text', `第${index + 1}段`, paragraph) })
  if (result.messages.length > 0) collector.warnings.add(`docx-parser-warnings:${result.messages.length}`)
  let visualResult
  try {
    visualResult = extractDocxVisualMetadata(data)
  } catch (error) {
    const code = error instanceof OfficeVisualParseError ? error.code : 'invalid-docx-document'
    return terminalDocument(sha256, data.length, 'docx', 'failed', normalizedAt, [], code)
  }
  const visuals = retainVisuals(
    'docx',
    visualResult.visuals,
    visualResult.unsupportedVisualCount,
    limits,
    collector.warnings,
  )
  if (collector.units.length === 0 && visuals.length > 0) {
    return visionRequiredDocument(
      sha256,
      data.length,
      'docx',
      normalizedAt,
      ['docx-text-layer-missing', ...collector.warnings],
      visuals,
      { visualCount: visuals.length },
    )
  }
  return parsedDocument(sha256, data.length, 'docx', normalizedAt, collector, {
    visualCount: visuals.length,
  }, visuals)
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  const text = typeof value === 'string'
    ? value
    : typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : JSON.stringify(value)
  return text.replaceAll('\t', ' ').replaceAll('\r', ' ').replaceAll('\n', ' ')
}

function retainRows(
  sheets: Awaited<ReturnType<typeof readXlsxFile>>,
  limits: FinanceDocumentParseLimits,
): { collector: UnitCollector; sheetNames: string[]; rowCount: number } {
  const collector = new UnitCollector(limits)
  const retainedSheets = sheets.slice(0, limits.maxSpreadsheetSheets)
  if (retainedSheets.length < sheets.length) collector.warnings.add('spreadsheet-sheets-truncated')
  let rowCount = 0
  let cellCount = 0
  outer: for (const sheet of retainedSheets) {
    for (let rowIndex = 0; rowIndex < sheet.data.length; rowIndex += 1) {
      if (rowCount >= limits.maxSpreadsheetRows || cellCount >= limits.maxSpreadsheetCells) {
        collector.warnings.add('spreadsheet-rows-truncated')
        break outer
      }
      const sourceRow = sheet.data[rowIndex] ?? []
      const row = sourceRow.slice(0, limits.maxSpreadsheetColumns)
      if (row.length < sourceRow.length) collector.warnings.add('spreadsheet-columns-truncated')
      if (cellCount + row.length > limits.maxSpreadsheetCells) {
        collector.warnings.add('spreadsheet-cells-truncated')
        break outer
      }
      cellCount += row.length
      rowCount += 1
      collector.add('row', `工作表“${sheet.sheet}”第${rowIndex + 1}行`, row.map(cellText).join('\t'))
    }
  }
  return { collector, sheetNames: retainedSheets.map(sheet => sheet.sheet), rowCount }
}

async function parseXlsx(
  data: Buffer,
  sha256: string,
  limits: FinanceDocumentParseLimits,
  normalizedAt: number,
): Promise<FinanceNormalizedDocument> {
  if (!startsWith(data, [0x50, 0x4B, 0x03, 0x04])) {
    return terminalDocument(sha256, data.length, 'xlsx', 'failed', normalizedAt, [], 'invalid-xlsx-container')
  }
  const sheets = await readXlsxFile(data)
  const retained = retainRows(sheets, limits)
  retained.collector.warnings.add('xlsx-formulas-not-evaluated')
  let visualResult
  try {
    visualResult = extractXlsxVisualMetadata(data)
  } catch (error) {
    const code = error instanceof OfficeVisualParseError ? error.code : 'invalid-xlsx-document'
    return terminalDocument(sha256, data.length, 'xlsx', 'failed', normalizedAt, [], code)
  }
  const visuals = retainVisuals(
    'xlsx',
    visualResult.visuals,
    visualResult.unsupportedVisualCount,
    limits,
    retained.collector.warnings,
  )
  if (retained.collector.units.length === 0 && visuals.length > 0) {
    return visionRequiredDocument(
      sha256,
      data.length,
      'xlsx',
      normalizedAt,
      ['xlsx-cell-content-missing', ...retained.collector.warnings],
      visuals,
      { sheetNames: retained.sheetNames, rowCount: retained.rowCount, visualCount: visuals.length },
    )
  }
  return parsedDocument(sha256, data.length, 'xlsx', normalizedAt, retained.collector, {
    sheetNames: retained.sheetNames,
    rowCount: retained.rowCount,
    visualCount: visuals.length,
  }, visuals)
}

function parsePptx(
  data: Buffer,
  sha256: string,
  limits: FinanceDocumentParseLimits,
  normalizedAt: number,
): FinanceNormalizedDocument {
  if (!startsWith(data, [0x50, 0x4B, 0x03, 0x04])) {
    return terminalDocument(sha256, data.length, 'pptx', 'failed', normalizedAt, [], 'invalid-pptx-container')
  }
  let presentation
  try {
    presentation = extractPptx(data, limits.maxPresentationSlides)
  } catch (error) {
    const code = error instanceof PptxParseError ? error.code : 'invalid-pptx-presentation'
    return terminalDocument(sha256, data.length, 'pptx', 'failed', normalizedAt, [], code)
  }
  const collector = new UnitCollector(limits)
  presentation.slides.forEach((slide, index) => {
    const content = [
      slide.text,
      ...slide.notes === undefined ? [] : [`演讲者备注：\n${slide.notes}`],
    ].filter(part => part.length > 0).join('\n\n')
    collector.add('text', `第${index + 1}张幻灯片`, content)
  })
  if (presentation.emptySlideCount > 0) {
    collector.warnings.add(`pptx-slides-without-text:${presentation.emptySlideCount}`)
  }
  if (presentation.hasNonTextContent) collector.warnings.add('pptx-non-text-content-not-extracted')
  const visuals = retainVisuals(
    'pptx',
    presentation.visuals.map(visual => ({
      sourceKey: visual.archivePart,
      mediaType: visual.mediaType,
      bytes: visual.bytes,
      locator: `幻灯片 ${visual.slideNumbers.join('、')}`,
    })),
    presentation.unsupportedVisualCount,
    limits,
    collector.warnings,
  )
  if (collector.units.length === 0) {
    return visionRequiredDocument(
      sha256,
      data.length,
      'pptx',
      normalizedAt,
      ['pptx-text-layer-missing', ...collector.warnings],
      visuals,
      { slideCount: presentation.slides.length, visualCount: visuals.length },
    )
  }
  return parsedDocument(sha256, data.length, 'pptx', normalizedAt, collector, {
    slideCount: presentation.slides.length,
    visualCount: visuals.length,
  }, visuals)
}

function parseInvoiceXml(
  data: Buffer,
  sha256: string,
  limits: FinanceDocumentParseLimits,
  normalizedAt: number,
): FinanceNormalizedDocument {
  let fields
  try {
    fields = extractDigitalInvoiceXml(data)
  } catch (error) {
    const code = error instanceof InvoiceParseError ? error.code : 'invalid-invoice-xml'
    return terminalDocument(sha256, data.length, 'xml', 'failed', normalizedAt, [], code)
  }
  if (fields === undefined) {
    return terminalDocument(
      sha256,
      data.length,
      'xml',
      'unsupported',
      normalizedAt,
      ['xml-not-recognized-as-digital-invoice'],
    )
  }
  const collector = new UnitCollector(limits)
  fields.forEach((field) => {
    collector.add('row', `XML字段 ${field.sourceName}`, `${field.label}\t${field.value}`)
  })
  collector.warnings.add('digital-invoice-xml-detected')
  collector.warnings.add('digital-invoice-signature-not-verified')
  return parsedDocument(sha256, data.length, 'xml', normalizedAt, collector)
}

function parseOfd(
  data: Buffer,
  sha256: string,
  limits: FinanceDocumentParseLimits,
  normalizedAt: number,
): FinanceNormalizedDocument {
  if (!startsWith(data, [0x50, 0x4B, 0x03, 0x04])) {
    return terminalDocument(sha256, data.length, 'ofd', 'failed', normalizedAt, [], 'invalid-ofd-container')
  }
  let result
  try {
    result = extractOfd(data, limits.maxPdfPages)
  } catch (error) {
    const code = error instanceof InvoiceParseError ? error.code : 'invalid-ofd-document'
    return terminalDocument(sha256, data.length, 'ofd', 'failed', normalizedAt, [], code)
  }
  const collector = new UnitCollector(limits)
  result.pages.forEach((page, index) => { collector.add('text', `第${index + 1}页`, page) })
  result.invoiceFields?.forEach((field) => {
    collector.add('row', `OFD结构字段 ${field.sourceName}`, `${field.label}\t${field.value}`)
  })
  const visuals = retainVisuals(
    'ofd',
    result.visuals,
    result.unsupportedVisualCount,
    limits,
    collector.warnings,
  )
  if (result.digitalInvoice) {
    collector.warnings.add('digital-invoice-ofd-detected')
    if (result.invoiceFields !== undefined) collector.warnings.add('digital-invoice-ofd-structured-data-detected')
    collector.warnings.add('digital-invoice-signature-not-verified')
  }
  if (collector.units.length === 0 && visuals.length > 0) {
    return visionRequiredDocument(
      sha256,
      data.length,
      'ofd',
      normalizedAt,
      ['ofd-text-layer-missing', ...collector.warnings],
      visuals,
      { pageCount: result.pages.length, visualCount: visuals.length },
    )
  }
  return parsedDocument(sha256, data.length, 'ofd', normalizedAt, collector, {
    pageCount: result.pages.length,
    visualCount: visuals.length,
  }, visuals)
}

function parseDelimitedText(
  data: Buffer,
  sha256: string,
  limits: FinanceDocumentParseLimits,
  normalizedAt: number,
): FinanceNormalizedDocument {
  const rows = parseCsv(decodePlainText(data), {
    bom: true,
    relax_column_count: true,
    skip_empty_lines: false,
  }) as unknown[][]
  const collector = new UnitCollector(limits)
  let cells = 0
  let rowCount = 0
  for (let index = 0; index < rows.length; index += 1) {
    if (rowCount >= limits.maxSpreadsheetRows || cells >= limits.maxSpreadsheetCells) {
      collector.warnings.add('spreadsheet-rows-truncated')
      break
    }
    const sourceRow = rows[index] ?? []
    const row = sourceRow.slice(0, limits.maxSpreadsheetColumns)
    if (row.length < sourceRow.length) collector.warnings.add('spreadsheet-columns-truncated')
    if (cells + row.length > limits.maxSpreadsheetCells) {
      collector.warnings.add('spreadsheet-cells-truncated')
      break
    }
    cells += row.length
    rowCount += 1
    collector.add('row', `第${index + 1}行`, row.map(cellText).join('\t'))
  }
  return parsedDocument(sha256, data.length, 'csv', normalizedAt, collector, { rowCount })
}

function parseText(
  data: Buffer,
  sha256: string,
  limits: FinanceDocumentParseLimits,
  normalizedAt: number,
): FinanceNormalizedDocument {
  const collector = new UnitCollector(limits)
  const lines = normalizeText(decodePlainText(data)).split('\n')
  let start = 0
  let pending: string[] = []
  const flush = (end: number): void => {
    if (pending.length === 0) return
    collector.add('text', `第${start + 1}-${end}行`, pending.join('\n'))
    pending = []
  }
  for (let index = 0; index < lines.length; index += 1) {
    if (pending.length === 0) start = index
    pending.push(lines[index] ?? '')
    if (pending.join('\n').length >= limits.maxUnitChars) flush(index + 1)
  }
  flush(lines.length)
  return parsedDocument(sha256, data.length, 'txt', normalizedAt, collector)
}

/**
 * Normalize one already size- and digest-verified source buffer.
 * @param data - Complete source bytes.
 * @param originalName - Imported filename used for supported-format selection.
 * @param sha256 - Verified lowercase digest.
 * @param limits - Resource limits.
 * @param normalizedAt - Completion timestamp supplied by the worker.
 * @returns Deterministic normalized record.
 */
export async function normalizeFinanceDocument(
  data: Buffer,
  originalName: string,
  sha256: string,
  limits: FinanceDocumentParseLimits,
  normalizedAt = Date.now(),
): Promise<FinanceNormalizedDocument> {
  if (data.length > limits.maxFileBytes) {
    return terminalDocument(sha256, data.length, kindFromName(originalName), 'failed', normalizedAt, [], 'file-size-limit-exceeded')
  }
  const kind = kindFromName(originalName)
  switch (kind) {
    case 'pdf': return await parsePdf(data, sha256, limits, normalizedAt)
    case 'docx': return await parseDocx(data, sha256, limits, normalizedAt)
    case 'xlsx': return await parseXlsx(data, sha256, limits, normalizedAt)
    case 'pptx': return parsePptx(data, sha256, limits, normalizedAt)
    case 'xml': return parseInvoiceXml(data, sha256, limits, normalizedAt)
    case 'ofd': return parseOfd(data, sha256, limits, normalizedAt)
    case 'csv': return parseDelimitedText(data, sha256, limits, normalizedAt)
    case 'txt': return parseText(data, sha256, limits, normalizedAt)
    case 'image': return terminalDocument(sha256, data.length, kind, 'native-vision', normalizedAt, ['use-native-vision'])
    case 'unsupported': return terminalDocument(sha256, data.length, kind, 'unsupported', normalizedAt, ['unsupported-document-format'])
  }
}
