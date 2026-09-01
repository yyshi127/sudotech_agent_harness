/** Finance consultation and customer workspace validation and provisioning. */

import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import type { FinanceClientBinding, FinanceClientId, FinanceClientRecord } from './types.ts'

const DIR_MODE = 0o700
const FILE_MODE = 0o600
const MARKER_NAME = '.xiaojing-client.json'
const SESSION_MANIFEST_NAME = '会话信息.json'

const markerSchema = z.object({
  schemaVersion: z.literal(1),
  clientId: z.uuid(),
  clientVersion: z.number().int().positive(),
  displayName: z.string().min(1).max(200),
}).strict()

const sessionManifestSchema = z.object({
  schemaVersion: z.literal(1),
  sessionId: z.string().min(1),
  clientId: z.uuid(),
  clientVersion: z.number().int().positive(),
  clientName: z.string().min(1).max(200),
}).strict()

interface ClientMarker {
  schemaVersion: 1
  clientId: string
  clientVersion: number
  displayName: string
}

interface SessionManifest {
  schemaVersion: 1
  sessionId: string
  clientId: string
  clientVersion: number
  clientName: string
}

/** Client facts required to provision or refresh its dedicated workspace. */
export interface FinanceClientWorkspaceDescriptor {
  /** Stable customer id mirrored into the directory marker. */
  clientId: FinanceClientId
  /** Customer-record version mirrored into the marker. */
  clientVersion: number
  /** Human-facing workspace title. */
  displayName: string
  /** Current canonical record used to refresh generated customer files. */
  client?: FinanceClientRecord
}

/** Stable directories owned directly by the Finance module. */
export interface FinanceWorkspaceLayout {
  /** Product-configured Finance root, separate from ordinary user workspaces. */
  root: string
  /** Fixed workspace for Finance questions without customer facts. */
  standardRoot: string
}

/** Customer-wide and per-session paths for one immutable Finance client binding. */
export interface FinanceClientWorkspace {
  /** Stable customer workspace and immutable Session cwd. */
  clientRoot: string
  /** Customer-wide profile materials. */
  profileDirectory: string
  /** Customer-wide finance-policy materials. */
  policyDirectory: string
  /** Customer-wide source documents; task skills may create period-specific children. */
  sourceDirectory: string
  /** Per-session work directory. */
  sessionWorkDirectory: string
  /** Customer-wide deliverables; task skills may create period-specific children. */
  outputDirectory: string
  /** Customer-wide archive; task skills may create period-specific children. */
  archiveDirectory: string
}

function markerText(marker: ClientMarker): string {
  return `${JSON.stringify(marker, null, 2)}\n`
}

function sessionManifestText(manifest: SessionManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

function clientSnapshotText(client: FinanceClientRecord): string {
  return `${JSON.stringify({ schemaVersion: 1, client }, null, 2)}\n`
}

function policyNotesText(client: FinanceClientRecord): string {
  const notes = client.financePolicyNotes?.trim() || '暂无已维护的客户财务政策备注。'
  return `# 客户财务政策备注\n\n${notes}\n`
}

function sessionDirectoryName(sessionId: SessionId): string {
  return `session-${createHash('sha256').update(sessionId).digest('hex').slice(0, 16)}`
}

async function readMarker(filename: string): Promise<ClientMarker | undefined> {
  let text: string
  try {
    text = await readFile(filename, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`xiaojing-finance-domain: cannot parse ${filename}; preserve the file and repair it`, { cause: error })
  }
  const parsed = markerSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(`xiaojing-finance-domain: ${filename} is not a valid client workspace marker`)
  }
  return parsed.data
}

async function readSessionManifest(filename: string): Promise<SessionManifest | undefined> {
  let text: string
  try {
    text = await readFile(filename, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`xiaojing-finance-domain: cannot parse ${filename}; preserve the file and repair it`, { cause: error })
  }
  const parsed = sessionManifestSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(`xiaojing-finance-domain: ${filename} is not a valid Finance session manifest`)
  }
  return parsed.data
}

async function ensureSessionManifest(
  filename: string,
  binding: FinanceClientBinding,
  sessionId: SessionId,
): Promise<void> {
  const expected: SessionManifest = {
    schemaVersion: 1,
    sessionId,
    clientId: binding.client.id,
    clientVersion: binding.clientVersion,
    clientName: binding.client.shortName ?? binding.client.legalName,
  }
  await withFileLock(filename, async () => {
    const existing = await readSessionManifest(filename)
    if (existing !== undefined) {
      if (existing.sessionId === expected.sessionId
        && existing.clientId === expected.clientId
        && existing.clientVersion === expected.clientVersion
        && existing.clientName === expected.clientName) return
      throw new Error(`xiaojing-finance-domain: ${filename} belongs to another Finance session binding`)
    }
    await writeFileAtomic(filename, sessionManifestText(expected), { mode: FILE_MODE, dirMode: DIR_MODE })
  })
}

