import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strToU8, zipSync } from 'fflate'
import type { Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  FinanceClientId,
  FinanceManagedFileId,
  type FinanceClientBinding,
} from '@deepseek-ai/dsh-xiaojing-finance-domain/types'
import { FINANCE_CAPABILITIES } from '@deepseek-ai/dsh-xiaojing-finance-domain/capabilities'
import {
  provisionFinanceClientWorkspace,
  resolveFinanceClientWorkspace,
} from '@deepseek-ai/dsh-xiaojing-finance-domain/workspace'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-tools'

const dshHome = process.env.DSH_HOME
if (dshHome === undefined) throw new Error('Finance document snapshot requires DSH_HOME')

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url))
const rootConfig = join(repoRoot, 'packages', 'bundle', 'base', 'tests', 'fixtures', 'root.cordis.yml')
const basePatch = join(repoRoot, 'packages', 'bundle', 'base', 'cordis.patch.yml')
const webPatch = join(repoRoot, 'packages', 'bundle', 'web-app', 'cordis.patch.yml')
const standardPresetPatch = join(repoRoot, 'packages', 'bundle', 'web-app', 'presets', 'standard.patch.yml')
const financePresetPatch = join(repoRoot, 'apps', 'cli', 'config', 'xiaojing-agent-presets', 'finance', 'agent.cordis.yml')
const workspaceRoot = join(dshHome, 'finance-workspaces')
const overrides: PatchOptions[] = [
  { id: 'settings', config: { path: join(dshHome, 'settings.yaml'), watch: false } },
  { id: 'storage-json', config: { root: join(dshHome, 'storages') } },
  { id: 'webserver', disabled: true },
  { id: 'web-runtime', disabled: true },
  { id: 'session-telemetry-otel', disabled: true },
  { id: 'modules', disabled: true },
  { id: 'connection', disabled: true },
  { id: 'usage-accounting', disabled: true },
  { id: 'session-log-download', disabled: true },
  { id: 'open-in-app', disabled: true },
  { id: 'session-controller', disabled: true },
  { id: 'file-upload', disabled: true },
  { id: 'ui-deliverables', disabled: true },
  { id: 'xiaojing-weixin-channel', disabled: true },
  { id: 'xiaojing-browser-control', disabled: true },
  { id: 'xiaojing-desktop-companion', disabled: true },
  { id: 'xiaojing-finance-domain', disabled: false, config: { dshHome, workspaceRoot } },
  { id: 'xiaojing-finance-calculations', disabled: false },
  { id: 'xiaojing-finance-evidence', disabled: false, config: { dshHome } },
  { id: 'xiaojing-finance-documents', disabled: false, config: { dshHome } },
  { id: 'client-hmr', disabled: true },
  { id: 'directory-picker', disabled: true },
  { insert: [
    { id: 'directory-picker-browse', name: '@deepseek-ai/dsh-host-directory-picker-browse' },
  ] },
]

function presentation(): Buffer {
  const slide = '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>经营简报</a:t></a:r></a:p><a:p><a:r><a:t>营业收入 &amp; 税额</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
  const notes = '<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>备注：核对税率</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>'
  return Buffer.from(zipSync(Object.fromEntries(Object.entries({
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
    'ppt/presentation.xml': '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>',
    'ppt/_rels/presentation.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>',
    'ppt/slides/slide1.xml': slide,
    'ppt/slides/_rels/slide1.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>',
    'ppt/notesSlides/notesSlide1.xml': notes,
  }).map(([name, value]) => [name, strToU8(value)]))))
}

