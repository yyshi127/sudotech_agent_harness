/** Youcheng V2 Finance reads and reserved single-attempt writes; write authority belongs to the Host. */

import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { balanceQuerySchema, projectBalances, type BalanceQuery, type BalanceResult } from './balances.ts'
import { readBalanceTree } from './balance-tree.ts'
import { projectJournals, resolveJournalQuery, type JournalQuery, type JournalResult } from './journals.ts'
import { buildJournalSubmission, validateJournalPreparation, type JournalPreparationInput,
  type JournalReferenceSelection } from './journal-preparation.ts'
import { classifyJournalSubmission, compareJournalReadback, type JournalReadback } from './journal-submission.ts'
import { collectJournalDeletionInventory, classifyJournalDeletion, type JournalDeletionOutcome,
  type JournalDeletionInventory, type JournalDeletionPage } from './journal-deletion.ts'
import type { JournalSubmissionOutcome } from './journal-records.ts'
import { buildMasterDataSubmission, type MasterDataProposal, type MasterDataSelection, type MasterDataSubmissionOutcome } from './master-data-records.ts'
import { classifyMasterDataSubmission, compareAuxiliaryReadback, type AuxiliaryReadback } from './master-data-submission.ts'
import { compareSubjectReadback, type SubjectReadback } from './subject-submission.ts'
import { resolveSubjectAccounting, resolveSubjectReferences } from './subject-preparation.ts'
import { resolveAuxiliaryReferences } from './auxiliary-preparation.ts'
import { analyzeJournals, journalAnalysisSchema, type JournalAnalysisQuery, type JournalAnalysisResult } from './journal-analysis.ts'
import { openItemQuerySchema, projectOpenItems, type OpenItemQuery, type OpenItemResult } from './open-items.ts'
import { classifyOpenItemDeletion, collectOpenItemDeletionInventory, type OpenItemDeletionInventory,
  type OpenItemDeletionOutcome, type OpenItemDeletionSelection } from './open-item-deletion.ts'
import { validateOpenItemWriteOff, selectOpenItemWriteOffTarget, classifyOpenItemWriteOff, readOpenItemWriteOffBusinessAccount,
  readOpenItemWriteOffIdentity, type OpenItemWriteOffInput, type OpenItemWriteOffOutcome,
  type OpenItemWriteOffReceiptId } from './open-item-write-off.ts'
import { collectWriteOffJournalLink, type WriteOffJournalLink } from './open-item-write-off-journal.ts'
import type { OpenItemWriteOffEvidence } from './open-item-write-off-records.ts'
import { buildOpenItemSubmission, validateOpenItemPreparation, resolveOpenItemCounterparty, type OpenItemPreparationInput } from './open-item-preparation.ts'
import { classifyOpenItemSubmission, compareOpenItemReadback, type OpenItemSubmissionOutcome,
  type OpenItemReadback, type OpenItemReadbackSelection } from './open-item-submission.ts'
import type { PreparedOpenItemRecord, OpenItemReservedSelection } from './open-item-records.ts'
import { projectOpenItemAccountReferences, resolveObservedOpenItemAccount, type OpenItemAccountReferences,
  type OpenItemAccountObservation } from './open-item-account-references.ts'
import { analyzeOpenItems, OpenItemGroupingError, openItemAnalysisSchema, type OpenItemAnalysisQuery, type OpenItemAnalysisResult } from './open-item-analysis.ts'
import { projectReferences, referenceQuerySchema, type ReferenceQuery, type ReferenceResult } from './references.ts'
import { projectVoucherDetail, projectVoucherPage, validateVoucherId, validateVoucherQuery, type VoucherDetail, type VoucherPage, type VoucherQuery } from './vouchers.ts'
import { buildVoucherSubmission, classifyVoucherSubmission, matchesVoucherAccounting, compareVoucherAuxiliary, compareVoucherCurrency,
  type VoucherSubmissionIdentity, type VoucherSubmissionOutcome } from './voucher-submission.ts'
import type { VoucherPreparationInput } from './voucher-preparation.ts'
import { inspectVoucherDeletion, classifyVoucherDeletion, type VoucherDeletionInspection,
  type VoucherDeletionPayload, type VoucherDeletionOutcome } from './voucher-deletion.ts'
import { verifyVoucherOriginals, type VoucherOriginalIdentity, type VoucherOriginalVerification,
  type VoucherOriginalVerificationOptions } from './voucher-originals.ts'
import type {
  FinanceClientId, FinanceConnectionFailure, FinanceConnectionStatus,
  FinanceYouchengAccount, FinanceYouchengAccountsResult, FinanceYouchengApiUrls, FinanceYouchengSystemConfig,
} from './types.ts'

const envelope = z.object({ result: z.number().int(), message: z.string().optional(),
  data: z.unknown().optional(), count: z.unknown().optional() })
const accounts = z.array(z.object({ id: z.string().min(1).max(200), sobName: z.string().trim().min(1).max(200) }))
const TOKEN_LIFETIME_MS = 115 * 60 * 1_000
type AuthenticationConfig = Pick<FinanceYouchengSystemConfig, 'environment' | 'appKey'>

/**
 * Validate deployment-owned HTTPS origins before any credential can be sent.
 * @param test - Origin for the internal test label.
 * @param production - Origin for the internal production label.
 * @returns Validated origin mapping; throws for insecure or non-origin URLs.
 */
export function resolveYouchengApiUrls(test: string, production: string): FinanceYouchengApiUrls {
  const origin = (value: string): string => {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('Youcheng API address must be an HTTPS origin without credentials, path, query, or fragment')
    }
    return url.origin
  }
  return { test: origin(test), production: origin(production) }
}

class CheckFailure extends Error {
  readonly failure: FinanceConnectionFailure
  constructor(failure: FinanceConnectionFailure, diagnostic?: string) {
    super(diagnostic === undefined ? failure : `${failure}:${diagnostic}`)
    this.failure = failure
  }
}

// Only fixed transport identifiers may cross into model-visible diagnostics, never error messages or URLs.
function transportDiagnostic(error: unknown): string | undefined {
  const cause: unknown = error instanceof Error ? error.cause : undefined
  const code = typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : undefined
  return typeof code === 'string' && ['ECONNRESET', 'UND_ERR_SOCKET', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)
    ? code : undefined
}

/** Host-private tokens, bounded reads and reserved voucher transport; no result exposes tokens or vendor prose. */
export class YouchengConnection {
  private readonly tokens = new Map<FinanceClientId, { fingerprint: string; token: string; expiresAt: number }>()

  /**
   * @param urls - Validated deployment origins.
   * @param timeoutMs - Whole-check deadline.
   * @param retryTransientReads - Retry one recognized transient failure without renewing the deadline; disabled unless requested.
   */
  constructor(readonly urls: FinanceYouchengApiUrls, private readonly timeoutMs: number, private readonly retryTransientReads = false) {}