async function requireSameDirectory(actual: string, expected: string, message: string): Promise<void> {
  const [actualPath, expectedPath] = await Promise.all([realpath(actual), realpath(expected)])
  if (actualPath !== expectedPath) throw new Error(message)
}

/**
 * Resolve the Finance root and fixed consultation directory.
 * @param workspaceRoot - Product-configured absolute Finance root.
 * @returns Stable Finance-owned paths.
 */
export function resolveFinanceWorkspaceLayout(workspaceRoot: string): FinanceWorkspaceLayout {
  if (!isAbsolute(workspaceRoot)) {
    throw new Error('xiaojing-finance-domain: Finance workspaceRoot must be absolute')
  }
  return { root: workspaceRoot, standardRoot: join(workspaceRoot, '标准咨询') }
}

/**
 * Create the Finance root and fixed consultation directory.
 * @param workspaceRoot - Product-configured absolute Finance root.
 * @returns The resolved directory layout.
 */
export async function ensureFinanceWorkspaceLayout(workspaceRoot: string): Promise<FinanceWorkspaceLayout> {
  const layout = resolveFinanceWorkspaceLayout(workspaceRoot)
  await Promise.all([
    mkdir(layout.root, { recursive: true, mode: DIR_MODE }),
    mkdir(layout.standardRoot, { recursive: true, mode: DIR_MODE }),
  ])
  return layout
}

/**
 * Require a Session to run in one permitted Finance consultation Workspace.
 * @param allowedPaths - Canonical Finance consultation directories.
 * @param sessionCwd - Immutable Session cwd.
 */
export async function assertFinanceConsultationWorkspace(
  allowedPaths: readonly string[],
  sessionCwd: string | undefined,
): Promise<void> {
  if (sessionCwd === undefined) {
    throw new Error('xiaojing-finance-domain: Finance consultation sessions require a workspace directory')
  }
  const actual = await realpath(sessionCwd)
  const allowed = await Promise.all(allowedPaths.map(path => realpath(path)))
  if (!allowed.includes(actual)) {
    throw new Error('xiaojing-finance-domain: consultation must run in a registered Finance consultation workspace')
  }
}

/**
 * Require a Session to run in the fixed consultation Workspace.
 * @param workspaceRoot - Product-configured absolute Finance root.
 * @param sessionCwd - Immutable Session cwd.
 */
export async function assertFinanceStandardWorkspace(
  workspaceRoot: string,
  sessionCwd: string | undefined,
): Promise<void> {
  await assertFinanceConsultationWorkspace(
    [resolveFinanceWorkspaceLayout(workspaceRoot).standardRoot],
    sessionCwd,
  )
}

/**
 * Require a Session to run in the selected customer's directory.
 * @param clientRoot - Canonical directory stored on the customer record.
 * @param sessionCwd - Immutable Session cwd.
 */
export async function assertFinanceClientSessionWorkspace(
  clientRoot: string,
  sessionCwd: string | undefined,
): Promise<void> {
  if (sessionCwd === undefined) {
    throw new Error('xiaojing-finance-domain: Finance customer sessions require a workspace directory')
  }
  await requireSameDirectory(
    sessionCwd,
    clientRoot,
    'xiaojing-finance-domain: selected customer does not match the Session workspace',
  )
}

/**
 * Create or refresh one user-selected customer workspace.
 * @param clientRoot - Canonical customer directory selected by the user.
 * @param descriptor - Stable id, version, and display name.
 * @returns Canonical customer workspace root.
 */
