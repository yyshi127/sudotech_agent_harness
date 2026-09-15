/** Independent exact-target experiment. The execution flag requires prior human approval; default only inspects. */
import assert from 'node:assert/strict'
import { readFile, mkdir, open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { compareJournalDeletion } from '../../packages/xiaojing/xiaojing-finance-domain/src/journal-deletion.ts'

const ledger = { id: '35616', name: '施的演示账套' }
const journalId = '141107'
const marker = 'F3B-35616-DELETE-JOURNAL-20260910-01'
const limits = { maxRows: 1000, maxPages: 10, pageSize: 100, maxBytes: 1000000 }

/** Reject unrelated targets and malformed arguments before loading credentials or constructing a connection. */
export function executionRequested(args) {
  if (args.length === 0) return false
  if (args.length === 1 && args[0] === '--inspect-account-name-03') return false
  if (args.length === 1 && args[0] === '--approved-delete-141107-account-name-03') return true
  if (args.length === 1 && args[0] === '--inspect-diagnostic-02') return false
  if (args.length === 1 && args[0] === '--approved-delete-141107-diagnostic-02') return true
  assert.deepEqual(args, ['--approved-delete-141107'])
  return true
}

/** A separately approved diagnostic attempt requires a definite rejection for the same original target. */
export function verifyDiagnosticPredecessor(intent, outcome) {
  assert.deepEqual(intent.ledger, ledger)
  assert.equal(intent.journalId, journalId)
  assert.equal(outcome.reserved, true)
  assert.deepEqual(outcome.outcome, { state: 'rejected', code: 201 })
}

/** Apply the exact approved experiment parameter, without accepting another target or extra fields. */
export function accountNameExperimentBody(body) {
  assert.deepEqual(body, { id: Number(journalId) })
  return { ...body, accountName: ledger.name }
}

/** Save only bounded rejection diagnostics in private lab evidence; preserve the response for the product classifier. */
export async function captureDeleteResponse(response, maxBytes, secrets, save) {
  assert.ok(Number.isSafeInteger(maxBytes) && maxBytes > 0)
  const reader = response.body?.getReader()
  const chunks = []
  let size = 0
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > maxBytes) {
          await reader.cancel()
          throw new Error('Deletion diagnostic response exceeds the existing experiment limit')
        }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
  }
  const bytes = Buffer.concat(chunks)
  let value
  try { value = JSON.parse(bytes.toString('utf8')) }
  catch { value = undefined }
  const diagnostic = { httpStatus: response.status, responseBytes: size, kind: 'unclassified' }
  if (value && Number.isInteger(value.result)) {
    diagnostic.result = value.result
    if (value.result >= 200 && value.result < 300) {
      diagnostic.kind = 'rejected-response'
      if (typeof value.message === 'string') {
        const sensitive = [...secrets].filter(secret => typeof secret === 'string' && secret.length > 0)
          .flatMap(secret => [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64')])
        diagnostic.message = sensitive.some(secret => value.message.includes(secret)) ? '[credential omitted]' : value.message
      }
    }
  }
  // A failed evidence save leaves the consumed intent uncertain; it must not trigger another request.
  await save(diagnostic)
  return new Response(response.body === null ? null : bytes, { status: response.status, headers: response.headers })
}

function identity(state) {
  for (const page of Object.values(state)) {
    assert.equal(page.accountId, ledger.id)
    assert.equal(page.accountName, ledger.name)
  }
  assert.deepEqual(state.cash.selection, { month: '2022-01', cashAccountId: '174622' })
  assert.deepEqual(state.journals.selection, { month: '2022-01' })
  for (const direction of ['receivable', 'payable']) {
    assert.deepEqual(state[direction].selection, { direction, periodStart: '2022-01', periodEnd: '2022-01' })
  }
  assert.equal(state.vouchers.hasMore, false)
  assert.equal(state.vouchers.month, '不限月份')
  assert.equal(state.vouchers.summary, undefined)
  assert.equal(new Set(state.vouchers.rows.map(row => row.voucherId)).size, state.vouchers.total)
}

function verification(before, after) {
  identity(before)
  identity(after)
  const unchanged = key => JSON.stringify(before[key].rows) === JSON.stringify(after[key].rows)
    && before[key].totalCount === after[key].totalCount
  return {
    cash: compareJournalDeletion(before.cash, after.cash),
    journals: compareJournalDeletion(before.journals, after.journals),
    cashInventoryUnchanged: JSON.stringify(before.cash) === JSON.stringify(after.cash),
    journalInventoryUnchanged: JSON.stringify(before.journals) === JSON.stringify(after.journals),
    receivablesPreserved: unchanged('receivable'), payablesPreserved: unchanged('payable'),
    vouchersPreserved: before.vouchers.total === after.vouchers.total && unchanged('vouchers'),
    scope: 'January 2022 journals and open items; complete unfiltered voucher list. Not full-ledger detail equivalence.',
  }
}

/** Injected I/O permits offline verification without loading credentials or contacting a vendor. No retries. */
export async function runJournalDeletionExperiment(io, execute = false) {
  assert.equal(typeof execute, 'boolean')
  const prior = await io.readIntent()
  if (execute) assert.equal(prior, undefined, 'A durable intent already exists; inspect only, never resend')
  const before = await io.snapshot()
  identity(before)
  if (prior !== undefined) {
    assert.deepEqual(prior.ledger, ledger)
    assert.equal(prior.journalId, journalId)
    return { mode: 'read-only-recovery', verification: verification(prior.before, before), writes: 0 }
  }
  const creation = io.creation
  assert.deepEqual(creation.account, ledger)
  assert.equal(creation.journalId, journalId)
  assert.equal(creation.readback.complete, true)
  const target = before.cash.target
  assert.ok(target)
  assert.deepEqual(target, creation.after.target, 'The dedicated fixture changed; do not delete its replacement or modified version')
  assert.deepEqual(before.journals.target, target)
  assert.equal(target.row.id, journalId)
  assert.equal(target.row.summary, marker)
  assert.equal(target.row.date, '2022-01-01')
  assert.equal(target.row.income, '0.01')
  assert.equal(target.cashAccountId, '174622')
  assert.deepEqual(target.blockers, [])
  if (!execute) return { mode: 'read-only-preview', journalId, ledger, amount: '0.01', writes: 0, approvalRequired: true }
  const digest = await io.configurationDigest()
  let reserved = false
  const outcome = await io.send(before.cash, async () => {
    assert.equal(reserved, false)
    assert.deepEqual(await io.snapshot(), before, 'Business evidence changed before dispatch')
    assert.equal(await io.configurationDigest(), digest, 'Configuration changed before dispatch')
    await io.saveExclusive('intent.json', { ledger, journalId, before, configurationDigest: digest,
      state: 'outcome-unknown', requestedAt: new Date().toISOString() })
    reserved = true
  })
  assert.ok(reserved || outcome.state === 'not-sent', 'The executor bypassed durable reservation')
  await io.saveExclusive('outcome.json', { outcome, reserved, observedAt: new Date().toISOString() })
  let checked
  try { checked = verification(before, await io.snapshot()) }
  catch { checked = { state: 'unavailable', reason: 'independent-readback-failed' } }
  const result = { mode: 'single-execution', journalId, ledger, outcome, reserved, verification: checked,
    scopedVerification: outcome.state === 'accepted' && checked.cash?.target === 'not-observed'
      && checked.cash.content === 'matched' && checked.cash.balances === 'matched'
      && checked.journals?.content === 'matched' && checked.receivablesPreserved
      && checked.payablesPreserved && checked.vouchersPreserved,
    limitation: 'Not whole-ledger absence, vendor locking or product UI acceptance. Any intent forbids another execution.' }
  await io.saveExclusive('readback.json', result)
  return result
}

async function main() {
  const args = process.argv.slice(2)
  const execute = executionRequested(args)
  const diagnosticAttempt = args[0]?.endsWith('-diagnostic-02') === true
  const accountNameAttempt = args[0]?.endsWith('-account-name-03') === true
  const runtime = 'E:/Projects/小兢会计0.2.3后续开发-运行数据/harness'
  const originalRoot = 'E:/Projects/小兢会计0.2.3后续开发-运行数据/test-tools/f3b-35616/journal-delete/execution'
  const root = accountNameAttempt ? `${originalRoot}-account-name-03`
    : diagnosticAttempt ? `${originalRoot}-diagnostic-02` : originalRoot
  const json = async path => JSON.parse(await readFile(path, 'utf8'))
  if (diagnosticAttempt) verifyDiagnosticPredecessor(await json(`${originalRoot}/intent.json`), await json(`${originalRoot}/outcome.json`))
  if (accountNameAttempt) {
    const predecessor = `${originalRoot}-diagnostic-02`
    verifyDiagnosticPredecessor(await json(`${predecessor}/intent.json`), await json(`${predecessor}/outcome.json`))
    assert.equal((await json(`${predecessor}/response-diagnostic.json`)).message, '帐套名称不能为空')
  }
  const { parse } = createRequire(new URL('../../packages/credentials/credentials-local/package.json', import.meta.url))('yaml')
  const load = async () => {
    const clients = (await json(`${runtime}/finance/clients-v1.json`)).clients.filter(client => client.status === 'active'
      && client.legalName === '瑞华云' && client.financeSystem?.system === 'youcheng' && client.financeSystem.accountCode === ledger.id)
    assert.equal(clients.length, 1)
    const client = clients[0]
    const credential = parse(await readFile(`${runtime}/.credentials.yaml`, 'utf8')).records[`xiaojing-finance-domain/client-${client.id}`]
    assert.equal(credential.kind, 'api-key')
    return { config: client.financeSystem, secret: credential.key,
      digest: createHash('sha256').update(JSON.stringify({ client, credential })).digest('hex') }
  }
  const settings = await load()
  const creation = await json(new URL(`./receipts/${marker}.json`, import.meta.url))
  const tokens = new Set([settings.config.appKey, settings.secret])
  const originalFetch = globalThis.fetch
  const reads = new Set(['/auth/getAccessToken.rjson', '/finance/auxiliary/queryAccountList.rjson',
    '/finance/cashjournal/getAccountList.rjson', '/finance/cashjournal/getListPage.rjson',
    '/finance/cashjournal/getCashierList', '/finance/certificate/list.rjson'])
  let permit = false
  let writes = 0
  const saveExclusive = async (name, value) => {
    if (name === 'intent.json' && accountNameAttempt) value = { ...value,
      experimentRequest: accountNameExperimentBody({ id: Number(journalId) }) }
    const text = JSON.stringify(value, null, 2) + '\n'
    for (const token of tokens) assert.ok(!text.includes(token))
    await mkdir(root, { recursive: true, mode: 0o700 })
    const file = await open(`${root}/${name}`, 'wx', 0o600)
    try { await file.writeFile(text); await file.sync() } finally { await file.close() }
    if (name === 'intent.json') permit = true
  }
  try {
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      assert.equal(url.origin, 'https://cwdata.yiqiyun.com')
      const body = JSON.parse(init.body)
      for (const key of ['accountName', 'booksName', 'sobName']) if (body[key] !== undefined) assert.equal(body[key], ledger.name)
      if (body.setOfBooksId !== undefined) assert.equal(String(body.setOfBooksId), ledger.id)
      if (url.pathname === '/finance/cashjournal/delete.rjson') {
        assert.ok(execute && permit && writes === 0)
        assert.equal((await load()).digest, settings.digest)
        assert.deepEqual(body, { id: Number(journalId) })
        if (accountNameAttempt) init = { ...init, body: JSON.stringify(accountNameExperimentBody(body)) }
        permit = false
        writes++
      } else assert.ok(reads.has(url.pathname), 'No creation, linked deletion, write-off or private endpoint allowed')
      const token = url.searchParams.get('accessToken')
      if (token) tokens.add(token)
      const response = await originalFetch(input, init)
      return url.pathname === '/finance/cashjournal/delete.rjson'
        ? captureDeleteResponse(response, limits.maxBytes, tokens,
          diagnostic => saveExclusive('response-diagnostic.json', { ledger, journalId, ...diagnostic }))
        : response
    }
    const { YouchengConnection } = await import('../../packages/xiaojing/xiaojing-finance-domain/src/youcheng.ts')
    const adapter = new YouchengConnection({ test: 'https://cwdata.yiqiyun.com', production: 'https://cwdata.yiqiyun.com' }, 90000)
    const stop = () => AbortSignal.timeout(180000)
    const snapshot = async () => {
      const cash = await adapter.inspectJournalDeletion(settings.config, settings.secret,
        { month: '2022-01', cashAccountId: '174622' }, journalId, stop(), limits)
      const journals = await adapter.inspectJournalDeletion(settings.config, settings.secret, { month: '2022-01' }, journalId, stop(), limits)
      const receivable = await adapter.inspectOpenItemDeletion(settings.config, settings.secret,
        { direction: 'receivable', periodStart: '2022-01', periodEnd: '2022-01' }, '72604', stop(), limits)
      const payable = await adapter.inspectOpenItemDeletion(settings.config, settings.secret,
        { direction: 'payable', periodStart: '2022-01', periodEnd: '2022-01' }, '72605', stop(), limits)
      const vouchers = await adapter.queryVouchers(settings.config, settings.secret, { page: 1, pageSize: 100 }, stop(), limits.maxBytes)
      return { cash, journals, receivable, payable, vouchers }
    }
    const result = await runJournalDeletionExperiment({ creation, snapshot,
      configurationDigest: async () => (await load()).digest,
      readIntent: async () => {
        try { return await json(`${root}/intent.json`) }
        catch (error) { if (error?.code === 'ENOENT') return undefined; throw error }
      },
      saveExclusive,
      send: (inventory, reserve) => adapter.sendReservedJournalDeletion(settings.config, settings.secret,
        inventory, stop(), limits, reserve),
    }, execute)
    console.log(JSON.stringify({ ...result, writes }))
  } finally { globalThis.fetch = originalFetch }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(JSON.stringify({ errorName: error?.name, locations: String(error?.stack).split('\n')
      .filter(line => /^\s+at /.test(line)).slice(0, 4) }))
    console.error(JSON.stringify({ failed: true, instruction: 'Inspect this attempt under journal-delete/execution, execution-diagnostic-02 or execution-account-name-03; never retry an existing intent.' }))
    process.exitCode = 1
  })
}
