/** Safe package and relationship helpers for Open XML and OFD containers. */

import { posix } from 'node:path'
import { unzipSync } from 'fflate'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { xml } from './xml.ts'

interface Relationship {
  id: string
  target: string
  type: string
}

const IMAGE_MEDIA_TYPES: Readonly<Record<string, ImageMediaType>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

function unzip(data: Buffer, code: string): Record<string, Uint8Array> {
  try {
    return unzipSync(new Uint8Array(data))
  } catch (error) {
    throw new ArchiveParseError(code, error)
  }
}

function required(archive: Record<string, Uint8Array>, part: string, code: string): Uint8Array {
  const data = archive[part]
  if (data === undefined) throw new ArchiveParseError(code)
  return data
}

function relationships(data: Uint8Array, code: string): Relationship[] {
  const result: Relationship[] = []
  xml.walk(xml.parse(data, code), (name, _qualifiedName, node) => {
    if (name !== 'Relationship') return
    const attrs = xml.attributes(node)
    const id = attrs['@_Id']
    const type = attrs['@_Type']
    const target = attrs['@_Target']
    if (id !== undefined && type !== undefined && target !== undefined && attrs['@_TargetMode'] !== 'External') {
      result.push({ id, type, target })
    }
  })
  return result
}

function relationshipPart(part: string): string {
  return posix.join(posix.dirname(part), '_rels', `${posix.basename(part)}.rels`)
}

function resolveTarget(sourcePart: string, target: string, code: string): string {
  const normalizedTarget = target.replaceAll('\\', '/')
  const resolved = normalizedTarget.startsWith('/')
    ? posix.normalize(normalizedTarget.slice(1))
    : posix.normalize(posix.join(posix.dirname(sourcePart), normalizedTarget))
  if (resolved === '..' || resolved.startsWith('../') || posix.isAbsolute(resolved)) {
    throw new ArchiveParseError(code)
  }
  return resolved
}

function imageMediaType(part: string): ImageMediaType | undefined {
  return IMAGE_MEDIA_TYPES[posix.extname(part).toLowerCase()]
}

/** Shared archive operations that reject path traversal and external relationships. */
export const archive = {
  unzip,
  required,
  relationships,
  relationshipPart,
  resolveTarget,
  imageMediaType,
}

/** Stable archive parser failure. */
export class ArchiveParseError extends Error {
  /** @param code - Stable caller-owned failure code. @param cause - Decoder failure, when available. */
  constructor(readonly code: string, cause?: unknown) {
    super(`xiaojing-finance-documents: archive parse failed (${code})`, cause === undefined ? {} : { cause })
  }
}
