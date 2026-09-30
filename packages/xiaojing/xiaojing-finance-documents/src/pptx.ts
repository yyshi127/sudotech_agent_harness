/** Deterministic text extraction from bounded Open XML presentations. */

import { posix } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { XMLParser } from 'fast-xml-parser'
import { SyntaxValidator } from 'fast-xml-validator'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'

type XmlRecord = Record<string, unknown>

interface Relationship {
  id: string
  target: string
  type: string
}

/** One presentation slide with optional speaker notes. */
export interface PptxSlide {
  /** Text in shape and table order. */
  text: string
  /** Speaker notes attached to the slide. */
  notes?: string
}

/** One supported raster image referenced by one or more presentation slides. */
export interface PptxEmbeddedVisual {
  /** Canonical archive part under `ppt/media`. */
  archivePart: string
  /** Harness-supported image type selected from the archive extension. */
  mediaType: ImageMediaType
  /** Exact encoded byte length. */
  bytes: number
  /** One-based slides that reference this image. */
  slideNumbers: number[]
}

/** Deterministic PPTX extraction result. */
export interface PptxExtraction {
  /** Slides in the order declared by `presentation.xml`. */
  slides: PptxSlide[]
  /** Number of slides without extractable text or notes. */
  emptySlideCount: number
  /** Whether the package contains media, charts, diagrams, or embedded objects. */
  hasNonTextContent: boolean
  /** Supported slide-referenced raster images in first-reference order. */
  visuals: PptxEmbeddedVisual[]
  /** Number of slide-referenced image parts that the native visual path cannot accept. */
  unsupportedVisualCount: number
}

/** Stable parser failure for malformed or over-limit PPTX input. */
export class PptxParseError extends Error {
  /** @param code - Stable failure code surfaced by the Finance normalizer. */
  constructor(readonly code: string) {
    super(`xiaojing-finance-documents: PPTX parse failed (${code})`)
  }
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: {
    maxEntitySize: 1_024,
    maxExpansionDepth: 4,
    maxTotalExpansions: 1_000,
    maxExpandedLength: 100_000,
    maxEntityCount: 100,
  },
})

const IMAGE_MEDIA_TYPES: Readonly<Record<string, ImageMediaType>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

function isRecord(value: unknown): value is XmlRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function localName(name: string): string {
  const separator = name.lastIndexOf(':')
  return separator < 0 ? name : name.slice(separator + 1)
}

function attributes(node: XmlRecord): Record<string, string> {
  const value = node[':@']
  if (!isRecord(value)) return {}
  const result: Record<string, string> = {}
  for (const [name, attribute] of Object.entries(value)) {
    if (typeof attribute === 'string') result[name] = attribute
  }
  return result
}

function walkElements(
  nodes: readonly unknown[],
  visit: (name: string, node: XmlRecord, children: readonly unknown[]) => boolean | void,
): void {
  for (const node of nodes) {
    if (!isRecord(node)) continue
    for (const [qualifiedName, children] of Object.entries(node)) {
      if (qualifiedName === ':@' || qualifiedName === '#text' || !Array.isArray(children)) continue
      if (visit(localName(qualifiedName), node, children) !== false) walkElements(children, visit)
    }
  }
}

function parseXml(data: Uint8Array): readonly unknown[] {
  let value: unknown
  try {
    const input = strFromU8(data)
    SyntaxValidator.validate(input)
    value = parser.parse(input)
  } catch {
    throw new PptxParseError('invalid-pptx-xml')
  }
  if (!Array.isArray(value)) throw new PptxParseError('invalid-pptx-xml')
  return value
}

function textContent(nodes: readonly unknown[]): string {
  let output = ''
  const append = (values: readonly unknown[]): void => {
    for (const value of values) {
      if (!isRecord(value)) continue
      for (const [qualifiedName, children] of Object.entries(value)) {
        const name = localName(qualifiedName)
        if (qualifiedName === '#text') {
          if (typeof children === 'string') output += children
          continue
        }
        if (!Array.isArray(children)) continue
        if (name === 'br') output += '\n'
        else if (name === 'tab') output += '\t'
        else if (name === 't') append(children)
        else append(children)
      }
    }
  }
  append(nodes)
  return output
}

function paragraphs(nodes: readonly unknown[]): string[] {
  const result: string[] = []
  walkElements(nodes, (name, _node, children) => {
    if (name !== 'p') return
    const text = textContent(children).trim()
    if (text.length > 0) result.push(text)
    return false
  })
  return result
}