export async function provisionFinanceClientWorkspace(
  clientRoot: string,
  descriptor: FinanceClientWorkspaceDescriptor,
): Promise<string> {
  if (!isAbsolute(clientRoot)) {
    throw new Error('xiaojing-finance-domain: customer workspace path must be absolute')
  }
  if (descriptor.client !== undefined
    && (descriptor.client.id !== descriptor.clientId || descriptor.client.version !== descriptor.clientVersion)) {
    throw new Error('xiaojing-finance-domain: generated client files require the matching current record')
  }
  await Promise.all([
    mkdir(join(clientRoot, '00-客户档案'), { recursive: true, mode: DIR_MODE }),
    mkdir(join(clientRoot, '01-财务政策'), { recursive: true, mode: DIR_MODE }),
    mkdir(join(clientRoot, '02-原始资料'), { recursive: true, mode: DIR_MODE }),
    mkdir(join(clientRoot, '03-会话作业'), { recursive: true, mode: DIR_MODE }),
    mkdir(join(clientRoot, '04-成果输出'), { recursive: true, mode: DIR_MODE }),
    mkdir(join(clientRoot, '05-归档'), { recursive: true, mode: DIR_MODE }),
  ])

  const markerPath = join(clientRoot, MARKER_NAME)
  await withFileLock(markerPath, async () => {
    const existing = await readMarker(markerPath)
    if (existing !== undefined && existing.clientId !== descriptor.clientId) {
      throw new Error(`xiaojing-finance-domain: ${markerPath} belongs to another client`)
    }
    if (existing !== undefined && existing.clientVersion >= descriptor.clientVersion
      && existing.displayName === descriptor.displayName) return
    await writeFileAtomic(markerPath, markerText({
      schemaVersion: 1,
      clientId: descriptor.clientId,
      clientVersion: descriptor.clientVersion,
      displayName: descriptor.displayName,
    }), { mode: FILE_MODE, dirMode: DIR_MODE })
  })
  if (descriptor.client !== undefined) {
    await Promise.all([
      writeFileAtomic(
        join(clientRoot, '00-客户档案', '客户档案快照.json'),
        clientSnapshotText(descriptor.client),
        { mode: FILE_MODE, dirMode: DIR_MODE },
      ),
      writeFileAtomic(
        join(clientRoot, '01-财务政策', '客户财务政策备注.md'),
        policyNotesText(descriptor.client),
        { mode: FILE_MODE, dirMode: DIR_MODE },
      ),
    ])
  }
  return realpath(clientRoot)
}

/**
 * Resolve the filesystem layout for one session binding.
 * @param binding - Immutable customer binding.
 * @param sessionId - Session receiving a private work subdirectory.
 * @returns Customer-wide and session-specific paths.
 */
export function resolveFinanceClientWorkspace(
  binding: FinanceClientBinding,
  sessionId: SessionId,
): FinanceClientWorkspace {
  const clientRoot = binding.workspacePath
  return {
    clientRoot,
    profileDirectory: join(clientRoot, '00-客户档案'),
    policyDirectory: join(clientRoot, '01-财务政策'),
    sourceDirectory: join(clientRoot, '02-原始资料'),
    sessionWorkDirectory: join(clientRoot, '03-会话作业', sessionDirectoryName(sessionId)),
    outputDirectory: join(clientRoot, '04-成果输出'),
    archiveDirectory: join(clientRoot, '05-归档'),
  }
}

/**
 * Create and validate one session layout inside its customer workspace.
 * @param binding - Immutable customer binding.
 * @param sessionId - Session receiving a private work subdirectory.
 * @param sessionCwd - Immutable Session cwd, which must equal the customer root.
 * @returns Validated filesystem layout.
 */
export async function ensureFinanceClientWorkspace(
  binding: FinanceClientBinding,
  sessionId: SessionId,
  sessionCwd: string | undefined,
): Promise<FinanceClientWorkspace> {
  if (sessionCwd === undefined) {
    throw new Error('xiaojing-finance-domain: Finance customer sessions require a workspace directory')
  }
  const workspace = resolveFinanceClientWorkspace(binding, sessionId)
  let cwdStat
  try {
    cwdStat = await stat(sessionCwd)
  } catch (error) {
    throw new Error(`xiaojing-finance-domain: workspace directory ${sessionCwd} does not exist`, { cause: error })
  }
  if (!cwdStat.isDirectory()) {
    throw new Error(`xiaojing-finance-domain: workspace path ${sessionCwd} is not a directory`)
  }
  await assertFinanceClientSessionWorkspace(binding.workspacePath, sessionCwd)
  await provisionFinanceClientWorkspace(binding.workspacePath, {
    clientId: binding.client.id,
    clientVersion: binding.clientVersion,
    displayName: binding.client.shortName ?? binding.client.legalName,
  })
  await Promise.all([
    workspace.sourceDirectory,
    workspace.sessionWorkDirectory,
    workspace.outputDirectory,
    workspace.archiveDirectory,
  ].map(path => mkdir(path, { recursive: true, mode: DIR_MODE })))
  await ensureSessionManifest(join(workspace.sessionWorkDirectory, SESSION_MANIFEST_NAME), binding, sessionId)
  return workspace
}
