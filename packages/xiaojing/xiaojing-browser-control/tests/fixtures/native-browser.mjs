/** Local stdio server substituting only the external browser in native routing tests. */
import { appendFileSync, existsSync, watch, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const [root, route, mode, backend] = process.argv.slice(2)
const devtools = backend === 'devtools'
const record = (event, values = {}) => appendFileSync(join(root, 'events.ndjson'), JSON.stringify({ event, route, pid: process.pid, ...values }) + '\n')
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
record('start')
process.once('exit', () => record('exit'))
const lines = createInterface({ input: process.stdin })
let listed = false
lines.once('close', () => process.exit(0))
lines.on('line', line => {
  const request = JSON.parse(line)
  if (request.id === undefined) return
  if (request.method === 'server/discover') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Local browser fixture' } }) + '\n')
  } else if (request.method === 'initialize') {
    reply(request.id, { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: route, version: '1' }, instructions: `Use ${route} browser tools.` })
  } else if (request.method === 'tools/list') {
    reply(request.id, { tools: devtools ? [
      { name: 'list_pages', description: 'List existing pages.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      { name: 'take_snapshot', description: 'Read the current page.', inputSchema: { type: 'object', properties: { pageId: { type: 'number' }, hold: { type: 'boolean' } }, required: ['pageId'], additionalProperties: false } },
      { name: 'click', description: 'Click a visible node.', inputSchema: { type: 'object', properties: { pageId: { type: 'number' }, uid: { type: 'string' } }, required: ['pageId', 'uid'], additionalProperties: false } },
    ] : [
      { name: 'browser_tabs', description: 'List existing tabs.', inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['list'] } }, required: ['action'], additionalProperties: false } },
      { name: 'browser_snapshot', description: 'Read the current page.', inputSchema: { type: 'object', properties: { hold: { type: 'boolean' } }, additionalProperties: false } },
    ] })
  } else if (request.method === 'tools/call') {
    const { name, arguments: args } = request.params
    record('call', { name, hold: args.hold === true })
    if (mode === 'backend-death' && (name === 'take_snapshot' || name === 'browser_snapshot')
      && !existsSync(join(root, 'backend-restarted'))
      || mode === 'probe-backend-death' && (name === 'list_pages' || name === 'browser_tabs') && listed
        && !existsSync(join(root, 'backend-restarted'))) {
      writeFileSync(join(root, 'backend-restarted'), '')
      process.exit(0)
    }
    if (name === 'list_pages' || name === 'browser_tabs') listed = true
    const unavailable = mode === 'probe-failure' || (mode === 'chrome-probe-failure' && route.includes('chrome'))
    if (mode === 'probe-native-403' && name === 'list_pages') {
      reply(request.id, { isError: true, content: [{ type: 'text', text: 'Could not connect to Chrome. Check if Chrome is running and remote debugging is enabled by going to chrome://inspect/#remote-debugging. Cause: Unexpected server response: 403' }] })
    } else if ((name === 'browser_tabs' || name === 'list_pages') && unavailable && !existsSync(join(root, 'browser-ready'))) {
      reply(request.id, { isError: true, content: [{ type: 'text', text: 'Official browser extension is not installed.' }] })
    } else if (args.hold || mode === 'probe-hold' && (name === 'browser_tabs' || name === 'list_pages')) {
      const releasePath = join(root, args.hold ? 'release-operation' : 'browser-ready')
      const text = args.hold ? `Snapshot ${route}` : `Existing tab for ${route}`
      const respond = () => { record('settled', { name }); reply(request.id, { content: [{ type: 'text', text }] }) }
      const watcher = watch(root, () => { if (existsSync(releasePath)) { watcher.close(); respond() } })
      if (existsSync(releasePath)) { watcher.close(); respond() }
    } else {
      record('settled', { name })
      const text = name === 'browser_tabs' || name === 'list_pages' ? `Existing tab for ${route}` : `Snapshot ${route}`
      reply(request.id, { content: [{ type: 'text', text }] })
    }
  } else {
    throw new Error(`Unexpected fixture method ${request.method}`)
  }
})
