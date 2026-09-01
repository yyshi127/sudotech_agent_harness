/** Embedded raster discovery for DOCX and XLSX packages. */

import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { archive, ArchiveParseError } from './archive.ts'
import { xml, XmlParseError } from './xml.ts'

/** One embedded raster image and its source location. */
export interface OfficeEmbeddedVisual {
  /** Canonical package part used as an opaque extraction key. */
  sourceKey: string
  /** Harness-supported raster type. */
  mediaType: ImageMediaType
  /** Exact encoded byte length. */
  bytes: number
  /** Human-readable document location. */
  locator: string
}

/** Embedded-raster discovery result. */
export interface OfficeVisualExtraction {
  /** Supported referenced raster images in first-reference order. */
  visuals: OfficeEmbeddedVisual[]
  /** Referenced image count with unsupported media types. */
  unsupportedVisualCount: number
}

/** Stable embedded-image parser failure. */
export class OfficeVisualParseError extends Error {
  /** @param code - Stable failure code. @param cause - Lower-level package failure, when available. */
  constructor(readonly code: string, cause?: unknown) {
    super(`xiaojing-finance-documents: Office visual parse failed (${code})`, cause === undefined ? {} : { cause })
  }
}

function wrap<T>(code: string, run: () => T): T {
  try {
    return run()
  } catch (error) {
    if (error instanceof OfficeVisualParseError) throw error
    if (error instanceof ArchiveParseError || error instanceof XmlParseError) {
      throw new OfficeVisualParseError(error.code, error)
    }
    throw new OfficeVisualParseError(code, error)
  }
}

function relationshipIds(nodes: readonly unknown[], elementName: string, attributeName: string): string[] {
  const result: string[] = []
  xml.walk(nodes, (name, _qualifiedName, node) => {
    if (name !== elementName) return
    const id = xml.attributes(node)[attributeName]
    if (id !== undefined) result.push(id)
  })
  return result
}

function addVisual(
  values: OfficeEmbeddedVisual[],
  archiveParts: Record<string, Uint8Array>,
  sourceKey: string,
  locator: string,
): boolean {
  const mediaType = archive.imageMediaType(sourceKey)
  if (mediaType === undefined) return false
  const data = archiveParts[sourceKey]
  if (data === undefined) throw new OfficeVisualParseError('missing-office-visual')
  const existing = values.find(value => value.sourceKey === sourceKey)
  if (existing === undefined) values.push({ sourceKey, mediaType, bytes: data.byteLength, locator })
  else if (!existing.locator.split('、').includes(locator)) existing.locator += `、${locator}`
  return true
}

/**
 * Discover raster images referenced by the DOCX main document.
 * @param data - Complete verified DOCX bytes.
 * @returns Referenced images and unsupported count.
 */
export function extractDocxVisualMetadata(data: Buffer): OfficeVisualExtraction {
  return wrap('invalid-docx-container', () => {
    const parts = archive.unzip(data, 'invalid-docx-container')
    const documentPart = 'word/document.xml'
    const nodes = xml.parse(archive.required(parts, documentPart, 'invalid-docx-document'), 'invalid-docx-xml')
    const ids = relationshipIds(nodes, 'blip', '@_r:embed')
    if (ids.length === 0) return { visuals: [], unsupportedVisualCount: 0 }
    const relationships = archive.relationships(
      archive.required(parts, archive.relationshipPart(documentPart), 'invalid-docx-relationships'),
      'invalid-docx-relationships',
    )
    const byId = new Map(relationships.map(relation => [relation.id, relation]))
    const visuals: OfficeEmbeddedVisual[] = []
    let unsupportedVisualCount = 0
    ids.forEach((id, index) => {
      const relation = byId.get(id)
      if (relation === undefined || !relation.type.endsWith('/image')) {
        throw new OfficeVisualParseError('invalid-docx-image-relationship')
      }
      const sourceKey = archive.resolveTarget(documentPart, relation.target, 'invalid-docx-image-target')
      if (!addVisual(visuals, parts, sourceKey, `Word 内嵌图片 ${index + 1}`)) unsupportedVisualCount += 1
    })
    return { visuals, unsupportedVisualCount }
  })
}

