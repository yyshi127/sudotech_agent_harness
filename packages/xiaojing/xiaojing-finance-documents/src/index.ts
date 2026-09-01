/** Xiaojing shared deterministic document normalization service. */

import { basename, extname } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-attachment'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { FinanceManagedFileId } from '@deepseek-ai/dsh-xiaojing-finance-domain/types'
import type {} from '@deepseek-ai/dsh-xiaojing-finance-domain'
import {
  financeDocumentSourceFromEvent,
  financeDocumentSources,
  type DocumentSource,
  type DocumentSourceFile,
} from './compat.ts'
import { generalDocumentCandidates } from './general-compat.ts'
import { FinanceDocumentNormalizer } from './normalizer.ts'
import { MAX_PDF_RENDER_DIMENSION } from './pdf-visuals.ts'
import { FinanceDocumentStore } from './store.ts'
import { XiaojingDocumentId } from './types.ts'
import type {
  DocumentListItem,
  DocumentReadResult,
  DocumentVisualItem,
  DocumentVisualReadResult,
  FinanceDocumentListItem,
  FinanceDocumentParseLimits,
  FinanceDocumentReadResult,
  FinanceDocumentVisualReadResult,
  FinanceDocumentVisual,
  FinanceNormalizedDocument,
  XiaojingDocumentListItem,
  XiaojingDocumentReadResult,
  XiaojingDocumentVisualReadResult,
} from './types.ts'
import { FinanceDocumentWorkerError } from './worker-runner.ts'

export type * from './types.ts'
export { FinanceDocumentStore } from './store.ts'
export { FinanceDocumentNormalizer } from './normalizer.ts'
export { financeDocumentKindFromName, normalizeFinanceDocument } from './parser.ts'

/** Deployment limits for local document normalization and model-visible reads. */
export interface Config {
  /** Explicit Harness home; omission follows `DSH_HOME`, then `~/.dsh`. */
  dshHome?: string
  /** Maximum accepted source bytes. */
  maxFileBytes?: number
  /** Parser worker wall deadline in milliseconds. */
  parseTimeoutMs?: number
  /** Parser worker V8 old-generation ceiling in MiB. */
  workerMemoryMb?: number
  /** Maximum accepted PDF pages. */
  maxPdfPages?: number
  /** Maximum accepted PPTX slides. */
  maxPresentationSlides?: number
  /** Maximum retained page renders and embedded raster images per document. */
  maxDocumentVisuals?: number
  /** Maximum aggregate page-render and embedded-image bytes retained per document. */
  maxDocumentVisualBytes?: number
  /** Minimum extracted PDF characters before requiring image/OCR handling. */
  minPdfTextChars?: number
  /** Preferred width for complete-page PDF rendering. */
  pdfRenderWidthPx?: number
  /** Maximum decoded pixels in one complete rendered PDF page. */
  maxPdfRenderPixels?: number
  /** Maximum retained characters per normalized document. */
  maxTextChars?: number
  /** Maximum retained characters per source-located unit. */
  maxUnitChars?: number
  /** Maximum XLSX sheets inspected. */
  maxSpreadsheetSheets?: number
  /** Maximum XLSX or CSV rows retained. */
  maxSpreadsheetRows?: number
  /** Maximum columns retained in one spreadsheet row. */
  maxSpreadsheetColumns?: number
  /** Maximum spreadsheet cells inspected. */
  maxSpreadsheetCells?: number
  /** Maximum characters returned by one model tool read. */
  maxToolChars?: number
  /** Maximum document visuals returned by one model tool read. */
  maxVisualsPerRead?: number
  /** Maximum aggregate encoded image bytes returned by one model tool read. */
  maxVisualBytesPerRead?: number
}