  /**
   * Send one subject or auxiliary item after the Host durably reserves its exact confirmed proposal.
   * @param config - Captured Host-owned ledger configuration.
   * @param secret - Host-only credential, never model-visible.
   * @param proposal - Exact validated reserved business kind and fields.
   * @param selection - Exact approved ledger and parent/category selection.
   * @param stopped - Caller cancellation; post-dispatch cancellation never proves non-creation.
   * @param maxBytes - Complete request and response byte limit.
   * @param beforeSend - Mandatory fresh reference/configuration and cancellation check immediately before dispatch.
   * @returns Sanitized transport observation without a fabricated ID; persist before independent readback.
   */
  async sendReservedMasterData(config: FinanceYouchengSystemConfig, secret: string | undefined, proposal: MasterDataProposal,
    selection: MasterDataSelection, stopped: AbortSignal, maxBytes: number,
    beforeSend: () => Promise<void>): Promise<MasterDataSubmissionOutcome> {
    const body = JSON.stringify(buildMasterDataSubmission(proposal, selection))
    if (Buffer.byteLength(body, 'utf8') > maxBytes) throw new Error('基础资料提交内容超过大小限制。')
    const signal = AbortSignal.any([stopped, AbortSignal.timeout(this.timeoutMs)])
    let token: string
    try {
      signal.throwIfAborted()
      if (secret === undefined || config.accountCode !== selection.accountId) return { state: 'not-sent', reason: 'preflight-failed' }
      token = await this.authenticate(config, secret, signal, maxBytes)
      const ledgers = await this.queryAccounts(config, secret, token, signal, undefined, maxBytes)
      if (ledgers.filter(account => account.id === selection.accountId && account.name === selection.accountName).length !== 1
        || ledgers.filter(account => account.name === selection.accountName).length !== 1) return { state: 'not-sent', reason: 'preflight-failed' }
      await beforeSend()
      signal.throwIfAborted()
    } catch {
      return { state: 'not-sent', reason: signal.aborted ? 'cancelled' : 'preflight-failed' }
    }
    const path = proposal.kind === 'subject' ? '/finance/subject/add.rjson' : '/finance/auxiliary/add.rjson'
    const url = new URL(path, this.urls[config.environment])
    url.searchParams.set('appKey', config.appKey)
    url.searchParams.set('accessToken', token)
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body, signal, redirect: 'error' })
      const value = await this.readBoundedJson(response, maxBytes)
      if ([config.appKey, secret, token].some(item => JSON.stringify(value).includes(item))) return { state: 'outcome-unknown' }
      return classifyMasterDataSubmission(value, response.ok)
    } catch {
      return { state: 'outcome-unknown' }
    }
  }

  /**
   * Send one journal only after Host confirmation and durable reservation.
   * @param config - Captured saved ledger configuration.
   * @param secret - Host-private credential.
   * @param input - Exact reserved proposal, not replacement model arguments.
   * @param selection - Approved ledger, cash account and category labels.
   * @param previousId - Host-qualified reserved predecessor.
   * @param stopped - Caller/Host cancellation; cancellation after dispatch cannot prove non-creation.
   * @param maxBytes - Complete request/response byte limit.
   * @param beforeSend - Fresh reference, configuration and cancellation check immediately before dispatch.
   * @returns Transport observation only, requiring durable saving before independent readback.
   */
  async sendReservedJournal(config: FinanceYouchengSystemConfig, secret: string | undefined, input: JournalPreparationInput,
    selection: JournalReferenceSelection, previousId: string, stopped: AbortSignal, maxBytes: number,
    beforeSend: () => Promise<void>): Promise<JournalSubmissionOutcome> {
    const payload = buildJournalSubmission(validateJournalPreparation(input, maxBytes), selection, previousId)
    const body = JSON.stringify(payload)
    if (Buffer.byteLength(body, 'utf8') > maxBytes) throw new Error('日记账提交内容超过大小限制。')
    const signal = AbortSignal.any([stopped, AbortSignal.timeout(this.timeoutMs)])
    let token: string
    try {
      signal.throwIfAborted()
      if (secret === undefined || config.accountCode !== selection.accountId) return { state: 'not-sent', reason: 'preflight-failed' }
      token = await this.authenticate(config, secret, signal, maxBytes)
      const ledgers = await this.queryAccounts(config, secret, token, signal, undefined, maxBytes)
      if (ledgers.filter(account => account.id === selection.accountId && account.name === selection.accountName).length !== 1
        || ledgers.filter(account => account.name === selection.accountName).length !== 1) {
        return { state: 'not-sent', reason: 'preflight-failed' }
      }
      await beforeSend()
      signal.throwIfAborted()
    } catch {
      return { state: 'not-sent', reason: signal.aborted ? 'cancelled' : 'preflight-failed' }
    }
    const url = new URL('/finance/cashjournal/add.rjson', this.urls[config.environment])
    url.searchParams.set('appKey', config.appKey)
    url.searchParams.set('accessToken', token)
    try {
      // A transient read retry is never valid for this external mutation.
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body, signal, redirect: 'error' })
      const value = await this.readBoundedJson(response, maxBytes)
      if ([config.appKey, secret, token].some(item => JSON.stringify(value).includes(item))) return { state: 'outcome-unknown' }
      return classifyJournalSubmission(value, response.ok)
    } catch {
      return { state: 'outcome-unknown' }
    }
  }

  /**
   * Dispatch an already authorized, owner-checked durable open-item reservation once, without read retries.
   * @param config - Captured saved ledger configuration.
   * @param secret - Host-only credential.
   * @param record - Exact record returned by successful reservation, never a replacement model payload.
   * @param stopped - Caller/Host cancellation; cancellation after dispatch cannot establish non-creation.
   * @param maxBytes - Complete request and response limit.
   * @param beforeSend - Host recheck of version, configuration and current references immediately before dispatch.
   * @returns Sanitized transport observation; the Host must persist it before independent readback.
   */
  async sendReservedOpenItem(config: FinanceYouchengSystemConfig, secret: string | undefined, record: PreparedOpenItemRecord,
    stopped: AbortSignal, maxBytes: number, beforeSend: () => Promise<void>): Promise<OpenItemSubmissionOutcome> {
    if (record.phase !== 'outcome-unknown' || record.outcome !== undefined || record.reservation === undefined) {
      return { state: 'not-sent', reason: 'preflight-failed' }
    }
    const { selection, payload } = record.reservation
    const input = validateOpenItemPreparation(record.input, maxBytes)
    const expected = buildOpenItemSubmission(input, selection.ledgerName, selection.categoryName, selection.counterparty)
    const body = JSON.stringify(expected)
    if (input.accountId !== selection.accountId || input.categoryId !== selection.categoryId
      || body !== JSON.stringify(payload) || Buffer.byteLength(body, 'utf8') > maxBytes) {
      return { state: 'not-sent', reason: 'preflight-failed' }
    }
    const signal = AbortSignal.any([stopped, AbortSignal.timeout(this.timeoutMs)])
    let token: string
    try {
      signal.throwIfAborted()
      if (secret === undefined || config.accountCode !== selection.ledgerId) return { state: 'not-sent', reason: 'preflight-failed' }
      token = await this.authenticate(config, secret, signal, maxBytes)
      const ledgers = await this.queryAccounts(config, secret, token, signal, undefined, maxBytes)
      if (ledgers.filter(account => account.id === selection.ledgerId && account.name === selection.ledgerName).length !== 1
        || ledgers.filter(account => account.name === selection.ledgerName).length !== 1) {
        return { state: 'not-sent', reason: 'preflight-failed' }
      }
      await beforeSend()
      signal.throwIfAborted()
    } catch {
      // Authentication, ledger, cancellation and Host preflight failures happen before dispatch.
      return { state: 'not-sent', reason: signal.aborted ? 'cancelled' : 'preflight-failed' }
    }
    const url = new URL('/finance/cashier/account/management/add.rjson', this.urls[config.environment])
    url.searchParams.set('appKey', config.appKey)
    url.searchParams.set('accessToken', token)
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body, signal, redirect: 'error' })
      const value = await this.readBoundedJson(response, maxBytes)
      if ([config.appKey, secret, token].some(item => JSON.stringify(value).includes(item))) return { state: 'outcome-unknown' }
      return classifyOpenItemSubmission(value, response.ok)
    } catch {
      // Dispatch and bounded response failures cannot prove whether the vendor created the record.
      return { state: 'outcome-unknown' }
    }
  }

  /**
   * Send an already authorized and durably reserved ordinary-endpoint voucher exactly once.
   * @param config - Captured saved ledger configuration; the Host must recheck its revision after approval.
   * @param secret - Host-only credential.
   * @param input - Exact previewed content, not fresh model arguments.
   * @param identity - Reserved appId/flowId, verified account name and uploaded original URLs.
   * @param stopped - Caller/Host cancellation; cancellation after dispatch leaves outcome unknown.
   * @param limits - Complete input/response bounds and entry limit.
   * @param beforeSend - Host revision and cancellation check after authentication, immediately before dispatch.
   * @returns Transport outcome only; accepted requires independent business and original-attachment readback.
   */
  async sendReservedVoucher(config: FinanceYouchengSystemConfig, secret: string | undefined, input: VoucherPreparationInput,
    identity: VoucherSubmissionIdentity, stopped: AbortSignal,
    limits: { maxEntries: number; maxBytes: number }, beforeSend: () => Promise<void>): Promise<VoucherSubmissionOutcome> {
    const payload = buildVoucherSubmission(input, identity, limits)
    const signal = AbortSignal.any([stopped, AbortSignal.timeout(this.timeoutMs)])
    let token: string
    try {
      signal.throwIfAborted()
      if (secret === undefined) return { state: 'not-sent', reason: 'preflight-failed' }
      token = await this.authenticate(config, secret, signal, limits.maxBytes)
      const accounts = await this.queryAccounts(config, secret, token, signal, undefined, limits.maxBytes)
      const matches = accounts.filter(account => account.id === config.accountCode && account.name === identity.accountName)
      if (matches.length !== 1 || accounts.filter(account => account.name === identity.accountName).length !== 1) {
        return { state: 'not-sent', reason: 'preflight-failed' }
      }
      await beforeSend()
      signal.throwIfAborted()
    } catch {
      return { state: 'not-sent', reason: signal.aborted ? 'cancelled' : 'preflight-failed' }
    }
    const url = new URL('/finance/certificate/createCertificate.rjson', this.urls[config.environment])
    url.searchParams.set('appKey', config.appKey)
    url.searchParams.set('accessToken', token)
    try {
      // Never use fetchRead here: its transient retry can duplicate an uncertain external write.
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload), signal, redirect: 'error' })
      const value = await this.readBoundedJson(response, limits.maxBytes)
      if ([config.appKey, secret, token].some(item => JSON.stringify(value).includes(item))) {
        return { state: 'outcome-unknown' }
      }
      return classifyVoucherSubmission(value, response.ok)
    } catch {
      return { state: 'outcome-unknown' }
    }
  }

  /**
   * Forget a client's token when its configuration or credential changes.
   * @param clientId - Credential owner.
   */
  invalidate(clientId: FinanceClientId): void { this.tokens.delete(clientId) }

  /**
   * Query one direction of open items using a verified saved ledger.
   * @param config - Saved connection, never model-supplied.
   * @param secret - Host credential.
   * @param query - Direction, periods and bounded page.
   * @param stopped - Caller and Host cancellation.
   * @param maxRows - Whole-page cap including summary markers.
   * @param maxBytes - Raw response and emitted result cap.
   * @returns Business records separated from totals; failures never become empty results.
   */
  async queryOpenItems(config: FinanceYouchengSystemConfig, secret: string | undefined, query: OpenItemQuery,
    stopped: AbortSignal, maxRows: number, maxBytes: number): Promise<OpenItemResult> {
    const selected = openItemQuerySchema.parse(query)
    return this.withOpenItemReader(config, secret, stopped, maxRows, maxBytes, read => read(selected))
  }

  /**
   * Read account attributes attached to existing open items on one explicit public page.
   * @param config - Host-selected ledger configuration.
   * @param secret - Host-only credential.
   * @param query - Explicit direction, period range and bounded page; no implicit history scan.
   * @param stopped - Caller and Host cancellation.
   * @param maxRows - Whole-page row cap.
   * @param maxBytes - Raw response and observation result cap.
   * @returns Page-scoped observations, never a complete directory or proof that an absent account does not exist.
   */
  async queryObservedOpenItemAccounts(config: FinanceYouchengSystemConfig, secret: string | undefined, query: OpenItemQuery,
    stopped: AbortSignal, maxRows: number, maxBytes: number): Promise<OpenItemAccountReferences> {
    let references: OpenItemAccountReferences | undefined
    await this.withOpenItemReader(config, secret, stopped, maxRows, maxBytes, read => read(openItemQuerySchema.parse(query)),
      (raw, page) => { references = projectOpenItemAccountReferences(raw, page, maxBytes) })
    if (references === undefined) throw new Error('公开往来账户属性未返回。')
    return references
  }

  /**
   * Prepare an existing-account proposal using an explicit public reference page and fresh counterparty/category reads.
   * @param config - Saved client-bound ledger connection.
   * @param secret - Host-only credential.
   * @param input - Validated business input with an explicit accountReferenceQuery; no implicit period scan.
   * @param stopped - Caller/Host cancellation.
   * @param maxRows - Reference and business-page row cap.
   * @param maxBytes - Whole response and resulting preview cap.
   * @returns Exact labels and source limitations for confirmation, not approval or authority to send.
   */
  async prepareOpenItem(config: FinanceYouchengSystemConfig, secret: string | undefined, input: OpenItemPreparationInput,
    stopped: AbortSignal, maxRows: number, maxBytes: number): Promise<{
    account: FinanceYouchengAccount
    input: OpenItemPreparationInput
    references: OpenItemReservedSelection
    accountObservation: OpenItemAccountObservation
    notice: string
  }> {
    if (input.accountReferenceQuery === undefined || input.accountReferenceQuery.direction !== input.direction) {
      throw new Error('往来准备必须明确同方向的账户来源查询页，不自动扩大查询期间或猜测账户。')
    }
    const signal = AbortSignal.any([stopped, AbortSignal.timeout(this.timeoutMs)])
    const accountReferences = await this.queryObservedOpenItemAccounts(config, secret,
      input.accountReferenceQuery, signal, maxRows, maxBytes)
    const account = { id: accountReferences.ledgerId, name: accountReferences.ledgerName }
    const accountObservation = resolveObservedOpenItemAccount(accountReferences, account, input.direction, input.accountId)
    const categories = await this.queryReferences(config, secret, { kind: 'cash-categories' }, signal, maxRows, maxBytes)
    if (categories.accountId !== account.id || categories.accountName !== account.name) throw new Error('往来类别查询期间账套已变化。')
    const selected = categories.rows.filter(row => row.id === input.categoryId)
    const category = selected[0]
    if (selected.length !== 1 || category === undefined || category.directionRaw !== (input.direction === 'receivable' ? '0' : '1')
      || category.name.length > 64 || categories.rows.filter(row => row.name === category.name).length !== 1) {
      throw new Error('往来收支类别不存在、不唯一、名称过长或方向不匹配。')
    }
    const auxiliaryCategories = await this.queryReferences(config, secret, { kind: 'auxiliary-categories' }, signal, maxRows, maxBytes)
    const { result: items, categoryId } = await this.readReferences(config, secret,
      { kind: 'auxiliary-items', categoryCode: input.auxiliaryCategoryCode }, signal, maxRows, maxBytes)
    const counterparty = resolveOpenItemCounterparty(input, account, auxiliaryCategories, items)
    if (categoryId !== counterparty.categoryId) throw new Error('往来辅助类别在查询期间已变化，请重新核对。')
    const references: OpenItemReservedSelection = { ledgerId: account.id, ledgerName: account.name, accountId: input.accountId,
      accountName: accountObservation.name, currencyCode: accountObservation.currencyCode,
      categoryId: input.categoryId, categoryName: category.name, counterparty }
    buildOpenItemSubmission(input, account.name, category.name, counterparty)
    const result = { account, input, references, accountObservation,
      notice: '仅本地往来预览，未创建、收付款或核销。账户属性来自所示期间及页码的已有往来记录，不是完整账户目录；未返回账户不代表不存在。当前仅核验本位币账户，不猜测外币或汇率。创建前须确认准确版本并重新核实来源与资料；可用日期由有成提交校验。' }
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > maxBytes) throw new Error('往来预览超过大小限制。')
    signal.throwIfAborted()
    return result
  }

  /**
   * Collect and analyze open items under one authentication and whole-operation deadline.
   * @param config - Saved ledger connection.
   * @param secret - Host credential.
   * @param query - Explicit direction, periods and grouping.
   * @param stopped - Caller and Host cancellation.
   * @param limits - Deployment collection and output limits.
   * @returns Count-reconciled local report, not an atomic vendor snapshot.
   */
  async analyzeOpenItems(config: FinanceYouchengSystemConfig, secret: string | undefined, query: OpenItemAnalysisQuery,
    stopped: AbortSignal, limits: { maxRows: number; maxBytes: number; pageSize: number }): Promise<OpenItemAnalysisResult> {
    const selected = openItemAnalysisSchema.parse(query)
    return this.withOpenItemReader(config, secret, stopped, limits.maxRows, limits.maxBytes,
      (read, signal) => analyzeOpenItems(selected, read, signal, limits))
  }

  /**
   * Find an accepted open item by ID within its original month and direction, without a write fallback.
   * @param config - Current saved connection for the reserved ledger.
   * @param secret - Host-only credential.
   * @param openItemId - Original accepted identifier, not a summary-based selection.
   * @param input - Immutable submitted values.
   * @param selection - Original verified ledger and reference labels.
   * @param stopped - Whole-operation cancellation.
   * @param limits - Total row, page-size and response-byte caps.
   * @returns Independent comparisons; unavailable or repeated pages never permit resubmission.
   */
  async querySubmittedOpenItem(config: FinanceYouchengSystemConfig, secret: string | undefined, openItemId: string,
    input: OpenItemPreparationInput, selection: OpenItemReadbackSelection, stopped: AbortSignal,
    limits: { maxRows: number; pageSize: number; maxBytes: number }): Promise<OpenItemReadback> {
    const unavailable: OpenItemReadback = { content: 'unavailable', associations: 'unavailable', balance: 'unavailable', complete: false }
    if (config.accountCode !== selection.ledgerId) return unavailable
    const seen = new Set<string>()
    let comparison = unavailable
    try {
      return await this.withOpenItemReader(config, secret, stopped, limits.maxRows, limits.maxBytes, async (read, signal) => {
        for (let page = 1; seen.size < limits.maxRows; page += 1) {
          signal.throwIfAborted()
          const pageSize = Math.min(limits.pageSize, limits.maxRows - seen.size)
          const result = await read({ direction: input.direction, periodStart: input.date.slice(0, 7),
            periodEnd: input.date.slice(0, 7), page, pageSize })
          if (result.rows.some(row => seen.has(row.id))) return unavailable
          for (const row of result.rows) seen.add(row.id)
          if (result.rows.some(row => row.id === openItemId)) return comparison
          if (result.rows.length < pageSize) return unavailable
        }
        return unavailable
      }, (raw, page) => { comparison = compareOpenItemReadback(page, raw, openItemId, input, selection) })
    } catch {
      // Only bounded query, projection and cancellation failures reach this read-only lookup.
      return unavailable
    }
  }

  /**
   * Inspect deletion evidence using the existing authenticated direction-specific reader; no mutation is sent.
   * @param config - Saved bound ledger and environment.
   * @param secret - Host-owned credential, never included in results.
   * @param selection - Exact direction and period range to retain for later comparisons.
   * @param openItemId - Exact receivable/payable record ID.
   * @param stopped - Whole-operation cancellation.
   * @param limits - Per-pass pages, rows and bytes, with fixed page size.
   * @returns Counted scoped evidence with explicit unverified deletion restrictions, not deletion permission.
   */
  async inspectOpenItemDeletion(config: FinanceYouchengSystemConfig, secret: string | undefined,
    selection: OpenItemDeletionSelection, openItemId: string, stopped: AbortSignal,
    limits: { maxPages: number; maxRows: number; maxBytes: number; pageSize: number }): Promise<OpenItemDeletionInventory> {
    let raw: unknown
    return this.withOpenItemReader(config, secret, stopped, limits.maxRows, limits.maxBytes,
      (read, signal) => collectOpenItemDeletionInventory(selection, openItemId,
        async query => ({ result: await read(query), raw }), signal, limits),
      (data) => { raw = data })
  }

  /**
   * Send one reserved receivable/payable deletion against unchanged direction-bound evidence.
   * @param config - Original saved ledger configuration, not model-supplied routing.
   * @param secret - Host-private credential.
   * @param inspection - Exact confirmed two-pass inventory; unknown constraints remain unknown.
   * @param stopped - Cancellation; failure after dispatch leaves the outcome uncertain.
   * @param limits - Bounded pages, rows, cumulative evidence bytes and page size.
   * @param beforeSend - Caller must qualify unresolved association risks, recheck saved configuration and exact-version
   * consent, then durably reserve the target and uncertain outcome. Rejection prevents dispatch; inspection is not consent.
   * @returns One transport observation, without retry, cascade requests or independent deletion verification.
   */
  async sendReservedOpenItemDeletion(config: FinanceYouchengSystemConfig, secret: string | undefined,
    inspection: OpenItemDeletionInventory, stopped: AbortSignal,
    limits: { maxPages: number; maxRows: number; maxBytes: number; pageSize: number },
    beforeSend: () => Promise<void>): Promise<OpenItemDeletionOutcome> {
    const saved = structuredClone(config)
    const approved = structuredClone(inspection)
    const signal = AbortSignal.any([stopped, AbortSignal.timeout(this.timeoutMs)])
    let token: string
    let body: string
    try {
      signal.throwIfAborted()
      const target = approved.target
      if (secret === undefined || saved.accountCode !== approved.accountId || target === undefined
        || target.accountId !== approved.accountId || target.accountName !== approved.accountName
        || target.direction !== approved.selection.direction || target.blockers.length > 0
        || !/^[1-9]\d*$/.test(target.row.id) || !Number.isSafeInteger(Number(target.row.id))) {
        return { state: 'not-sent', reason: 'preflight-failed' }
      }
      token = await this.authenticate(saved, secret, signal, limits.maxBytes)
      const fresh = await this.inspectOpenItemDeletion(saved, secret, approved.selection, target.row.id, signal, limits)
      if (JSON.stringify(fresh) !== JSON.stringify(approved)) return { state: 'not-sent', reason: 'preflight-failed' }
      const ledgers = await this.queryAccounts(saved, secret, token, signal, undefined, limits.maxBytes)
      const matches = ledgers.filter(ledger => ledger.name === approved.accountName)
      if (matches.length !== 1 || matches[0]?.id !== approved.accountId) return { state: 'not-sent', reason: 'preflight-failed' }
      body = JSON.stringify({ booksName: approved.accountName, managementId: Number(target.row.id) })
      await beforeSend()
      signal.throwIfAborted()
      if (JSON.stringify(config) !== JSON.stringify(saved) || JSON.stringify(inspection) !== JSON.stringify(approved)) {
        return { state: 'not-sent', reason: 'preflight-failed' }
      }
    } catch {
      // Only pre-dispatch authentication, evidence, reservation and cancellation failures reach this branch.
      return { state: 'not-sent', reason: signal.aborted ? 'cancelled' : 'preflight-failed' }
    }
    const url = new URL('/finance/cashier/account/management/delete.rjson', this.urls[saved.environment])
    url.searchParams.set('appKey', saved.appKey)
    url.searchParams.set('accessToken', token)
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body, signal, redirect: 'error' })
      const value = await this.readBoundedJson(response, limits.maxBytes)
      if ([saved.appKey, secret, token].some(item => JSON.stringify(value).includes(item))) return { state: 'outcome-unknown' }
      return classifyOpenItemDeletion(value, response.ok)
    } catch {
      // Dispatch may have reached Youcheng even when the response is lost, cancelled or invalid.
      return { state: 'outcome-unknown' }
    }
  }

  /**
   * Submit one reserved full received/paid settlement, retaining its response ID separately from journals.
   * @param config - Original Host-owned configuration.
   * @param secret - Private credential; never included in the outcome.
   * @param evidence - Validated intent and original authenticated target/cash references shown for confirmation.
   * @param stopped - Caller cancellation; a failure after dispatch is uncertain.
   * @param limits - Complete response/evidence bytes and bounded read rows.
   * @param beforeSend - Caller must qualify raw state, currency and known links, disclose unavailable period status, enforce
   * exact-version consent, recheck saved configuration and durably reserve. The callback must not send a business write.
   * @returns One transport observation; no partial settlement, guessed journalId, retry or bank-payment instruction.
   */
  async sendReservedOpenItemWriteOff(config: FinanceYouchengSystemConfig, secret: string | undefined,
    evidence: OpenItemWriteOffEvidence, stopped: AbortSignal,
    limits: { maxBytes: number; maxRows: number }, beforeSend: () => Promise<void>): Promise<OpenItemWriteOffOutcome> {
    const saved = structuredClone(config)
    const approved = structuredClone(evidence)
    const signal = AbortSignal.any([stopped, AbortSignal.timeout(this.timeoutMs)])
    let preflightStage: NonNullable<Extract<OpenItemWriteOffOutcome, { state: 'not-sent' }>['preflightStage']> = 'input'
    const notSent = (): OpenItemWriteOffOutcome => ({ state: 'not-sent',
      reason: signal.aborted ? 'cancelled' : 'preflight-failed', preflightStage })
    let token: string
    let body: string
    try {
      signal.throwIfAborted()
      const input = validateOpenItemWriteOff(approved.input, limits.maxBytes)
      const source = approved.source
      const cashAccounts = approved.cashAccounts
      if (secret === undefined || approved.businessAccountId === undefined
        || source.accountId !== saved.accountCode || cashAccounts.accountId !== source.accountId
        || cashAccounts.accountName !== source.accountName || cashAccounts.kind !== 'cash-accounts'
        || Buffer.byteLength(JSON.stringify(approved)) > limits.maxBytes) return notSent()
      selectOpenItemWriteOffTarget(input, source, { id: source.accountId, name: source.accountName })
      preflightStage = 'cash-account'
      const matches = cashAccounts.rows.filter(row => row.id === input.cashAccountId)
      const cash = matches[0]
      if (matches.length !== 1 || cash?.status !== 'enabled' || !cash.currencyId) {
        return notSent()
      }
      preflightStage = 'authentication'
      token = await this.authenticate(saved, secret, signal, limits.maxBytes)
      preflightStage = 'source-read'
      const fresh = await this.queryOpenItemWriteOffSource(saved, secret, input, signal, limits)
      preflightStage = 'cash-read'
      const references = await this.queryReferences(saved, secret, { kind: 'cash-accounts' }, signal, limits.maxRows, limits.maxBytes)
      preflightStage = 'evidence-comparison'
      if (fresh.businessAccountId !== approved.businessAccountId || JSON.stringify(fresh.source) !== JSON.stringify(source)
        || JSON.stringify(references) !== JSON.stringify(cashAccounts)) {
        return notSent()
      }
      preflightStage = 'ledger-read'
      const ledgers = await this.queryAccounts(saved, secret, token, signal, undefined, limits.maxBytes)
      preflightStage = 'ledger-identity'
      const named = ledgers.filter(ledger => ledger.name === source.accountName)
      if (named.length !== 1 || named[0]?.id !== source.accountId) return notSent()
      body = JSON.stringify({ booksName: source.accountName, direction: input.direction === 'payable', money: Number(input.amount),
        accountManagementId: Number(input.openItemId), accountId: Number(input.cashAccountId), date: input.date,
        resource: 1, type: 1, keeperName: input.keeperName })
      preflightStage = 'final-confirmation'
      await beforeSend()
      signal.throwIfAborted()
      preflightStage = 'request-integrity'
      if (JSON.stringify(config) !== JSON.stringify(saved) || JSON.stringify(evidence) !== JSON.stringify(approved)) {
        return notSent()
      }
    } catch {
      // Authentication, fresh evidence, reservation or cancellation failed before the write request.
      return notSent()
    }
    const url = new URL('/finance/cashier/account/management/writeOff.rjson', this.urls[saved.environment])
    url.searchParams.set('appKey', saved.appKey)
    url.searchParams.set('accessToken', token)
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body, signal, redirect: 'error' })
      const value = await this.readBoundedJson(response, limits.maxBytes)
      if ([saved.appKey, secret, token].some(item => JSON.stringify(value).includes(item))) return { state: 'outcome-unknown' }
      return classifyOpenItemWriteOff(value, response.ok)
    } catch {
      // The write may have reached Youcheng; response loss, cancellation and invalid bytes never authorize retry.
      return { state: 'outcome-unknown' }
    }
  }

  /**
   * Read the receipt-linked journal without substituting its ID or sending another settlement.
   * @param config - Saved configuration belonging to the original source ledger.
   * @param secret - Host-private credential.
   * @param evidence - Original validated intent and source, never an already-settled substitute.
   * @param receiptId - Accepted receipt retained from the original send.
   * @param stopped - Whole-readback cancellation.
   * @param limits - Accumulated monthly business-row and byte bounds.
   * @returns Matched relation, conflicting content or unavailable evidence; failed reads never permit retrying the write.
   */
  async queryWriteOffJournalLink(config: FinanceYouchengSystemConfig, secret: string | undefined,
    evidence: { input: OpenItemWriteOffInput; source: OpenItemResult }, receiptId: OpenItemWriteOffReceiptId,
    stopped: AbortSignal, limits: { maxRows: number; maxBytes: number }): Promise<WriteOffJournalLink> {
    const saved = structuredClone(config)
    const approved = structuredClone(evidence)
    const signal = AbortSignal.any([stopped, AbortSignal.timeout(this.timeoutMs)])
    try {
      if (secret === undefined || saved.accountCode !== approved.source.accountId) return { state: 'unavailable' }
      const result = await collectWriteOffJournalLink(approved.input, approved.source, receiptId,
        query => this.queryJournalPage(saved, secret, query, signal, limits.maxRows, limits.maxBytes), signal, limits)
      if (JSON.stringify(config) !== JSON.stringify(saved) || JSON.stringify(evidence) !== JSON.stringify(approved)) {
        return { state: 'unavailable' }
      }
      return result
    } catch {
      // Failed, cancelled or incomplete reads cannot certify linkage or release the original send intent.
      return { state: 'unavailable' }
    }
  }

  /**
   * Read an exact eligible projected target and its business-account identity from the same response.
   * @param config - Host-owned destination configuration.
   * @param secret - Private authentication credential.
   * @param input - Validated full-settlement intent with its original query scope.
   * @param stopped - Caller cancellation.
   * @param limits - Complete response byte and projected row bounds.
   * @returns Source page and raw business-account ID; no period/currency qualification or dispatch authority.
   */
  async queryOpenItemWriteOffSource(config: FinanceYouchengSystemConfig, secret: string | undefined,
    input: OpenItemWriteOffInput, stopped: AbortSignal, limits: { maxBytes: number; maxRows: number }):
  Promise<{ source: OpenItemResult; businessAccountId: Branded<'FinanceReferenceId'> }> {
    let businessAccountId: Branded<'FinanceReferenceId'> | undefined
    const source = await this.withOpenItemReader(config, secret, stopped, limits.maxRows, limits.maxBytes,
      read => read(input.sourceQuery), (data, page) => { businessAccountId = readOpenItemWriteOffBusinessAccount(data, page, input) })
    if (businessAccountId === undefined) throw new Error('核销目标缺少业务账户身份。')
    selectOpenItemWriteOffTarget(input, source, { id: source.accountId, name: source.accountName })
    return { source, businessAccountId }
  }

  /**
   * Observe the original source page and raw identity after a possible settlement without qualifying another send.
   * @param config - Original Host configuration.
   * @param secret - Private authentication credential.
   * @param input - Original intent and source query, not rewritten from settled balances.
   * @param stopped - Caller cancellation.
   * @param limits - Complete response byte and row bounds.
   * @returns Source and independently available identity; missing identity does not discard valid projected content.
   */
  async queryOpenItemWriteOffReadback(config: FinanceYouchengSystemConfig, secret: string | undefined,
    input: OpenItemWriteOffInput, stopped: AbortSignal, limits: { maxBytes: number; maxRows: number }):
  Promise<{ source: OpenItemResult; businessAccountId: Branded<'FinanceReferenceId'> | undefined }> {
    let businessAccountId: Branded<'FinanceReferenceId'> | undefined
    const source = await this.withOpenItemReader(config, secret, stopped, limits.maxRows, limits.maxBytes,
      read => read(input.sourceQuery), (data, page) => { businessAccountId = readOpenItemWriteOffIdentity(data, page, input.openItemId) })
    return { source, businessAccountId }
  }

  private async withOpenItemReader<T>(config: FinanceYouchengSystemConfig, secret: string | undefined,
    stopped: AbortSignal, maxRows: number, maxBytes: number,
    run: (read: (query: OpenItemQuery) => Promise<OpenItemResult>, signal: AbortSignal) => Promise<T>,
    observe?: (data: unknown, page: OpenItemResult) => void): Promise<T> {
    let stage = '认证'
    try {
      if (secret === undefined) throw new CheckFailure('credentials-missing')
      const signal = AbortSignal.any([stopped, AbortSignal.timeout(this.timeoutMs)])
      const token = await this.authenticate(config, secret, signal, maxBytes)
      stage = '账套核验'
      const ledgers = await this.queryAccounts(config, secret, token, signal, undefined, maxBytes)
      const matches = ledgers.filter(item => item.id === config.accountCode)
      const account = matches[0]
      if (matches.length !== 1 || account === undefined) throw new CheckFailure('account-unavailable')
      const ledgerId = Number(account.id)
      if (!Number.isSafeInteger(ledgerId) || ledgerId <= 0) throw new CheckFailure('account-unavailable')
      const url = new URL('/finance/cashjournal/getCashierList', this.urls[config.environment])
      url.searchParams.set('appKey', config.appKey)
      url.searchParams.set('accessToken', token)
      const result = await run(async (query) => {
        const selected = openItemQuerySchema.parse(query)
        stage = '应收应付请求'
        const data = await this.request(url, { setOfBooksId: ledgerId,
          direction: selected.direction === 'receivable' ? 0 : 1,
          periodNumberStart: selected.periodStart, periodNumberEnd: selected.periodEnd,
          page: selected.page, pageSize: selected.pageSize }, signal, 'account-query', maxBytes)
        stage = '应收应付校验'
        if ([config.appKey, secret, token].some(value => JSON.stringify({ data }).includes(value))) throw new CheckFailure('invalid-response')
        const projected = projectOpenItems(data, selected, account, maxRows, maxBytes)
        observe?.(data, projected)
        return projected
      }, signal)
      signal.throwIfAborted()
      return result
    } catch (error) {
      if (stopped.aborted) throw new Error('应收应付查询已取消。')
      if (error instanceof OpenItemGroupingError) throw error
      const reason = error instanceof CheckFailure ? error.message : error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'invalid-response'
      throw new Error(`有成应收应付查询失败（${reason}；阶段：${stage}）。本次未取得有效结果，不代表没有往来；不要通过文件搜索或索取密钥代替查询。`)
    }
  }

  /**
   * Read a dated journal page after validating the saved ledger and optional cash account.
   * @param config - Saved connection, not model-supplied.
   * @param secret - Host credential.
   * @param query - Period, dates, page and optional cash-account ID.
   * @param stopped - Caller and Host cancellation.
   * @param maxRows - Whole result and cash-account list cap.
   * @param maxBytes - Raw response and emitted result cap.
   * @returns Bounded journal page with explicit completeness limitations.
   */
  async queryJournals(config: FinanceYouchengSystemConfig, secret: string | undefined, query: JournalQuery,
    stopped: AbortSignal, maxRows: number, maxBytes: number): Promise<JournalResult> {
    return (await this.queryJournalPage(config, secret, query, stopped, maxRows, maxBytes)).result
  }

  /**
   * Inspect a journal using two counted inventories without granting deletion authority.
   * @param config - Saved ledger identity; no destination override is accepted.
   * @param secret - Host-private credential.
   * @param selection - One full month and optional verified cash account.
   * @param journalId - Exact target ID.
   * @param stopped - Whole-operation cancellation.
   * @param limits - Bounded pages, rows, accumulated bytes and page size.
   * @returns Stable monthly evidence, not proof of global absence, balance impact or authorization.
   */
  async inspectJournalDeletion(config: FinanceYouchengSystemConfig, secret: string | undefined,
    selection: { month: string; cashAccountId?: string }, journalId: string, stopped: AbortSignal,
    limits: { maxPages: number; maxRows: number; maxBytes: number; pageSize: number }): Promise<JournalDeletionInventory> {
    const signal = AbortSignal.any([stopped, AbortSignal.timeout(this.timeoutMs)])
    return collectJournalDeletionInventory(selection, journalId,
      query => this.queryJournalPage(config, secret, query, signal, limits.maxRows, limits.maxBytes), signal, limits)
  }

  /**
   * Send one journal delete only after the caller has durably reserved an explicitly confirmed target.
   * @param config - Original saved ledger configuration.
   * @param secret - Host-private credential.
   * @param inspection - Approved two-pass evidence, including the exact target and original month.
   * @param stopped - Caller cancellation; loss after dispatch is uncertain.
   * @param limits - Bounded reads and response limits.
   * @param beforeSend - Caller-owned final configuration/authority check; rejection or changed evidence prevents dispatch.
   * @returns Single transport observation; never retries, deletes a related voucher or claims independent verification.
   */
  async sendReservedJournalDeletion(config: FinanceYouchengSystemConfig, secret: string | undefined,
    inspection: JournalDeletionInventory, stopped: AbortSignal,
    limits: { maxPages: number; maxRows: number; maxBytes: number; pageSize: number },
    beforeSend: () => Promise<void>): Promise<JournalDeletionOutcome> {
    const saved = structuredClone(config)
    const approved = structuredClone(inspection)
    const signal = AbortSignal.any([stopped, AbortSignal.timeout(this.timeoutMs)])
    let token: string
    let body: string
    try {
      signal.throwIfAborted()
      const target = approved.target
      if (secret === undefined || saved.accountCode !== approved.accountId || target === undefined
        || target.accountId !== approved.accountId || target.accountName !== approved.accountName
        || target.blockers.length > 0 || !Number.isSafeInteger(Number(target.row.id))) {
        return { state: 'not-sent', reason: 'preflight-failed' }
      }
      token = await this.authenticate(saved, secret, signal, limits.maxBytes)
      const fresh = await this.inspectJournalDeletion(saved, secret, approved.selection, target.row.id, signal, limits)
      if (JSON.stringify(fresh) !== JSON.stringify(approved)) return { state: 'not-sent', reason: 'preflight-failed' }
      body = JSON.stringify({ id: Number(target.row.id), accountName: approved.accountName })
      await beforeSend()
      signal.throwIfAborted()
      if (JSON.stringify(config) !== JSON.stringify(saved) || JSON.stringify(inspection) !== JSON.stringify(approved)) {
        return { state: 'not-sent', reason: 'preflight-failed' }
      }
    } catch {
      return { state: 'not-sent', reason: signal.aborted ? 'cancelled' : 'preflight-failed' }
    }
    const url = new URL('/finance/cashjournal/delete.rjson', this.urls[saved.environment])
    url.searchParams.set('appKey', saved.appKey)
    url.searchParams.set('accessToken', token)
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body, signal, redirect: 'error' })
      const value = await this.readBoundedJson(response, limits.maxBytes)
      if ([saved.appKey, secret, token].some(item => JSON.stringify(value).includes(item))) return { state: 'outcome-unknown' }
      return classifyJournalDeletion(value, response.ok)
    } catch {
      // A failed response after dispatch does not establish whether this exact journal was removed.
      return { state: 'outcome-unknown' }
    }
  }

  private async queryJournalPage(config: FinanceYouchengSystemConfig, secret: string | undefined, query: JournalQuery,
    stopped: AbortSignal, maxRows: number, maxBytes: number): Promise<JournalDeletionPage> {
    const selected = resolveJournalQuery(query)
    let stage = '认证'
    try {
      if (secret === undefined) throw new CheckFailure('credentials-missing')
      const signal = AbortSignal.any([stopped, AbortSignal.timeout(this.timeoutMs)])
      const token = await this.authenticate(config, secret, signal, maxBytes)
      stage = '账套核验'
      const ledgers = await this.queryAccounts(config, secret, token, signal, undefined, maxBytes)
      const matches = ledgers.filter(item => item.id === config.accountCode)
      const account = matches[0]
      if (matches.length !== 1 || account === undefined || ledgers.filter(item => item.name === account.name).length !== 1) {
        throw new CheckFailure('account-unavailable')
      }
      const read = async (path: string, body: object): Promise<z.infer<typeof envelope>> => {
        const url = new URL(path, this.urls[config.environment])
        url.searchParams.set('appKey', config.appKey)
        url.searchParams.set('accessToken', token)
        const data = await this.requestEnvelope(url, body, signal, 'account-query', maxBytes)
        if ([config.appKey, secret, token].some(value => JSON.stringify({ data }).includes(value))) throw new CheckFailure('invalid-response')
        return data
      }
      let cashAccountId: number | undefined
      if (selected.cashAccountId !== undefined) {
        stage = '出纳账户核验'
        cashAccountId = Number(selected.cashAccountId)
        if (!Number.isSafeInteger(cashAccountId)) throw new CheckFailure('account-unavailable')
        const { data } = await read('/finance/cashjournal/getAccountList.rjson', { setOfBooksId: account.id, sobName: account.name })
        const cashAccounts = z.array(z.object({
          accountId: z.union([z.string(), z.number().int().max(Number.MAX_SAFE_INTEGER)]),
        })).parse(data)
        if (cashAccounts.length > maxRows || cashAccounts.filter(item => String(item.accountId) === selected.cashAccountId).length !== 1) {
          throw new CheckFailure('account-unavailable')
        }
      }
      stage = '日记账请求'
      const response = await read('/finance/cashjournal/getListPage.rjson', {
        accountName: account.name, periodNumber: selected.month, dateStart: selected.dateStart, dateEnd: selected.dateEnd,
        page: selected.page, pageSize: selected.pageSize,
        ...cashAccountId === undefined ? {} : { subjectId: cashAccountId },
      })
      stage = '日记账校验'
      const result = projectJournals(response.data, selected, account, maxRows, maxBytes)
      signal.throwIfAborted()
      return { result, raw: response.data, totalCount: response.count }
    } catch (error) {
      if (stopped.aborted) throw new Error('日记账查询已取消。')
      const reason = error instanceof CheckFailure ? error.message : error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'invalid-response'
      throw new Error(`有成日记账查询失败（${reason}；阶段：${stage}）。本次未取得有效结果，不代表没有流水；不要通过文件搜索或索取密钥代替查询。`)
    }
  }

  /**
   * Find and compare an accepted journal under bounded pagination without any write fallback.
   * @param config - Saved original ledger configuration.
   * @param secret - Host-private credential.
   * @param journalId - Accepted original journal ID.
   * @param input - Durable exact proposal.
   * @param selection - Approved reference identities and labels.
   * @param previousId - Reserved predecessor.
   * @param stopped - Whole operation cancellation.
   * @param limits - Total business-row cap, page size and response/output byte limit.
   * @returns Matched, mismatched or unavailable readback; not-found pages never authorize resending.
   */
  async querySubmittedJournal(config: FinanceYouchengSystemConfig, secret: string | undefined, journalId: string,
    input: JournalPreparationInput, selection: JournalReferenceSelection, previousId: string, stopped: AbortSignal,
    limits: { maxRows: number; pageSize: number; maxBytes: number }): Promise<JournalReadback> {
    const unavailable: JournalReadback = { content: 'unavailable', associations: 'unavailable', complete: false }
    if (config.accountCode !== selection.accountId) return unavailable
    const signal = AbortSignal.any([stopped, AbortSignal.timeout(this.timeoutMs)])
    const seen = new Set<string>()
    try {
      for (let page = 1; seen.size < limits.maxRows; page += 1) {
        signal.throwIfAborted()
        const pageSize = Math.min(limits.pageSize, limits.maxRows - seen.size)
        const { result, raw } = await this.queryJournalPage(config, secret,
          { month: input.date.slice(0, 7), dateStart: input.date, dateEnd: input.date, cashAccountId: input.cashAccountId,
            page, pageSize }, signal, limits.maxRows, limits.maxBytes)
        if (result.rows.some(row => seen.has(row.id))) return unavailable
        for (const row of result.rows) seen.add(row.id)
        if (result.rows.some(row => row.id === journalId)) {
          return compareJournalReadback(result, raw, journalId, input, selection, previousId)
        }
        if (result.rows.length < pageSize) return unavailable
      }
    } catch {
      // Only bounded query, projection and cancellation failures reach this read-only comparison.
      return unavailable
    }
    return unavailable
  }

  /**
   * Reconcile one account's paginated journals under a whole-operation deadline.
   * @param config - Saved connection, never model-supplied.
   * @param secret - Host credential.
   * @param query - One explicit account and one or two month-bounded date ranges.
   * @param stopped - Caller and Host cancellation.
   * @param limits - Deployment collection and output limits.
   * @returns Same-currency totals and differences; failures never produce partial aggregates.
   */
  async analyzeJournals(config: FinanceYouchengSystemConfig, secret: string | undefined, query: JournalAnalysisQuery,
    stopped: AbortSignal, limits: { maxRows: number; maxBytes: number; pageSize: number }): Promise<JournalAnalysisResult> {
    const selected = journalAnalysisSchema.parse(query)
    const signal = AbortSignal.any([stopped, AbortSignal.timeout(this.timeoutMs)])
    return analyzeJournals(selected,
      page => this.queryJournals(config, secret, page, signal, limits.maxRows, limits.maxBytes), signal, limits)
  }

  /**
   * Read a bounded balance report using a verified saved ledger ID.
   * @param config - Saved connection, never model-supplied.
   * @param secret - Host credential.
   * @param query - Inclusive accounting periods.
   * @param stopped - Caller and Host cancellation.
   * @param maxRows - Requested and accepted row cap including summaries.
   * @param maxBytes - Raw response and emitted result cap.
   * @returns Report with explicit limitations; vendor failures never become empty reports.
   */
  async queryBalances(config: FinanceYouchengSystemConfig, secret: string | undefined, query: BalanceQuery,
    stopped: AbortSignal, maxRows: number, maxBytes: number): Promise<BalanceResult> {
    const selected = balanceQuerySchema.parse(query)
    let stage = '认证'
    try {
      if (secret === undefined) throw new CheckFailure('credentials-missing')
      const signal = AbortSignal.any([stopped, AbortSignal.timeout(this.timeoutMs)])
      const token = await this.authenticate(config, secret, signal, maxBytes)
      stage = '账套核验'
      const ledgers = await this.queryAccounts(config, secret, token, signal, undefined, maxBytes)
      const matches = ledgers.filter(item => item.id === config.accountCode)
      const account = matches[0]
      if (matches.length !== 1 || account === undefined) throw new CheckFailure('account-unavailable')
      const ledgerId = Number(account.id)
      if (!/^\d+$/.test(account.id) || !Number.isSafeInteger(ledgerId) || ledgerId <= 0) throw new CheckFailure('account-unavailable')
      stage = '余额表请求'
      const url = new URL('/finance/subject/getList.rjson', this.urls[config.environment])
      url.searchParams.set('appKey', config.appKey)
      url.searchParams.set('accessToken', token)
      if (selected.subjectLevel !== undefined && selected.subjectLevelEnd !== undefined) {
        return await readBalanceTree(
          { ...selected, subjectLevel: selected.subjectLevel, subjectLevelEnd: selected.subjectLevelEnd }, account,
          async (level, parentSubjectId) => {
            const data = await this.request(url, {
              setOfBooksId: ledgerId, periodNumber: selected.month, periodNumber2: selected.monthEnd ?? selected.month,
              subjectLevelStart: level, subjectLevelEnd: level, pageNo: 1, pageSize: maxRows,
              isNeedPage: false, currency: true, displayDisableSubject: true,
              ...parentSubjectId === undefined ? {} : { parentSubjectId },
            }, signal, 'account-query', maxBytes)
            if ([config.appKey, secret, token].some(value => JSON.stringify({ data }).includes(value))) throw new CheckFailure('invalid-response')
            return data
          }, signal, maxRows, maxBytes)
      }
      const data = await this.request(url, {
        setOfBooksId: ledgerId, periodNumber: selected.month, periodNumber2: selected.monthEnd ?? selected.month,
        ...selected.subjectLevel === undefined ? {} : {
          subjectLevelStart: selected.subjectLevel, subjectLevelEnd: selected.subjectLevelEnd ?? selected.subjectLevel,
        },
        pageNo: 1, pageSize: maxRows, isNeedPage: selected.subjectLevelEnd === undefined,
        ...selected.subjectLevelEnd === undefined ? {} : { currency: true, displayDisableSubject: true },
      }, signal, 'account-query', maxBytes)
      stage = '余额表校验'
      if ([config.appKey, secret, token].some(value => JSON.stringify({ data }).includes(value))) throw new CheckFailure('invalid-response')
      const result = projectBalances(data, selected, account, maxRows, maxBytes)
      signal.throwIfAborted()
      return result
    } catch (error) {
      if (stopped.aborted) throw new Error('科目余额表查询已取消。')
      const reason = error instanceof CheckFailure ? error.message : error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'invalid-response'
      throw new Error(`有成科目余额表查询失败（${reason}；阶段：${stage}）。本次未取得有效结果，不代表没有余额；不要通过文件搜索或索取密钥代替查询。`)
    }
  }

  /**
   * Read one voucher from the saved, uniquely authorized ledger.
   * @param config - Saved connection, never model-supplied.
   * @param secret - Host credential.
   * @param voucherId - Exact requested voucher ID.
   * @param stopped - Caller and Host cancellation.
   * @param maxBytes - Raw response and complete result cap.
   * @returns Identity-checked detail; failures contain no vendor body or credentials.
   */
  async queryVoucherDetail(config: FinanceYouchengSystemConfig, secret: string | undefined, voucherId: string,
    stopped: AbortSignal, maxBytes: number): Promise<VoucherDetail> {
    return this.withVoucherDetail(config, secret, voucherId, stopped, maxBytes, (_data, detail) => detail)
  }

  /**
   * Inspect deletion-relevant raw fields through the same authenticated, ledger-bound detail read.
   * @param config - Saved connection, never a model-selected destination.
   * @param secret - Host-only credential.
   * @param voucherId - Exact target ID, checked against the returned identity.
   * @param stopped - Caller and Host cancellation.
   * @param maxBytes - Complete raw response and inspection size cap.
   * @returns Read-only state and change fingerprint, without approval, deletion or absence inference.
   */
  async inspectVoucherDeletion(config: FinanceYouchengSystemConfig, secret: string | undefined, voucherId: string,
    stopped: AbortSignal, maxBytes: number): Promise<VoucherDeletionInspection> {
    return this.withVoucherDetail(config, secret, voucherId, stopped, maxBytes,
      (data, detail) => inspectVoucherDeletion(data, voucherId, { id: detail.accountId, name: detail.accountName }, maxBytes))
  }

  /**
   * Send one reserved deletion without transport retries; does not prove that the voucher disappeared.
   * @param config - Current saved ledger configuration.
   * @param secret - Host credential.
   * @param payload - Host-derived ledger name and one target, never model arguments.
   * @param inspection - Exact previewed state; fresh differences and caller changes before dispatch prevent sending.
   * @param stopped - Caller and Host cancellation.
   * @param maxBytes - Complete request, response and inspection cap.
   * @param beforeSend - Final Host configuration/cancellation check; caller must already hold a confirmed durable target reservation.
   * @returns One transport outcome; cancellation after dispatch remains unknown and cannot permit resending.
   */
  async sendReservedVoucherDeletion(config: FinanceYouchengSystemConfig, secret: string | undefined,
    payload: VoucherDeletionPayload, inspection: VoucherDeletionInspection, stopped: AbortSignal, maxBytes: number,
    beforeSend: () => Promise<void>): Promise<VoucherDeletionOutcome> {
    const saved = structuredClone(config)
    const approved = structuredClone(inspection)
    const originalPayload = structuredClone(payload)
    const signal = AbortSignal.any([stopped, AbortSignal.timeout(this.timeoutMs)])
    let token: string
    let body: string
    try {
      signal.throwIfAborted()
      if (secret === undefined || approved.detail.accountId !== saved.accountCode
        || originalPayload.accountName !== approved.detail.accountName
        || originalPayload.cerInfoList[0].cerId !== approved.detail.voucherId || approved.blockers.length > 0) {
        return { state: 'not-sent', reason: 'preflight-failed' }
      }
      body = JSON.stringify(originalPayload)
      if (Buffer.byteLength(body, 'utf8') > maxBytes) return { state: 'not-sent', reason: 'preflight-failed' }
      token = await this.authenticate(saved, secret, signal, maxBytes)
      const fresh = await this.inspectVoucherDeletion(saved, secret, approved.detail.voucherId, signal, maxBytes)
      if (fresh.fingerprint !== approved.fingerprint || fresh.detail.accountName !== originalPayload.accountName
        || fresh.blockers.length > 0) return { state: 'not-sent', reason: 'preflight-failed' }
      await beforeSend()
      signal.throwIfAborted()
      if (JSON.stringify(config) !== JSON.stringify(saved) || JSON.stringify(inspection) !== JSON.stringify(approved)
        || JSON.stringify(payload) !== body) return { state: 'not-sent', reason: 'preflight-failed' }
    } catch {
      return { state: 'not-sent', reason: signal.aborted ? 'cancelled' : 'preflight-failed' }
    }
    const url = new URL('/finance/certificate/delCertificate.rjson', this.urls[saved.environment])
    url.searchParams.set('appKey', saved.appKey)
    url.searchParams.set('accessToken', token)
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body, signal, redirect: 'error' })
      const value = await this.readBoundedJson(response, maxBytes)
      if ([saved.appKey, secret, token].some(item => JSON.stringify(value).includes(item))) return { state: 'outcome-unknown' }
      return classifyVoucherDeletion(value, response.ok)
    } catch {
      // A transport error after dispatch cannot establish that the vendor did not delete the voucher.
      return { state: 'outcome-unknown' }
    }
  }

  private async withVoucherDetail<T>(config: FinanceYouchengSystemConfig, secret: string | undefined, voucherId: string,
    stopped: AbortSignal, maxBytes: number, project: (data: unknown, detail: VoucherDetail) => T): Promise<T> {
    validateVoucherId(voucherId)
    try {
      if (secret === undefined) throw new CheckFailure('credentials-missing')
      const signal = AbortSignal.any([stopped, AbortSignal.timeout(this.timeoutMs)])
      const token = await this.authenticate(config, secret, signal, maxBytes)
      const ledgers = await this.queryAccounts(config, secret, token, signal, undefined, maxBytes)
      const matches = ledgers.filter(item => item.id === config.accountCode)
      const account = matches[0]
      if (matches.length !== 1 || account === undefined || ledgers.filter(item => item.name === account.name).length !== 1) {
        throw new CheckFailure('account-unavailable')
      }
      const url = new URL('/finance/certificate/info.rjson', this.urls[config.environment])
      url.searchParams.set('appKey', config.appKey)
      url.searchParams.set('accessToken', token)
      const data = await this.request(url, { accountName: account.name, certificateId: voucherId }, signal, 'account-query', maxBytes)
      if ([config.appKey, secret, token].some(value => JSON.stringify({ data }).includes(value))) throw new CheckFailure('invalid-response')
      const result = projectVoucherDetail(data, voucherId, account, maxBytes)
      signal.throwIfAborted()
      return project(data, result)
    } catch (error) {
      if (stopped.aborted) throw new Error('凭证详情查询已取消。')
      const reason = error instanceof CheckFailure ? error.message : 'invalid-response'
      throw new Error(`有成凭证详情查询失败（${reason}）；失败不等于凭证不存在，请核对连接和凭证 ID。`)
    }
  }

  /**
   * Read back an accepted ID without sending or retrying a creation request.
   * @param config - Current saved connection; must still match the reserved account ID.
   * @param secret - Host-only credential.
   * @param reserved - Captured destination and proposal, plus the accepted identifier.
   * @param stopped - Caller and Host cancellation.
   * @param maxBytes - Read response and projection byte cap.
   * @param originals - Selected upload receipts and trusted download policy, when copy verification is requested.
   * @returns Accounting, auxiliary, currency and original-copy evidence; complete covers this voucher,
   *   not invoice authenticity or project acceptance.
   */
  async querySubmittedVoucher(config: FinanceYouchengSystemConfig, secret: string | undefined,
    reserved: { accountId: string; accountName: string; voucherId: string; input: VoucherPreparationInput },
    stopped: AbortSignal, maxBytes: number,
    originals?: { expected: readonly VoucherOriginalIdentity[]; options: VoucherOriginalVerificationOptions }): Promise<{
    accounting: 'matched' | 'mismatch'
    auxiliary: 'matched' | 'mismatch' | 'unavailable'
    currency: 'matched' | 'mismatch' | 'unavailable'
    originals?: VoucherOriginalVerification
    complete: boolean
  }> {
    if (config.accountCode !== reserved.accountId) throw new Error('回查账套与已保存提交记录不一致。')
    return this.withVoucherDetail(config, secret, reserved.voucherId, stopped, maxBytes, async (data, detail) => {
      const accounting = matchesVoucherAccounting(detail, reserved.input,
        { id: reserved.accountId, name: reserved.accountName }, reserved.voucherId) ? 'matched' : 'mismatch'
      const copies = originals === undefined || accounting !== 'matched' ? undefined
        : await verifyVoucherOriginals(data, originals.expected, originals.options, stopped)
      const auxiliary = compareVoucherAuxiliary(data, detail, reserved.input)
      const currency = compareVoucherCurrency(data, detail, reserved.input)
      const complete = accounting === 'matched' && auxiliary === 'matched' && currency === 'matched'
        && originals?.expected.length === reserved.input.sourcePaths.length
        && (copies?.association === 'not-required' || (copies?.association === 'matched' && copies.retention === 'verified'))
      return { accounting, auxiliary, currency, ...copies === undefined ? {} : { originals: copies }, complete }
    })
  }

  /**
   * Read reference data for one verified ledger, never create missing records.
   * @param config - Saved ledger and application identity.
   * @param secret - Host-only credential.
   * @param query - Kind and exact local filters.
   * @param stopped - Caller/Host cancellation.
   * @param maxRows - Requested and accepted row cap, not a verified vendor page size.
   * @param maxBytes - Response and complete result byte cap.
   * @returns Validated rows; complete vendor coverage is not asserted.
   */
  async queryReferences(config: FinanceYouchengSystemConfig, secret: string | undefined, query: ReferenceQuery,
    stopped: AbortSignal, maxRows: number, maxBytes: number): Promise<ReferenceResult> {
    return (await this.readReferences(config, secret, query, stopped, maxRows, maxBytes)).result
  }

  /**
   * Independently compare the reserved code in its original ledger; this method never creates or retries a write.
   * @param config - Current Host configuration, checked against the reserved ledger before reading.
   * @param secret - Host-only credential.
   * @param proposal - Original persisted values, not rewritten to match the returned record.
   * @param selection - Original ledger and parent/category identity.
   * @param stopped - Caller and Host cancellation.
   * @param maxRows - Accepted reference row cap.
   * @param maxBytes - Each response and projection byte cap.
   * @returns Content comparison; auxiliary status remains unverified even when its code/name match.
   */
  async querySubmittedMasterData(config: FinanceYouchengSystemConfig, secret: string | undefined,
    proposal: MasterDataProposal, selection: MasterDataSelection, stopped: AbortSignal,
    maxRows: number, maxBytes: number): Promise<SubjectReadback | AuxiliaryReadback> {
    if (config.accountCode !== selection.accountId || proposal.kind !== selection.kind) throw new Error('基础资料回查目标不一致。')
    if (proposal.kind === 'subject' && selection.kind === 'subject') {
      const { result, data } = await this.readReferences(config, secret, { kind: 'subjects', code: proposal.input.subjectCode },
        stopped, maxRows, maxBytes)
      return compareSubjectReadback(result, data, proposal.input, selection)
    }
    if (proposal.kind === 'auxiliary-item' && selection.kind === 'auxiliary-item') {
      const { result, categoryId } = await this.readReferences(config, secret,
        { kind: 'auxiliary-items', categoryCode: proposal.input.categoryCode, code: proposal.input.itemCode }, stopped, maxRows, maxBytes)
      if (categoryId !== selection.categoryId) return { content: 'mismatch', status: 'unavailable', complete: false }
      return compareAuxiliaryReadback(result, proposal.input, selection)
    }
    throw new Error('基础资料回查类型不一致。')
  }

  /**
   * Resolve a proposal against fresh, unfiltered references for confirmation and immediately-before-send checks.
   * @param config - Host-selected ledger configuration.
   * @param secret - Host-only credential.
   * @param proposal - Explicit validated business values.
   * @param stopped - Caller and Host cancellation.
   * @param maxRows - Reference row cap; returned coverage remains unverified.
   * @param maxBytes - Response and result limit.
   * @returns Named parent/category and proposal, with unsupported parent accounting rejected before confirmation.
   */
  async prepareMasterData(config: FinanceYouchengSystemConfig, secret: string | undefined, proposal: MasterDataProposal,
    stopped: AbortSignal, maxRows: number, maxBytes: number): Promise<{
    account: FinanceYouchengAccount
    proposal: MasterDataProposal
    references: MasterDataSelection
    notice: string
  }> {
    let references: MasterDataSelection
    if (proposal.kind === 'subject') {
      const { result, data } = await this.readReferences(config, secret, { kind: 'subjects' }, stopped, maxRows, maxBytes)
      const selected = resolveSubjectReferences(proposal.input, { id: result.accountId, name: result.accountName }, result)
      const subjects = z.array(z.looseObject({ subjectCode: z.string() })).parse(data)
      if (proposal.input.numberUnit !== null) throw new Error('当前新增科目不支持数量核算，numberUnit必须为null。')
      if (proposal.input.parentCode === null) {
        if (!subjects.some(row => row.subjectCode.startsWith(proposal.input.subjectCategory)
          && row.subjectType === proposal.input.subjectType)) {
          throw new Error('当前账套同一科目总分类下未返回所选类型；请核对真实科目类型，不传自造枚举。')
        }
      } else {
        const parent = z.object({ subjectType: z.string(), numberUnit: z.literal(''),
          auxiliaryList: z.array(z.unknown()).length(0), currencyList: z.array(z.unknown()).length(0) })
          .safeParse(subjects.find(row => row.subjectCode === proposal.input.parentCode))
        if (!parent.success) {
          throw new Error('当前仅支持已核实类别、无数量/辅助/外币核算的普通父科目；不能猜测或变更父级核算设置。')
        }
        if (parent.data.subjectType !== proposal.input.subjectType) {
          throw new Error(`父科目实际类型为“${parent.data.subjectType}”，与方案不一致；请保留已确认的有成类型名称，不传自造枚举。`)
        }
      }
      const categories = proposal.input.accounting?.auxiliaryCategoryCodes.length
        ? await this.queryReferences(config, secret, { kind: 'auxiliary-categories' }, stopped, maxRows, maxBytes) : undefined
      const accounting = resolveSubjectAccounting(proposal.input, result, data, categories)
      references = { kind: 'subject', ...selected, ...accounting === undefined ? {} : { accounting } }
    } else {
      const categories = await this.queryReferences(config, secret, { kind: 'auxiliary-categories' }, stopped, maxRows, maxBytes)
      const { result: items, categoryId } = await this.readReferences(config, secret,
        { kind: 'auxiliary-items', categoryCode: proposal.input.categoryCode }, stopped, maxRows, maxBytes)
      const selected = resolveAuxiliaryReferences(proposal.input,
        { id: categories.accountId, name: categories.accountName }, categories, items)
      if (categoryId !== selected.categoryId) throw new Error('辅助类别在查询期间已变化，请重新核对。')
      references = { kind: 'auxiliary-item', ...selected }
    }
    buildMasterDataSubmission(proposal, references)
    return { account: { id: references.accountId, name: references.accountName }, proposal, references,
      notice: '本地预览，未创建有成资料。创建前必须确认准确版本；不修改已有资料或历史凭证。重复检查仅限接口返回范围。科目支持一级科目或普通已有分支的下级，可明确选择已核实的辅助类别和币种，不提升已有末级、不注册币种或设置汇率；币种来源限当前科目中已出现的配置。辅助项目的启用状态接口不返回，不能仅凭名称匹配宣称全部核验。' }
  }

  private async readReferences(config: FinanceYouchengSystemConfig, secret: string | undefined, query: ReferenceQuery,
    stopped: AbortSignal, maxRows: number, maxBytes: number): Promise<{ result: ReferenceResult; data: unknown; categoryId?: string }> {
    if (!referenceQuerySchema.safeParse(query).success) throw new Error('基础资料查询参数无效，请指定类型和必要的辅助类别编码。')
    try {
      if (secret === undefined) throw new CheckFailure('credentials-missing')
      const signal = AbortSignal.any([stopped, AbortSignal.timeout(this.timeoutMs)])
      const token = await this.authenticate(config, secret, signal, maxBytes)
      const ledgers = await this.queryAccounts(config, secret, token, signal, undefined, maxBytes)
      const matches = ledgers.filter(item => item.id === config.accountCode)
      const account = matches[0]
      if (matches.length !== 1 || account === undefined || ledgers.filter(item => item.name === account.name).length !== 1) {
        throw new CheckFailure('account-unavailable')
      }
      const paths = {
        subjects: '/finance/auxiliary/querySubjectInfoList.rjson',
        'auxiliary-categories': '/finance/auxiliary/queryAuxiliaryCategoryList.rjson',
        'auxiliary-items': '/finance/auxiliary/queryAuxiliaryItemList.rjson',
        'cash-accounts': '/finance/cashjournal/getAccountList.rjson',
        'cash-categories': '/finance/cashjournal/getCategoryList.rjson',
      }
      const read = async (kind: ReferenceQuery['kind'], categoryCode?: string): Promise<unknown> => {
        const url = new URL(paths[kind], this.urls[config.environment])
        url.searchParams.set('appKey', config.appKey)
        url.searchParams.set('accessToken', token)
        const data = await this.request(url, { setOfBooksId: account.id, sobName: account.name, pageSize: maxRows,
          ...categoryCode === undefined ? {} : { categoryCode },
        }, signal, 'account-query', maxBytes)
        if ([config.appKey, secret, token].some(value => JSON.stringify({ data }).includes(value))) throw new CheckFailure('invalid-response')
        return data
      }
      let categoryId: string | undefined
      if (query.kind === 'auxiliary-items') {
        const categories = projectReferences(await read('auxiliary-categories'), { kind: 'auxiliary-categories', code: query.categoryCode }, account, maxRows, maxBytes)
        const category = categories.rows[0]
        if (categories.rows.length !== 1 || category === undefined) throw new CheckFailure('account-query')
        categoryId = category.id
      }
      const data = await read(query.kind, query.categoryCode)
      const result = projectReferences(data, query, account, maxRows, maxBytes, categoryId)
      signal.throwIfAborted()
      return { result, data, ...categoryId === undefined ? {} : { categoryId } }
    } catch (error) {
      if (stopped.aborted) throw new Error('基础资料查询已取消。')
      const reason = error instanceof CheckFailure ? error.message : error instanceof z.ZodError ? 'invalid-response' : 'query-failed'
      throw new Error(`有成基础资料查询失败（${reason}）。请检查连接、类别编码及返回范围；失败不等于没有资料，不要自动新增。`)
    }
  }

  /**
   * Read a voucher page after resolving the configured ID to a unique authorized ledger name.
   * @param config - Saved ledger configuration, never model-supplied.
   * @param secret - Host-only credential.
   * @param query - Bounded month and page selection.
   * @param stopped - Tool cancellation combined with Host teardown.
   * @param maxBytes - Each response and complete result byte limit.
   * @returns Sanitized voucher entries; errors never include credentials or vendor error bodies.
   */
  async queryVouchers(config: FinanceYouchengSystemConfig, secret: string | undefined, query: VoucherQuery,
    stopped: AbortSignal, maxBytes: number): Promise<VoucherPage> {
    validateVoucherQuery(query)
    if (secret === undefined) throw new Error('请先在帐套信息中保存有成 AppSecret。')
    let data: unknown
    let account: FinanceYouchengAccount
    let stage = '认证'
    try {
      const signal = AbortSignal.any([stopped, AbortSignal.timeout(this.timeoutMs)])
      const token = await this.authenticate(config, secret, signal, maxBytes)
      stage = '账套核验'
      const ledgers = await this.queryAccounts(config, secret, token, signal, undefined, maxBytes)
      const matches = ledgers.filter(item => item.id === config.accountCode)
      const selected = matches[0]
      if (matches.length !== 1 || selected === undefined || ledgers.filter(item => item.name === selected.name).length !== 1) {
        throw new CheckFailure('account-unavailable')
      }
      account = selected
      stage = '凭证列表请求'
      const url = new URL('/finance/certificate/list.rjson', this.urls[config.environment])
      url.searchParams.set('appKey', config.appKey)
      url.searchParams.set('accessToken', token)
      data = await this.request(url, { accountName: account.name, page: query.page, pageSize: query.pageSize,
        ...query.month === undefined ? {} : {
          certificateDateMonthStart: query.month, certificateDateMonthEnd: query.monthEnd ?? query.month,
        },
        ...query.summary === undefined ? {} : { abstractName: query.summary },
      }, signal, 'account-query', maxBytes)
      if ([config.appKey, secret, token].some(value => JSON.stringify({ data }).includes(value))) throw new CheckFailure('invalid-response')
      stage = '凭证响应校验'
      let result: VoucherPage
      try { result = projectVoucherPage(data, query, account, maxBytes) }
      catch { throw new CheckFailure('invalid-response') }
      signal.throwIfAborted()
      return result
    } catch (error) {
      if (stopped.aborted) throw new Error('凭证查询已取消。')
      const reason = error instanceof CheckFailure ? error.message : 'query-failed'
      throw new Error(`有成凭证查询失败（${reason}；阶段：${stage}）。本次未取得有效结果，不代表没有凭证；不能仅凭此错误判定是配置或有成服务故障。不要通过文件搜索或索取密钥代替查询。`)
    }
  }

  /**
   * Discover ledgers without a ledger ID, persistent token cache, or saved-connection status change.
   * @param config - Unsaved application identity and environment.
   * @param secret - Host-only supplied or stored AppSecret.
   * @param stopped - Host teardown cancellation.
   * @returns Only ledger IDs/names or a sanitized failure; no credentials or vendor error text.
   */
  async listAccounts(
    config: AuthenticationConfig, secret: string | undefined, stopped: AbortSignal,
  ): Promise<FinanceYouchengAccountsResult> {
    try {
      if (secret === undefined) throw new CheckFailure('credentials-missing')
      const signal = AbortSignal.any([stopped, AbortSignal.timeout(this.timeoutMs)])
      const token = await this.authenticate(config, secret, signal)
      const ledgers = await this.queryAccounts(config, secret, token, signal)
      if (new Set(ledgers.map(account => account.id)).size !== ledgers.length) throw new CheckFailure('invalid-response')
      return { state: 'ready', accounts: ledgers }
    } catch (error) {
      return { state: 'failed', failure: error instanceof CheckFailure ? error.failure : 'network' }
    }
  }

  /**
   * Authenticate and match only the configured ledger; never performs a business write.
   * @param clientId - Credential owner.
   * @param config - Current saved settings.
   * @param secret - Host-only AppSecret.
   * @param stopped - Host teardown cancellation.
   * @returns Safe success or failure evidence for this ledger.
   */
  async check(
    clientId: FinanceClientId,
    config: FinanceYouchengSystemConfig,
    secret: string | undefined,
    stopped: AbortSignal,
  ): Promise<FinanceConnectionStatus> {
    const base = { accountId: config.accountCode }
    try {
      if (secret === undefined) throw new CheckFailure('credentials-missing')
      const signal = AbortSignal.any([stopped, AbortSignal.timeout(this.timeoutMs)])
      const origin = this.urls[config.environment]
      const fingerprint = createHash('sha256').update(JSON.stringify([origin, config.appKey, secret])).digest('hex')
      const cached = this.tokens.get(clientId)
      let token: string
      if (cached?.fingerprint === fingerprint && cached.expiresAt > Date.now()) {
        token = cached.token
      } else {
        token = await this.authenticate(config, secret, signal)
        this.tokens.set(clientId, { fingerprint, token, expiresAt: Date.now() + TOKEN_LIFETIME_MS })
      }
      const ledgers = await this.queryAccounts(config, secret, token, signal, config.accountCode)
      // The vendor can ignore its filter, so request parameters alone do not prove the binding.
      const matches = ledgers.filter(account => account.id === config.accountCode)
      const account = matches[0]
      if (matches.length !== 1 || account === undefined) throw new CheckFailure('account-unavailable')
      return { ...base, state: 'connected', accountName: account.name, checkedAt: Date.now() }
    } catch (error) {
      this.tokens.delete(clientId)
      return { ...base, state: 'failed', failure: error instanceof CheckFailure ? error.failure : 'network', checkedAt: Date.now() }
    }
  }

  private async authenticate(config: AuthenticationConfig, secret: string, signal: AbortSignal, maxBytes?: number): Promise<string> {
    const data = await this.request(new URL('/auth/getAccessToken.rjson', this.urls[config.environment]),
      { appKey: config.appKey, appSecret: secret }, signal, 'authentication', maxBytes)
    if (typeof data !== 'string' || data.trim() === '') throw new CheckFailure('invalid-response')
    return data
  }

  private async queryAccounts(
    config: AuthenticationConfig, secret: string, token: string, signal: AbortSignal, accountId?: string, maxBytes?: number,
  ): Promise<FinanceYouchengAccount[]> {
    const url = new URL('/finance/auxiliary/queryAccountList.rjson', this.urls[config.environment])
    url.searchParams.set('appKey', config.appKey)
    url.searchParams.set('accessToken', token)
    const parsed = accounts.safeParse(await this.request(url,
      accountId === undefined ? {} : { setOfBooksId: accountId }, signal, 'account-query', maxBytes))
    if (!parsed.success) throw new CheckFailure('invalid-response')
    return parsed.data.map((account) => {
      if ([config.appKey, secret, token].some(value => account.sobName.includes(value) || account.id.includes(value))) {
        throw new CheckFailure('invalid-response')
      }
      return { id: account.id, name: account.sobName }
    })
  }

  private async request(url: URL, body: object, signal: AbortSignal, failure: 'authentication' | 'account-query', maxBytes?: number): Promise<unknown> {
    return (await this.requestEnvelope(url, body, signal, failure, maxBytes)).data
  }

  private async requestEnvelope(url: URL, body: object, signal: AbortSignal, failure: 'authentication' | 'account-query',
    maxBytes?: number): Promise<z.infer<typeof envelope>> {
    try {
      const response = await this.fetchRead(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body), redirect: 'error', signal,
      })
      const httpFailure = response.status === 401 ? 'authentication' : response.status === 403 ? 'access-denied' : failure
      let value: unknown
      try { value = maxBytes === undefined ? await response.json() : await this.readBoundedJson(response, maxBytes) }
      catch { throw new CheckFailure(response.ok ? 'invalid-response' : httpFailure) }
      const parsed = envelope.safeParse(value)
      if (!parsed.success) throw new CheckFailure(response.ok ? 'invalid-response' : httpFailure)
      if (!response.ok || parsed.data.result < 100 || parsed.data.result >= 200) {
        const deniedIp = /白名单|ip.*(拒绝|限制|不允许|whitelist|denied)/i.test(parsed.data.message ?? '')
        throw new CheckFailure(deniedIp ? 'ip-not-allowed' : httpFailure)
      }
      return parsed.data
    } catch (error) {
      if (signal.aborted && signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError') {
        throw new CheckFailure('timeout')
      }
      if (!(error instanceof CheckFailure) && !signal.aborted) throw new CheckFailure('network', transportDiagnostic(error))
      throw error
    }
  }

  private async fetchRead(url: URL, init: RequestInit): Promise<Response> {
    try { return await fetch(url, init) }
    catch (error) {
      const code = transportDiagnostic(error)
      if (!this.retryTransientReads || init.signal?.aborted || code === undefined || code === 'ENOTFOUND') throw error
      // The same signal bounds both attempts; HTTP/vendor errors and response parsing never reach this retry.
      return fetch(url, init)
    }
  }

  private async readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
    if (response.body === null) throw new CheckFailure('invalid-response')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let bytes = 0
    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes > maxBytes) {
          await reader.cancel()
          throw new CheckFailure('invalid-response')
        }
        chunks.push(chunk.value)
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    } finally { reader.releaseLock() }
  }
}
