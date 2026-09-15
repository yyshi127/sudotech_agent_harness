/** Read-only enterprise/ledger reference inspection; never emit tokens or unrelated records. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { YouchengConnection } from '../../packages/xiaojing/xiaojing-finance-domain/src/youcheng.ts'

const runtime = 'E:/Projects/小兢会计0.2.3后续开发-运行数据/harness'
assert.ok(process.argv.slice(2).every(arg => ['--open-items', '--history', '--verify-control'].includes(arg)))
assert.ok(!process.argv.includes('--history') || process.argv.includes('--open-items'))
assert.ok(!process.argv.includes('--verify-control') || process.argv.includes('--open-items'))
const require = createRequire(new URL('../../packages/credentials/credentials-local/package.json', import.meta.url))
const catalog = JSON.parse(await readFile(`${runtime}/finance/clients-v1.json`, 'utf8'))
const clients = catalog.clients.filter(c => c.status === 'active' && c.legalName === '瑞华云' && c.financeSystem?.accountCode === '35616')
assert.equal(clients.length, 1)
const client = clients[0]
const secrets = require('yaml').parse(await readFile(`${runtime}/.credentials.yaml`, 'utf8'))
const credential = secrets.records[`xiaojing-finance-domain/client-${client.id}`]
assert.equal(credential.kind, 'api-key')
const allowed = new Set(['/auth/getAccessToken.rjson', '/finance/auxiliary/queryAccountList.rjson',
  '/finance/auxiliary/queryAuxiliaryCategoryList.rjson', '/finance/auxiliary/queryAuxiliaryItemList.rjson',
  '/finance/cashjournal/getCashierList', '/finance/certificate/list.rjson'])
const fields = new Set(['id', 'itemId', 'itemID', 'code', 'itemCode', 'name', 'itemName', 'sobName',
  'corpId', 'companyId', 'setOfBooksId', 'accountName', 'status', 'auxiliaryCategoryId', 'subjectId', 'subjectCode', 'currencyId', 'type'])
const observations = []
const original = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input.toString())
  assert.equal(url.origin, 'https://cwdata.yiqiyun.com')
  assert.ok(allowed.has(url.pathname), 'Only scoped public reads are permitted')
  const body = JSON.parse(init.body)
  if (body.accountName !== undefined) assert.equal(body.accountName, '施的演示账套')
  if (body.setOfBooksId !== undefined) assert.equal(String(body.setOfBooksId), '35616')
  const response = await original(input, init)
  const value = await response.clone().json()
  const selected = []
  function visit(node) {
    if (node === null || typeof node !== 'object') return
    if (!Array.isArray(node) && [node.id, node.itemId, node.itemID].some(id => ['35616', '191501', '174626', '174624'].includes(String(id)))) {
      selected.push({ availableFields: Object.keys(node), fields: Object.fromEntries(Object.entries(node)
        .filter(([key, item]) => fields.has(key) && (item === null || ['string', 'number', 'boolean'].includes(typeof item)))) })
    }
    for (const item of Object.values(node)) visit(item)
  }
  if (url.pathname !== '/auth/getAccessToken.rjson') visit(value.data)
  if (url.pathname === '/finance/cashjournal/getCashierList') {
    const control = value.data?.list?.filter(row => row.abstractStr === '小兢F3A-35616-UI对照-20260909-01') ?? []
    observations.push({ path: url.pathname, controlRows: control.map(row => ({ availableFields: Object.keys(row),
      fields: Object.fromEntries(Object.entries(row).filter(([key, item]) =>
        ['id', 'setOfBooksId', 'corpId', 'date', 'abstractStr', 'subjectCode', 'subjectName', 'auxiliaryItemIds',
          'auxiliaryItemName', 'currencyCode', 'baseCurrencyCode', 'money', 'balance', 'baseMoney', 'baseBalance',
          'subjectId', 'initialBalance', 'isFinish', 'thisMoney', 'badMoney', 'hedgeMoney', 'returnMoney',
          'keeperName', 'categoryName', 'remark'].includes(key) && (item === null || ['string', 'number', 'boolean'].includes(typeof item)))) })) })
  }
  observations.push({ path: url.pathname, result: value.result, dataType: Array.isArray(value.data) ? 'array' : typeof value.data,
    ...(value.data && typeof value.data === 'object' && !Array.isArray(value.data) ? { dataFields: Object.keys(value.data),
      children: Object.fromEntries(Object.entries(value.data).map(([key, item]) => [key,
        Array.isArray(item) ? { type: 'array', count: item.length, firstFields: item[0] && typeof item[0] === 'object' ? Object.keys(item[0]) : [],
          firstIdentity: item[0] && typeof item[0] === 'object' ? Object.fromEntries(Object.entries(item[0])
            .filter(([name, value]) => ['id', 'corpId', 'setOfBooksId', 'currencyCode', 'baseCurrencyCode'].includes(name)
              && (value === null || ['string', 'number', 'boolean'].includes(typeof value)))) : {} }
          : { type: typeof item, fields: item && typeof item === 'object' ? Object.keys(item) : [] }])) } : {}), selected })
  return response
}
try {
  const adapter = new YouchengConnection({ production: 'https://cwdata.yiqiyun.com', test: 'https://cwdata.yiqiyun.com' }, 20000)
  const result = await adapter.queryReferences(client.financeSystem, credential.key,
    { kind: 'auxiliary-items', categoryCode: '01', code: '03', name: '淘云科技' }, AbortSignal.timeout(60000), 1000, 1000000)
  assert.equal(result.accountId, '35616')
  assert.equal(result.selection, 'unique-returned')
  if (process.argv.includes('--open-items')) {
    for (const direction of ['receivable', 'payable']) {
      try {
      const page = await adapter.queryOpenItems(client.financeSystem, credential.key,
        { direction, periodStart: '2022-01', periodEnd: process.argv.includes('--history') ? '2026-09' : '2022-01', page: 1, pageSize: 100 }, AbortSignal.timeout(60000), 1000, 1000000)
      assert.equal(page.accountId, '35616')
      assert.equal(page.accountName, '施的演示账套')
      observations.push({ direction, periodStart: page.selection.periodStart, periodEnd: page.selection.periodEnd,
        totalCount: page.totalCount, returnedRows: page.rows.length, matchingAccountRows: page.rows.filter(row => ['112201', '2202'].includes(row.subjectCode)),
        projectedControlRows: page.rows.filter(row => row.summary === '小兢F3A-35616-UI对照-20260909-01') })
      } catch (error) {
        observations.push({ direction, projectionError: error instanceof Error ? error.message : 'Unknown read failure' })
      }
    }
  }
  if (process.argv.includes('--verify-control')) {
    assert.ok(!observations.some(item => item.projectionError))
    const receivable = observations.find(item => item.direction === 'receivable')
    assert.equal(receivable.totalCount, 1)
    assert.equal(receivable.projectedControlRows.length, 1)
    const row = receivable.projectedControlRows[0]
    for (const [key, expected] of Object.entries({ id: '72593', date: '2022-01-09', amount: '0.04', balance: '0.04',
      auxiliaryItemIds: '191501', auxiliaryItemName: '淘云科技', currencyCode: 'RMB', subjectCode: '', subjectName: '应收账款' })) {
      assert.equal(row[key], expected, key)
    }
    assert.equal(observations.find(item => item.direction === 'payable').totalCount, 0)
    const vouchers = await adapter.queryVouchers(client.financeSystem, credential.key, { page: 1, pageSize: 100 }, AbortSignal.timeout(60000), 1000000)
    const ids = [...new Set(vouchers.rows.map(row => row.voucherId))]
    const baseline = JSON.parse(await readFile(new URL('./receipts/open-item-probe/ledger-header-attempt-1/readback-1788964015723.json', import.meta.url), 'utf8')).after
    assert.equal(ids.length, 41)
    assert.equal(vouchers.total, 41)
    assert.deepEqual(ids, baseline.voucherIds)
    assert.equal(createHash('sha256').update(JSON.stringify(vouchers.rows)).digest('hex'), baseline.voucherRowsHash)
    observations.push({ verifiedUiControl: '72593', preservedVouchers: 41, voucherIdsAndRowsUnchanged: true,
      publicWriteQualified: false })
  }
  const receipt = { checkedAt: new Date().toISOString(), businessWrites: false, observations }
  const text = JSON.stringify(receipt, null, 2)
  assert.ok(!text.includes(credential.key) && !text.includes(client.financeSystem.appKey))
  await writeFile(new URL(`./receipts/open-item-probe/context-read-${Date.now()}.json`, import.meta.url), `${text}\n`, { flag: 'wx' })
  console.log(text)
} finally { globalThis.fetch = original }