function placeholderType(nodes: readonly unknown[]): string | undefined {
  let result: string | undefined
  walkElements(nodes, (name, node) => {
    if (result !== undefined || name !== 'ph') return
    result = attributes(node)['@_type']
  })
  return result
}

function notesText(nodes: readonly unknown[]): string {
  const result: string[] = []
  walkElements(nodes, (name, _node, children) => {
    if (name !== 'sp') return
    const type = placeholderType(children)
    if (type === undefined || type === 'body') result.push(...paragraphs(children))
    return false
  })
  return result.join('\n')
}

function relationships(nodes: readonly unknown[]): Relationship[] {
  const result: Relationship[] = []
  walkElements(nodes, (name, node) => {
    if (name !== 'Relationship') return
    const attrs = attributes(node)
    const id = attrs['@_Id']
    const type = attrs['@_Type']
    const target = attrs['@_Target']
    if (id !== undefined && type !== undefined && target !== undefined && attrs['@_TargetMode'] !== 'External') {
      result.push({ id, type, target })
    }
  })
  return result
}

function slideRelationshipIds(nodes: readonly unknown[]): string[] {
  const result: string[] = []
  walkElements(nodes, (name, node) => {
    if (name !== 'sldId') return
    const id = attributes(node)['@_r:id']
    if (id !== undefined) result.push(id)
  })
  return result
}

function embeddedImageRelationshipIds(nodes: readonly unknown[]): string[] {
  const result: string[] = []
  walkElements(nodes, (name, node) => {
    if (name !== 'blip') return
    const id = attributes(node)['@_r:embed']
    if (id !== undefined) result.push(id)
  })
  return result
}

function relationshipPart(part: string): string {
  return posix.join(posix.dirname(part), '_rels', `${posix.basename(part)}.rels`)
}

function resolveTarget(sourcePart: string, target: string): string {
  const normalizedTarget = target.replaceAll('\\', '/')
  const resolved = normalizedTarget.startsWith('/')
    ? posix.normalize(normalizedTarget.slice(1))
    : posix.normalize(posix.join(posix.dirname(sourcePart), normalizedTarget))
  if (resolved === '..' || resolved.startsWith('../') || posix.isAbsolute(resolved)) {
    throw new PptxParseError('invalid-pptx-relationship-target')
  }
  return resolved
}

function requiredPart(archive: Record<string, Uint8Array>, name: string): Uint8Array {
  const part = archive[name]
  if (part === undefined) throw new PptxParseError('invalid-pptx-presentation')
  return part
}

function slidePaths(archive: Record<string, Uint8Array>): string[] {
  const presentationPart = 'ppt/presentation.xml'
  const ids = slideRelationshipIds(parseXml(requiredPart(archive, presentationPart)))
  const rels = relationships(parseXml(requiredPart(archive, relationshipPart(presentationPart))))
  const byId = new Map(rels.filter(rel => rel.type.endsWith('/slide')).map(rel => [rel.id, rel]))
  if (ids.length === 0) throw new PptxParseError('empty-pptx-presentation')
  return ids.map((id) => {
    const relation = byId.get(id)
    if (relation === undefined) throw new PptxParseError('invalid-pptx-presentation')
    return resolveTarget(presentationPart, relation.target)
  })
}

function speakerNotes(archive: Record<string, Uint8Array>, slidePart: string): string | undefined {
  const relsPart = relationshipPart(slidePart)
  const relsData = archive[relsPart]
  if (relsData === undefined) return undefined
  const relation = relationships(parseXml(relsData)).find(rel => rel.type.endsWith('/notesSlide'))
  if (relation === undefined) return undefined
  const notesPart = archive[resolveTarget(slidePart, relation.target)]
  if (notesPart === undefined) throw new PptxParseError('invalid-pptx-presentation')
  const text = notesText(parseXml(notesPart)).trim()
  return text.length === 0 ? undefined : text
}

function visualMediaType(archivePart: string): ImageMediaType | undefined {
  return IMAGE_MEDIA_TYPES[posix.extname(archivePart).toLowerCase()]
}

