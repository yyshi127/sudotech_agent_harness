/** Deterministic digital-invoice XML and OFD extraction. */

import { posix } from 'node:path'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { archive, ArchiveParseError } from './archive.ts'
import { xml, XmlParseError } from './xml.ts'

/** One recognized digital-invoice field. */
export interface DigitalInvoiceField {
  /** Chinese field label shown to the model. */
  label: string
  /** Source XML element name. */
  sourceName: string
  /** Deterministically extracted field value. */
  value: string
}

/** One raster image referenced by an OFD page. */
export interface OfdEmbeddedVisual {
  /** Canonical OFD package part. */
  sourceKey: string
  /** Harness-supported raster type. */
  mediaType: ImageMediaType
  /** Exact encoded byte length. */
  bytes: number
  /** Human-readable page location. */
  locator: string
}

/** Parsed OFD page content and referenced images. */
export interface OfdExtraction {
  /** Ordered page text. */
  pages: string[]
  /** Supported page-referenced images. */
  visuals: OfdEmbeddedVisual[]
  /** Referenced images with unsupported encodings. */
  unsupportedVisualCount: number
  /** Whether the extracted text identifies an electronic invoice. */
  digitalInvoice: boolean
  /** Structured invoice fields embedded as XML or XBRL, when present. */
  invoiceFields?: DigitalInvoiceField[]
}

/** Stable digital-invoice parser failure. */
export class InvoiceParseError extends Error {
  /** @param code - Stable failure code. @param cause - Lower-level parser failure, when available. */
  constructor(readonly code: string, cause?: unknown) {
    super(`xiaojing-finance-documents: invoice parse failed (${code})`, cause === undefined ? {} : { cause })
  }
}

const FIELD_LABELS: Readonly<Record<string, string>> = {
  invoicecode: '发票代码',
  invoicenumber: '发票号码',
  invoiceno: '发票号码',
  uniquecodeofinvoice: '发票号码',
  invoicedate: '开票日期',
  issuedate: '开票日期',
  dateofissue: '开票日期',
  requesttime: '开票时间',
  buyername: '购买方名称',
  purchasername: '购买方名称',
  nameofbuyer: '购买方名称',
  nameofpurchaser: '购买方名称',
  buyertaxpayername: '购买方名称',
  buyeridnum: '购买方统一社会信用代码',
  buyertaxid: '购买方统一社会信用代码',
  buyertaxpayerid: '购买方统一社会信用代码',
  taxpayeridentificationnumberunifiedsocialcreditcodeofbuyer: '购买方统一社会信用代码',
  taxpayeridentificationnumberunifiedsocialcreditcodeofpurchaser: '购买方统一社会信用代码',
  sellername: '销售方名称',
  nameofseller: '销售方名称',
  sellertaxpayername: '销售方名称',
  selleridnum: '销售方统一社会信用代码',
  sellertaxid: '销售方统一社会信用代码',
  sellertaxpayerid: '销售方统一社会信用代码',
  taxpayeridentificationnumberunifiedsocialcreditcodeofseller: '销售方统一社会信用代码',
  totalamwithouttax: '合计金额（不含税）',
  amountwithouttax: '合计金额（不含税）',
  totalamountexcludingtax: '合计金额（不含税）',
  totaltaxam: '合计税额',
  totaltaxamount: '合计税额',
  totaltaxincludedamount: '价税合计',
  totalamountwithtax: '价税合计',
  totalamount: '价税合计',
  taxincludedamountinfigures: '价税合计',
  taxincludedamountinwords: '价税合计（大写）',
  drawer: '开票人',
  payee: '收款人',
  reviewer: '复核人',
  remarks: '备注',
  remark: '备注',
  goodsortaxableservicename: '项目名称',
  itemname: '项目名称',
  specificationmodel: '规格型号',
  unit: '单位',
  quantity: '数量',
  unitprice: '单价',
  amount: '金额',
  taxrate: '税率',
  taxamount: '税额',
}

function normalizedFieldName(name: string): string {
  return name.toLowerCase().replaceAll(/[^a-z0-9]/gu, '')
}

function elementValues(nodes: readonly unknown[], targetName: string): string[] {
  const result: string[] = []
  xml.walk(nodes, (name, _qualifiedName, _node, children) => {
    if (name !== targetName) return
    const value = xml.text(children).trim()
    if (value.length > 0) result.push(value)
  })
  return result
}

