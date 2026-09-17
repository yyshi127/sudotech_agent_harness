/** Controlled copies between the local upload area and one bound Finance client workspace. */

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import {
  copyFile,
  link,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  unlink,
} from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import type { FinanceClientWorkspace } from './workspace.ts'
import {
  FinanceManagedFileId,
  type ArchiveFinanceFileRequest,
  type FinanceClientBinding,
  type FinanceConsultationFile,
  type FinanceFileAction,
  type FinanceFileStage,
  type FinanceManagedFile,
  type ImportFinanceUploadRequest,
  type PublishFinanceFileRequest,
} from './types.ts'

const SCHEMA_VERSION = 1
const DIR_MODE = 0o700
const FILE_MODE = 0o600
const INDEX_NAME = '.xiaojing-finance-files-v1.json'

const managedFileSchema = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  sessionId: z.string().min(1),
  action: z.enum(['import', 'publish', 'archive']),
  stage: z.enum(['source', 'output', 'archive']),
  path: z.string().min(1),
  name: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  size: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  sourceFileId: z.uuid().optional(),
}).strict()

const indexSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  revision: z.number().int().nonnegative(),
  files: z.array(managedFileSchema),
}).strict()

interface FinanceFileIndex {
  schemaVersion: 1
  revision: number
  files: FinanceManagedFile[]
}

interface SourceFile {
  path: string
  size: number
}

interface CommitRequest {
  action: FinanceFileAction
  stage: FinanceFileStage
  source: SourceFile
  workspace: FinanceClientWorkspace
  destinationDirectory: string
  preferredName: string
  binding: FinanceClientBinding
  sessionId: SessionId
}

function pathKey(path: string): string {
  return process.platform === 'win32' ? path.toLocaleLowerCase('en-US') : path
}

function isWithin(root: string, candidate: string): boolean {
  const offset = relative(root, candidate)
  return offset !== '' && !offset.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    && offset !== '..' && !isAbsolute(offset)
}

function safeBasename(value: string): string {
  const requested = basename(value.trim())
  const cleaned = requested
    .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_')
    .replace(/[. ]+$/gu, '')
    .trim()
  if (cleaned.length === 0 || cleaned === '.' || cleaned === '..') {
    throw new Error('xiaojing-finance-domain: managed file needs a valid filename')
  }
  const stem = cleaned.slice(0, 180)
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(stem) ? `_${stem}` : stem
}

function collisionName(name: string, sequence: number): string {
  if (sequence === 1) return name
  const extension = extname(name)
  const stem = name.slice(0, name.length - extension.length)
  return `${stem} (${sequence})${extension}`
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) {
    if (!(chunk instanceof Uint8Array)) {
      throw new Error('xiaojing-finance-domain: managed file stream returned non-binary data')
    }
    hash.update(chunk)
  }
  return hash.digest('hex')
}

async function readIndex(filename: string): Promise<FinanceFileIndex> {
  let text: string
  try {
    text = await readFile(filename, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { schemaVersion: SCHEMA_VERSION, revision: 0, files: [] }
    }
    throw error
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`xiaojing-finance-domain: cannot parse ${filename}; preserve the file and repair it`, { cause: error })
  }
  const parsed = indexSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(`xiaojing-finance-domain: ${filename} is not a valid Finance file index`)
  }
  for (const file of parsed.data.files) {
    if (!isAbsolute(file.path)) {
      throw new Error(`xiaojing-finance-domain: ${filename} contains a non-absolute managed path`)
    }
  }
  return parsed.data as FinanceFileIndex
}

function renderIndex(index: FinanceFileIndex): string {
  return `${JSON.stringify(index, null, 2)}\n`
}

async function canonicalRegularFile(path: string): Promise<SourceFile> {
  if (!isAbsolute(path)) throw new Error('xiaojing-finance-domain: managed source path must be absolute')
  const direct = await lstat(path)
  if (direct.isSymbolicLink() || !direct.isFile()) {
    throw new Error('xiaojing-finance-domain: managed source must be a regular non-symlink file')
  }
  const canonical = await realpath(path)
  const info = await stat(canonical)
  if (!info.isFile()) throw new Error('xiaojing-finance-domain: managed source must be a regular file')
  return { path: canonical, size: info.size }
}

