/** Independent documented payable branch qualification; default reads only, --send reserves one attempt. */
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { YouchengConnection } from '../../packages/xiaojing/xiaojing-finance-domain/src/youcheng.ts'

assert.ok(process.argv.slice(2).every(arg => ['--send', '--qualified-name', '--inspect-account-types', '--omit-account'].includes(arg)))
const send = process.argv.includes('--send')
const qualifiedName = process.argv.includes('--qualified-name')
const inspectAccountTypes = process.argv.includes('--inspect-account-types')
const omitAccount = process.argv.includes('--omit-account')
assert.ok(!(send && inspectAccountTypes))
assert.ok(!omitAccount || qualifiedName && !inspectAccountTypes)
const root = new URL('./receipts/open-item-probe/', import.meta.url)
const dir = new URL(omitAccount ? 'payable-omitted-account-attempt-1/' : qualifiedName ? 'payable-qualified-name-attempt-1/' : 'payable-document-attempt-1/', root)
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const runtime = 'E:/Projects/小兢会计0.2.3后续开发-运行数据/harness'
const clients = (await json(`${runtime}/finance/clients-v1.json`)).clients.filter(c => c.status === 'active'
  && c.legalName === '瑞华云' && c.financeSystem?.accountCode === '35616')
assert.equal(clients.length, 1)
const client = clients[0]
const require = createRequire(new URL('../../packages/credentials/credentials-local/package.json', import.meta.url))
const credential = require('yaml').parse(await readFile(`${runtime}/.credentials.yaml`, 'utf8')).records[`xiaojing-finance-domain/client-${client.id}`]
assert.equal(credential.kind, 'api-key')
const payload = { booksName: '施的演示账套', categoryName: '其他支出', auxiliaryItemNames: 'F3主应用供应商测试',
  direction: true, date: '2022-01-09', abstractStr: '小兢F3A-35616-20260909-AP-PROBE-01', money: 0.05,
  resource: 1, accountId: 174624, keeperName: '施' }
if (qualifiedName) {
  payload.auxiliaryItemNames = '供应商:F3主应用供应商测试'
  payload.abstractStr = '小兢F3A-35616-20260910-AP-QUALIFIED-NAME-01'
}
if (omitAccount) {
  delete payload.accountId
  payload.money = 0.01
  payload.abstractStr = '小兢F3A-35616-20260910-AP-OMIT-ACCOUNT-01'
}
const original = globalThis.fetch
let authenticatedUrl
let accountType
const tokens = new Set([credential.key, client.financeSystem.appKey])
const readPaths = new Set(['/auth/getAccessToken.rjson', '/finance/auxiliary/queryAccountList.rjson',
  '/finance/cashjournal/getCashierList', '/finance/certificate/list.rjson', '/finance/cashjournal/getCategoryList.rjson',
  '/finance/auxiliary/queryAuxiliaryCategoryList.rjson', '/finance/auxiliary/queryAuxiliaryItemList.rjson',
  '/finance/auxiliary/querySubjectInfoList.rjson'])
