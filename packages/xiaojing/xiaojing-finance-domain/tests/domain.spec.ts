import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import XiaojingFinanceDomain from '../src/index.ts'
import {
  resolveFinanceClientWorkspace,
  resolveFinanceWorkspaceLayout,
} from '../src/workspace.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function workspaceRegistry() {
  const byPath = new Map<string, Workspace>()
  const byId = new Map<Workspace['id'], Workspace>()
  let sequence = 0
  return {
    byPath,
    service: {
      create: async (path: string, initialTitle?: string): Promise<Workspace> => {
        const canonical = resolve(path)
        const existing = byPath.get(canonical)
        if (existing !== undefined) return existing
        let title = initialTitle ?? basename(canonical)
        const workspace: Workspace = {
          id: `finance-workspace-${++sequence}` as Workspace['id'],
          path: canonical,
          get title() { return title },
          createdAt: '2026-08-27T00:00:00.000Z',
          updatedAt: '2026-08-27T00:00:00.000Z',
          sessionIds: [],
          setTitle: async (value) => { title = value },
          attachSession: async () => {},
          insertSessionBefore: async () => {},
          detachSession: async () => {},
          status: async () => (await stat(canonical)).isDirectory() ? 'ok' : 'missing-dir',
        }
        byPath.set(canonical, workspace)
        byId.set(workspace.id, workspace)
        return workspace
      },
      get: (id: Workspace['id']) => byId.get(id),
      resolveByPath: async (path: string) => byPath.get(resolve(path)),
      list: () => [...byPath.values()],
      delete: async (id: Workspace['id']) => {
        const workspace = byId.get(id)
        if (workspace === undefined) return false
        byId.delete(id)
        byPath.delete(workspace.path)
        return true
      },
    },
  }
}

async function mounted(prepare?: (input: {
  root: string
  financeRoot: string
  workspaces: ReturnType<typeof workspaceRegistry>
}) => Promise<void>): Promise<{
  ctx: Context
  financeRoot: string
  uploadRoot: string
  standardRoot: string
  workspaces: ReturnType<typeof workspaceRegistry>
  dispose: () => Promise<void>
}> {
  const root = await mkdtemp(join(tmpdir(), 'xiaojing-finance-domain-'))
  roots.push(root)
  const financeRoot = join(root, 'Finance工作区')
  const uploadRoot = join(root, 'uploads')
  await mkdir(uploadRoot, { recursive: true })
  const workspaces = workspaceRegistry()
  await prepare?.({ root, financeRoot, workspaces })
  const ctx = new Context()
  await ctx.plugin(SessionStore).await()
  await ctx.plugin(SessionProjectionRegistry).await()
  ctx.provide('workspaceRegistry', workspaces.service as never)
  const fiber = ctx.plugin(XiaojingFinanceDomain, {
    dshHome: root,
    workspaceRoot: financeRoot,
    uploadRoot,
  })
  await fiber.await()
  return {
    ctx,
    financeRoot,
    uploadRoot,
    standardRoot: resolveFinanceWorkspaceLayout(financeRoot).standardRoot,
    workspaces,
    dispose: () => ctx.fiber.dispose(),
  }
}

function agent(ctx: Context, id: string, preset = 'finance', cwd?: string): Agent {
  const session = ctx.sessions.create(SessionId(id), {
    meta: { agentPreset: preset, ...cwd === undefined ? {} : { cwd } },
  })
  return agentForSession(ctx, session)
}

function agentForSession(ctx: Context, session: ReturnType<Context['sessions']['create']>): Agent {
  return {
    id: session.id,
    session,
    ctx,
    options: {},
    inbox: {} as Agent['inbox'],
    status: 'idle',
    cancel: () => {},
    whenIdle: () => Promise.resolve(),
    runMaintenance: task => task(new AbortController().signal),
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
  }
}

const draft = (name: string, region: string) => ({
  legalName: name,
  shortName: name.slice(0, 2),
  taxpayerType: 'general-vat' as const,
  registeredRegion: region,
  accountingStandard: 'enterprise' as const,
  financePolicyNotes: `${name}专属政策`,
  chartMappings: [],
  externalSystemRefs: [],
})

