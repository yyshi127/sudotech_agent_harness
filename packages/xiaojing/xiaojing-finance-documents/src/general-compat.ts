/** Ordinary-session adapter for durable upload references written by the Xiaojing file picker. */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, realpath } from 'node:fs/promises'
import { basename, isAbsolute, relative } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { DocumentSource, DocumentSourceFile } from './compat.ts'
import { XiaojingDocumentId, type XiaojingDocumentId as XiaojingDocumentIdType } from './types.ts'

const UPLOAD_REFERENCE = /(?:^|\n)上传文件(?:（当前格式不能直接视觉识别）)?：`([^`\r\n]+)`(?=$|\n)/gu

/** Ordinary-session upload facts synthesized from a durable human message. */
export interface GeneralDocumentFile extends DocumentSourceFile {
  /** Opaque identity derived from session and canonical source path. */
  id: XiaojingDocumentIdType
}

/** One ordinary-session source authorized by its own durable human message. */
export type GeneralDocumentSource = DocumentSource<GeneralDocumentFile>

/** One accepted source or a stable refusal visible to the session's document tool. */
export type GeneralDocumentCandidate =
  | { kind: 'source'; source: GeneralDocumentSource }
  | { kind: 'failed'; documentId: XiaojingDocumentIdType; name: string; code: string }

function isWithin(root: string, candidate: string): boolean {
  const child = relative(root, candidate)
  return child.length > 0 && child !== '..' && !child.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(child)
}

function documentId(sessionId: string, path: string): XiaojingDocumentIdType {
  return XiaojingDocumentId(createHash('sha256').update(`ordinary-session\0${sessionId}\0${path}`).digest('hex'))
}

async function digest(filename: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filename)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

function referencedPaths(agent: Agent): Array<{ path: string; createdAt: number }> {
  const result: Array<{ path: string; createdAt: number }> = []
  // oxlint-disable-next-line typescript/no-deprecated -- Existing Finance history read; projection migration is deferred.
  for (const event of agent.session.snapshotEvents()) {
    if (event.type !== 'user/message' || event.data.source.kind !== 'user') continue
    for (const block of event.data.content) {
      if (block.type !== 'text') continue
      for (const match of block.text.matchAll(UPLOAD_REFERENCE)) {
        const path = match[1]?.trim()
        if (path !== undefined && path.length > 0) result.push({ path, createdAt: event.time })
      }
    }
  }
  return result
}

/**
 * Discover the current ordinary session's own uploads without admitting arbitrary model-supplied paths.
 * @param uploadRoot - Product upload directory used by the file-picker plugin.
 * @param agent - Calling non-Finance agent.
 * @returns Accepted sources and stable refusals in first-reference order.
 */
export async function generalDocumentCandidates(uploadRoot: string, agent: Agent): Promise<GeneralDocumentCandidate[]> {
  const references = referencedPaths(agent)
  if (references.length === 0) return []
  let canonicalRoot: string
  try {
    canonicalRoot = await realpath(uploadRoot)
  } catch {
    return references.map(reference => ({
      kind: 'failed',
      documentId: documentId(String(agent.session.id), reference.path),
      name: basename(reference.path),
      code: 'source-unavailable',
    }))
  }
  const seen = new Set<string>()
  const result: GeneralDocumentCandidate[] = []
  for (const reference of references) {
    if (!isAbsolute(reference.path)) {
      const id = documentId(String(agent.session.id), reference.path)
      result.push({ kind: 'failed', documentId: id, name: basename(reference.path), code: 'source-path-invalid' })
      continue
    }
    let canonical: string
    let stat: Awaited<ReturnType<typeof lstat>>
    try {
      stat = await lstat(reference.path)
      canonical = await realpath(reference.path)
    } catch {
      const id = documentId(String(agent.session.id), reference.path)
      result.push({ kind: 'failed', documentId: id, name: basename(reference.path), code: 'source-unavailable' })
      continue
    }
    if (seen.has(canonical)) continue
    seen.add(canonical)
    const id = documentId(String(agent.session.id), canonical)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      result.push({ kind: 'failed', documentId: id, name: basename(canonical), code: 'source-not-regular-file' })
      continue
    }
    if (!isWithin(canonicalRoot, canonical)) {
      result.push({ kind: 'failed', documentId: id, name: basename(canonical), code: 'source-outside-authorized-root' })
      continue
    }
    result.push({
      kind: 'source',
      source: {
        sourceRoot: canonicalRoot,
        cacheScope: `session:${agent.session.id}`,
        file: {
          id,
          sessionId: String(agent.session.id),
          path: canonical,
          name: basename(canonical),
          sha256: await digest(canonical),
          size: stat.size,
          createdAt: reference.createdAt,
        },
      },
    })
  }
  return result
}