readPaths.add('/finance/cashjournal/getAccountList.rjson')
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  assert.equal(url.origin, 'https://cwdata.yiqiyun.com')
  assert.ok(readPaths.has(url.pathname))
  const body = JSON.parse(init.body)
  if (body.accountName !== undefined) assert.equal(body.accountName, payload.booksName)
  if (body.sobName !== undefined) assert.equal(body.sobName, payload.booksName)
  if (body.setOfBooksId !== undefined) assert.equal(String(body.setOfBooksId), '35616')
  if (url.searchParams.has('accessToken')) tokens.add(url.searchParams.get('accessToken'))
  if (url.pathname === '/finance/cashjournal/getCashierList') authenticatedUrl = url
  if (url.pathname === '/finance/cashjournal/getAccountList.rjson' && accountType !== undefined) {
    return original(input, { ...init, body: JSON.stringify({ ...body, type: accountType }) })
  }
  return original(input, init)
}
const adapter = new YouchengConnection({ production: 'https://cwdata.yiqiyun.com', test: 'https://cwdata.yiqiyun.com' }, 20000)
const signal = () => AbortSignal.timeout(60000)
async function save(name, value) {
  const text = JSON.stringify(value, null, 2)
  for (const token of tokens) if (token) assert.ok(!text.includes(token), 'Never save credentials')
  await writeFile(new URL(name, dir), `${text}\n`, { flag: 'wx', mode: 0o600 })
}
async function baseline() {
  const pages = []
  for (const direction of ['receivable', 'payable']) {
    const page = await adapter.queryOpenItems(client.financeSystem, credential.key,
      { direction, periodStart: '2022-01', periodEnd: '2022-01', page: 1, pageSize: 100 }, signal(), 1000, 1000000)
    assert.equal(page.accountId, '35616')
    assert.equal(page.accountName, payload.booksName)
    assert.equal(page.rows.length, page.totalCount)
    pages.push(page)
  }
  const vouchers = await adapter.queryVouchers(client.financeSystem, credential.key, { page: 1, pageSize: 100 }, signal(), 1000000)
  const voucherIds = [...new Set(vouchers.rows.map(row => row.voucherId))]
  assert.equal(voucherIds.length, vouchers.total)
  return { pages, voucherIds, voucherRowsHash: createHash('sha256').update(JSON.stringify(vouchers.rows)).digest('hex') }
}
try {
  await mkdir(dir, { recursive: true })
  if (send) {
    let exists = true
    try { await access(new URL('intent.json', dir)) } catch (error) { if (error.code !== 'ENOENT') throw error; exists = false }
    assert.equal(exists, false, 'Reserved attempts cannot be sent again; use default read-only mode')
  }
  const before = await baseline()
  if (inspectAccountTypes) {
    const observations = []
    for (const type of [undefined, 5, 6]) {
      accountType = type
      const accounts = await adapter.queryReferences(client.financeSystem, credential.key,
        { kind: 'cash-accounts' }, signal(), 1000, 1000000)
      assert.equal(accounts.accountId, '35616')
      observations.push({ requestedType: type ?? 'omitted', rows: accounts.rows })
    }
    accountType = undefined
    await save(`account-type-read-${Date.now()}.json`, { observations,
      evidence: 'Public UI asset cwCashier.ac8da7.js declares account type5 receivable and6 payable. The public q2REAOzg doc does not declare a type filter. This read-only experiment checks whether the public endpoint recognizes it; no product support is inferred without matching results.', businessWrites: false })
    console.log(JSON.stringify({ accountTypeReads: observations }))
  }
  const supplier = await adapter.queryReferences(client.financeSystem, credential.key,
    { kind: 'auxiliary-items', categoryCode: '02', code: 'F3A04', name: 'F3主应用供应商测试' }, signal(), 1000, 1000000)
  assert.equal(supplier.selection, 'unique-returned')
  assert.equal(supplier.rows[0].id, '191573')
  if (qualifiedName) {
    const auxiliaryCategory = await adapter.queryReferences(client.financeSystem, credential.key,
      { kind: 'auxiliary-categories', code: '02' }, signal(), 1000, 1000000)
    assert.equal(auxiliaryCategory.accountId, '35616')
    assert.equal(auxiliaryCategory.selection, 'unique-returned')
    assert.equal(auxiliaryCategory.rows[0].name, '供应商')
    assert.equal(payload.auxiliaryItemNames, `${auxiliaryCategory.rows[0].name}:${supplier.rows[0].name}`)
    await save(`category-${Date.now()}.json`, auxiliaryCategory)
  }
  const categories = await adapter.queryReferences(client.financeSystem, credential.key, { kind: 'cash-categories' }, signal(), 1000, 1000000)
  const category = categories.rows.filter(row => row.name === payload.categoryName && row.directionRaw === '1')
  const subject = await adapter.queryReferences(client.financeSystem, credential.key, { kind: 'subjects', code: '2202' }, signal(), 1000, 1000000)
  await save(`inspection-${Date.now()}.json`, { checkedAt: new Date().toISOString(), before, supplier, categories, subject })
  console.log(JSON.stringify({ mode: send ? 'reserved-payable-test' : 'read-only', counts: before.pages.map(p => [p.selection.direction, p.totalCount]),
    supplier: supplier.rows, expenseCategory: category, subject: subject.rows }))
  if (send) {
    assert.equal(category.length, 1)
    assert.equal(subject.selection, 'unique-returned')
    assert.equal(subject.rows[0].status, 'enabled')
    assert.ok(subject.rows[0].auxiliaryCodes.includes('02'))
    const ui = await json(new URL(qualifiedName ? 'payable-ui-evidence-20260910.json' : 'payable-ui-evidence-20260909.json', root))
    assert.equal(ui.ledgerId, '35616')
    assert.equal(ui.company, '瑞华云')
    assert.equal(ui.accountName, payload.booksName)
    assert.equal(ui.payableAccountId, omitAccount ? '174624' : String(payload.accountId))
    assert.equal(ui.supplierId, supplier.rows[0].id)
    assert.ok(ui.accountText.includes('启用') && ui.supplierText.includes('启用'))
    assert.ok(Date.now() - Date.parse(ui.checkedAt) >= 0 && Date.now() - Date.parse(ui.checkedAt) < 1800000)
    assert.ok(before.pages.every(p => p.rows.every(row => row.summary !== payload.abstractStr)))
    const document = (await json(new URL('./public-docs/B2llxm2D.json', import.meta.url))).document
    assert.ok(Object.keys(payload).every(key => document.requestParams.some(p => p.name === key && p.parentId === '')))
    if (omitAccount) assert.equal(document.requestParams.find(p => p.name === 'accountId' && p.parentId === '').required, 0)
    assert.equal((await json(new URL('document-only-attempt-1/response.json', root))).body.result, 201)
    const url = new URL(authenticatedUrl)
    url.pathname = '/finance/cashier/account/management/add.rjson'
    await save('intent.json', { payload, before, supplier, category, subject, ui,
      authority: omitAccount
        ? 'The public add document declares accountId optional. Independently test omission once with qualified supplier format in35616,0.01 and unique summary. This is not a product default or a retry of any earlier reservation. Inspect the actual selected account if accepted. No payment, settlement, voucher, private endpoint or automatic resend.'
        : qualifiedName
        ? 'User relayed categoryName:itemName format. Independently qualify payable true with verified supplier02/F3A04 and enabled account174624 in35616. One0.05 labeled payable; no payment, settlement, voucher, retry or private API. Do not infer payable success from receivable acceptance.'
        : 'Independent CF21 test under standing minimal synthetic-data authorization for35616. Earlier public attempts exercised only receivable false. Test the documented payable true branch with an existing enabled supplier/account, not an assumed receivable mapping. One0.05 synthetic payable, no payment, settlement, voucher, retry or private API.' })
    await save('dispatch.json', { at: new Date().toISOString(), state: 'outcome-unknown', payload })
    let response
    try {
      const http = await original(url, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(20000) })
      const text = await http.text()
      await save('http-response.json', { status: http.status, contentType: http.headers.get('content-type'), text })
      response = { httpStatus: http.status, body: JSON.parse(text) }
    } catch (error) { response = { state: 'outcome-unknown', errorType: error.name } }
    await save('response.json', response)
    console.log(JSON.stringify({ response }))
  }
  const after = await baseline()
  assert.deepEqual(after.voucherIds, before.voucherIds)
  assert.equal(after.voucherRowsHash, before.voucherRowsHash)
  for (const p of before.pages) assert.ok(p.rows.every(row => after.pages.find(a => a.selection.direction === p.selection.direction).rows.some(r => JSON.stringify(row) === JSON.stringify(r))))
  const matching = after.pages.flatMap(p => p.rows.filter(row => row.summary === payload.abstractStr).map(row => ({ direction: p.selection.direction, row })))
  await save(`readback-${Date.now()}.json`, { after, matching, preservedVouchers: after.voucherIds.length, existingOpenItemsUnchanged: true })
  console.log(JSON.stringify({ matching, preservedVouchers: after.voucherIds.length }))
} finally { globalThis.fetch = original }