/** Runtime configuration schema. */
export const Config: s<Config> = s.object({
  dshHome: s.string(),
  maxFileBytes: s.number().default(100 * 1024 * 1024),
  parseTimeoutMs: s.number().default(120_000),
  workerMemoryMb: s.number().default(256),
  maxPdfPages: s.number().default(300),
  maxPresentationSlides: s.number().default(300),
  maxDocumentVisuals: s.number().default(200),
  maxDocumentVisualBytes: s.number().default(100_000_000),
  minPdfTextChars: s.number().default(24),
  pdfRenderWidthPx: s.number().default(1_600),
  maxPdfRenderPixels: s.number().default(8_000_000),
  maxTextChars: s.number().default(500_000),
  maxUnitChars: s.number().default(8_000),
  maxSpreadsheetSheets: s.number().default(50),
  maxSpreadsheetRows: s.number().default(20_000),
  maxSpreadsheetColumns: s.number().default(256),
  maxSpreadsheetCells: s.number().default(200_000),
  maxToolChars: s.number().default(24_000),
  maxVisualsPerRead: s.number().default(6),
  maxVisualBytesPerRead: s.number().default(40_000_000),
})

type ResolvedConfig = Required<Omit<Config, 'dshHome'>> & Pick<Config, 'dshHome'>

function positiveInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`xiaojing-finance-documents: ${name} must be a positive safe integer`)
  }
  return value
}

function nonNegativeInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`xiaojing-finance-documents: ${name} must be a non-negative safe integer`)
  }
  return value
}

function errorCode(error: unknown): string {
  return error instanceof FinanceDocumentWorkerError ? error.code : 'normalization-unavailable'
}

type IdentifiedSource<TId extends string> = DocumentSource<DocumentSourceFile & { id: TId }>

function item<TId extends string>(source: IdentifiedSource<TId>, document: FinanceNormalizedDocument): DocumentListItem<TId> {
  return {
    documentId: source.file.id,
    name: source.file.name,
    kind: document.kind,
    status: document.status,
    summary: structuredClone(document.summary),
    warnings: [...document.warnings, ...document.failureCode === undefined ? [] : [document.failureCode]],
  }
}

function failedItem<TId extends string>(documentId: TId, name: string, code: string): DocumentListItem<TId> {
  return {
    documentId,
    name,
    kind: 'unsupported',
    status: 'failed',
    summary: { unitCount: 0, charCount: 0 },
    warnings: [code],
  }
}

function readPage<TId extends string>(
  base: DocumentListItem<TId>,
  document: FinanceNormalizedDocument,
  cursor: number,
  maxCharacters: number,
): DocumentReadResult<TId> {
  if (document.status !== 'parsed' || cursor >= document.units.length) return { ...base, cursor, units: [] }
  const units = []
  let characters = 0
  for (let index = cursor; index < document.units.length; index += 1) {
    const unit = document.units[index]
    if (unit === undefined) break
    if (units.length > 0 && characters + unit.text.length > maxCharacters) break
    units.push(structuredClone(unit))
    characters += unit.text.length
  }
  const next = cursor + units.length
  return {
    ...base,
    cursor,
    units,
    ...next < document.units.length ? { nextCursor: next } : {},
  }
}

function visualName(sourceName: string, visualIndex: number, mediaType: string): string {
  const stem = basename(sourceName, extname(sourceName))
  const extension = mediaType === 'image/jpeg' ? 'jpg' : mediaType.slice('image/'.length)
  return `${stem}-image-${visualIndex + 1}.${extension}`
}

function waitForCaller<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return promise
  if (signal.aborted) return Promise.reject(new FinanceDocumentWorkerError('aborted'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(new FinanceDocumentWorkerError('aborted')) }
    signal.addEventListener('abort', onAbort, { once: true })
    void promise.then(resolve, reject).finally(() => { signal.removeEventListener('abort', onAbort) })
  })
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Session-authorized local document normalization and bounded reads. */
    xiaojingFinanceDocuments: XiaojingFinanceDocuments
  }
}

/** Host service exposed only through the Finance preset's document tool. */
export class XiaojingFinanceDocuments extends Service {
  static inject = ['xiaojingFinanceDomain', 'attachments']
  static Config = Config

