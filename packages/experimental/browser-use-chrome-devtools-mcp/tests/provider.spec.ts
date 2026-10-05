import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { mountSessionMcp } from '@deepseek-ai/dsh-experimental-browser-use-runtime/mcp'
import * as Provider from '../src/index.ts'

vi.mock('@deepseek-ai/dsh-experimental-browser-use-runtime/mcp', async importOriginal => ({
  ...await importOriginal<typeof import('@deepseek-ai/dsh-experimental-browser-use-runtime/mcp')>(),
  mountSessionMcp: vi.fn(),
}))
afterEach(() => vi.clearAllMocks())

it('resolves the installed DevTools CLI and explicitly selects isolated headed or headless launch', () => {
  Provider.apply(new Context(), Provider.Config({ mode: 'launch', executablePath: '/custom/chrome', toolCallTimeoutMs: 456 }))
  const options = vi.mocked(mountSessionMcp).mock.calls[0]![1]
  expect(existsSync(options.args[0]!)).toBe(true)
  expect(options).toMatchObject({ name: 'chrome-devtools-mcp', exclusive: false, command: process.execPath, toolCallTimeoutMs: 456 })
  expect(options.args.slice(1)).toEqual(['--no-usage-statistics', '--isolated', '--headless=true', '--executable-path', '/custom/chrome'])
  Provider.apply(new Context(), Provider.Config({ mode: 'launch', headless: false }))
  expect(vi.mocked(mountSessionMcp).mock.calls[1]![1].args.slice(1)).toEqual(['--no-usage-statistics', '--isolated', '--headless=false'])
  expect('default' in Provider).toBe(false)
})

it.each([
  ['http://127.0.0.1:9222', '--browser-url'],
  ['wss://browser.example/devtools/browser/id', '--ws-endpoint'],
])('attaches to %s without passing launch flags', (endpoint, flag) => {
  Provider.apply(new Context(), Provider.Config({ mode: 'attach', endpoint }))
  const options = vi.mocked(mountSessionMcp).mock.calls[0]![1]
  expect(options.exclusive).toBe(true)
  expect(options.args.slice(1)).toEqual(['--no-usage-statistics', flag, endpoint])
})

it('connects an existing profile through the native CLI without launch flags or executable selection', () => {
  const userDataDir = resolve('fixture-browser-profile')
  Provider.apply(new Context(), Provider.Config({ mode: 'auto-connect', userDataDir, serverName: 'personal-edge', toolCallTimeoutMs: 600_000 }))
  const options = vi.mocked(mountSessionMcp).mock.calls[0]![1]
  expect(options).toMatchObject({ name: 'personal-edge', exclusive: true, toolCallTimeoutMs: 600_000 })
  expect(options.args.slice(1)).toEqual(['--no-usage-statistics', '--autoConnect', '--user-data-dir', userDataDir])
  expect(options.args).not.toContain('--isolated')
  expect(options.args).not.toContain('--executable-path')
})

it.each(['', 'relative/profile', './profile', '/profile\0tail'])('rejects an invalid existing-profile directory %j before mounting', (userDataDir) => {
  expect(() => { Provider.apply(new Context(), Provider.Config({ mode: 'auto-connect', userDataDir })) }).toThrow()
  expect(mountSessionMcp).not.toHaveBeenCalled()
})

it('rejects trailing endpoint garbage before mounting any browser resources', () => {
  expect(() => { Provider.apply(new Context(), Provider.Config({ mode: 'attach', endpoint: 'http://localhost trailing-junk' })) }).toThrow('browser endpoint')
  expect(mountSessionMcp).not.toHaveBeenCalled()
})

it('resolves native options for a lazy consumer without mounting or launching a browser', () => {
  const options = Provider.createSessionMcpOptions(Provider.Config({ mode: 'launch', headless: false, serverName: 'xiaojing-edge-managed', executablePath: '/custom/edge' }))
  expect(options.name).toBe('xiaojing-edge-managed')
  expect(options.args.slice(1)).toEqual(['--no-usage-statistics', '--isolated', '--headless=false', '--executable-path', '/custom/edge'])
  expect(vi.mocked(mountSessionMcp)).not.toHaveBeenCalled()
})

it.each(['', 'with spaces', 'a'.repeat(33)])('rejects invalid browser namespaces: %s', (serverName) => {
  expect(() => Provider.Config({ mode: 'launch', serverName })).toThrow()
})
