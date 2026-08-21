import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { chromium } from 'playwright-core'
import BrowserControl from '../../src/index.ts'

const server = createServer((_request, response) => {
  response.setHeader('content-type', 'text/html; charset=utf-8')
  response.end('<!doctype html><input aria-label="Name"><button>Confirm</button>')
})

await new Promise<void>((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})
const address = server.address()
if (address === null || typeof address === 'string') throw new Error('source-launch fixture server did not bind TCP')

const profileDir = await mkdtemp(join(tmpdir(), 'xiaojing-browser-source-launch-'))
const ctx = new Context()
let fiber: Awaited<ReturnType<typeof ctx.plugin>> | undefined
try {
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  fiber = await ctx.plugin(BrowserControl, {
    profileDir,
    ...process.platform === 'win32' ? {} : { executablePath: chromium.executablePath() },
    headless: true,
    allowPrivateHosts: true,
  })
  const opened = await ctx.xiaojingBrowserControl.run(
    SessionId('source-launch-smoke'),
    { action: 'open', url: `http://127.0.0.1:${String(address.port)}` },
    new AbortController().signal,
  )
  if (opened.targets?.some(target => target.name === 'Name') !== true) {
    throw new Error('tsx source launch did not project the fixture input')
  }
  process.stdout.write('source-launch-browser-ok\n')
} finally {
  if (fiber !== undefined) await fiber.dispose()
  await new Promise<void>(resolve => server.close(() => { resolve() }))
  await rm(profileDir, { recursive: true, force: true })
}
