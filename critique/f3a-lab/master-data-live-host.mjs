// Serial, one-shot main-Host qualification in35616. Default mode only inspects retained operations.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { YouchengConnection } from '../../packages/xiaojing/xiaojing-finance-domain/src/youcheng.ts'
import { MasterDataRecords } from '../../packages/xiaojing/xiaojing-finance-domain/src/master-data-records.ts'
import { projectReferences } from '../../packages/xiaojing/xiaojing-finance-domain/src/references.ts'

const runtime = 'E:/Projects/小兢会计0.2.3后续开发-运行数据/harness'
const rootMode = process.argv.includes('--root')
const disabledAuxiliary = process.argv.includes('--disabled-auxiliary')
const subjectAuxiliary = process.argv.includes('--subject-auxiliary')
const subjectCurrency = process.argv.includes('--subject-currency')
const kind = process.argv.includes('--auxiliary') || disabledAuxiliary ? 'auxiliary-item' : 'subject'
const dir = new URL(`./receipts/master-data-live-host/${subjectAuxiliary ? 'subject-auxiliary-20260914' : subjectCurrency ? 'subject-currency-20260914'
  : disabledAuxiliary ? 'disabled-auxiliary-item' : rootMode ? 'root-subject' : kind}/`, import.meta.url)
const proposal = kind === 'subject' ? { kind, input: { subjectCode: subjectAuxiliary ? '100292' : subjectCurrency ? '100291' : rootMode ? '1097' : '100295',
  subjectName: subjectAuxiliary ? 'F3R主应用辅助0914' : subjectCurrency ? 'F3R主应用美元0914' : rootMode ? 'F3主应用一级测试' : 'F3主应用银行测试',
  subjectCategory: '1', subjectType: '流动资产', parentCode: rootMode ? null : '1002', direction: 'debit', status: 'enabled', numberUnit: null, documentMaker: '施',
  ...subjectAuxiliary || subjectCurrency ? { accounting: { auxiliaryCategoryCodes: subjectAuxiliary ? ['01'] : [], currencyCodes: subjectCurrency ? ['USD'] : [] } } : {} } }
  : { kind, input: { categoryCode: '02', itemCode: disabledAuxiliary ? 'F3A05' : 'F3A04',
    itemName: disabledAuxiliary ? 'F3禁用供应商测试勿使用' : 'F3主应用供应商测试',
    status: disabledAuxiliary ? 'disabled' : 'enabled', documentMaker: '施' } }