async function requireFileInRoot(path: string, root: string, label: string): Promise<SourceFile> {
  const [source, canonicalRoot] = await Promise.all([
    canonicalRegularFile(path),
    realpath(root),
  ])
  if (!isWithin(canonicalRoot, source.path)) {
    throw new Error(`xiaojing-finance-domain: ${label} must stay inside ${canonicalRoot}`)
  }
  return source
}

async function requireFileInRoots(path: string, roots: readonly string[], label: string): Promise<SourceFile> {
  const source = await canonicalRegularFile(path)
  const canonicalRoots = await Promise.all(roots.map(root => realpath(root)))
  if (!canonicalRoots.some(root => isWithin(root, source.path))) {
    throw new Error(`xiaojing-finance-domain: ${label} is outside this client session's managed directories`)
  }
  return source
}

async function atomicCopy(source: string, directory: string, workspaceRoot: string, requestedName: string): Promise<{
  path: string
  name: string
  sha256: string
  size: number
}> {
  await mkdir(directory, { recursive: true, mode: DIR_MODE })
  const [canonicalDirectory, canonicalWorkspaceRoot] = await Promise.all([
    realpath(directory),
    realpath(workspaceRoot),
  ])
  if (!isWithin(canonicalWorkspaceRoot, canonicalDirectory)) {
    throw new Error('xiaojing-finance-domain: managed destination escaped the client workspace')
  }
  const name = safeBasename(requestedName)
  for (let sequence = 1; ; sequence += 1) {
    const candidateName = collisionName(name, sequence)
    const target = join(canonicalDirectory, candidateName)
    const temp = join(canonicalDirectory, `.${candidateName}.${randomBytes(6).toString('hex')}.tmp`)
    try {
      await copyFile(source, temp, constants.COPYFILE_EXCL)
      const [sha256, info] = await Promise.all([hashFile(temp), stat(temp)])
      await link(temp, target)
      await unlink(temp)
      return { path: target, name: candidateName, sha256, size: info.size }
    } catch (error) {
      await rm(temp, { force: true })
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw error
    }
  }
}

function archiveDay(timestamp: number): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(timestamp)
}

function archiveFolderName(value: string): string {
  const trimmed = value.trim()
  if (basename(trimmed) !== trimmed) {
    throw new Error('xiaojing-finance-domain: archive folder must be one directory name')
  }
  return safeBasename(trimmed)
}

/** Finance-owned, append-only file index and controlled copy operations. */
export class FinanceFileLifecycle {
  private readonly uploadRoot: string

  /**
   * @param uploadRoot - Directory owned by the local upload plugin.
   */
  constructor(uploadRoot: string) {
    if (!isAbsolute(uploadRoot)) throw new Error('xiaojing-finance-domain: uploadRoot must be absolute')
    this.uploadRoot = resolve(uploadRoot)
  }

  /**
   * Return the configured local upload directory used to authorize consultation imports.
   * @returns Absolute upload directory.
   */
  localUploadRoot(): string {
    return this.uploadRoot
  }

  /**
   * Register one completed local upload for a general Finance consultation.
   * @param sessionId - Consultation session that owns the upload.
   * @param request - Local upload path and browser filename.
   * @returns Immutable session-scoped upload record without copying the source.
   */
  async registerConsultationUpload(
    sessionId: SessionId,
    request: ImportFinanceUploadRequest,
  ): Promise<FinanceConsultationFile> {
    const source = await requireFileInRoot(request.path, this.uploadRoot, 'uploaded file')
    return {
      id: FinanceManagedFileId(randomUUID()),
      sessionId,
      path: source.path,
      name: safeBasename(request.originalName),
      sha256: await hashFile(source.path),
      size: source.size,
      createdAt: Date.now(),
    }
  }