function scannedPdf(): Buffer {
  return Buffer.from(
    'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9YT2JqZWN0IDw8IC9JbTAgNCAwIFIgPj4gPj4gL0NvbnRlbnRzIDUgMCBSID4+CmVuZG9iago0IDAgb2JqCjw8IC9UeXBlIC9YT2JqZWN0IC9TdWJ0eXBlIC9JbWFnZSAvV2lkdGggMSAvSGVpZ2h0IDEgL0NvbG9yU3BhY2UgL0RldmljZVJHQiAvQml0c1BlckNvbXBvbmVudCA4IC9MZW5ndGggMyA+PgpzdHJlYW0K/wAACmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvTGVuZ3RoIDMxID4+CnN0cmVhbQpxIDE2IDAgMCAxNiA3MiA3MDAgY20gL0ltMCBEbyBRCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQ1IDAwMDAwIG4gCjAwMDAwMDAzOTAgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo0NzEKJSVFT0YK',
    'base64',
  )
}

interface AcceptanceClient {
  binding: FinanceClientBinding
  sessionId: ReturnType<typeof SessionId>
  documentId: string
  sourceName: string
}

function resultText(result: { content: readonly { type: string; text?: string }[] }): string {
  return result.content
    .filter((item): item is { type: string; text: string } => item.type === 'text' && item.text !== undefined)
    .map(item => item.text)
    .join('\n')
}

async function executeChecked(
  ctx: Context,
  agent: Agent,
  callId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const result = await ctx.tools.execute({
    callId: ToolCallId(callId),
    name,
    arguments: args,
    signal: new AbortController().signal,
    agent,
  })
  if (result.isError) throw new Error(`${callId} failed: ${JSON.stringify(result.content)}`)
  return resultText(result)
}

async function createAcceptanceClient(
  ctx: Context,
  client: AcceptanceClient,
  source: Buffer,
): Promise<{ agent: Agent; dispose(): Promise<void>; sourcePath: string }> {
  const clientRoot = await provisionFinanceClientWorkspace(client.binding.workspacePath, {
    clientId: client.binding.client.id,
    clientVersion: client.binding.clientVersion,
    displayName: client.binding.client.shortName ?? client.binding.client.legalName,
  })
  const handle = await ctx.agents.create({
    sessionId: client.sessionId,
    meta: { cwd: clientRoot },
    setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'finance').then(() => undefined),
  })
  handle.agent.session.append('finance/client-bound', client.binding)
  const workspace = resolveFinanceClientWorkspace(client.binding, client.sessionId)
  const sourcePath = join(workspace.sourceDirectory, client.sourceName)
  await writeFile(sourcePath, source)
  handle.agent.session.append('finance/file-imported', {
    schemaVersion: 1,
    file: {
      id: FinanceManagedFileId(client.documentId),
      clientId: client.binding.client.id,
      sessionId: client.sessionId,
      action: 'import',
      stage: 'source',
      path: sourcePath,
      name: client.sourceName,
      sha256: createHash('sha256').update(source).digest('hex'),
      size: source.length,
      createdAt: 1,
    },
  })
  return { agent: handle.agent, dispose: () => handle.dispose(), sourcePath }
}