async function createClient(
  ctx: Context,
  financeRoot: string,
  expectedRevision: number,
  name: string,
  region: string,
) {
  const workspacePath = join(financeRoot, `客户-${name}`)
  await mkdir(workspacePath, { recursive: true })
  return ctx.xiaojingFinanceDomain.create({
    expectedRevision,
    client: draft(name, region),
    workspacePath,
  })
}

describe('XiaojingFinanceDomain', () => {
  it('defaults Finance to explicit general consultation without writing a binding event', async () => {
    const { ctx, standardRoot, dispose } = await mounted()
    const finance = agent(ctx, 'finance-general', 'finance', standardRoot)
    expect(await ctx.xiaojingFinanceDomain.sessionContext(finance)).toEqual({ state: 'general', locked: false })
    const prompt = await ctx.xiaojingFinanceDomain.promptContext(finance)
    expect(prompt).toContain('未绑定任何客户')
    expect(prompt).toContain('不得推测或编造客户')
    expect(finance.session.events.some(event => event.type === 'finance/client-bound')).toBe(false)
    expect(ctx.xiaojingFinanceDomain.currentClientBinding(finance)).toBeUndefined()
    expect(() => ctx.xiaojingFinanceDomain.requireBoundClient(finance)).toThrow(/requires a client-bound Finance session/)
    await dispose()
  })

  it('registers general consultation uploads in the session without copying them into a client workspace', async () => {
    const { ctx, uploadRoot, standardRoot, dispose } = await mounted()
    const finance = agent(ctx, 'finance-general-upload', 'finance', standardRoot)
    const uploadedPath = join(uploadRoot, 'consultation.pdf')
    await writeFile(uploadedPath, 'consultation document', 'utf8')

    const imported = await ctx.xiaojingFinanceDomain.importUpload(finance, {
      path: uploadedPath,
      originalName: 'consultation.pdf',
    })

    expect(imported).toMatchObject({
      sessionId: finance.session.id,
      path: uploadedPath,
      name: 'consultation.pdf',
      size: 21,
    })
    expect(imported).not.toHaveProperty('clientId')
    expect(await readFile(uploadedPath, 'utf8')).toBe('consultation document')
    expect(finance.session.events.map(event => event.type)).toContain('finance/consultation-file-imported')
    expect(finance.session.events.some(event => event.type === 'finance/client-bound')).toBe(false)
    await dispose()
  })

  it('owns a standard Workspace and creates one isolated Workspace for each client', async () => {
    const { ctx, financeRoot, standardRoot, workspaces, dispose } = await mounted()
    const initial = await ctx.xiaojingFinanceDomain.workspaces()
    expect(initial.standard).toMatchObject({ kind: 'standard', title: '咨询', startable: true })
    expect(initial.consultations).toEqual([])
    expect(initial.clients).toEqual([])
    expect(workspaces.byPath.get(resolve(standardRoot))?.id).toBe(initial.standard.workspaceId)

    const created = await createClient(ctx, financeRoot, 0, '客户甲有限公司', '上海市')
    const listed = await ctx.xiaojingFinanceDomain.workspaces()
    expect(listed.clients).toEqual([expect.objectContaining({
      kind: 'client',
      clientId: created.client.id,
      title: '客户',
      startable: true,
    })])
    const clientRoot = created.client.workspacePath
    expect(workspaces.byPath.get(resolve(clientRoot))?.id).toBe(listed.clients[0]?.workspaceId)
    await Promise.all([
      join(clientRoot, '00-客户档案'),
      join(clientRoot, '01-财务政策'),
      join(clientRoot, '02-原始资料'),
      join(clientRoot, '03-会话作业'),
      join(clientRoot, '04-成果输出'),
      join(clientRoot, '05-归档'),
    ].map(path => access(path)))
    const profile = JSON.parse(await readFile(
      join(clientRoot, '00-客户档案', '客户档案快照.json'),
      'utf8',
    )) as { schemaVersion: number; client: { legalName: string } }
    expect(profile).toMatchObject({ schemaVersion: 1, client: { legalName: '客户甲有限公司' } })
    expect(await readFile(join(clientRoot, '01-财务政策', '客户财务政策备注.md'), 'utf8'))
      .toContain('客户甲有限公司专属政策')
    await dispose()
  })

  it('rolls back only the customer Workspace registration when the catalog mutation rejects', async () => {
    const { ctx, financeRoot, workspaces, dispose } = await mounted()
    const clientRoot = join(financeRoot, '客户-过期窗口客户')
    await mkdir(clientRoot, { recursive: true })
    await writeFile(join(clientRoot, '用户文件.txt'), 'preserve', 'utf8')
    await expect(ctx.xiaojingFinanceDomain.create({
      expectedRevision: 99,
      client: draft('过期窗口客户', '北京市'),
      workspacePath: clientRoot,
    })).rejects.toThrow(/revision/i)
    expect(await readFile(join(clientRoot, '用户文件.txt'), 'utf8')).toBe('preserve')
    expect(workspaces.byPath.has(resolve(clientRoot))).toBe(false)
    expect([...workspaces.byPath.values()].map(workspace => workspace.title)).toEqual(['咨询'])
    await dispose()
  })

  it('registers a user-selected consultation Workspace and permits general Finance sessions there', async () => {
    const { ctx, financeRoot, workspaces, dispose } = await mounted()
    const consultationRoot = join(financeRoot, '专项咨询')
    await mkdir(consultationRoot, { recursive: true })
    const entry = await ctx.xiaojingFinanceDomain.addConsultationWorkspace({ path: consultationRoot })
    expect(entry).toMatchObject({ kind: 'consultation', title: '专项咨询', startable: true })
    expect(workspaces.byPath.get(resolve(consultationRoot))?.id).toBe(entry.workspaceId)
    expect((await ctx.xiaojingFinanceDomain.workspaces()).consultations).toEqual([entry])
    const finance = agent(ctx, 'finance-custom-consultation', 'finance', consultationRoot)
    expect(await ctx.xiaojingFinanceDomain.promptContext(finance)).toContain('未绑定任何客户')
    await dispose()
  })

  it('persists Finance workspace rename and list removal without deleting clients or registrations', async () => {
    const { ctx, financeRoot, standardRoot, workspaces, dispose } = await mounted()
    const consultationRoot = join(financeRoot, '专项咨询')
    await mkdir(consultationRoot, { recursive: true })
    const consultation = await ctx.xiaojingFinanceDomain.addConsultationWorkspace({ path: consultationRoot })
    const created = await createClient(ctx, financeRoot, 0, '客户甲有限公司', '上海市')
    const before = await ctx.xiaojingFinanceDomain.workspaces()
    const client = before.clients[0]
    expect(client).toBeDefined()

    await ctx.xiaojingFinanceDomain.renameWorkspace({
      workspaceId: consultation.workspaceId,
      title: '税务专项',
    })
    await ctx.xiaojingFinanceDomain.renameWorkspace({
      workspaceId: client!.workspaceId,
      title: '甲公司工作区',
    })
    const renamed = await ctx.xiaojingFinanceDomain.workspaces()
    expect(renamed.consultations[0]?.title).toBe('税务专项')
    expect(renamed.clients[0]?.title).toBe('甲公司工作区')
    expect(workspaces.byPath.get(resolve(consultationRoot))?.title).toBe('税务专项')
    expect(workspaces.byPath.get(resolve(created.client.workspacePath))?.title).toBe('甲公司工作区')

    await ctx.xiaojingFinanceDomain.removeWorkspace({ workspaceId: renamed.standard.workspaceId })
    await ctx.xiaojingFinanceDomain.removeWorkspace({ workspaceId: client!.workspaceId })
    const removed = await ctx.xiaojingFinanceDomain.workspaces()
    expect(removed.listedWorkspaceIds).not.toContain(renamed.standard.workspaceId)
    expect(removed.listedWorkspaceIds).not.toContain(client!.workspaceId)
    expect(removed.listedWorkspaceIds).toContain(consultation.workspaceId)
    expect(workspaces.byPath.get(resolve(standardRoot))?.id).toBe(renamed.standard.workspaceId)
    expect(workspaces.byPath.get(resolve(created.client.workspacePath))?.id).toBe(client!.workspaceId)
    expect((await ctx.xiaojingFinanceDomain.read(created.client.id)).client.status).toBe('active')

    await expect(ctx.xiaojingFinanceDomain.removeWorkspace({
      workspaceId: consultation.workspaceId,
    })).rejects.toThrow(/at least one consultation workspace/)
    const restoredClient = await ctx.xiaojingFinanceDomain.restoreClientWorkspace({
      path: created.client.workspacePath,
    })
    expect(restoredClient?.workspaceId).toBe(client!.workspaceId)
    expect((await ctx.xiaojingFinanceDomain.workspaces()).listedWorkspaceIds).toContain(client!.workspaceId)
    await dispose()
  })

  it('keeps one consultation listed when two windows remove different consultation workspaces concurrently', async () => {
    const { ctx, financeRoot, dispose } = await mounted()
    const consultationRoot = join(financeRoot, '并发咨询')
    await mkdir(consultationRoot, { recursive: true })
    const consultation = await ctx.xiaojingFinanceDomain.addConsultationWorkspace({ path: consultationRoot })
    const standard = (await ctx.xiaojingFinanceDomain.workspaces()).standard

    const results = await Promise.allSettled([
      ctx.xiaojingFinanceDomain.removeWorkspace({ workspaceId: standard.workspaceId }),
      ctx.xiaojingFinanceDomain.removeWorkspace({ workspaceId: consultation.workspaceId }),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    const remaining = await ctx.xiaojingFinanceDomain.workspaces()
    const consultationIds = [remaining.standard, ...remaining.consultations]
      .map(entry => entry.workspaceId)
    expect(remaining.listedWorkspaceIds.filter(id => consultationIds.includes(id))).toHaveLength(1)
    await dispose()
  })

  it('locks context selection as soon as the first turn starts', async () => {
    const { ctx, financeRoot, standardRoot, dispose } = await mounted()
    const created = await createClient(ctx, financeRoot, 0, '甲公司', '上海市')
    const finance = agent(ctx, 'finance-started', 'finance', standardRoot)
    finance.session.append('turn/start', { turn: 1 })

    await expect(ctx.xiaojingFinanceDomain.stage(finance, { mode: 'general' })).rejects.toThrow(/locked/)
    await expect(ctx.xiaojingFinanceDomain.stage(finance, {
      mode: 'client', clientId: created.client.id,
    })).rejects.toThrow(/locked/)
    await dispose()
  })

  it('reopens a blank session already bound to the same client without allowing reassignment', async () => {
    const { ctx, financeRoot, dispose } = await mounted()
    const first = await createClient(ctx, financeRoot, 0, 'First Company', 'Shanghai')
    const second = await createClient(ctx, financeRoot, 1, 'Second Company', 'Beijing')
    const finance = agent(ctx, 'finance-bound-blank', 'finance', first.client.workspacePath)

    await ctx.xiaojingFinanceDomain.stage(finance, {
      mode: 'client', clientId: first.client.id,
    })
    await ctx.xiaojingFinanceDomain.promptContext(finance)
    expect(finance.session.events.some(event => event.type === 'turn/start')).toBe(false)

    await expect(ctx.xiaojingFinanceDomain.stage(finance, {
      mode: 'client', clientId: first.client.id,
    })).resolves.toMatchObject({
      state: 'bound',
      locked: true,
      clientName: first.client.shortName ?? first.client.legalName,
    })
    await expect(ctx.xiaojingFinanceDomain.stage(finance, {
      mode: 'client', clientId: second.client.id,
    })).rejects.toThrow(/locked/)
    await expect(ctx.xiaojingFinanceDomain.stage(finance, { mode: 'general' })).rejects.toThrow(/locked/)
    await dispose()
  })

  it('stages in memory and locks an immutable client snapshot before model use', async () => {
    const { ctx, financeRoot, dispose } = await mounted()
    const created = await createClient(ctx, financeRoot, 0, '甲公司', '上海市')
    const clientRoot = created.client.workspacePath
    const finance = agent(ctx, 'finance-bound', 'finance', clientRoot)

    expect(await ctx.xiaojingFinanceDomain.stage(finance, {
      mode: 'client', clientId: created.client.id,
    })).toMatchObject({ state: 'ready', clientName: '甲公' })
    expect(finance.session.events.some(event => event.type === 'finance/client-bound')).toBe(false)

    const prompt = await ctx.xiaojingFinanceDomain.promptContext(finance)
    expect(prompt).toContain('甲公司')
    expect(prompt).toContain('本会话只绑定客户，不绑定会计期间')
    const bindings = finance.session.events.filter(event => event.type === 'finance/client-bound')
    expect(bindings).toHaveLength(1)
    expect(bindings[0]?.type === 'finance/client-bound' && bindings[0].data.clientVersion).toBe(1)
    expect(ctx.sessionProjections.snapshot(finance.session).values.financeClient)
      .toEqual({ state: 'bound', clientName: '甲公' })
    const binding = ctx.xiaojingFinanceDomain.requireBoundClient(finance)
    expect(ctx.xiaojingFinanceDomain.currentClientBinding(finance)).toEqual(binding)
    expect(ctx.xiaojingFinanceDomain.currentClientBinding(finance)).not.toBe(binding)
    const clientWorkspace = resolveFinanceClientWorkspace(binding, finance.session.id)
    await Promise.all([
      clientWorkspace.profileDirectory,
      clientWorkspace.policyDirectory,
      clientWorkspace.sourceDirectory,
      clientWorkspace.sessionWorkDirectory,
      clientWorkspace.outputDirectory,
      clientWorkspace.archiveDirectory,
    ].map(path => access(path)))
    const marker = await readFile(join(clientWorkspace.clientRoot, '.xiaojing-client.json'), 'utf8')
    expect(JSON.parse(marker)).toEqual({
      schemaVersion: 1,
      clientId: created.client.id,
      clientVersion: 1,
      displayName: '甲公',
    })
    expect(marker).not.toContain('上海市')
    expect(marker).not.toContain('甲公司专属政策')
    expect(JSON.parse(await readFile(
      join(clientWorkspace.sessionWorkDirectory, '会话信息.json'),
      'utf8',
    ))).toEqual({
      schemaVersion: 1,
      sessionId: finance.session.id,
      clientId: created.client.id,
      clientVersion: 1,
      clientName: '甲公',
    })

    const updated = await ctx.xiaojingFinanceDomain.update({
      clientId: created.client.id,
      expectedRevision: 1,
      client: draft('甲公司新名称', '北京市'),
    })
    expect(updated.client.version).toBe(2)
    expect(await ctx.xiaojingFinanceDomain.promptContext(finance)).toContain('上海市')
    expect(await ctx.xiaojingFinanceDomain.promptContext(finance)).not.toContain('北京市')
    await expect(ctx.xiaojingFinanceDomain.stage(finance, { mode: 'general' })).rejects.toThrow(/locked/)
    await dispose()
  })

  it('preserves an invalid session manifest instead of replacing it', async () => {
    const { ctx, financeRoot, dispose } = await mounted()
    const created = await createClient(ctx, financeRoot, 0, '清单客户', '上海市')
    const finance = agent(ctx, 'finance-invalid-manifest', 'finance', created.client.workspacePath)
    await ctx.xiaojingFinanceDomain.stage(finance, {
      mode: 'client', clientId: created.client.id,
    })
    await ctx.xiaojingFinanceDomain.promptContext(finance)
    const binding = ctx.xiaojingFinanceDomain.requireBoundClient(finance)
    const manifestPath = join(
      resolveFinanceClientWorkspace(binding, finance.session.id).sessionWorkDirectory,
      '会话信息.json',
    )
    await writeFile(manifestPath, '{broken', 'utf8')

    await expect(ctx.xiaojingFinanceDomain.promptContext(finance)).rejects.toThrow(/cannot parse/)
    expect(await readFile(manifestPath, 'utf8')).toBe('{broken')
    await dispose()
  })

  it('imports uploads and copies final outputs and archives without removing their sources', async () => {
    const { ctx, financeRoot, uploadRoot, dispose } = await mounted()
    const created = await createClient(ctx, financeRoot, 0, '文件客户', '上海市')
    const finance = agent(ctx, 'finance-files', 'finance', created.client.workspacePath)
    await ctx.xiaojingFinanceDomain.stage(finance, {
      mode: 'client', clientId: created.client.id,
    })

    const uploadedPath = join(uploadRoot, 'upload-1.bin')
    await writeFile(uploadedPath, '原始凭证', 'utf8')
    const imported = await ctx.xiaojingFinanceDomain.importUpload(finance, {
      path: uploadedPath,
      originalName: '原始凭证.txt',
    })
    expect(imported).toMatchObject({ action: 'import', stage: 'source', name: '原始凭证.txt' })
    expect(imported.path).toBe(join(created.client.workspacePath, '02-原始资料', '原始凭证.txt'))
    expect(await readFile(imported.path, 'utf8')).toBe('原始凭证')
    expect(await readFile(uploadedPath, 'utf8')).toBe('原始凭证')

    const binding = ctx.xiaojingFinanceDomain.requireBoundClient(finance)
    const workspace = resolveFinanceClientWorkspace(binding, finance.session.id)
    const draftPath = join(workspace.sessionWorkDirectory, '月结报告.md')
    await writeFile(draftPath, '# 月结报告\n', 'utf8')
    const published = await ctx.xiaojingFinanceDomain.publishFile(finance, { sourcePath: draftPath })
    expect(published).toMatchObject({ action: 'publish', stage: 'output', name: '月结报告.md' })
    expect(published.path).toBe(join(workspace.outputDirectory, '月结报告.md'))
    expect(await readFile(draftPath, 'utf8')).toBe('# 月结报告\n')
    expect(await readFile(published.path, 'utf8')).toBe('# 月结报告\n')

    const archived = await ctx.xiaojingFinanceDomain.archiveFile(finance, { sourcePath: published.path })
    expect(archived).toMatchObject({
      action: 'archive',
      stage: 'archive',
      name: '月结报告.md',
      sourceFileId: published.id,
    })
    expect(archived.path).toContain(join(workspace.archiveDirectory, '20'))
    expect(await readFile(published.path, 'utf8')).toBe('# 月结报告\n')
    expect(await readFile(archived.path, 'utf8')).toBe('# 月结报告\n')
    expect(finance.session.events.map(event => event.type)).toEqual(expect.arrayContaining([
      'finance/client-bound',
      'finance/file-imported',
      'finance/file-published',
      'finance/file-archived',
    ]))
    const prompt = await ctx.xiaojingFinanceDomain.promptContext(finance)
    expect(prompt).toContain(imported.path)
    expect(prompt).toContain(published.path)
    expect(prompt).toContain(archived.path)
    await dispose()
  })

  it('rejects upload and publication paths outside the selected client and preserves a corrupt index', async () => {
    const { ctx, financeRoot, uploadRoot, dispose } = await mounted()
    const first = await createClient(ctx, financeRoot, 0, '甲文件客户', '上海市')
    const second = await createClient(ctx, financeRoot, 1, '乙文件客户', '北京市')
    const finance = agent(ctx, 'finance-file-isolation', 'finance', first.client.workspacePath)
    await ctx.xiaojingFinanceDomain.stage(finance, {
      mode: 'client', clientId: first.client.id,
    })
    const outsideUpload = join(financeRoot, 'outside-upload.txt')
    await writeFile(outsideUpload, 'outside', 'utf8')
    await expect(ctx.xiaojingFinanceDomain.importUpload(finance, {
      path: outsideUpload,
      originalName: 'outside.txt',
    })).rejects.toThrow(/uploaded file must stay inside/)

    await ctx.xiaojingFinanceDomain.promptContext(finance)
    const otherClientFile = join(second.client.workspacePath, '03-会话作业', 'other.txt')
    await mkdir(join(second.client.workspacePath, '03-会话作业'), { recursive: true })
    await writeFile(otherClientFile, 'other', 'utf8')
    await expect(ctx.xiaojingFinanceDomain.publishFile(finance, {
      sourcePath: otherClientFile,
    })).rejects.toThrow(/published file must stay inside/)

    const validUpload = join(uploadRoot, 'valid.txt')
    await writeFile(validUpload, 'valid', 'utf8')
    await ctx.xiaojingFinanceDomain.importUpload(finance, {
      path: validUpload,
      originalName: 'valid.txt',
    })
    const indexPath = join(first.client.workspacePath, '.xiaojing-finance-files-v1.json')
    await writeFile(indexPath, '{broken', 'utf8')
    const secondUpload = join(uploadRoot, 'second.txt')
    await writeFile(secondUpload, 'second', 'utf8')
    await expect(ctx.xiaojingFinanceDomain.importUpload(finance, {
      path: secondUpload,
      originalName: 'second.txt',
    })).rejects.toThrow(/cannot parse/)
    expect(await readFile(indexPath, 'utf8')).toBe('{broken')
    await expect(access(join(first.client.workspacePath, '02-原始资料', 'second.txt'))).rejects.toThrow()
    await dispose()
  })

  it('keeps two client prompts and projections isolated', async () => {
    const { ctx, financeRoot, dispose } = await mounted()
    const first = await createClient(ctx, financeRoot, 0, '甲公司', '上海市')
    const second = await createClient(ctx, financeRoot, 1, '乙公司', '北京市')
    const a = agent(ctx, 'finance-a', 'finance', first.client.workspacePath)
    const b = agent(ctx, 'finance-b', 'finance', second.client.workspacePath)
    await ctx.xiaojingFinanceDomain.stage(a, {
      mode: 'client', clientId: first.client.id,
    })
    await ctx.xiaojingFinanceDomain.stage(b, {
      mode: 'client', clientId: second.client.id,
    })
    const [aPrompt, bPrompt] = await Promise.all([
      ctx.xiaojingFinanceDomain.promptContext(a),
      ctx.xiaojingFinanceDomain.promptContext(b),
    ])
    expect(aPrompt).toContain('甲公司')
    expect(aPrompt).not.toContain('乙公司')
    expect(bPrompt).toContain('乙公司')
    expect(bPrompt).not.toContain('甲公司')
    const aBinding = ctx.xiaojingFinanceDomain.requireBoundClient(a)
    const bBinding = ctx.xiaojingFinanceDomain.requireBoundClient(b)
    expect(aBinding.client.legalName).toBe('甲公司')
    expect(bBinding.client.legalName).toBe('乙公司')
    expect(a.session.events.filter(event => event.type === 'finance/client-bound')).toHaveLength(1)
    expect(b.session.events.filter(event => event.type === 'finance/client-bound')).toHaveLength(1)
    expect(resolveFinanceClientWorkspace(aBinding, a.session.id).sessionWorkDirectory)
      .not.toBe(resolveFinanceClientWorkspace(aBinding, b.session.id).sessionWorkDirectory)
    await dispose()
  })

  it('refuses to bind one customer while the Session belongs to another customer Workspace', async () => {
    const { ctx, financeRoot, dispose } = await mounted()
    const first = await createClient(ctx, financeRoot, 0, '甲公司', '上海市')
    const second = await createClient(ctx, financeRoot, 1, '乙公司', '北京市')
    const wrongWorkspace = agent(
      ctx,
      'finance-cross-client',
      'finance',
      second.client.workspacePath,
    )
    await expect(ctx.xiaojingFinanceDomain.stage(wrongWorkspace, {
      mode: 'client',
      clientId: first.client.id,
    })).rejects.toThrow(/does not match the Session workspace/)
    expect(wrongWorkspace.session.events.some(event => event.type === 'finance/client-bound')).toBe(false)
    await dispose()
  })

  it('restores the immutable binding and safe projection from session events', async () => {
    const { ctx, financeRoot, dispose } = await mounted()
    const created = await createClient(ctx, financeRoot, 0, '历史公司', '杭州市')
    const clientRoot = created.client.workspacePath
    const original = agent(ctx, 'finance-original', 'finance', clientRoot)
    await ctx.xiaojingFinanceDomain.stage(original, {
      mode: 'client', clientId: created.client.id,
    })
    const originalPrompt = await ctx.xiaojingFinanceDomain.promptContext(original)
    const restoredSession = ctx.sessions.create(SessionId('finance-restored'), {
      seed: [...original.session.events],
      meta: { agentPreset: 'finance', cwd: clientRoot },
    })
    const restored = agentForSession(ctx, restoredSession)

    expect(await ctx.xiaojingFinanceDomain.sessionContext(restored)).toEqual({
      state: 'bound', locked: true, clientName: '历史',
    })
    const restoredPrompt = await ctx.xiaojingFinanceDomain.promptContext(restored)
    expect(restoredPrompt).toContain('历史公司')
    expect(restoredPrompt).toContain('不绑定会计期间')
    expect(restoredPrompt).not.toBe(originalPrompt)
    expect(ctx.sessionProjections.snapshot(restored.session).values.financeClient)
      .toEqual({ state: 'bound', clientName: '历史' })
    await dispose()
  })

  it('does not create client directories for standard consultation', async () => {
    const { ctx, financeRoot, standardRoot, dispose } = await mounted()
    const finance = agent(ctx, 'finance-standard-workspace', 'finance', standardRoot)
    await ctx.xiaojingFinanceDomain.promptContext(finance)
    expect(await readdir(financeRoot)).toEqual(['标准咨询'])
    await dispose()
  })

  it('preserves a conflicting client marker and refuses to bind the session', async () => {
    const { ctx, financeRoot, dispose } = await mounted()
    const created = await createClient(ctx, financeRoot, 0, '冲突公司', '南京市')
    const clientRoot = created.client.workspacePath
    const finance = agent(ctx, 'finance-marker-conflict', 'finance', clientRoot)
    const binding = {
      schemaVersion: 1 as const,
      clientVersion: created.client.version,
      client: created.client,
      workspacePath: clientRoot,
    }
    const layout = resolveFinanceClientWorkspace(binding, finance.session.id)
    const markerPath = join(layout.clientRoot, '.xiaojing-client.json')
    await mkdir(layout.clientRoot, { recursive: true })
    const conflict = '{"schemaVersion":1,"clientId":"11111111-1111-4111-8111-111111111111","clientVersion":1,"displayName":"其他客户"}\n'
    await writeFile(markerPath, conflict, 'utf8')

    await expect(ctx.xiaojingFinanceDomain.stage(finance, {
      mode: 'client', clientId: created.client.id,
    })).rejects.toThrow(/belongs to another client/)
    expect(await readFile(markerPath, 'utf8')).toBe(conflict)
    expect(finance.session.events.some(event => event.type === 'finance/client-bound')).toBe(false)
    await dispose()
  })

  it('rejects standard sessions and archived clients for new bindings', async () => {
    const { ctx, financeRoot, dispose } = await mounted()
    const created = await createClient(ctx, financeRoot, 0, '归档公司', '深圳市')
    const standard = agent(ctx, 'standard-session', 'standard')
    await expect(ctx.xiaojingFinanceDomain.stage(standard, { mode: 'general' })).rejects.toThrow(/only in the Finance preset/)
    expect(await ctx.xiaojingFinanceDomain.sessionContext(standard)).toEqual({ state: 'not-finance', locked: true })

    await ctx.xiaojingFinanceDomain.archive({ clientId: created.client.id, expectedRevision: 1 })
    const finance = agent(
      ctx,
      'finance-archive',
      'finance',
      created.client.workspacePath,
    )
    await expect(ctx.xiaojingFinanceDomain.stage(finance, {
      mode: 'client', clientId: created.client.id,
    })).rejects.toThrow(/archived clients/)
    await dispose()
  })
})