function fieldValues(nodes: readonly unknown[]): DigitalInvoiceField[] {
  const fields: DigitalInvoiceField[] = []
  const seen = new Set<string>()
  xml.walk(nodes, (name, _qualifiedName, _node, children) => {
    const label = FIELD_LABELS[normalizedFieldName(name)]
    if (label === undefined) return
    const value = xml.text(children).trim()
    if (value.length === 0) return
    const key = `${label}\u0000${value}`
    if (seen.has(key)) return
    seen.add(key)
    fields.push({ label, sourceName: name, value })
  })
  return fields
}

function isDigitalInvoiceFields(fields: readonly DigitalInvoiceField[]): boolean {
  const labels = new Set(fields.map(field => field.label))
  return labels.has('发票号码')
    && (labels.has('销售方名称') || labels.has('购买方名称'))
    && (labels.has('价税合计') || labels.has('合计金额（不含税）'))
}

/**
 * Extract recognized fields from a Ministry-of-Finance electronic-invoice XML payload.
 * @param data - Complete XML bytes.
 * @returns Recognized fields, or `undefined` for non-invoice XML.
 */
export function extractDigitalInvoiceXml(data: Buffer | Uint8Array): DigitalInvoiceField[] | undefined {
  let nodes: readonly unknown[]
  try {
    nodes = xml.parse(data, 'invalid-invoice-xml')
  } catch (error) {
    if (error instanceof XmlParseError) throw new InvoiceParseError(error.code, error)
    throw error
  }
  const fields = fieldValues(nodes)
  return isDigitalInvoiceFields(fields) ? fields : undefined
}

function wrapOfd<T>(run: () => T): T {
  try {
    return run()
  } catch (error) {
    if (error instanceof InvoiceParseError) throw error
    if (error instanceof ArchiveParseError || error instanceof XmlParseError) {
      throw new InvoiceParseError(error.code, error)
    }
    throw new InvoiceParseError('invalid-ofd-document', error)
  }
}

function elementAttributeValues(nodes: readonly unknown[], elementName: string, attributeName: string): string[] {
  const result: string[] = []
  xml.walk(nodes, (name, _qualifiedName, node) => {
    if (name !== elementName) return
    const value = xml.attributes(node)[attributeName]
    if (value !== undefined) result.push(value)
  })
  return result
}

interface OfdResource {
  sourceKey: string
  mediaType: ImageMediaType | undefined
}

function resourceMap(
  parts: Record<string, Uint8Array>,
  documentPart: string,
  documentNodes: readonly unknown[],
): Map<string, OfdResource> {
  const result = new Map<string, OfdResource>()
  const resourceParts = [
    ...elementValues(documentNodes, 'DocumentRes'),
    ...elementValues(documentNodes, 'PublicRes'),
  ]
  for (const resourceTarget of resourceParts) {
    const resourcePart = archive.resolveTarget(documentPart, resourceTarget, 'invalid-ofd-resource-target')
    const resourceNodes = xml.parse(archive.required(parts, resourcePart, 'missing-ofd-resource'), 'invalid-ofd-resource')
    xml.walk(resourceNodes, (name, _qualifiedName, node, children) => {
      if (name !== 'MultiMedia') return
      const attrs = xml.attributes(node)
      const id = attrs['@_ID']
      const type = attrs['@_Type']
      const [mediaFile] = elementValues(children, 'MediaFile')
      if (id === undefined || type !== 'Image' || mediaFile === undefined) return
      const sourceKey = archive.resolveTarget(resourcePart, mediaFile, 'invalid-ofd-media-target')
      result.set(id, { sourceKey, mediaType: archive.imageMediaType(sourceKey) })
    })
  }
  return result
}

function addOfdVisual(
  visuals: OfdEmbeddedVisual[],
  parts: Record<string, Uint8Array>,
  resource: OfdResource,
  locator: string,
): boolean {
  if (resource.mediaType === undefined) return false
  const data = parts[resource.sourceKey]
  if (data === undefined) throw new InvoiceParseError('missing-ofd-image')
  const current = visuals.find(visual => visual.sourceKey === resource.sourceKey)
  if (current === undefined) {
    visuals.push({
      sourceKey: resource.sourceKey,
      mediaType: resource.mediaType,
      bytes: data.byteLength,
      locator,
    })
  } else if (!current.locator.split('、').includes(locator)) {
    current.locator += `、${locator}`
  }
  return true
}

function isDigitalInvoiceText(value: string): boolean {
  const signals = [
    /(?:数电发票|数字化电子发票|电子发票)/u,
    /发票号码/u,
    /(?:购买方|购方)/u,
    /(?:销售方|销方)/u,
    /价税合计/u,
  ]
  return signals.filter(pattern => pattern.test(value)).length >= 3
}

