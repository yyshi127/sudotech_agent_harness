/** Bounded page rendering and embedded-raster extraction for PDF documents. */

import sharp from 'sharp'
import { extractImages, getDocumentProxy, renderPageAsImage } from 'unpdf'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'

type PdfProxy = Awaited<ReturnType<typeof getDocumentProxy>>

/** Maximum accepted rendered-page width from a durable visual key. */
export const MAX_PDF_RENDER_DIMENSION = 8_192

/** One retained PDF image and its source location. */
export interface PdfEmbeddedVisual {
  /** Stable page-render or page-and-ordinal extraction key. */
  sourceKey: string
  /** PNG output accepted by the Harness attachment service. */
  mediaType: ImageMediaType
  /** Exact encoded PNG byte length. */
  bytes: number
  /** Human-readable page location. */
  locator: string
}

/** Bounded PDF image discovery result. */
export interface PdfVisualExtraction {
  /** Retained page renders and embedded images in page order. */
  visuals: PdfEmbeddedVisual[]
  /** Complete text-poor pages retained as rendered images. */
  renderedPageCount: number
  /** Complete text-poor page renders omitted by count or byte limits. */
  omittedRenderedPageCount: number
  /** Embedded PDF images retained from pages that were not rendered. */
  embeddedImageCount: number
  /** Embedded images omitted by count, byte, or decoder limits. */
  omittedEmbeddedImageCount: number
}

/** Stable PDF image parser failure. */
export class PdfVisualParseError extends Error {
  /** @param code - Stable failure code. @param cause - Lower-level decoder failure, when available. */
  constructor(readonly code: string, cause?: unknown) {
    super(`xiaojing-finance-documents: PDF visual parse failed (${code})`, cause === undefined ? {} : { cause })
  }
}

async function encodePng(image: Awaited<ReturnType<typeof extractImages>>[number]): Promise<Uint8Array> {
  try {
    const input = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength)
    return new Uint8Array(await sharp(input, {
      raw: { width: image.width, height: image.height, channels: image.channels },
    }).png().toBuffer())
  } catch (error) {
    throw new PdfVisualParseError('pdf-image-encoding-failed', error)
  }
}

function embeddedSourceKey(pageNumber: number, ordinal: number): string {
  return `pdf:page:${pageNumber}:image:${ordinal}`
}

function renderedSourceKey(pageNumber: number, width: number): string {
  return `pdf:page:${pageNumber}:render:${width}`
}

async function boundedRenderWidth(
  proxy: PdfProxy,
  pageNumber: number,
  requestedWidth: number,
  maxPixels: number,
): Promise<number> {
  const page = await proxy.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 1 })
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)
    || viewport.width <= 0 || viewport.height <= 0) {
    throw new PdfVisualParseError('invalid-pdf-page-dimensions')
  }
  const widthByPixels = Math.floor(Math.sqrt(maxPixels * viewport.width / viewport.height))
  return Math.max(1, Math.min(requestedWidth, widthByPixels, MAX_PDF_RENDER_DIMENSION))
}

async function renderPage(proxy: PdfProxy, pageNumber: number, width: number): Promise<Uint8Array> {
  try {
    const rendered = await renderPageAsImage(proxy, pageNumber, {
      canvasImport: () => import('@napi-rs/canvas'),
      width,
    })
    if (typeof rendered === 'string') throw new PdfVisualParseError('unexpected-pdf-page-data-url')
    return new Uint8Array(rendered)
  } catch (error) {
    if (error instanceof PdfVisualParseError) throw error
    throw new PdfVisualParseError('pdf-page-render-failed', error)
  }
}

/** Page rendering and embedded-image discovery limits. */
export interface PdfVisualDiscoveryOptions {
  /** One-based pages whose text layer is too sparse for text-only reading. */
  renderPageNumbers: readonly number[]
  /** Preferred complete-page render width. */
  renderWidthPx: number
  /** Maximum decoded pixels in one complete-page render. */
  maxRenderPixels: number
  /** Maximum retained image count. */
  maxVisuals: number
  /** Maximum aggregate encoded PNG bytes. */
  maxOutputBytes: number
}

/**
 * Render text-poor pages and discover PDF XObject images on remaining pages.
 * @param proxy - Verified PDF.js document proxy.
 * @param options - Page selection and document-level resource limits.
 * @returns Retained metadata and separate page-render and embedded-image counts.
 */
