import { it } from 'vitest'
import { verifyMcpBrowser } from '../../browser-use-runtime/tests/mcp-upstream.ts'
import * as Provider from '../src/index.ts'

it.skipIf(process.env.DSH_BROWSER_EXECUTABLE === undefined).each(['launch', 'attach'] as const)(
  'uses the pinned Playwright MCP server to %s Chromium and visit a loopback page',
  async mode => verifyMcpBrowser({ apply(ctx, config) { Provider.apply(ctx, Provider.Config(config)) } }, 'playwright-mcp', { name: 'browser_navigate', arguments: url => ({ url }) }, mode),
)
