/** Chromium browser tools from the pinned Playwright MCP server. @module */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { mountSessionMcp, validateBrowserMcpConfig } from '@deepseek-ai/dsh-experimental-browser-use-runtime/mcp'
import type { BrowserMcpAttachConfig, BrowserMcpLaunchConfig, SessionMcpOptions } from '@deepseek-ai/dsh-experimental-browser-use-runtime/mcp'
import type {} from '@deepseek-ai/dsh-working-directory'

/** Cordis identity for the Playwright MCP browser provider. */
export const name = 'experimental-browser-use-playwright-mcp'

/** Services required for scoped MCP startup and prompt readiness checks. */
export const inject = ['browserUse', 'agents', 'tools', 'systemPrompt', 'workingDirectory']

/** Chromium-family channels accepted by the pinned Playwright MCP server. */
export type BrowserChannel = 'chromium' | 'chrome' | 'msedge'

/** Node hostname lookup order for the extension's local connection relay. */
export type DnsResultOrder = 'verbatim' | 'ipv4first' | 'ipv6first'

/** Isolated Playwright launch with an explicit Chromium-family channel. */
export interface BrowserLaunchConfig extends BrowserMcpLaunchConfig {
  /** Browser channel to launch; defaults to Chromium. */
  browser: BrowserChannel
}

/** MCP namespace shared by the browser route's discovered tools. */
export interface BrowserNamespaceConfig {
  /** Unique MCP server name; defaults to playwright-mcp. */
  serverName: string
}

/** Connection to the browser and tab selected through the Playwright extension. */
export interface BrowserExtensionConfig {
  /** Connect through the installed extension instead of launching a browser. */
  mode: 'extension'
  /** Browser channel containing the installed extension; defaults to Chromium. */
  browser: BrowserChannel
  /** Browser executable used to open the extension connection page. */
  executablePath?: string
  /** Optional extension pairing token, passed only through the child environment. */
  extensionToken?: string
  /** Node DNS lookup order for the extension relay; defaults to IPv4 first. */
  dnsResultOrder: DnsResultOrder
  /** Per-call timeout override in milliseconds; omission uses the MCP client default. */
  toolCallTimeoutMs?: number
}

/** Fixed browser route and tool namespace for one provider activation. */
export type Config = (
  | BrowserLaunchConfig
  | BrowserMcpAttachConfig
  | BrowserExtensionConfig
) & BrowserNamespaceConfig

type ConfigInput = (
  | Omit<BrowserMcpLaunchConfig, 'headless'> & { headless?: boolean; browser?: BrowserChannel }
  | BrowserMcpAttachConfig
  | Omit<BrowserExtensionConfig, 'browser' | 'dnsResultOrder'> & { browser?: BrowserChannel; dnsResultOrder?: DnsResultOrder }
) & { serverName?: string }

/** Validate launch, debugging endpoint, or extension settings before activation. */
export const Config: Schema<ConfigInput, Config> = Schema.union([
  Schema.object({
    serverName: Schema.string().pattern(/^[A-Za-z0-9_-]{1,32}$/u).default('playwright-mcp'),
    toolCallTimeoutMs: Schema.number().min(1),
    mode: Schema.const('launch').required(),
    browser: Schema.union(['chromium', 'chrome', 'msedge']).default('chromium'),
    headless: Schema.boolean().default(true),
    executablePath: Schema.string().pattern(/\S/u),
  }),
  Schema.object({
    serverName: Schema.string().pattern(/^[A-Za-z0-9_-]{1,32}$/u).default('playwright-mcp'),
    toolCallTimeoutMs: Schema.number().min(1),
    mode: Schema.const('attach').required(),
    endpoint: Schema.string().pattern(/^https?:\/\/[^\s/]+|^wss?:\/\/[^\s/]+/u).required(),
  }),
  Schema.object({
    serverName: Schema.string().pattern(/^[A-Za-z0-9_-]{1,32}$/u).default('playwright-mcp'),
    toolCallTimeoutMs: Schema.number().min(1),
    mode: Schema.const('extension').required(),
    browser: Schema.union(['chromium', 'chrome', 'msedge']).default('chromium'),
    executablePath: Schema.string().pattern(/\S/u),
    extensionToken: Schema.string().pattern(/\S/u).role('secret'),
    dnsResultOrder: Schema.union(['verbatim', 'ipv4first', 'ipv6first']).default('ipv4first'),
  }),
])

/**
 * Expose Playwright's upstream tools in each live Session's scope.
 * The pinned npm server runs under the current Node executable; browser state is not persisted by DSH.
 * @param ctx - provider context supplying browser use, Agents, and tools.
 * @param config - validated route, tool namespace, and optional timeout.
 */
export function apply(ctx: Context, config: Config): void {
  mountSessionMcp(ctx, createSessionMcpOptions(config))
}

/**
 * Resolve the pinned MCP executable and explicit browser route without starting a process.
 * Extension tokens stay in the child environment and never enter command arguments.
 * @param config - validated browser settings and MCP tool namespace.
 * @returns server options for the shared Session runtime or a lazy consumer.
 */
export function createSessionMcpOptions(config: Config): SessionMcpOptions {
  if (config.mode !== 'extension') validateBrowserMcpConfig(config)
  const cli = join(dirname(fileURLToPath(import.meta.resolve('@playwright/mcp/package.json'))), 'cli.js')
  // Upstream environment options can otherwise replace the configured browser
  // mode or import an unrelated profile. Empty values mean absent to its parser.
  const env = Object.fromEntries(Object.keys(process.env)
    .filter(key => key.toUpperCase().startsWith('PLAYWRIGHT_MCP_'))
    .map(key => [key, '']))
  const args = config.mode === 'extension' ? [`--dns-result-order=${config.dnsResultOrder}`, cli] : [cli]
  if (config.mode === 'extension') {
    args.push('--browser', config.browser, '--extension')
    if (config.executablePath !== undefined) args.push('--executable-path', config.executablePath)
    if (config.extensionToken !== undefined) env.PLAYWRIGHT_MCP_EXTENSION_TOKEN = config.extensionToken
  } else if (config.mode === 'attach') {
    args.push('--browser', 'chromium')
    args.push('--cdp-endpoint', config.endpoint)
  } else {
    args.push('--browser', config.browser)
    args.push('--isolated')
    if (config.headless) args.push('--headless')
    if (config.executablePath !== undefined) args.push('--executable-path', config.executablePath)
  }
  return {
    name: config.serverName,
    exclusive: config.mode !== 'launch',
    command: process.execPath,
    args,
    env,
    ...config.toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs: config.toolCallTimeoutMs },
  }
}