function slideVisualParts(
  archive: Record<string, Uint8Array>,
  slidePart: string,
  slideNodes: readonly unknown[],
): { supported: Array<{ archivePart: string; mediaType: ImageMediaType }>; unsupported: number } {
  const ids = embeddedImageRelationshipIds(slideNodes)
  if (ids.length === 0) return { supported: [], unsupported: 0 }
  const relsData = archive[relationshipPart(slidePart)]
  if (relsData === undefined) throw new PptxParseError('invalid-pptx-presentation')
  const byId = new Map(relationships(parseXml(relsData)).map(relation => [relation.id, relation]))
  const supported: Array<{ archivePart: string; mediaType: ImageMediaType }> = []
  let unsupported = 0
  for (const id of ids) {
    const relation = byId.get(id)
    if (relation === undefined || !relation.type.endsWith('/image')) {
      throw new PptxParseError('invalid-pptx-presentation')
    }
    const archivePart = resolveTarget(slidePart, relation.target)
    const data = archive[archivePart]
    if (data === undefined) throw new PptxParseError('invalid-pptx-presentation')
    const mediaType = visualMediaType(archivePart)
    if (mediaType === undefined) unsupported += 1
    else supported.push({ archivePart, mediaType })
  }
  return { supported, unsupported }
}

/**
 * Extract ordered slide text and speaker notes without Office automation.
 * @param data - Complete verified PPTX bytes.
 * @param maxSlides - Maximum accepted slide count.
 * @returns Ordered slide extraction and non-text-content indicator.
 */
export function extractPptx(data: Buffer, maxSlides: number): PptxExtraction {
  let archive: Record<string, Uint8Array>
  try {
    archive = unzipSync(new Uint8Array(data))
  } catch {
    throw new PptxParseError('invalid-pptx-container')
  }
  const paths = slidePaths(archive)
  if (paths.length > maxSlides) throw new PptxParseError('pptx-slide-limit-exceeded')
  const visualByPart = new Map<string, PptxEmbeddedVisual>()
  let unsupportedVisualCount = 0
  const slides = paths.map((path, index) => {
    const slideNodes = parseXml(requiredPart(archive, path))
    const text = paragraphs(slideNodes).join('\n')
    const notes = speakerNotes(archive, path)
    const visualParts = slideVisualParts(archive, path, slideNodes)
    unsupportedVisualCount += visualParts.unsupported
    for (const visual of visualParts.supported) {
      const current = visualByPart.get(visual.archivePart)
      if (current === undefined) {
        visualByPart.set(visual.archivePart, {
          archivePart: visual.archivePart,
          mediaType: visual.mediaType,
          bytes: requiredPart(archive, visual.archivePart).byteLength,
          slideNumbers: [index + 1],
        })
      } else if (current.slideNumbers.at(-1) !== index + 1) {
        current.slideNumbers.push(index + 1)
      }
    }
    return { text, ...notes === undefined ? {} : { notes } }
  })
  return {
    slides,
    emptySlideCount: slides.filter(slide => slide.text.length === 0 && slide.notes === undefined).length,
    hasNonTextContent: Object.keys(archive).some(name => /^(?:ppt\/(?:media|charts|diagrams|embeddings)\/)/u.test(name)),
    visuals: [...visualByPart.values()],
    unsupportedVisualCount,
  }
}

/**
 * Extract one exact bounded batch of images from a verified PPTX source.
 * @param data - Complete verified PPTX bytes.
 * @param archiveParts - Canonical parts selected from a normalized document record.
 * @param maxOutputBytes - Maximum aggregate encoded bytes returned to the Host.
 * @returns Extracted image bytes in requested order.
 */
export function extractPptxVisuals(
  data: Buffer,
  archiveParts: readonly string[],
  maxOutputBytes: number,
): Array<{ archivePart: string; mediaType: ImageMediaType; data: Uint8Array }> {
  let archive: Record<string, Uint8Array>
  try {
    archive = unzipSync(new Uint8Array(data))
  } catch {
    throw new PptxParseError('invalid-pptx-container')
  }
  const result: Array<{ archivePart: string; mediaType: ImageMediaType; data: Uint8Array }> = []
  let outputBytes = 0
  for (const archivePart of archiveParts) {
    const normalized = posix.normalize(archivePart.replaceAll('\\', '/'))
    if (normalized !== archivePart || !normalized.startsWith('ppt/media/') || posix.isAbsolute(normalized)) {
      throw new PptxParseError('invalid-pptx-visual-part')
    }
    const mediaType = visualMediaType(normalized)
    if (mediaType === undefined) throw new PptxParseError('unsupported-pptx-visual')
    const visual = archive[normalized]
    if (visual === undefined) throw new PptxParseError('missing-pptx-visual')
    outputBytes += visual.byteLength
    if (outputBytes > maxOutputBytes) throw new PptxParseError('pptx-visual-byte-limit-exceeded')
    result.push({ archivePart: normalized, mediaType, data: visual })
  }
  return result
}
