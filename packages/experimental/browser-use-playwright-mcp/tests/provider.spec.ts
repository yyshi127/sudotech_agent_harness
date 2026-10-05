import { existsSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { afterEach, expect, it, vi } from 'vitest'
import { mountSessionMcp } from '@deepseek-ai/dsh-experimental-browser-use-runtime/mcp'
import * as Provider from '../src/index.ts'

vi.mock('@deepseek-ai/dsh-experimental-browser-use-runtime/mcp', async importOriginal => ({
  ...await importOriginal<typeof import('@deepseek-ai/dsh-experimental-browser-use-runtime/mcp')>(),
  mountSessionMcp: vi.fn(),
}))
afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

it('uses the pinned Playwright executable with isolated Chromium launch settings', () => {
  vi.stubEnv('PLAYWRIGHT_MCP_CDP_ENDPOINT', 'http://invalid.example:1')
  Provider.apply(new Context(), Provider.Config({ mode: 'launch', executablePath: '/custom/chromium', toolCallTimeoutMs: 123 }))
  const options = vi.mocked(mountSessionMcp).mock.calls[0]![1]
  expect(existsSync(options.args[0]!)).toBe(true)
  expect(options).toMatchObject({ name: 'playwright-mcp', exclusive: false, command: process.execPath, toolCallTimeoutMs: 123 })
  expect(options.env?.PLAYWRIGHT_MCP_CDP_ENDPOINT).toBe('')
  expect(options.args.slice(1)).toEqual(['--browser', 'chromium', '--isolated', '--headless', '--executable-path', '/custom/chromium'])
  expect('default' in Provider).toBe(false)
})

it('supports headed launch and attaches without launching a browser or creating a profile', () => {
  Provider.apply(new Context(), Provider.Config({ mode: 'launch', headless: false }))
  expect(vi.mocked(mountSessionMcp).mock.calls[0]![1].args.slice(1)).toEqual(['--browser', 'chromium', '--isolated'])
  Provider.apply(new Context(), Provider.Config({ mode: 'attach', endpoint: 'http://127.0.0.1:9222' }))
  const options = vi.mocked(mountSessionMcp).mock.calls[1]![1]
  expect(options.exclusive).toBe(true)
  expect(options.args.slice(1)).toEqual(['--browser', 'chromium', '--cdp-endpoint', 'http://127.0.0.1:9222'])
})

it('rejects malformed endpoints before mounting any browser resources', () => {
  expect(() => { Provider.apply(new Context(), Provider.Config({ mode: 'attach', endpoint: 'http://localhost:bad/path' })) }).toThrow('browser endpoint')
  expect(mountSessionMcp).not.toHaveBeenCalled()
})

it.each(['chrome', 'msedge'] as const)('launches the selected %s channel under its own MCP namespace', (browser) => {
  Provider.apply(new Context(), Provider.Config({ mode: 'launch', browser, serverName: browser, headless: false }))
  const options = vi.mocked(mountSessionMcp).mock.calls[0]![1]
  expect(options.name).toBe(browser)
  expect(options.args.slice(1)).toEqual(['--browser', browser, '--isolated'])
})

it('attaches under a custom namespace without adding browser launch settings', () => {
  Provider.apply(new Context(), Provider.Config({ mode: 'attach', endpoint: 'http://127.0.0.1:9222', serverName: 'personal-edge' }))
  const options = vi.mocked(mountSessionMcp).mock.calls[0]![1]
  expect(options.name).toBe('personal-edge')
  expect(options.args.slice(1)).toEqual(['--browser', 'chromium', '--cdp-endpoint', 'http://127.0.0.1:9222'])
})

it('connects through the browser extension and passes its pairing token only in the child environment', () => {
  vi.stubEnv('PLAYWRIGHT_MCP_EXTENSION_TOKEN', 'ambient-fixture-token')
  vi.stubEnv('PLAYWRIGHT_MCP_BROWSER', 'msedge')
  vi.stubEnv('PLAYWRIGHT_MCP_CDP_ENDPOINT', 'http://invalid.example:1')
  Provider.apply(new Context(), Provider.Config({ mode: 'extension', browser: 'chrome', serverName: 'personal-chrome', extensionToken: 'configured-fixture-token', toolCallTimeoutMs: 321 }))
  const options = vi.mocked(mountSessionMcp).mock.calls[0]![1]
  expect(options).toMatchObject({ name: 'personal-chrome', exclusive: true, toolCallTimeoutMs: 321 })
  expect(options.args[0]).toBe('--dns-result-order=ipv4first')
  expect(existsSync(options.args[1]!)).toBe(true)
  expect(options.args.slice(2)).toEqual(['--browser', 'chrome', '--extension'])
  expect(options.args).not.toContain('configured-fixture-token')
  expect(options.env?.PLAYWRIGHT_MCP_EXTENSION_TOKEN).toBe('configured-fixture-token')
  expect(options.env?.PLAYWRIGHT_MCP_BROWSER).toBe('')
  expect(options.env?.PLAYWRIGHT_MCP_CDP_ENDPOINT).toBe('')
})

it('keeps extension tab selection with the user and clears an inherited pairing token', () => {
  vi.stubEnv('PLAYWRIGHT_MCP_EXTENSION_TOKEN', 'ambient-fixture-token')
  Provider.apply(new Context(), Provider.Config({ mode: 'extension' }))
  const options = vi.mocked(mountSessionMcp).mock.calls[0]![1]
  expect(options.name).toBe('playwright-mcp')
  expect(options.exclusive).toBe(true)
  expect(options.args.slice(2)).toEqual(['--browser', 'chromium', '--extension'])
  expect(options.env?.PLAYWRIGHT_MCP_EXTENSION_TOKEN).toBe('')
})

it('resolves extension options for a lazy Edge consumer without mounting a Session provider', () => {
  const options = Provider.createSessionMcpOptions(Provider.Config({ mode: 'extension', browser: 'msedge', executablePath: '/custom/edge', serverName: 'personal-edge' }))
  expect(options.name).toBe('personal-edge')
  expect(options.exclusive).toBe(true)
  expect(options.args.slice(2)).toEqual(['--browser', 'msedge', '--extension', '--executable-path', '/custom/edge'])
  expect(mountSessionMcp).not.toHaveBeenCalled()
})

it.each(['', 'invalid name', 'invalid/name', 'x'.repeat(33)])('rejects the invalid MCP namespace %j before mounting', (serverName) => {
  expect(() => Provider.Config({ mode: 'launch', serverName })).toThrow()
  expect(mountSessionMcp).not.toHaveBeenCalled()
})

it('rejects unsupported browser channels and empty extension tokens', () => {
  expect(() => Schema.resolve({ mode: 'launch', browser: 'firefox' }, Provider.Config, {})).toThrow()
  expect(() => Provider.Config({ mode: 'extension', extensionToken: '   ' })).toThrow()
  expect(mountSessionMcp).not.toHaveBeenCalled()
})

it.each(['verbatim', 'ipv4first', 'ipv6first'] as const)('puts extension DNS order %s before the native CLI', (dnsResultOrder) => {
  const options = Provider.createSessionMcpOptions(Provider.Config({ mode: 'extension', browser: 'msedge', dnsResultOrder }))
  expect(options.args[0]).toBe(`--dns-result-order=${dnsResultOrder}`)
  expect(existsSync(options.args[1]!)).toBe(true)
  expect(options.args[2]).toBe('--browser')
})

it('rejects unsupported DNS order without changing launch or attachment arguments', () => {
  expect(() => Schema.resolve({ mode: 'extension', dnsResultOrder: 'automatic' }, Provider.Config, {})).toThrow()
  for (const config of [Provider.Config({ mode: 'launch' }), Provider.Config({ mode: 'attach', endpoint: 'http://127.0.0.1:9222' })]) {
    expect(Provider.createSessionMcpOptions(config).args.some(arg => arg.startsWith('--dns-result-order'))).toBe(false)
  }
})
