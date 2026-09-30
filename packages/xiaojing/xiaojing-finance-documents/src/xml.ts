/** Bounded XML helpers shared by Open XML, OFD, and digital-invoice parsing. */

import { strFromU8 } from 'fflate'
import { XMLParser } from 'fast-xml-parser'
import { SyntaxValidator } from 'fast-xml-validator'

type XmlRecord = Record<string, unknown>

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

function walk(
  nodes: readonly unknown[],
  visit: (name: string, qualifiedName: string, node: XmlRecord, children: readonly unknown[]) => boolean | void,
): void {
  for (const node of nodes) {
    if (!isRecord(node)) continue
    for (const [qualifiedName, children] of Object.entries(node)) {
      if (qualifiedName === ':@' || qualifiedName === '#text' || !Array.isArray(children)) continue
      if (visit(localName(qualifiedName), qualifiedName, node, children) !== false) walk(children, visit)
    }
  }
}

function text(nodes: readonly unknown[]): string {
  let output = ''
  const append = (values: readonly unknown[]): void => {
    for (const value of values) {
      if (!isRecord(value)) continue
      for (const [qualifiedName, children] of Object.entries(value)) {
        if (qualifiedName === '#text') {
          if (typeof children === 'string') output += children
          continue
        }
        if (!Array.isArray(children)) continue
        const name = localName(qualifiedName)
        if (name === 'br') output += '\n'
        else if (name === 'tab') output += '\t'
        append(children)
      }
    }
  }
  append(nodes)
  return output
}

/** Safe XML operations with bounded entity expansion. */
export const xml = {
  parse(data: Uint8Array, code: string): readonly unknown[] {
    let value: unknown
    try {
      const input = strFromU8(data)
      SyntaxValidator.validate(input)
      value = parser.parse(input)
    } catch (error) {
      throw new XmlParseError(code, error)
    }
    if (!Array.isArray(value)) throw new XmlParseError(code)
    return value
  },
  localName,
  attributes,
  walk,
  text,
}

/** Stable XML parser failure. */
export class XmlParseError extends Error {
  /** @param code - Stable caller-owned failure code. @param cause - Parser failure, when available. */
  constructor(readonly code: string, cause?: unknown) {
    super(`xiaojing-finance-documents: XML parse failed (${code})`, cause === undefined ? {} : { cause })
  }
}