interface SheetPart {
  name: string
  part: string
}

function sheetParts(parts: Record<string, Uint8Array>): SheetPart[] {
  const workbookPart = 'xl/workbook.xml'
  const nodes = xml.parse(archive.required(parts, workbookPart, 'invalid-xlsx-workbook'), 'invalid-xlsx-xml')
  const relationships = archive.relationships(
    archive.required(parts, archive.relationshipPart(workbookPart), 'invalid-xlsx-relationships'),
    'invalid-xlsx-relationships',
  )
  const byId = new Map(relationships.map(relation => [relation.id, relation]))
  const result: SheetPart[] = []
  xml.walk(nodes, (name, _qualifiedName, node) => {
    if (name !== 'sheet') return
    const attrs = xml.attributes(node)
    const relation = attrs['@_r:id'] === undefined ? undefined : byId.get(attrs['@_r:id'])
    if (relation === undefined || !relation.type.endsWith('/worksheet')) {
      throw new OfficeVisualParseError('invalid-xlsx-sheet-relationship')
    }
    result.push({
      name: attrs['@_name'] ?? `工作表${result.length + 1}`,
      part: archive.resolveTarget(workbookPart, relation.target, 'invalid-xlsx-sheet-target'),
    })
  })
  return result
}

function directText(nodes: readonly unknown[], name: string): string | undefined {
  let output: string | undefined
  xml.walk(nodes, (candidate, _qualifiedName, _node, children) => {
    if (output !== undefined || candidate !== name) return
    output = xml.text(children).trim()
    return false
  })
  return output
}

function cellColumn(index: number): string {
  let value = index + 1
  let output = ''
  while (value > 0) {
    value -= 1
    output = String.fromCharCode(65 + (value % 26)) + output
    value = Math.floor(value / 26)
  }
  return output
}

function drawingVisuals(
  parts: Record<string, Uint8Array>,
  drawingPart: string,
  sheetName: string,
): { visuals: OfficeEmbeddedVisual[]; unsupportedVisualCount: number } {
  const nodes = xml.parse(archive.required(parts, drawingPart, 'invalid-xlsx-drawing'), 'invalid-xlsx-drawing-xml')
  const relationships = archive.relationships(
    archive.required(parts, archive.relationshipPart(drawingPart), 'invalid-xlsx-drawing-relationships'),
    'invalid-xlsx-drawing-relationships',
  )
  const byId = new Map(relationships.map(relation => [relation.id, relation]))
  const visuals: OfficeEmbeddedVisual[] = []
  let unsupportedVisualCount = 0
  let ordinal = 0
  xml.walk(nodes, (name, _qualifiedName, _node, children) => {
    if (name !== 'oneCellAnchor' && name !== 'twoCellAnchor' && name !== 'absoluteAnchor') return
    const ids = relationshipIds(children, 'blip', '@_r:embed')
    if (ids.length === 0) return false
    const fromNodes: readonly unknown[] = (() => {
      let found: readonly unknown[] = []
      xml.walk(children, (candidate, _qualified, _candidateNode, candidateChildren) => {
        if (candidate !== 'from') return
        found = candidateChildren
        return false
      })
      return found
    })()
    const row = Number.parseInt(directText(fromNodes, 'row') ?? '', 10)
    const column = Number.parseInt(directText(fromNodes, 'col') ?? '', 10)
    ids.forEach((id) => {
      ordinal += 1
      const relation = byId.get(id)
      if (relation === undefined || !relation.type.endsWith('/image')) {
        throw new OfficeVisualParseError('invalid-xlsx-image-relationship')
      }
      const sourceKey = archive.resolveTarget(drawingPart, relation.target, 'invalid-xlsx-image-target')
      const locator = Number.isSafeInteger(row) && row >= 0 && Number.isSafeInteger(column) && column >= 0
        ? `工作表“${sheetName}”单元格 ${cellColumn(column)}${row + 1} 附近`
        : `工作表“${sheetName}”内嵌图片 ${ordinal}`
      if (!addVisual(visuals, parts, sourceKey, locator)) unsupportedVisualCount += 1
    })
    return false
  })
  return { visuals, unsupportedVisualCount }
}

