/** Chromium inspection and automation through the pinned Chrome DevTools MCP server. @module */

import { fileURLToPath } from 'node:url'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { mountSessionMcp, validateBrowserMcpConfig } from '@deepseek-ai/dsh-experimental-browser-use-runtime/mcp'
import type { BrowserMcpAttachConfig, BrowserMcpLaunchConfig, SessionMcpOptions } from '@deepseek-ai/dsh-experimental-browser-use-runtime/mcp'
import type {} from '@deepseek-ai/dsh-working-directory'

/** Cordis identity for the Chrome DevTools MCP browser provider. */
export const name = 'experimental-browser-use-chrome-devtools-mcp'

/** Services required for scoped MCP startup and prompt readiness checks. */
export const inject = ['browserUse', 'agents', 'tools', 'systemPrompt', 'workingDirectory']

/** Connection discovered by the pinned server from an externally owned browser profile. */
export interface BrowserAutoConnectConfig {
  /** Exclusively connect one live Session to a running browser through its profile metadata. */
  mode: 'auto-connect'
  /** Explicit absolute browser user-data directory; no profile contents are imported into the model. */
  userDataDir: string
  /** Per-call timeout override in milliseconds; omission uses the MCP client default. */
  toolCallTimeoutMs?: number
}

/** Native MCP tool namespace for one provider activation. */
export interface BrowserNamespaceConfig {
  /** MCP server identity and native tool namespace; defaults to chrome-devtools-mcp. */
  serverName: string
}

/** Fixed Chromium launch, endpoint attachment, or existing-profile connection settings. */
export type Config = (BrowserMcpLaunchConfig | BrowserMcpAttachConfig | BrowserAutoConnectConfig) & BrowserNamespaceConfig

type ConfigInput = (BrowserMcpAttachConfig | BrowserAutoConnectConfig | Omit<BrowserMcpLaunchConfig, 'headless'> & { headless?: boolean }) & { serverName?: string }

/** Validate launch, attachment, or existing-profile settings before activation. */
export const Config: Schema<ConfigInput, Config> = Schema.union([
  Schema.object({
    serverName: Schema.string().pattern(/^[A-Za-z0-9_-]{1,32}$/u).default('chrome-devtools-mcp'),
    toolCallTimeoutMs: Schema.number().min(1),
    mode: Schema.const('launch').required(),
    headless: Schema.boolean().default(true),
    executablePath: Schema.string().pattern(/\S/u),
  }),
  Schema.object({
    serverName: Schema.string().pattern(/^[A-Za-z0-9_-]{1,32}$/u).default('chrome-devtools-mcp'),
    toolCallTimeoutMs: Schema.number().min(1),
    mode: Schema.const('attach').required(),
    endpoint: Schema.string().pattern(/^https?:\/\/[^\s/]+|^wss?:\/\/[^\s/]+/u).required(),
  }),
  Schema.object({
    serverName: Schema.string().pattern(/^[A-Za-z0-9_-]{1,32}$/u).default('chrome-devtools-mcp'),
    toolCallTimeoutMs: Schema.number().min(1),
    mode: Schema.const('auto-connect').required(),
    userDataDir: Schema.string().pattern(/^(?:[A-Za-z]:[\\/]|\\\\|\/)/u).required(),
  }),
])

/**
 * Expose Chrome DevTools' upstream catalog through one MCP process per live Session.
 * Attached browsers remain externally owned; the server disables usage statistics.
 * @param ctx - provider context supplying browser use, Agents, and tools.
 * @param config - validated browser choice and optional tool timeout.
 */
export function apply(ctx: Context, config: Config): void {
  mountSessionMcp(ctx, createSessionMcpOptions(config))
}

/**
 * Resolve the pinned DevTools executable and explicit route without starting a process.
 * @param config - validated browser settings and MCP tool namespace.
 * @returns server options for the shared Session runtime or a lazy consumer.
 */
export function createSessionMcpOptions(config: Config): SessionMcpOptions {
  if (config.mode === 'auto-connect') {
    if (!isAbsolute(config.userDataDir) || config.userDataDir.includes('\0')) {
      throw new Error('browser userDataDir must be an absolute directory path')
    }
  } else {
    validateBrowserMcpConfig(config)
  }
  const cli = fileURLToPath(import.meta.resolve('chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js'))
  const args = [cli, '--no-usage-statistics']
  if (config.mode === 'attach') {
    args.push(/^wss?:/u.test(config.endpoint) ? '--ws-endpoint' : '--browser-url', config.endpoint)
  } else if (config.mode === 'auto-connect') {
    args.push('--autoConnect', '--user-data-dir', config.userDataDir)
  } else {
    args.push('--isolated', `--headless=${String(config.headless)}`)
    if (config.executablePath !== undefined) args.push('--executable-path', config.executablePath)
  }
  return {
    name: config.serverName,
    exclusive: config.mode !== 'launch',
    command: process.execPath,
    args,
    ...config.toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs: config.toolCallTimeoutMs },
  }
}
