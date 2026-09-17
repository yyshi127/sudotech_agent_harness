/** Versioned atomic local storage for Finance client records. */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { z } from 'zod'
import {
  FinanceClientId,
  type ArchiveFinanceClientRequest,
  type CreateFinanceClientRequest,
  type FinanceClientDraft,
  type FinanceClientListView,
  type FinanceClientMutationResult,
  type FinanceClientRecord,
  type FinanceClientSummary,
  type UpdateFinanceClientRequest,
} from './types.ts'

const SCHEMA_VERSION = 1
const FILE_MODE = 0o600
const DIR_MODE = 0o700

const optionalText = (max: number) => z.string().trim().min(1).max(max).optional()
const externalId = optionalText(200)
const financeSystemSchema = z.discriminatedUnion('system', [
  z.object({
    system: z.literal('youcheng'),
    environment: z.enum(['test', 'production']),
    appKey: z.string().trim().min(1).max(200),
    accountCode: z.string().trim().min(1).max(200),
    accountName: optionalText(200),
  }).strict(),
  z.object({ system: z.literal('sdoo') }).strict(),
  z.object({ system: z.literal('yonyou') }).strict(),
  z.object({ system: z.literal('kingdee') }).strict(),
])

const draftSchema = z.object({
  legalName: z.string().trim().min(1).max(200),
  shortName: optionalText(100),
  unifiedSocialCreditCode: z.string().trim().toUpperCase()
    .regex(/^[0-9A-HJ-NPQRTUWXY]{18}$/u, 'must be an 18-character unified social credit code')
    .optional(),
  taxpayerType: z.enum(['general-vat', 'small-scale-vat', 'other']),
  registeredRegion: z.string().trim().min(1).max(100),
  accountingStandard: z.enum(['enterprise', 'small-enterprise', 'government', 'nonprofit', 'other']),
  industry: optionalText(100),
  financePolicyNotes: optionalText(10_000),
  financeSystem: financeSystemSchema.optional(),
  chartMappings: z.array(z.object({
    localAccountCode: z.string().trim().min(1).max(100),
    externalAccountCode: z.string().trim().min(1).max(100),
  }).strict()).max(500),
  externalSystemRefs: z.array(z.object({
    system: z.enum(['youcheng', 'sdoo']),
    tenantId: externalId,
    companyId: externalId,
    accountSetId: externalId,
  }).strict()).max(20),
}).strict()

const recordSchema = draftSchema.extend({
  id: z.uuid(),
  version: z.number().int().positive(),
  status: z.enum(['active', 'archived']),
  workspacePath: z.string().min(1).max(32_768).refine(isAbsolute, 'must be an absolute path'),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  archivedAt: z.number().int().nonnegative().optional(),
}).strict()

const documentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  revision: z.number().int().nonnegative(),
  clients: z.array(recordSchema),
}).strict()

interface FinanceClientDocument {
  schemaVersion: 1
  revision: number
  clients: FinanceClientRecord[]
}

/** Roll back a side effect prepared under the client-catalog lock. */
export type RollbackFinanceClientCommit = () => Promise<void>

/** Prepare one external side effect immediately before a catalog commit. */
export type PrepareFinanceClientCommit = () => Promise<RollbackFinanceClientCommit | undefined>

async function readOptional(filename: string): Promise<string | undefined> {
  try {
    return await readFile(filename, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function parseDocument(text: string, filename: string): FinanceClientDocument {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`xiaojing-finance-domain: cannot parse ${filename}; preserve the file and repair or migrate it`, { cause: error })
  }
  const parsed = documentSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(`xiaojing-finance-domain: ${filename} is not a valid clients schema v1 document; preserve it and migrate or repair it`)
  }
  const document = parsed.data as FinanceClientDocument
  assertUniqueCreditCodes(document.clients, filename)
  return document
}

function assertUniqueCreditCodes(clients: readonly FinanceClientRecord[], filename: string): void {
  const seen = new Set<string>()
  for (const client of clients) {
    const code = client.unifiedSocialCreditCode
    if (code === undefined) continue
    if (seen.has(code)) throw new Error(`xiaojing-finance-domain: duplicate unified social credit code in ${filename}`)
    seen.add(code)
  }
}

