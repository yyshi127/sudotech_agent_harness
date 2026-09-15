// One read-only natural-language check in the approved ledger; default only observes the retained session.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

assert.ok(process.argv.slice(2).every(arg => arg === '--start'))
const dir = new URL('./receipts/reference-attributes-live/', import.meta.url)
async function rpc(method, payload) {
  const response = await fetch(`http://127.0.0.1:3092/api/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload }), signal: AbortSignal.timeout(30000),
  })
  assert.equal(response.status, 200)
  const { result } = await response.json()
  assert.equal(result.ok, true, `RPC failed: ${method}`)
  return result.value
}
async function save(name, value, exclusive = false) {
  await writeFile(new URL(name, dir), JSON.stringify(value, null, 2), { flag: exclusive ? 'wx' : 'w', mode: 0o600 })
}
await mkdir(dir, { recursive: true })
if (process.argv.includes('--start')) {
  const { clients } = await rpc('financeClients/workspaces', { args: {} })
  const targets = clients.filter(client => client.title === '瑞华云' && client.connection?.accountId === '35616')
  assert.equal(targets.length, 1)
  const target = targets[0]
  const check = await rpc('financeClients/checkConnection', { args: { clientId: target.clientId } })
  assert.equal(check.state, 'connected')
  assert.equal(check.accountName, '施的演示账套')
  const sessionId = randomUUID()
  const prompt = '只查询，不新增不修改。帮我看看这个账套里“F3主应用一级测试”那个科目：它是最上层的还是挂在哪个科目下面？属于哪种科目类型，余额在借方还是贷方，目前能用吗？请查真实资料后用简短中文回答，不准备任何新资料，不处理报销。'
  await save('intent.json', { sessionId, clientId: target.clientId, accountId: '35616', prompt,
    createdAt: new Date().toISOString(), businessWritesAuthorized: false }, true)
  await rpc('session.create', { sessionId, workspaceId: target.workspaceId, agentPreset: 'finance' })
  await rpc('financeClients/stage', { args: { agentId: sessionId, request: { mode: 'client', clientId: target.clientId } } })
  const model = await rpc('session.models', { sessionId })
  assert.equal(model.routable, true)
  await save('model.json', { current: model.current, routable: model.routable })
  await rpc('session.prompt', { sessionId, mode: 'queue', clientTimeZone: 'Asia/Shanghai', content: [{ type: 'text', text: prompt }] })
  console.log(JSON.stringify({ started: true, sessionId, businessWritesAuthorized: false }))
} else {
  const { sessionId } = JSON.parse(await readFile(new URL('intent.json', dir), 'utf8'))
  const { items } = await rpc('session.list', {})
  const session = items.find(item => item.sessionId === sessionId)
  assert.ok(session)
  const history = await rpc('session.history', { sessionId, maxMessages: 50 })
  await save('history.json', history)
  const events = history.events.map(item => item.event)
  const calls = events.filter(event => event.type === 'tool/call')
  const results = events.filter(event => event.type === 'tool/result').flatMap(event => event.data.message.content)
    .filter(block => block.type === 'tool-result')
  const answer = events.filter(event => event.type === 'assistant/message').flatMap(event => event.data.message.content)
    .filter(block => block.type === 'text').map(block => block.text).join('\n')
  console.log(JSON.stringify({ sessionId, running: session.running, calls: calls.map(call => call.data.name), answer }))
  if (!session.running) {
    assert.ok(calls.length > 0)
    assert.ok(calls.every(call => call.data.name === 'finance_references'), 'Only reference queries are permitted')
    assert.ok(results.length > 0 && results.every(result => !result.isError))
    const records = results.flatMap(result => result.content).filter(block => block.type === 'text').map(block => JSON.parse(block.text))
    assert.ok(records.every(record => record.accountId === '35616' && record.kind === 'subjects'))
    const match = records.flatMap(record => record.rows).find(row => row.code === '1097')
    assert.ok(match)
    assert.equal(match.subjectType, '流动资产')
    assert.equal(match.directionRaw, '0')
    assert.equal(match.parentCode, '')
    assert.equal(match.status, 'enabled')
    assert.match(answer, /流动资产/)
    assert.match(answer, /借方/)
    assert.match(answer, /启用/)
    await save('receipt.json', { checkedAt: new Date().toISOString(), sessionId, calls: calls.map(call => call.data.name),
      matchedRow: match, answer, businessWrites: 0, verified: true })
    console.log(JSON.stringify({ verified: true, code: '1097', businessWrites: 0 }))
  }
}
