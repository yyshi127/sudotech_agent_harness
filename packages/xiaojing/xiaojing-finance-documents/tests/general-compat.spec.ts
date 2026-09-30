import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'document-fixture': { kind: 'document-fixture' } & ContextFormed
  }
}
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { generalDocumentCandidates } from '../src/general-compat.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('ordinary-session document source adapter', () => {
  it('returns an empty list before the upload directory exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xiaojing-general-documents-empty-'))
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(SessionStore).await()
    const session = ctx.sessions.create(SessionId('empty-ordinary-session'), {
      meta: { agentPreset: 'standard', cwd: root },
    })

    await expect(generalDocumentCandidates(join(root, 'missing-uploads'), { session } as Agent)).resolves.toEqual([])
    await ctx.fiber.dispose()
  })

  it('admits only current-session user uploads under the configured upload root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xiaojing-general-documents-'))
    roots.push(root)
    const uploadRoot = join(root, 'uploads')
    const outsideRoot = join(root, 'outside')
    await Promise.all([mkdir(uploadRoot), mkdir(outsideRoot)])
    const report = Buffer.from('ordinary report')
    const reportPath = join(uploadRoot, '经营报告.pptx')
    const outsidePath = join(outsideRoot, 'outside.pdf')
    await Promise.all([writeFile(reportPath, report), writeFile(outsidePath, 'outside')])

    const ctx = new Context()
    await ctx.plugin(SessionStore).await()
    const session = ctx.sessions.create(SessionId('ordinary-session'), {
      meta: { agentPreset: 'standard', cwd: root },
    })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `请读取\n上传文件：\`${reportPath}\`` }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `重复引用\n上传文件（当前格式不能直接视觉识别）：\`${reportPath}\`` }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `上传文件：\`${outsidePath}\`` }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `上传文件：\`${join(uploadRoot, 'plugin.pdf')}\`` }],
      source: { kind: 'document-fixture' },
    }), { surfaceOp: 'append' })

    const candidates = await generalDocumentCandidates(uploadRoot, { session } as Agent)

    expect(candidates).toHaveLength(2)
    expect(candidates[0]).toMatchObject({
      kind: 'source',
      source: {
        sourceRoot: uploadRoot,
        cacheScope: `session:${session.id}`,
        file: {
          sessionId: session.id,
          path: reportPath,
          name: '经营报告.pptx',
          sha256: createHash('sha256').update(report).digest('hex'),
          size: report.byteLength,
        },
      },
    })
    expect(candidates[1]).toMatchObject({
      kind: 'failed',
      name: 'outside.pdf',
      code: 'source-outside-authorized-root',
    })
    expect(String(candidates[0]?.kind === 'source' && candidates[0].source.file.id)).not.toContain(reportPath)
    await ctx.fiber.dispose()
  })
})