function embeddedInvoiceFields(parts: Readonly<Record<string, Uint8Array>>): DigitalInvoiceField[] | undefined {
  const candidates = Object.keys(parts)
    .filter(part => /\.(?:xml|xbrl)$/iu.test(part))
    .sort((left, right) => left.localeCompare(right, 'en'))
  for (const part of candidates) {
    const data = parts[part]
    if (data === undefined) continue
    const fields = extractDigitalInvoiceXml(data)
    if (fields !== undefined) return fields
  }
  return undefined
}

/**
 * Extract OFD page text and page-referenced raster images.
 * @param data - Complete OFD package bytes.
 * @param maxPages - Maximum accepted page count.
 * @returns Ordered page content and image metadata.
 */
export function extractOfd(data: Buffer, maxPages: number): OfdExtraction {
  return wrapOfd(() => {
    const parts = archive.unzip(data, 'invalid-ofd-container')
    const ofdNodes = xml.parse(archive.required(parts, 'OFD.xml', 'missing-ofd-root'), 'invalid-ofd-root')
    const [documentTarget] = elementValues(ofdNodes, 'DocRoot')
    if (documentTarget === undefined) throw new InvoiceParseError('missing-ofd-document-root')
    const documentPart = archive.resolveTarget('OFD.xml', documentTarget, 'invalid-ofd-document-target')
    const documentNodes = xml.parse(
      archive.required(parts, documentPart, 'missing-ofd-document'),
      'invalid-ofd-document',
    )
    const pageTargets = elementAttributeValues(documentNodes, 'Page', '@_BaseLoc')
    if (pageTargets.length > maxPages) throw new InvoiceParseError('ofd-page-limit-exceeded')
    const resources = resourceMap(parts, documentPart, documentNodes)
    const invoiceFields = embeddedInvoiceFields(parts)
    const pages: string[] = []
    const visuals: OfdEmbeddedVisual[] = []
    let unsupportedVisualCount = 0
    pageTargets.forEach((pageTarget, pageIndex) => {
      const pagePart = archive.resolveTarget(documentPart, pageTarget, 'invalid-ofd-page-target')
      const pageNodes = xml.parse(archive.required(parts, pagePart, 'missing-ofd-page'), 'invalid-ofd-page')
      const pageText = elementValues(pageNodes, 'TextCode').join('\n').trim()
      pages.push(pageText)
      const resourceIds = elementAttributeValues(pageNodes, 'ImageObject', '@_ResourceID')
      for (const resourceId of resourceIds) {
        const resource = resources.get(resourceId)
        if (resource === undefined) throw new InvoiceParseError('missing-ofd-image-resource')
        if (!addOfdVisual(visuals, parts, resource, `第${pageIndex + 1}页内嵌图片`)) unsupportedVisualCount += 1
      }
    })
    return {
      pages,
      visuals,
      unsupportedVisualCount,
      digitalInvoice: invoiceFields !== undefined || isDigitalInvoiceText(pages.join('\n')),
      ...invoiceFields === undefined ? {} : { invoiceFields },
    }
  })
}

/**
 * Extract exact OFD images selected from normalized metadata.
 * @param data - Complete verified OFD bytes.
 * @param sourceKeys - Canonical package image parts.
 * @param maxOutputBytes - Aggregate encoded-byte limit.
 * @returns Images in requested order.
 */
export function extractOfdVisuals(
  data: Buffer,
  sourceKeys: readonly string[],
  maxOutputBytes: number,
): Array<{ sourceKey: string; mediaType: ImageMediaType; data: Uint8Array }> {
  return wrapOfd(() => {
    const parts = archive.unzip(data, 'invalid-ofd-container')
    const result: Array<{ sourceKey: string; mediaType: ImageMediaType; data: Uint8Array }> = []
    let outputBytes = 0
    for (const sourceKey of sourceKeys) {
      const normalized = posix.normalize(sourceKey.replaceAll('\\', '/'))
      if (normalized !== sourceKey || normalized === '..' || normalized.startsWith('../') || posix.isAbsolute(normalized)) {
        throw new InvoiceParseError('invalid-ofd-visual-key')
      }
      const mediaType = archive.imageMediaType(normalized)
      if (mediaType === undefined) throw new InvoiceParseError('unsupported-ofd-visual')
      const visual = archive.required(parts, normalized, 'missing-ofd-visual')
      outputBytes += visual.byteLength
      if (outputBytes > maxOutputBytes) throw new InvoiceParseError('ofd-visual-byte-limit-exceeded')
      result.push({ sourceKey: normalized, mediaType, data: visual })
    }
    return result
  })
}