assert.ok(process.argv.slice(2).every(arg => ['--start', '--submit', '--auxiliary', '--root', '--disabled-auxiliary', '--subject-auxiliary', '--subject-currency'].includes(arg)))
assert.ok([rootMode, disabledAuxiliary, subjectAuxiliary, subjectCurrency, process.argv.includes('--auxiliary')].filter(Boolean).length <= 1)
assert.ok(!(process.argv.includes('--start') && process.argv.includes('--submit')))
assert.ok(!(rootMode && process.argv.includes('--auxiliary')))
assert.ok(!(disabledAuxiliary && (rootMode || process.argv.includes('--auxiliary'))))
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
async function rpc(method, payload) {
  const response = await fetch(`http://127.0.0.1:3092/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload }), signal: AbortSignal.timeout(30000) })
  assert.equal(response.status, 200)
  const { result } = await response.json()
  assert.ok(result.ok, `RPC ${method} failed: ${result.error?.code}`)
  return result.value
}
async function save(name, value, exclusive = false) {
  await writeFile(new URL(name, dir), JSON.stringify(value, null, 2), { mode: 0o600, flag: exclusive ? 'wx' : 'w' })
}
async function baseline() {
  const require = createRequire(new URL('../../packages/credentials/credentials-local/package.json', import.meta.url))
  const clients = JSON.parse(await readFile(`${runtime}/finance/clients-v1.json`, 'utf8')).clients.filter(client =>
    client.status === 'active' && client.legalName === '瑞华云' && client.financeSystem?.accountCode === '35616')
  assert.equal(clients.length, 1)
  const client = clients[0]
  const secret = require('yaml').parse(await readFile(`${runtime}/.credentials.yaml`, 'utf8')).records[`xiaojing-finance-domain/client-${client.id}`]
  assert.equal(secret.kind, 'api-key')
  const original = globalThis.fetch
  const raw = []
  const allowed = new Set(['/auth/getAccessToken.rjson', '/finance/auxiliary/queryAccountList.rjson',
    '/finance/auxiliary/querySubjectInfoList.rjson', '/finance/auxiliary/queryAuxiliaryCategoryList.rjson',
    '/finance/auxiliary/queryAuxiliaryItemList.rjson', '/finance/certificate/list.rjson'])
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    assert.equal(url.origin, 'https://cwdata.yiqiyun.com')
    assert.ok(allowed.has(url.pathname), 'Independent adapter is read-only')
    const body = JSON.parse(init.body)
    if (body.accountName !== undefined) assert.equal(body.accountName, '施的演示账套')
    if (body.setOfBooksId !== undefined) assert.equal(String(body.setOfBooksId), '35616')
    const response = await original(input, init)
    if (url.pathname.endsWith('querySubjectInfoList.rjson')) raw.push(await response.clone().json())
    return response
  }
  try {
    const adapter = new YouchengConnection({ production: 'https://cwdata.yiqiyun.com', test: 'https://cwdata.yiqiyun.com' }, 20000)
    const refs = async request => {
      const value = await adapter.queryReferences(client.financeSystem, secret.key, request, AbortSignal.timeout(60000), 1000, 1000000)
      assert.equal(value.accountId, '35616')
      assert.equal(value.accountName, '施的演示账套')
      assert.equal(value.returnedCount, value.rows.length)
      assert.ok(value.returnedCount < value.requestedLimit, 'Do not qualify from a cap-sized returned set')
      return value
    }
    const subjects = await refs({ kind: 'subjects' })
    const customers = await refs({ kind: 'auxiliary-items', categoryCode: '01' })
    const suppliers = await refs({ kind: 'auxiliary-items', categoryCode: '02' })
    const vouchers = await adapter.queryVouchers(client.financeSystem, secret.key, { page: 1, pageSize: 100 }, AbortSignal.timeout(60000), 1000000)
    assert.equal(vouchers.accountId, '35616')
    const voucherIds = [...new Set(vouchers.rows.map(row => row.voucherId))]
    assert.equal(voucherIds.length, vouchers.total)
    const result = { checkedAt: new Date().toISOString(), clientId: client.id, subjects, customers, suppliers,
      rawSubjects: raw.flatMap(page => page.data), voucherIds, voucherRowsHash: digest(vouchers.rows) }
    assert.ok(!JSON.stringify(result).includes(secret.key) && !JSON.stringify(result).includes(client.financeSystem.appKey))
    return result
  } finally { globalThis.fetch = original }
}
async function historyFor(sessionId) {
  const { items } = await rpc('session.list', {})
  const session = items.find(item => item.sessionId === sessionId)
  assert.ok(session)
  const history = await rpc('session.history', { sessionId, maxMessages: 80 })
  const events = history.events.map(item => item.event)
  const calls = events.filter(event => event.type === 'tool/call')
  const results = events.filter(event => event.type === 'tool/result').flatMap(event => event.data.message.content)
    .filter(block => block.type === 'tool-result').map(block => ({ callId: block.toolCallId, isError: block.isError,
      text: block.content.filter(item => item.type === 'text').map(item => item.text).join('\n') }))
  return { running: session.running, events, calls, results }
}
await mkdir(dir, { recursive: true })
if (process.argv.includes('--start')) {
  const before = await baseline()
  const rows = kind === 'subject' ? before.subjects.rows : before.suppliers.rows
  assert.ok(!rows.some(row => row.code === (proposal.input.subjectCode ?? proposal.input.itemCode)))
  const { clients } = await rpc('financeClients/workspaces', { args: {} })
  const target = clients.find(client => client.clientId === before.clientId)
  assert.equal(target?.connection?.accountId, '35616')
  const sessionId = randomUUID()
  await save('intent.json', { sessionId, clientId: before.clientId, proposal, before,
    authority: 'Standing user approval: one minimal synthetic master-data item in35616 via main Host, no existing updates.' }, true)
  await rpc('session.create', { sessionId, workspaceId: target.workspaceId, agentPreset: 'finance' })
  await rpc('financeClients/stage', { args: { agentId: sessionId, request: { mode: 'client', clientId: target.clientId } } })
  const task = kind === 'subject'
    ? subjectAuxiliary ? '银行存款1002下新增明细科目100292，名称F3R主应用辅助0914，流动资产，借方，启用，启用客户辅助核算（类别01），不启用外币或数量核算。'
      : subjectCurrency ? '银行存款1002下新增明细科目100291，名称F3R主应用美元0914，流动资产，借方，启用，只启用美元USD核算，不额外加入RMB，不启用辅助或数量核算；不注册新币种或修改汇率。'
      : rootMode ? '新增最上层的普通一级科目，不挂任何父科目，编号1097，名称F3主应用一级测试，流动资产，借方，启用，不启用数量、辅助或外币核算。'
      : '银行存款1002下新增普通明细科目，编号100295，名称F3主应用银行测试，流动资产，借方，启用，不启用数量、辅助或外币核算。'
    : disabledAuxiliary ? '现有供应商类别02下新增项目，编号F3A05，名称F3禁用供应商测试勿使用，创建时明确设为禁用。不新建类别，不修改已有供应商。'
      : '现有供应商类别02下新增项目，编号F3A04，名称F3主应用供应商测试，启用。不新建类别。'
  await rpc('session.prompt', { sessionId, mode: 'queue', clientTimeZone: 'Asia/Shanghai', content: [{ type: 'text', text:
    `开发测试，仅瑞华云的施的演示账套35616：${task}提交人是已确认的有成成员“施”。先查询真实资料，给出可修改的本地预览，暂不提交。不要修改旧资料，不处理报销，不创建凭证。` }] })
  console.log(JSON.stringify({ started: true, sessionId, kind }))
} else {
  const intent = JSON.parse(await readFile(new URL('intent.json', dir), 'utf8'))
  assert.deepEqual(intent.proposal, proposal)
  const history = await historyFor(intent.sessionId)
  await save('history.json', history)
  const records = new MasterDataRecords(`${runtime}/finance/master-data-preparations`, `${intent.clientId}/${intent.sessionId}`, 131072)
  const createCalls = history.calls.filter(call => call.data.name === 'finance_create_master_data')
  if (process.argv.includes('--submit')) {
    assert.equal(history.running, false)
    assert.equal(createCalls.length, 0)
    // Skill loading and local planning do not mutate vendor data; later calls still need this explicit allowlist.
    assert.ok(history.calls.every(call => ['finance_references', 'finance_prepare_master_data', 'todo_write', 'skill'].includes(call.data.name)))
    const prepareIds = new Set(history.calls.filter(call => call.data.name === 'finance_prepare_master_data').map(call => call.data.callId))
    const previews = history.results.filter(result => prepareIds.has(result.callId) && !result.isError).map(result => JSON.parse(result.text))
    assert.equal(previews.length, 1)
    const preview = previews[0]
    assert.deepEqual(preview.proposal, proposal)
    assert.deepEqual(preview.account, { id: '35616', name: '施的演示账套' })
    assert.equal(preview.version, 1)
    assert.equal(preview.phase, 'prepared')
    assert.equal((await records.read(preview.id)).phase, 'prepared')
    await save('submit-intent.json', { sessionId: intent.sessionId, preview, humanUiClick: false, exactPreviewOnce: true }, true)
    const socket = new WebSocket('ws://127.0.0.1:3092/api/events.mux')
    let timer
    let responding = false
    const answered = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Approval not reached')), 120000)
      socket.addEventListener('error', () => reject(new Error('Local event stream failed')), { once: true })
      socket.addEventListener('message', async event => {
        const envelope = JSON.parse(event.data)
        const frame = envelope.payload
        if (frame?.sessionId !== intent.sessionId || frame.type !== 'approval/requested' || responding) return
        responding = true
        try {
          assert.equal(frame.toolName, 'finance_create_master_data')
          const confirmed = JSON.parse(frame.reason.slice(frame.reason.indexOf('{')))
          assert.deepEqual(confirmed, preview)
          assert.equal((await records.read(preview.id)).phase, 'prepared')
          await save('approval-intent.json', { sessionId: intent.sessionId, approvalId: frame.approvalId, preview: confirmed, humanUiClick: false }, true)
          const response = await fetch('http://127.0.0.1:3092/api/respond', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'client-response', rpcId: envelope.rpcId, result: { ok: true, value: {
              sessionId: intent.sessionId, approvalId: frame.approvalId, outcome: 'allowed-once' } } }), signal: AbortSignal.timeout(15000) })
          assert.equal(response.status, 200)
          await save('approval-receipt.json', { response: await response.json(), humanUiClick: false })
          resolve()
        } catch (error) { reject(error) }
      })
    })
    try {
      await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
      await rpc('session.prompt', { sessionId: intent.sessionId, mode: 'queue', clientTimeZone: 'Asia/Shanghai', content: [{ type: 'text', text:
        `提交本地基础资料${preview.id}第1版，仅这一项，等待系统强制确认。不要重新准备或重复提交，不修改旧资料，不创建凭证。` }] })
      await answered
      console.log(JSON.stringify({ sessionId: intent.sessionId, kind, exactPreviewApprovedOnce: true, awaitingReadback: true }))
    } catch (error) {
      await rpc('session.cancel', { sessionId: intent.sessionId })
      throw new Error(`Own test stopped; inspect original operation, never resend: ${error.message}`)
    } finally { clearTimeout(timer); socket.close() }
  } else {
    console.log(JSON.stringify({ sessionId: intent.sessionId, running: history.running, calls: history.calls.map(call => call.data.name),
      creationResults: history.results.filter(result => createCalls.some(call => call.data.callId === result.callId)) }))
    if (!history.running && createCalls.length) {
      assert.equal(createCalls.length, 1)
      const submitted = history.results.find(result => result.callId === createCalls[0].data.callId)
      assert.ok(submitted && !submitted.isError)
      const result = JSON.parse(submitted.text)
      assert.equal(result.phase, 'accepted', 'Do not resend any nonaccepted operation')
      const record = await records.read(result.id)
      assert.equal(record.phase, 'accepted')
      assert.deepEqual(record.proposal, proposal)
      const after = await baseline()
      assert.deepEqual(after.voucherIds, intent.before.voucherIds)
      assert.equal(after.voucherRowsHash, intent.before.voucherRowsHash)
      // Reproject retained raw subjects so newly exposed fields are compared against original evidence, not discarded.
      const originalSubjects = projectReferences(intent.before.rawSubjects, { kind: 'subjects' },
        { id: '35616', name: '施的演示账套' }, 1000, 1000000)
      for (const key of ['customers', 'suppliers', 'subjects']) for (const row of (key === 'subjects' ? originalSubjects : intent.before[key]).rows) {
        assert.deepEqual(after[key].rows.find(next => next.code === row.code), row, `Existing ${key}/${row.code} changed`)
      }
      const key = kind === 'subject' ? 'subjects' : 'suppliers'
      const code = proposal.input.subjectCode ?? proposal.input.itemCode
      const matches = after[key].rows.filter(row => row.code === code)
      assert.equal(matches.length, 1)
      assert.equal(after[key].rows.length, intent.before[key].rows.length + 1)
      assert.equal(matches[0].name, proposal.input.subjectName ?? proposal.input.itemName)
      if (kind === 'subject') {
        assert.equal(matches[0].parentCode, rootMode ? '' : '1002')
        assert.equal(matches[0].directionRaw, '0')
        assert.equal(matches[0].status, 'enabled')
        assert.equal(matches[0].subjectType, proposal.input.subjectType)
        assert.equal(result.complete, true)
      } else {
        assert.equal(result.readback.content, 'matched')
        assert.equal(result.readback.status, 'unavailable')
        assert.equal(result.complete, false)
      }
      await save('audit.json', { checkedAt: new Date().toISOString(), sessionId: intent.sessionId, result, record, after,
        preservedVouchers: after.voucherIds.length, originalReferencesPreserved: true, oneNewItem: matches[0], humanUiClick: false })
      console.log(JSON.stringify({ verified: true, kind, code, complete: result.complete, preservedVouchers: after.voucherIds.length }))
    }
  }
}