export async function extractPdfVisualMetadata(
  proxy: PdfProxy,
  options: PdfVisualDiscoveryOptions,
): Promise<PdfVisualExtraction> {
  const pagesToRender = new Set(options.renderPageNumbers)
  const visuals: PdfEmbeddedVisual[] = []
  let outputBytes = 0
  let renderedPageCount = 0
  let omittedRenderedPageCount = 0
  let embeddedImageCount = 0
  let omittedEmbeddedImageCount = 0

  for (let pageNumber = 1; pageNumber <= proxy.numPages; pageNumber += 1) {
    if (pagesToRender.has(pageNumber)) {
      if (visuals.length >= options.maxVisuals) {
        omittedRenderedPageCount += 1
        continue
      }
      const width = await boundedRenderWidth(proxy, pageNumber, options.renderWidthPx, options.maxRenderPixels)
      const rendered = await renderPage(proxy, pageNumber, width)
      if (outputBytes + rendered.byteLength <= options.maxOutputBytes) {
        outputBytes += rendered.byteLength
        renderedPageCount += 1
        visuals.push({
          sourceKey: renderedSourceKey(pageNumber, width),
          mediaType: 'image/png',
          bytes: rendered.byteLength,
          locator: `第${pageNumber}页（完整页面）`,
        })
        continue
      }
      omittedRenderedPageCount += 1
    }

    let images
    try {
      images = await extractImages(proxy, pageNumber)
    } catch {
      omittedEmbeddedImageCount += 1
      continue
    }
    const seen = new Set<string>()
    let ordinal = 0
    for (const image of images) {
      if (seen.has(image.key)) continue
      seen.add(image.key)
      ordinal += 1
      if (visuals.length >= options.maxVisuals) {
        omittedEmbeddedImageCount += 1
        continue
      }
      let encoded: Uint8Array
      try {
        encoded = await encodePng(image)
      } catch {
        omittedEmbeddedImageCount += 1
        continue
      }
      if (outputBytes + encoded.byteLength > options.maxOutputBytes) {
        omittedEmbeddedImageCount += 1
        continue
      }
      outputBytes += encoded.byteLength
      embeddedImageCount += 1
      visuals.push({
        sourceKey: embeddedSourceKey(pageNumber, ordinal),
        mediaType: 'image/png',
        bytes: encoded.byteLength,
        locator: `第${pageNumber}页内嵌图片${ordinal}`,
      })
    }
  }
  return {
    visuals,
    renderedPageCount,
    omittedRenderedPageCount,
    embeddedImageCount,
    omittedEmbeddedImageCount,
  }
}

interface RequestedEmbeddedVisual {
  kind: 'embedded'
  sourceKey: string
  pageNumber: number
  ordinal: number
}

interface RequestedRenderedVisual {
  kind: 'rendered'
  sourceKey: string
  pageNumber: number
  width: number
}

type RequestedPdfVisual = RequestedEmbeddedVisual | RequestedRenderedVisual

function parseSourceKey(value: string): RequestedPdfVisual {
  const embedded = /^pdf:page:([1-9]\d*):image:([1-9]\d*)$/u.exec(value)
  if (embedded !== null) {
    return {
      kind: 'embedded',
      sourceKey: value,
      pageNumber: Number(embedded[1]),
      ordinal: Number(embedded[2]),
    }
  }
  const rendered = /^pdf:page:([1-9]\d*):render:([1-9]\d*)$/u.exec(value)
  if (rendered === null) throw new PdfVisualParseError('invalid-pdf-visual-key')
  const width = Number(rendered[2])
  if (width > MAX_PDF_RENDER_DIMENSION) throw new PdfVisualParseError('invalid-pdf-render-width')
  return {
    kind: 'rendered',
    sourceKey: value,
    pageNumber: Number(rendered[1]),
    width,
  }
}

/**
 * Re-extract exact PDF page renders or embedded images selected from normalized metadata.
 * @param data - Complete verified PDF bytes.
 * @param sourceKeys - Stable complete-page or page-and-ordinal keys.
 * @param maxOutputBytes - Aggregate encoded PNG limit.
 * @returns Images in requested order.
 */
export async function extractPdfVisuals(
  data: Buffer,
  sourceKeys: readonly string[],
  maxOutputBytes: number,
): Promise<Array<{ sourceKey: string; mediaType: ImageMediaType; data: Uint8Array }>> {
  const requests = sourceKeys.map(parseSourceKey)
  const byPage = new Map<number, RequestedPdfVisual[]>()
  for (const request of requests) {
    const current = byPage.get(request.pageNumber) ?? []
    current.push(request)
    byPage.set(request.pageNumber, current)
  }
  let proxy: PdfProxy
  try {
    proxy = await getDocumentProxy(new Uint8Array(data), { maxImageSize: 16_777_216 })
  } catch (error) {
    throw new PdfVisualParseError('invalid-pdf-document', error)
  }
  try {
    const extracted = new Map<string, { sourceKey: string; mediaType: ImageMediaType; data: Uint8Array }>()
    let outputBytes = 0
    const retain = (request: RequestedPdfVisual, encoded: Uint8Array): void => {
      outputBytes += encoded.byteLength
      if (outputBytes > maxOutputBytes) throw new PdfVisualParseError('pdf-visual-byte-limit-exceeded')
      extracted.set(request.sourceKey, { sourceKey: request.sourceKey, mediaType: 'image/png', data: encoded })
    }
    for (const [pageNumber, pageRequests] of byPage) {
      if (pageNumber > proxy.numPages) throw new PdfVisualParseError('missing-pdf-visual')
      for (const request of pageRequests) {
        if (request.kind === 'rendered') retain(request, await renderPage(proxy, pageNumber, request.width))
      }
      const embeddedRequests = pageRequests.filter(
        (request): request is RequestedEmbeddedVisual => request.kind === 'embedded',
      )
      if (embeddedRequests.length === 0) continue
      const images = await extractImages(proxy, pageNumber)
      const unique = images.filter((image, index) => images.findIndex(candidate => candidate.key === image.key) === index)
      for (const request of embeddedRequests) {
        const image = unique[request.ordinal - 1]
        if (image === undefined) throw new PdfVisualParseError('missing-pdf-visual')
        retain(request, await encodePng(image))
      }
    }
    return requests.map((request) => {
      const value = extracted.get(request.sourceKey)
      if (value === undefined) throw new PdfVisualParseError('missing-pdf-visual')
      return value
    })
  } finally {
    const destroy = (proxy as PdfProxy & { destroy?: () => Promise<void> }).destroy
    if (destroy !== undefined) await destroy.call(proxy)
  }
}