/**
 * Discover raster images referenced by XLSX worksheet drawings.
 * @param data - Complete verified XLSX bytes.
 * @returns Referenced images and unsupported count.
 */
export function extractXlsxVisualMetadata(data: Buffer): OfficeVisualExtraction {
  return wrap('invalid-xlsx-container', () => {
    const parts = archive.unzip(data, 'invalid-xlsx-container')
    const visuals: OfficeEmbeddedVisual[] = []
    let unsupportedVisualCount = 0
    for (const sheet of sheetParts(parts)) {
      const nodes = xml.parse(archive.required(parts, sheet.part, 'invalid-xlsx-sheet'), 'invalid-xlsx-sheet-xml')
      const drawingIds = relationshipIds(nodes, 'drawing', '@_r:id')
      if (drawingIds.length === 0) continue
      const relationships = archive.relationships(
        archive.required(parts, archive.relationshipPart(sheet.part), 'invalid-xlsx-sheet-relationships'),
        'invalid-xlsx-sheet-relationships',
      )
      const byId = new Map(relationships.map(relation => [relation.id, relation]))
      for (const id of drawingIds) {
        const relation = byId.get(id)
        if (relation === undefined || !relation.type.endsWith('/drawing')) {
          throw new OfficeVisualParseError('invalid-xlsx-drawing-relationship')
        }
        const value = drawingVisuals(
          parts,
          archive.resolveTarget(sheet.part, relation.target, 'invalid-xlsx-drawing-target'),
          sheet.name,
        )
        for (const visual of value.visuals) addVisual(visuals, parts, visual.sourceKey, visual.locator)
        unsupportedVisualCount += value.unsupportedVisualCount
      }
    }
    return { visuals, unsupportedVisualCount }
  })
}

/**
 * Extract exact package images selected from normalized DOCX or XLSX metadata.
 * @param data - Complete verified package bytes.
 * @param kind - Package format.
 * @param sourceKeys - Exact normalized image keys.
 * @param maxOutputBytes - Aggregate output limit.
 * @returns Images in requested order.
 */
export function extractOfficeVisuals(
  data: Buffer,
  kind: 'docx' | 'xlsx',
  sourceKeys: readonly string[],
  maxOutputBytes: number,
): Array<{ sourceKey: string; mediaType: ImageMediaType; data: Uint8Array }> {
  return wrap(`invalid-${kind}-container`, () => {
    const parts = archive.unzip(data, `invalid-${kind}-container`)
    const prefix = kind === 'docx' ? 'word/media/' : 'xl/media/'
    const result: Array<{ sourceKey: string; mediaType: ImageMediaType; data: Uint8Array }> = []
    let outputBytes = 0
    for (const sourceKey of sourceKeys) {
      if (!sourceKey.startsWith(prefix)) throw new OfficeVisualParseError(`invalid-${kind}-visual-key`)
      const mediaType = archive.imageMediaType(sourceKey)
      if (mediaType === undefined) throw new OfficeVisualParseError(`unsupported-${kind}-visual`)
      const visual = archive.required(parts, sourceKey, `missing-${kind}-visual`)
      outputBytes += visual.byteLength
      if (outputBytes > maxOutputBytes) throw new OfficeVisualParseError(`${kind}-visual-byte-limit-exceeded`)
      result.push({ sourceKey, mediaType, data: visual })
    }
    return result
  })
}