  /**
   * Copy one completed local upload into the bound client's original materials.
   * @param binding - Immutable client binding.
   * @param workspace - Validated client workspace.
   * @param sessionId - Session requesting the import.
   * @param request - Local upload path and browser filename.
   * @returns Committed file record.
   */
  async importUpload(
    binding: FinanceClientBinding,
    workspace: FinanceClientWorkspace,
    sessionId: SessionId,
    request: ImportFinanceUploadRequest,
  ): Promise<FinanceManagedFile> {
    const source = await requireFileInRoot(request.path, this.uploadRoot, 'uploaded file')
    return this.commit({
      action: 'import',
      stage: 'source',
      source,
      workspace,
      destinationDirectory: workspace.sourceDirectory,
      preferredName: request.originalName,
      binding,
      sessionId,
    })
  }

  /**
   * Copy one completed session-work file into formal client outputs.
   * @param binding - Immutable client binding.
   * @param workspace - Validated client workspace.
   * @param sessionId - Session requesting publication.
   * @param request - Session-work source and optional output name.
   * @returns Committed file record.
   */
  async publish(
    binding: FinanceClientBinding,
    workspace: FinanceClientWorkspace,
    sessionId: SessionId,
    request: PublishFinanceFileRequest,
  ): Promise<FinanceManagedFile> {
    const source = await requireFileInRoot(request.sourcePath, workspace.sessionWorkDirectory, 'published file')
    return this.commit({
      action: 'publish',
      stage: 'output',
      source,
      workspace,
      destinationDirectory: workspace.outputDirectory,
      preferredName: request.preferredName ?? basename(source.path),
      binding,
      sessionId,
    })
  }

  /**
   * Copy one managed client file into a date-keyed archive directory.
   * @param binding - Immutable client binding.
   * @param workspace - Validated client workspace.
   * @param sessionId - Session requesting archival.
   * @param request - Managed source, optional archive folder, and optional archive name.
   * @returns Committed file record.
   */
  async archive(
    binding: FinanceClientBinding,
    workspace: FinanceClientWorkspace,
    sessionId: SessionId,
    request: ArchiveFinanceFileRequest,
  ): Promise<FinanceManagedFile> {
    const source = await requireFileInRoots(request.sourcePath, [
      workspace.sourceDirectory,
      workspace.sessionWorkDirectory,
      workspace.outputDirectory,
    ], 'archived file')
    const timestamp = Date.now()
    return this.commit({
      action: 'archive',
      stage: 'archive',
      source,
      workspace,
      destinationDirectory: join(
        workspace.archiveDirectory,
        request.archiveFolder === undefined ? archiveDay(timestamp) : archiveFolderName(request.archiveFolder),
      ),
      preferredName: request.preferredName ?? basename(source.path),
      binding,
      sessionId,
    }, timestamp)
  }

  private async commit(request: CommitRequest, timestamp = Date.now()): Promise<FinanceManagedFile> {
    const indexPath = join(request.workspace.clientRoot, INDEX_NAME)
    return withFileLock(indexPath, async () => {
      const index = await readIndex(indexPath)
      const copy = await atomicCopy(
        request.source.path,
        request.destinationDirectory,
        request.workspace.clientRoot,
        request.preferredName,
      )
      const sourceRecord = index.files.find(file => pathKey(file.path) === pathKey(request.source.path))
      const record: FinanceManagedFile = {
        id: FinanceManagedFileId(randomUUID()),
        clientId: request.binding.client.id,
        sessionId: request.sessionId,
        action: request.action,
        stage: request.stage,
        path: copy.path,
        name: copy.name,
        sha256: copy.sha256,
        size: copy.size,
        createdAt: timestamp,
        ...sourceRecord === undefined ? {} : { sourceFileId: sourceRecord.id },
      }
      const next: FinanceFileIndex = {
        schemaVersion: SCHEMA_VERSION,
        revision: index.revision + 1,
        files: [...index.files, record],
      }
      try {
        await writeFileAtomic(indexPath, renderIndex(next), { mode: FILE_MODE, dirMode: DIR_MODE })
      } catch (error) {
        await rm(copy.path, { force: true })
        throw error
      }
      return structuredClone(record)
    })
  }
}