async function runStage1Acceptance(ctx: Context): Promise<void> {
  const sharedSource = Buffer.from('项目,金额\n云服务费,88.00\n')
  const clients: [AcceptanceClient, AcceptanceClient] = [
    {
      sessionId: SessionId('finance-stage1-client-a'),
      documentId: 'finance-stage1-document-a',
      sourceName: '甲客户云服务费.csv',
      binding: {
        schemaVersion: 1,
        clientVersion: 2,
        workspacePath: join(workspaceRoot, 'stage1-client-a'),
        client: {
          id: FinanceClientId('6ba7b810-9dad-11d1-80b4-00c04fd430c8'),
          legalName: '甲方科技有限公司',
          shortName: '甲方科技',
          taxpayerType: 'general-vat',
          registeredRegion: '上海市',
          accountingStandard: 'enterprise',
          financePolicyNotes: '甲方费用按部门归集。',
          chartMappings: [{ localAccountCode: '6602', externalAccountCode: 'A-6602' }],
          externalSystemRefs: [{ system: 'sdoo', tenantId: 'tenant-a', companyId: 'company-a' }],
        },
      },
    },
    {
      sessionId: SessionId('finance-stage1-client-b'),
      documentId: 'finance-stage1-document-b',
      sourceName: '乙客户云服务费.csv',
      binding: {
        schemaVersion: 1,
        clientVersion: 3,
        workspacePath: join(workspaceRoot, 'stage1-client-b'),
        client: {
          id: FinanceClientId('6ba7b811-9dad-11d1-80b4-00c04fd430c8'),
          legalName: '乙方商贸有限公司',
          shortName: '乙方商贸',
          taxpayerType: 'small-scale-vat',
          registeredRegion: '浙江省杭州市',
          accountingStandard: 'small-enterprise',
          financePolicyNotes: '乙方费用按项目归集。',
          chartMappings: [{ localAccountCode: '6602', externalAccountCode: 'B-6602' }],
          externalSystemRefs: [{ system: 'youcheng', tenantId: 'tenant-b', companyId: 'company-b' }],
        },
      },
    },
  ]
  const standard = await ctx.agents.create({
    sessionId: SessionId('finance-stage1-standard'),
    meta: { cwd: workspaceRoot },
    setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined),
  })
  const clientA = await createAcceptanceClient(ctx, clients[0], sharedSource)
  const clientB = await createAcceptanceClient(ctx, clients[1], sharedSource)
  try {
    const standardTools = ctx.tools.schemas(standard.agent).map(tool => tool.name).sort()
    const financeTools = ctx.tools.schemas(clientA.agent).map(tool => tool.name).sort()
    const standardSkills = (await ctx.skills.list({ scope: standard.agent })).map(skill => skill.name)
    const financeSkills = (await ctx.skills.list({ scope: clientA.agent })).map(skill => skill.name)
    const [assemblyA, assemblyB] = await Promise.all([
      ctx.systemPrompt.assemble(assembleContextFor(clientA.agent)),
      ctx.systemPrompt.assemble(assembleContextFor(clientB.agent)),
    ])
    const contextA = assemblyA.contexts.find(context => context.name === 'xiaojing:finance-client')?.text ?? ''
    const contextB = assemblyB.contexts.find(context => context.name === 'xiaojing:finance-client')?.text ?? ''
    const capabilitiesA = assemblyA.sections.find(section => section.name === 'xiaojing:finance-capabilities')?.text ?? ''
    const capabilitiesB = assemblyB.sections.find(section => section.name === 'xiaojing:finance-capabilities')?.text ?? ''
    const [listA, listB, readA, readB] = await Promise.all([
      executeChecked(ctx, clientA.agent, 'finance-stage1-list-a', 'finance_document', { action: 'list' }),
      executeChecked(ctx, clientB.agent, 'finance-stage1-list-b', 'finance_document', { action: 'list' }),
      executeChecked(ctx, clientA.agent, 'finance-stage1-read-a', 'finance_document', {
        action: 'read', document_id: clients[0].documentId, cursor: 0,
      }),
      executeChecked(ctx, clientB.agent, 'finance-stage1-read-b', 'finance_document', {
        action: 'read', document_id: clients[1].documentId, cursor: 0,
      }),
    ])
    const [crossA, crossB] = await Promise.all([
      ctx.tools.execute({
        callId: ToolCallId('finance-stage1-cross-a'),
        name: 'finance_document',
        arguments: { action: 'read', document_id: clients[1].documentId, cursor: 0 },
        signal: new AbortController().signal,
        agent: clientA.agent,
      }),
      ctx.tools.execute({
        callId: ToolCallId('finance-stage1-cross-b'),
        name: 'finance_document',
        arguments: { action: 'read', document_id: clients[0].documentId, cursor: 0 },
        signal: new AbortController().signal,
        agent: clientB.agent,
      }),
    ])
    const [calculationA, calculationB, jurisdiction] = await Promise.all([
      executeChecked(ctx, clientA.agent, 'finance-stage1-calculation-a', 'finance_calculation', {
        calculation: 'vat',
        as_of_date: '2026-08-29',
        tax_exclusive_sales: '100000',
        vat_rate_percent: '13',
        deductible_input_vat: '5000',
        prior_vat_credit: '1000',
      }),
      executeChecked(ctx, clientB.agent, 'finance-stage1-calculation-b', 'finance_calculation', {
        calculation: 'vat',
        as_of_date: '2026-08-29',
        tax_exclusive_sales: '90000',
        filing_frequency: 'monthly',
        mandatory_taxable_sales: '0',
        apply_small_scale_one_percent: true,
      }),
      executeChecked(ctx, clientA.agent, 'finance-stage1-jurisdiction', 'finance_evidence', {
        query: '利得税',
        as_of_date: '2026-08-29',
        locality: '香港特别行政区',
      }),
    ])
    const financeOnlyTools = financeTools.filter(name => !standardTools.includes(name))
    const financeOnlySkills = financeSkills.filter(name => !standardSkills.includes(name)).sort()
    const inventoriedTools = [...new Set(FINANCE_CAPABILITIES.flatMap(capability => capability.toolNames))].sort()
    const acceptance = {
      capabilityContext: capabilitiesA,
      capabilityParity: {
        financeOnlyTools,
        financeOnlySkills,
        standardHasFinanceTools: standardTools.some(name => name.startsWith('finance_')),
      },
      capabilityGuidance: {
        bothClientsReceiveSameInventory: capabilitiesA === capabilitiesB,
        bindingDoesNotClaimConnection: capabilitiesA.includes('绑定只确认客户身份，不证明有成连接、权限或接口此刻可用'),
        genericIntroductionUsesPositioning: capabilitiesA.includes('对外定位概述（用于一般能力介绍）')
          && capabilitiesA.includes('小兢会计，您的AI财务助手')
          && capabilitiesA.includes('不得主动罗列详细支持状态、接口限制、内部工具或六类原生报表等具体缺口'),
        reportsRemainConnectorScoped: capabilitiesA.includes('[暂不支持] 六类原生账簿与报表（适用范围：当前有成财务接入）')
          && capabilitiesA.includes('这不限制小兢会计基于用户提供的可靠资料进行分析或生成成果'),
        registeredToolsMatchInventory: JSON.stringify(financeOnlyTools) === JSON.stringify(inventoriedTools),
        reimbursementIsExcluded: capabilitiesA.includes('[暂不支持] 报销业务（适用范围：当前财务工作区）')
          && !financeTools.includes('finance_reimbursement')
          && !financeSkills.includes('finance-reimbursement'),
        sourceOfTruthIsExplicit: capabilitiesA.includes('回答产品能力问题的唯一真源'),
      },
      clientIsolation: {
        clientAHasOnlyOwnContext: contextA.includes('甲方科技有限公司') && !contextA.includes('乙方商贸有限公司'),
        clientBHasOnlyOwnContext: contextB.includes('乙方商贸有限公司') && !contextB.includes('甲方科技有限公司'),
        clientAHasOnlyOwnDocument: listA.includes('甲客户云服务费.csv') && !listA.includes('乙客户云服务费.csv'),
        clientBHasOnlyOwnDocument: listB.includes('乙客户云服务费.csv') && !listB.includes('甲客户云服务费.csv'),
        crossClientReadsRejected: crossA.isError && crossB.isError,
      },
      documentTraceability: {
        sameSourceHash: createHash('sha256').update(sharedSource).digest('hex'),
        separateStoragePaths: clientA.sourcePath !== clientB.sourcePath,
        clientAReadHasSourceLocation: readA.includes('甲客户云服务费.csv') && readA.includes('第2行'),
        clientBReadHasSourceLocation: readB.includes('乙客户云服务费.csv') && readB.includes('第2行'),
      },
      deterministicCalculations: {
        generalVatUsesBoundClient: calculationA.includes('一般纳税人（client）') && calculationA.includes('7000.00元'),
        smallScaleVatUsesBoundClient: calculationB.includes('小规模纳税人（client）') && calculationB.includes('0.00元'),
      },
      jurisdictionSafety: {
        unsupportedLocalityRefused: jurisdiction.includes('超出中国大陆范围')
          && jurisdiction.includes('香港特别行政区'),
      },
    }
    const passed = !acceptance.capabilityParity.standardHasFinanceTools
      && acceptance.capabilityParity.financeOnlySkills.length === 5
      && Object.values(acceptance.capabilityGuidance).every(Boolean)
      && Object.values(acceptance.clientIsolation).every(Boolean)
      && acceptance.documentTraceability.separateStoragePaths
      && acceptance.documentTraceability.clientAReadHasSourceLocation
      && acceptance.documentTraceability.clientBReadHasSourceLocation
      && Object.values(acceptance.deterministicCalculations).every(Boolean)
      && acceptance.jurisdictionSafety.unsupportedLocalityRefused
    if (!passed) {
      throw new Error(`Finance Stage 1 acceptance failed: ${JSON.stringify(acceptance)}`)
    }
    process.stdout.write(`${JSON.stringify(acceptance)}\n`)
  } finally {
    await clientB.dispose()
    await clientA.dispose()
    await standard.dispose()
  }
}