function render(document: FinanceClientDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

function normalizeDraft(value: FinanceClientDraft): FinanceClientDraft {
  const draft = draftSchema.parse(value) as FinanceClientDraft
  if (draft.shortName === undefined) {
    throw new Error('xiaojing-finance-domain: shortName is required for client mutations')
  }
  return draft
}

function displaySummary(client: FinanceClientRecord): FinanceClientSummary {
  return {
    id: client.id,
    legalName: client.legalName,
    ...client.shortName === undefined ? {} : { shortName: client.shortName },
    taxpayerType: client.taxpayerType,
    registeredRegion: client.registeredRegion,
    accountingStandard: client.accountingStandard,
    version: client.version,
    status: client.status,
  }
}

function assertExpectedRevision(document: FinanceClientDocument, expected: number): void {
  if (!Number.isSafeInteger(expected) || expected < 0) {
    throw new Error('xiaojing-finance-domain: expectedRevision must be a non-negative safe integer')
  }
  if (document.revision !== expected) {
    throw new Error(`xiaojing-finance-domain: revision conflict; expected ${expected}, current ${document.revision}`)
  }
}

function assertNoDuplicateCreditCode(
  clients: readonly FinanceClientRecord[],
  draft: FinanceClientDraft,
  excludedId?: FinanceClientId,
): void {
  const code = draft.unifiedSocialCreditCode
  if (code === undefined) return
  if (clients.some(client => client.id !== excludedId && client.unifiedSocialCreditCode === code)) {
    throw new Error(`xiaojing-finance-domain: unified social credit code ${code} already belongs to another client`)
  }
}

/** Atomic store rooted at `$DSH_HOME/finance/clients-v1.json`. */
export class FinanceClientStore {
  /** Private Finance data directory. */
  readonly root: string
  /** Versioned client catalog path. */
  readonly filePath: string

  /** @param dshHome - Fixed Harness data root. */
  constructor(dshHome: string) {
    this.root = join(dshHome, 'finance')
    this.filePath = join(this.root, 'clients-v1.json')
  }

  /** Validate existing data or initialize an empty catalog without rewriting valid data. */
  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: DIR_MODE })
    const existing = await readOptional(this.filePath)
    if (existing !== undefined) {
      parseDocument(existing, this.filePath)
      return
    }
    await withFileLock(this.filePath, async () => {
      const raced = await readOptional(this.filePath)
      if (raced !== undefined) {
        parseDocument(raced, this.filePath)
        return
      }
      await writeFileAtomic(this.filePath, render({ schemaVersion: 1, revision: 0, clients: [] }), {
        mode: FILE_MODE,
        dirMode: DIR_MODE,
      })
    })
  }

  /**
   * Read browser-safe catalog rows.
   * @returns Current revision and creation-ordered summaries.
   */
  async list(): Promise<FinanceClientListView> {
    const document = await this.readDocument()
    return { revision: document.revision, clients: document.clients.map(displaySummary) }
  }

  /**
   * Read one full loopback-only record.
   * @param clientId - Client identity.
   * @returns Current revision and detached record.
   */
  async read(clientId: FinanceClientId): Promise<{ revision: number; client: FinanceClientRecord }> {
    const document = await this.readDocument()
    const client = document.clients.find(candidate => candidate.id === clientId)
    if (client === undefined) throw new Error(`xiaojing-finance-domain: client ${clientId} was not found`)
    return { revision: document.revision, client: structuredClone(client) }
  }

  /**
   * Create one active client under catalog compare-and-swap.
   * @param request - Expected revision and fields.
   * @param clientId - Preallocated id used by the customer-workspace transaction.
   * @param prepareCommit - Optional side effect prepared under the catalog lock and rolled back if the file write fails.
   * @returns New revision and record.
   */
  async create(
    request: CreateFinanceClientRequest,
    clientId: FinanceClientId = FinanceClientId(randomUUID()),
    prepareCommit?: PrepareFinanceClientCommit,
  ): Promise<FinanceClientMutationResult> {
    return this.mutate(request.expectedRevision, (document) => {
      const draft = normalizeDraft(request.client)
      assertNoDuplicateCreditCode(document.clients, draft)
      const now = Date.now()
      const client: FinanceClientRecord = {
        id: clientId,
        version: 1,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        workspacePath: request.workspacePath,
        ...draft,
      }
      return { clients: [...document.clients, client], result: client }
    }, prepareCommit)
  }

  /**
   * Replace editable fields on an active client.
   * @param request - Client, expected revision, and fields.
   * @param prepareCommit - Optional side effect prepared under the catalog lock and rolled back if the file write fails.
   * @returns New revision and record.
   */
  async update(
    request: UpdateFinanceClientRequest,
    prepareCommit?: PrepareFinanceClientCommit,
  ): Promise<FinanceClientMutationResult> {
    return this.mutate(request.expectedRevision, (document) => {
      const index = document.clients.findIndex(candidate => candidate.id === request.clientId)
      if (index === -1) throw new Error(`xiaojing-finance-domain: client ${request.clientId} was not found`)
      const current = document.clients[index] as FinanceClientRecord
      if (current.status !== 'active') throw new Error('xiaojing-finance-domain: archived clients cannot be edited')
      const draft = normalizeDraft(request.client)
      assertNoDuplicateCreditCode(document.clients, draft, current.id)
      const client: FinanceClientRecord = {
        id: current.id,
        version: current.version + 1,
        status: current.status,
        workspacePath: current.workspacePath,
        createdAt: current.createdAt,
        updatedAt: Date.now(),
        ...draft,
      }
      const clients = [...document.clients]
      clients[index] = client
      return { clients, result: client }
    }, prepareCommit)
  }

  /**
   * Archive a client without removing historical data.
   * @param request - Client and expected revision.
   * @returns New revision and archived record.
   */
  async archive(request: ArchiveFinanceClientRequest): Promise<FinanceClientMutationResult> {
    return this.mutate(request.expectedRevision, (document) => {
      const index = document.clients.findIndex(candidate => candidate.id === request.clientId)
      if (index === -1) throw new Error(`xiaojing-finance-domain: client ${request.clientId} was not found`)
      const current = document.clients[index] as FinanceClientRecord
      if (current.status === 'archived') throw new Error('xiaojing-finance-domain: client is already archived')
      const now = Date.now()
      const client: FinanceClientRecord = {
        ...current,
        version: current.version + 1,
        status: 'archived',
        updatedAt: now,
        archivedAt: now,
      }
      const clients = [...document.clients]
      clients[index] = client
      return { clients, result: client }
    })
  }

  private async readDocument(): Promise<FinanceClientDocument> {
    return parseDocument(await readFile(this.filePath, 'utf8'), this.filePath)
  }

  private async mutate(
    expectedRevision: number,
    change: (document: FinanceClientDocument) => { clients: FinanceClientRecord[]; result: FinanceClientRecord },
    prepareCommit?: PrepareFinanceClientCommit,
  ): Promise<FinanceClientMutationResult> {
    return withFileLock(this.filePath, async () => {
      const current = await this.readDocument()
      assertExpectedRevision(current, expectedRevision)
      const changed = change(current)
      const next: FinanceClientDocument = {
        schemaVersion: 1,
        revision: current.revision + 1,
        clients: changed.clients,
      }
      assertUniqueCreditCodes(next.clients, this.filePath)
      documentSchema.parse(next)
      const rollback = await prepareCommit?.()
      try {
        await writeFileAtomic(this.filePath, render(next), { mode: FILE_MODE, dirMode: DIR_MODE })
      } catch (error) {
        if (rollback === undefined) throw error
        try {
          await rollback()
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            'Finance client catalog commit and credential rollback both failed',
          )
        }
        throw error
      }
      return { revision: next.revision, client: structuredClone(changed.result) }
    })
  }
}