  private readonly controller = new AbortController()
  private readonly store: FinanceDocumentStore
  private readonly normalizer: FinanceDocumentNormalizer
  private readonly background = new Set<Promise<void>>()
  private readonly maxToolChars: number
  private readonly maxVisualsPerRead: number
  private readonly maxVisualBytesPerRead: number

  /** @param ctx - Finance Host context. @param config - Parser, storage, and output limits. */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'xiaojingFinanceDocuments')
    const resolved = config as ResolvedConfig
    const pdfRenderWidthPx = positiveInteger('pdfRenderWidthPx', resolved.pdfRenderWidthPx)
    if (pdfRenderWidthPx > MAX_PDF_RENDER_DIMENSION) {
      throw new Error(`xiaojing-finance-documents: pdfRenderWidthPx cannot exceed ${MAX_PDF_RENDER_DIMENSION}`)
    }
    const limits: FinanceDocumentParseLimits = {
      maxFileBytes: positiveInteger('maxFileBytes', resolved.maxFileBytes),
      maxPdfPages: positiveInteger('maxPdfPages', resolved.maxPdfPages),
      maxPresentationSlides: positiveInteger('maxPresentationSlides', resolved.maxPresentationSlides),
      maxDocumentVisuals: positiveInteger('maxDocumentVisuals', resolved.maxDocumentVisuals),
      maxDocumentVisualBytes: positiveInteger('maxDocumentVisualBytes', resolved.maxDocumentVisualBytes),
      minPdfTextChars: nonNegativeInteger('minPdfTextChars', resolved.minPdfTextChars),
      pdfRenderWidthPx,
      maxPdfRenderPixels: positiveInteger('maxPdfRenderPixels', resolved.maxPdfRenderPixels),
      maxTextChars: positiveInteger('maxTextChars', resolved.maxTextChars),
      maxUnitChars: positiveInteger('maxUnitChars', resolved.maxUnitChars),
      maxSpreadsheetSheets: positiveInteger('maxSpreadsheetSheets', resolved.maxSpreadsheetSheets),
      maxSpreadsheetRows: positiveInteger('maxSpreadsheetRows', resolved.maxSpreadsheetRows),
      maxSpreadsheetColumns: positiveInteger('maxSpreadsheetColumns', resolved.maxSpreadsheetColumns),
      maxSpreadsheetCells: positiveInteger('maxSpreadsheetCells', resolved.maxSpreadsheetCells),
    }
    this.maxToolChars = positiveInteger('maxToolChars', resolved.maxToolChars)
    this.maxVisualsPerRead = positiveInteger('maxVisualsPerRead', resolved.maxVisualsPerRead)
    this.maxVisualBytesPerRead = positiveInteger('maxVisualBytesPerRead', resolved.maxVisualBytesPerRead)
    if (limits.maxUnitChars > this.maxToolChars) {
      throw new Error('xiaojing-finance-documents: maxUnitChars cannot exceed maxToolChars')
    }
    this.store = new FinanceDocumentStore(resolveDshHome(resolved.dshHome))
    this.normalizer = new FinanceDocumentNormalizer(
      this.store,
      limits,
      positiveInteger('parseTimeoutMs', resolved.parseTimeoutMs),
      positiveInteger('workerMemoryMb', resolved.workerMemoryMb),
      this.controller.signal,
    )
  }

  /** Validate cache storage, admit import warming, and drain parsers on disposal. */
  protected async *[Service.init](): AsyncGenerator<() => Promise<void>, void, void> {
    yield async () => {
      this.controller.abort()
      await this.normalizer.close()
      await Promise.allSettled([...this.background])
    }
    await this.store.init()
    this.ctx.on('session/event', (session, event) => {
      if (event.type !== 'finance/file-imported' && event.type !== 'finance/consultation-file-imported') return
      const source = financeDocumentSourceFromEvent(this.ctx, session, event.data.file)
      if (source === undefined) return
      const pending = this.normalizer.ensure(source).then(() => {}, (error: unknown) => {
        this.ctx.logger.warn('xiaojing-finance-documents: background normalization failed (%s)', errorCode(error))
      }).finally(() => { this.background.delete(pending) })
      this.background.add(pending)
    }, { global: true })
  }

  /**
   * List and normalize original-material imports in the calling Finance session.
   * @param agent - Calling Finance agent.
   * @param signal - Caller cancellation signal; shared warming remains useful after cancellation.
   * @returns Imported document states in event order.
   */
  async listDocuments(agent: Agent, signal?: AbortSignal): Promise<FinanceDocumentListItem[]> {
    const output: FinanceDocumentListItem[] = []
    for (const source of financeDocumentSources(this.ctx, agent)) {
      try {
        output.push(item(source, await waitForCaller(this.normalizer.ensure(source), signal)))
      } catch (error) {
        output.push(failedItem(source.file.id, source.file.name, errorCode(error)))
      }
    }
    return output
  }

  /**
   * Read one bounded page of normalized content from the calling Finance session.
   * @param agent - Calling Finance agent.
   * @param documentId - Session import identity returned by {@link listDocuments}.
   * @param cursor - Zero-based normalized-unit cursor.
   * @param signal - Caller cancellation signal.
   * @returns Paginated normalized content.
   */
  async readDocument(
    agent: Agent,
    documentId: FinanceManagedFileId,
    cursor: number = 0,
    signal?: AbortSignal,
  ): Promise<FinanceDocumentReadResult> {
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('xiaojing-finance-documents: cursor must be a non-negative safe integer')
    const source = financeDocumentSources(this.ctx, agent).find(candidate => candidate.file.id === documentId)
    if (source === undefined) throw new Error('xiaojing-finance-documents: document is not an original-material import in this Finance session')
    const document = await waitForCaller(this.normalizer.ensure(source), signal)
    return readPage(item(source, document), document, cursor, this.maxToolChars)
  }

  /**
   * Read one bounded document-image page from the calling Finance session.
   * @param agent - Calling Finance agent.
   * @param documentId - Session import identity returned by {@link listDocuments}.
   * @param cursor - Zero-based document-image cursor.
   * @param signal - Caller cancellation signal.
   * @returns Durable native-vision attachments and their slide locations.
   */
  async readDocumentVisuals(
    agent: Agent,
    documentId: FinanceManagedFileId,
    cursor: number = 0,
    signal?: AbortSignal,
  ): Promise<FinanceDocumentVisualReadResult> {
    const source = financeDocumentSources(this.ctx, agent).find(candidate => candidate.file.id === documentId)
    if (source === undefined) throw new Error('xiaojing-finance-documents: document is not an original-material import in this Finance session')
    return await this.readVisualPage(source, cursor, signal)
  }

  /**
   * List deterministic document states for the calling ordinary session.
   * @param agent - Calling non-Finance agent.
   * @param signal - Caller cancellation signal.
   * @returns Current-session uploads in durable user-message order.
   */
  async listGeneralDocuments(agent: Agent, signal?: AbortSignal): Promise<XiaojingDocumentListItem[]> {
    const output: XiaojingDocumentListItem[] = []
    for (const candidate of await generalDocumentCandidates(this.ctx.xiaojingFinanceDomain.localUploadRoot(), agent)) {
      if (candidate.kind === 'failed') {
        output.push(failedItem(candidate.documentId, candidate.name, candidate.code))
        continue
      }
      try {
        output.push(item(candidate.source, await waitForCaller(this.normalizer.ensure(candidate.source), signal)))
      } catch (error) {
        output.push(failedItem(candidate.source.file.id, candidate.source.file.name, errorCode(error)))
      }
    }
    return output
  }

  /**
   * Read normalized text from one upload introduced by the calling ordinary session.
   * @param agent - Calling non-Finance agent.
   * @param documentId - Opaque identity returned by {@link listGeneralDocuments}.
   * @param cursor - Zero-based normalized-unit cursor.
   * @param signal - Caller cancellation signal.
   * @returns Paginated normalized content.
   */
  async readGeneralDocument(
    agent: Agent,
    documentId: XiaojingDocumentId,
    cursor: number = 0,
    signal?: AbortSignal,
  ): Promise<XiaojingDocumentReadResult> {
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('xiaojing-finance-documents: cursor must be a non-negative safe integer')
    const candidates = await generalDocumentCandidates(this.ctx.xiaojingFinanceDomain.localUploadRoot(), agent)
    const source = candidates.find(candidate => candidate.kind === 'source' && candidate.source.file.id === documentId)
    if (source?.kind !== 'source') throw new Error('xiaojing-finance-documents: document is not an upload in this ordinary session')
    const document = await waitForCaller(this.normalizer.ensure(source.source), signal)
    return readPage(item(source.source, document), document, cursor, this.maxToolChars)
  }

  /**
   * Read document images from one upload introduced by the calling ordinary session.
   * @param agent - Calling non-Finance agent.
   * @param documentId - Opaque identity returned by {@link listGeneralDocuments}.
   * @param cursor - Zero-based document-image cursor.
   * @param signal - Caller cancellation signal.
   * @returns Durable native-vision attachments and their slide locations.
   */
  async readGeneralDocumentVisuals(
    agent: Agent,
    documentId: XiaojingDocumentId,
    cursor: number = 0,
    signal?: AbortSignal,
  ): Promise<XiaojingDocumentVisualReadResult> {
    const candidates = await generalDocumentCandidates(this.ctx.xiaojingFinanceDomain.localUploadRoot(), agent)
    const source = candidates.find(candidate => candidate.kind === 'source' && candidate.source.file.id === documentId)
    if (source?.kind !== 'source') throw new Error('xiaojing-finance-documents: document is not an upload in this ordinary session')
    return await this.readVisualPage(source.source, cursor, signal)
  }

  private async readVisualPage<TId extends string>(
    source: IdentifiedSource<TId>,
    cursor: number,
    signal?: AbortSignal,
  ): Promise<DocumentVisualReadResult<TId>> {
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('xiaojing-finance-documents: cursor must be a non-negative safe integer')
    const document = await waitForCaller(this.normalizer.ensure(source), signal)
    const base = item(source, document)
    if (cursor >= document.visuals.length) {
      return { ...base, cursor, visuals: [] }
    }

    const limits = this.ctx.attachments.imageLimits
    const countLimit = Math.min(this.maxVisualsPerRead, limits.maxImagesPerMessage)
    const byteLimit = Math.min(this.maxVisualBytesPerRead, limits.maxMessageImageBytes)
    const selected: FinanceDocumentVisual[] = []
    const warnings = [...base.warnings]
    let bytes = 0
    let next = cursor
    while (next < document.visuals.length && selected.length < countLimit) {
      const visual = document.visuals[next]
      if (visual === undefined) break
      next += 1
      if (!limits.mediaTypes.includes(visual.mediaType) || visual.bytes > limits.maxImageBytes || visual.bytes > byteLimit) {
        warnings.push(`document-visual-too-large:${visual.index}`)
        continue
      }
      if (selected.length > 0 && bytes + visual.bytes > byteLimit) {
        next -= 1
        break
      }
      selected.push(visual)
      bytes += visual.bytes
    }

    if (selected.length === 0) {
      return {
        ...base,
        warnings,
        cursor,
        visuals: [],
        ...next < document.visuals.length ? { nextCursor: next } : {},
      }
    }
    const extracted = await waitForCaller(this.normalizer.extractVisuals(source, selected, byteLimit), signal)
    signal?.throwIfAborted()
    const refs = await this.ctx.attachments.saveImages(extracted.map((visual, index) => ({
      data: visual.data,
      mediaType: visual.mediaType,
      name: visualName(source.file.name, selected[index]?.index ?? index, visual.mediaType),
    })))
    const visuals: DocumentVisualItem[] = refs.map((attachment, index) => ({
      attachment,
      locator: selected[index]?.locator ?? `内嵌图片 ${index + 1}`,
    }))
    return {
      ...base,
      warnings,
      cursor,
      visuals,
      ...next < document.visuals.length ? { nextCursor: next } : {},
    }
  }
}

export default XiaojingFinanceDocuments