await mkdir(dshHome, { recursive: true })
await writeFile(join(dshHome, 'settings.yaml'), '{}\n')
const ctx = await boot('finance-document-snapshot', rootConfig, [
  ...loadOverlayPatches('finance-document-snapshot', basePatch),
  ...loadOverlayPatches('finance-document-snapshot', webPatch),
  ...loadOverlayPatches('finance-document-snapshot', standardPresetPatch),
  ...loadOverlayPatches('finance-document-snapshot', financePresetPatch),
  ...overrides,
], (bootCtx) => {
  provideCmdline(bootCtx, { args: [], exit: () => {} })
})

try {
  if (process.argv.includes('--stage1-acceptance')) {
    await runStage1Acceptance(ctx)
  } else {
    const consultation = process.argv.includes('--consultation')
    const scan = process.argv.includes('--scan')
    const calculation = process.argv.includes('--calculation')
    const clientId = FinanceClientId('6ba7b810-9dad-11d1-80b4-00c04fd430c8')
    const sessionId = SessionId(
      consultation
        ? 'finance-consultation-document-snapshot'
        : scan
          ? 'finance-scan-document-snapshot'
          : calculation ? 'finance-calculation-snapshot' : 'finance-document-snapshot',
    )
    const binding: FinanceClientBinding = {
      schemaVersion: 1,
      clientVersion: 1,
      workspacePath: join(workspaceRoot, 'snapshot-client'),
      client: {
        id: clientId,
        legalName: '示例客户有限公司',
        shortName: '示例客户',
        taxpayerType: 'general-vat',
        registeredRegion: '上海市',
        accountingStandard: 'enterprise',
        chartMappings: [],
        externalSystemRefs: [],
      },
    }
    const clientRoot = consultation
      ? join(workspaceRoot, '标准咨询')
      : await provisionFinanceClientWorkspace(binding.workspacePath, {
        clientId,
        clientVersion: binding.clientVersion,
        displayName: binding.client.shortName ?? binding.client.legalName,
      })
    const handle = await ctx.agents.create({
      sessionId,
      meta: { cwd: clientRoot },
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'finance').then(() => undefined),
    })
    try {
      if (calculation) {
        handle.agent.session.append('finance/client-bound', binding)
        const schemas = ctx.tools.schemas(handle.agent)
        const schema = schemas.find(candidate => candidate.name === 'finance_calculation')
        if (schema === undefined) throw new Error('Finance calculation snapshot did not assemble finance_calculation')
        const result = await ctx.tools.execute({
          callId: ToolCallId('finance-calculation-snapshot'),
          name: 'finance_calculation',
          arguments: {
            calculation: 'vat',
            as_of_date: '2026-08-29',
            tax_exclusive_sales: '100000',
            vat_rate_percent: '13',
            deductible_input_vat: '5000',
            prior_vat_credit: '1000',
          },
          signal: new AbortController().signal,
          agent: handle.agent,
        })
        if (result.isError) throw new Error(`Finance calculation snapshot tool failed: ${JSON.stringify(result.content)}`)
        process.stdout.write(`${JSON.stringify({
          tool: {
            name: schema.name,
            description: schema.description,
            parameters: schema.parameters,
          },
          result: result.content,
        })}\n`)
      } else {
        let documentId: string
        if (consultation) {
          const uploadRoot = join(dshHome, 'uploads')
          await mkdir(uploadRoot, { recursive: true })
          const sourcePath = join(uploadRoot, '咨询资料.csv')
          const source = Buffer.from('项目,金额\n云服务费,88.00\n')
          await writeFile(sourcePath, source)
          handle.agent.session.append('finance/consultation-file-imported', {
            schemaVersion: 1,
            file: {
              id: FinanceManagedFileId('snapshot-consultation-document'),
              sessionId,
              path: sourcePath,
              name: '咨询资料.csv',
              sha256: createHash('sha256').update(source).digest('hex'),
              size: source.length,
              createdAt: 1,
            },
          })
          documentId = 'snapshot-consultation-document'
        } else {
          handle.agent.session.append('finance/client-bound', binding)
          const workspace = resolveFinanceClientWorkspace(binding, sessionId)
          const sourceName = scan ? '扫描发票.pdf' : '经营简报.pptx'
          const sourcePath = join(workspace.sourceDirectory, sourceName)
          const source = scan ? scannedPdf() : presentation()
          await writeFile(sourcePath, source)
          handle.agent.session.append('finance/file-imported', {
            schemaVersion: 1,
            file: {
              id: FinanceManagedFileId(scan ? 'snapshot-scan-document' : 'snapshot-document'),
              clientId,
              sessionId,
              action: 'import',
              stage: 'source',
              path: sourcePath,
              name: sourceName,
              sha256: createHash('sha256').update(source).digest('hex'),
              size: source.length,
              createdAt: 1,
            },
          })
          documentId = scan ? 'snapshot-scan-document' : 'snapshot-document'
        }
        const schemas = ctx.tools.schemas(handle.agent)
        const schema = schemas.find(candidate => candidate.name === 'finance_document')
        if (schema === undefined) throw new Error('Finance document snapshot did not assemble finance_document')
        const list = await ctx.tools.execute({
          callId: ToolCallId('finance-document-snapshot-list'),
          name: 'finance_document',
          arguments: { action: 'list' },
          signal: new AbortController().signal,
          agent: handle.agent,
        })
        const read = await ctx.tools.execute({
          callId: ToolCallId('finance-document-snapshot-read'),
          name: 'finance_document',
          arguments: { action: 'read', document_id: documentId, cursor: 0 },
          signal: new AbortController().signal,
          agent: handle.agent,
        })
        if (list.isError || read.isError) {
          throw new Error(`Finance document snapshot tool failed: ${JSON.stringify({ list: list.content, read: read.content })}`)
        }
        process.stdout.write(`${JSON.stringify({
          tool: {
            name: schema.name,
            description: schema.description,
            parameters: schema.parameters,
          },
          ordinaryToolVisible: schemas.some(candidate => candidate.name === 'document_reader'),
          list: list.content,
          read: read.content,
        })}\n`)
      }
    } finally {
      await handle.dispose()
    }
  }
} finally {
  await ctx.fiber.dispose()
}
