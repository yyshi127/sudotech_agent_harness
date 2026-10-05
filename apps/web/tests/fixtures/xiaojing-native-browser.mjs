/** DevTools MCP wire and Windows policy metadata fixtures; no browser or personal profile is opened. */
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const [root, browser] = process.argv.slice(2)
if (root === '--profile-policy') {
  process.stdout.write('{"status":"ok","userDataDir":null,"remoteDebuggingAllowed":null}\n')
  process.exit(0)
}
const edge = browser === 'edge'
const record = (event, name) => appendFileSync(join(root, 'native-events.jsonl'), JSON.stringify({ event, browser, name, pid: process.pid }) + '\n')
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
record('start')
process.once('exit', () => record('exit'))
process.once('SIGTERM', () => process.exit(0))
const lines = createInterface({ input: process.stdin })
lines.once('close', () => process.exit(0))
lines.on('line', line => {
  const request = JSON.parse(line)
  if (request.id === undefined) return
  if (request.method === 'server/discover') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Native browser wire fixture' } }) + '\n')
  } else if (request.method === 'initialize') {
    reply(request.id, { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: `fixture-${browser}`, version: '1' }, instructions: `Use the native ${browser} tools to read the connected page.` })
  } else if (request.method === 'tools/list') {
    reply(request.id, { tools: [
      { name: 'list_pages', description: 'List connected browser pages.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      { name: 'take_snapshot', description: 'Read the connected browser page.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    ] })
  } else if (request.method === 'tools/call') {
    const name = request.params.name
    record('call', name)
    const content = {
      list_pages: edge ? '## Pages\n1: Edge office page (https://example.com/office) [selected]'
        : '## Pages\n1: Chrome finance page (https://example.com/finance) [selected]',
      take_snapshot: edge ? 'uid=1_0 RootWebArea "Edge office page" url="https://example.com/office"\n  uid=1_1 heading "Edge office page" level="1"\n  uid=1_2 StaticText "Quarterly office plan"'
        : 'uid=1_0 RootWebArea "Chrome finance page" url="https://example.com/finance"\n  uid=1_1 heading "Chrome finance page" level="1"\n  uid=1_2 StaticText "Monthly finance review"',
    }[name]
    if (content === undefined) throw new Error(`Unexpected native browser tool ${name}`)
    reply(request.id, { content: [{ type: 'text', text: content }] })
  } else {
    throw new Error(`Unexpected native browser method ${request.method}`)
  }
})
