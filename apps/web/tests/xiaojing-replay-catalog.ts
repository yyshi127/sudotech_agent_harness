/** Current Xiaojing model route for keyless browser fixtures. */
import type { LaunchOptions } from './scaffold.ts'
import { fileURLToPath } from 'node:url'

/** The Flash route selected by Xiaojing's model migration, with its published context and image support. */
export const XIAOJING_REPLAY_PROVIDERS: NonNullable<LaunchOptions['replayProviders']> = [{
  id: 'deepseek-official', name: 'DeepSeek',
  models: [{ id: 'deepseek-flash', name: 'DeepSeek-V41-Flash', contextWindow: 128_000, inputModalities: ['text', 'image'] }],
}]

/** Header-only replay makes current model labels available without accepting any model calls. */
export const XIAOJING_ROUTE_CATALOG: Pick<LaunchOptions, 'replayFixture' | 'replayProvidersOnly' | 'replayProviders'> = {
  replayFixture: fileURLToPath(new URL('./fixtures/xiaojing-route-catalog/session.v4.jsonl', import.meta.url)),
  replayProvidersOnly: true,
  replayProviders: XIAOJING_REPLAY_PROVIDERS,
}
