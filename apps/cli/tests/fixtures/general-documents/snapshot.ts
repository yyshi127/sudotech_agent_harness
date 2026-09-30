import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { boot, healProfilesModuleFallback, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-xiaojing-finance-documents'

const dshHome = process.env.DSH_HOME
if (dshHome === undefined) throw new Error('General document snapshot requires DSH_HOME')

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url))
const installAnchor = fileURLToPath(new URL('../../../package.json', import.meta.url))
const rootConfig = join(repoRoot, 'packages', 'bundle', 'base', 'tests', 'fixtures', 'root.cordis.yml')
const basePatch = join(repoRoot, 'packages', 'bundle', 'base', 'cordis.patch.yml')
const webPatch = join(repoRoot, 'packages', 'bundle', 'web-app', 'cordis.patch.yml')
const standardPresetPatch = join(repoRoot, 'packages', 'bundle', 'web-app', 'presets', 'standard.patch.yml')
const overrides: PatchOptions[] = [
  { id: 'settings', config: { path: join(dshHome, 'settings.yaml'), watch: false } },
  { id: 'storage-json', config: { root: join(dshHome, 'storages') } },
  { id: 'webserver', disabled: true },
  { id: 'web-runtime', disabled: true },
  { id: 'session-telemetry-otel', disabled: true },
  { id: 'modules', disabled: true },
  { id: 'connection', disabled: true },
  { id: 'xiaojing-weixin-channel', disabled: true },
  { id: 'xiaojing-browser-control', disabled: true },
  { id: 'xiaojing-desktop-companion', disabled: true },
  { id: 'xiaojing-finance-domain', disabled: false, config: { dshHome, workspaceRoot: join(dshHome, 'finance-workspaces') } },
  { id: 'xiaojing-finance-documents', disabled: false, config: { dshHome } },
  { id: 'client-hmr', disabled: true },
  { id: 'directory-picker', disabled: true },
  { insert: [{ id: 'directory-picker-browse', name: '@deepseek-ai/dsh-host-directory-picker-browse' }] },
]

await mkdir(dshHome, { recursive: true })
await writeFile(join(dshHome, 'settings.yaml'), '{}\n')
const uploadRoot = join(dshHome, 'uploads')
await mkdir(uploadRoot, { recursive: true })
const sourcePath = join(uploadRoot, '普通模式资料.csv')
await writeFile(sourcePath, '项目,金额\n云服务费,88.00\n')

await healProfilesModuleFallback({ installAnchor, home: dshHome })
const ctx = await boot('general-document-snapshot', rootConfig, [
  ...loadOverlayPatches('general-document-snapshot', basePatch),
  ...loadOverlayPatches('general-document-snapshot', webPatch),
  ...loadOverlayPatches('general-document-snapshot', standardPresetPatch),
  ...overrides,
], (bootCtx) => {
  provideCmdline(bootCtx, { args: [], exit: () => {} })
})

try {
  const handle = await ctx.agents.create({
    sessionId: SessionId('general-document-snapshot'),
    meta: { cwd: dshHome },
    setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined),
  })
  try {
    handle.agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `请读取\n上传文件：\`${sourcePath}\`` }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const schemas = ctx.tools.schemas(handle.agent)
    const schema = schemas.find(candidate => candidate.name === 'document_reader')
    if (schema === undefined) throw new Error('General document snapshot did not assemble document_reader')
    const ordinaryPresetTools: Record<string, boolean> = { standard: true }
    for (const preset of ['code', 'cordis', 'minimal'] as const) {
      const probe = await ctx.agents.create({
        sessionId: SessionId(`general-document-${preset}-snapshot`),
        meta: { cwd: dshHome },
        setup: agentCtx => ctx.agentPresets.mount(agentCtx, preset).then(() => undefined),
      })
      try {
        ordinaryPresetTools[preset] = ctx.tools.schemas(probe.agent).some(candidate => candidate.name === 'document_reader')
      } finally {
        await probe.dispose()
      }
    }
    const documents = await ctx.xiaojingFinanceDocuments.listGeneralDocuments(handle.agent)
    const document = documents[0]
    if (document === undefined) throw new Error('General document snapshot did not discover the user upload')
    const signal = new AbortController().signal
    const list = await ctx.tools.execute({
      callId: ToolCallId('general-document-snapshot-list'),
      name: 'document_reader',
      arguments: { action: 'list' },
      signal,
      agent: handle.agent,
    })
    const read = await ctx.tools.execute({
      callId: ToolCallId('general-document-snapshot-read'),
      name: 'document_reader',
      arguments: { action: 'read', document_id: document.documentId, cursor: 0 },
      signal,
      agent: handle.agent,
    })
    if (list.isError || read.isError) {
      throw new Error(`General document snapshot tool failed: ${JSON.stringify({ list: list.content, read: read.content })}`)
    }
    const normalizeContent = (content: typeof list.content): typeof list.content => content.map(block => block.type === 'text'
      ? { ...block, text: block.text.replaceAll(String(document.documentId), '<document-id>') }
      : block)
    process.stdout.write(`${JSON.stringify({
      tool: { name: schema.name, description: schema.description, parameters: schema.parameters },
      financeToolVisible: schemas.some(candidate => candidate.name === 'finance_document'),
      ordinaryPresetTools,
      list: normalizeContent(list.content),
      read: normalizeContent(read.content),
    })}\n`)
  } finally {
    await handle.dispose()
  }
} finally {
  await ctx.fiber.dispose()
}
