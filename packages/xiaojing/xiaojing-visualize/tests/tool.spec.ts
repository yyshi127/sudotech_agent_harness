import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { visualizeMetaFrom, type VisualizeMeta } from '../src/fragment.ts'
import { visualizeTool } from '../src/tool.ts'

async function fixture(policy = true) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'xiaojing-visualize-tool-')))
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(LocalFileSystem, { cwd: root })
    await ctx.plugin(WorkingDirectory, { defaultDirectory: root })
    if (policy) await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: root })
    const harness = await mountAgentLoopTestHarness(ctx)
    const agent = await harness.create(SessionId('visualize-tool'), {}, { cwd: root })
    const tool = visualizeTool(ctx, 1000)
    ctx.tools.register(tool)
    let calls = 0
    return {
      ctx, root, agent, tool,
      run: (args: Record<string, JsonValue>, withAgent = true) => ctx.tools.execute({
        name: 'visualize', arguments: args, callId: ToolCallId(`visualize-tool-${++calls}`),
        ...withAgent ? { agent } : {}, signal: new AbortController().signal,
      }),
      async seed(path: string, fragment: string) {
        const file = join(root, path)
        await mkdir(dirname(file), { recursive: true })
        await writeFile(file, fragment)
        return file
      },
      async [Symbol.asyncDispose]() {
        await ctx.fiber.dispose()
        await rm(root, { recursive: true, force: true })
      },
    }
  } catch (error) {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
    throw error
  }
}

function card(result: ToolExecutionResult): VisualizeMeta {
  expect(result.isError).toBe(false)
  const meta = visualizeMetaFrom(result.meta)
  if (meta === undefined) throw new Error('Visualization result has no valid card metadata')
  return meta
}

describe('visualizeTool sandbox policy', () => {
  it('resolves the session policy and forwards it to the workspace write', async () => {
    await using f = await fixture()
    const policy = vi.spyOn(f.ctx.sandboxPolicy, 'resolve')
    const resolve = vi.spyOn(f.ctx.fs, 'resolve')
    const write = vi.spyOn(f.ctx.fs, 'writeText')
    const value = card(await f.run({ fragment: '<div id="lab">x</div>', title: 'Lab' }))

    expect(policy).toHaveBeenCalledWith({ session: f.agent.session })
    const copy = resolve.mock.calls.find(([path]) => /^viz\/lab-[0-9a-f]{8}\.html$/.test(path))
    expect(copy).toBeDefined()
    expect(copy?.[1]?.cwd).toBe(f.root)
    expect(copy?.[1]?.signal).toBeInstanceOf(AbortSignal)
    expect(write.mock.calls[0]?.[4]).toEqual({ mode: 'workspace-write', workspaceRoot: f.root, sessionId: f.agent.session.id })
    expect(basename(value.path)).toMatch(/^lab-[0-9a-f]{8}\.html$/)
    expect(await readFile(value.path, 'utf8')).toBe('<div id="lab">x</div>')
  })

  it('patches the workspace copy on update and writes the result beside it', async () => {
    await using f = await fixture(false)
    const file = await f.seed('viz/lab-0badf00d.html', '<div id="lab"><p>p99 480ms</p></div>')
    const read = vi.spyOn(f.ctx.fs, 'readText')
    const write = vi.spyOn(f.ctx.fs, 'writeText')
    const result = await f.run({
      action: 'update', path: 'viz/lab-0badf00d.html', title: 'Lab', old_str: 'p99 480ms', new_str: 'p99 120ms',
    })
    const value = card(result)

    expect(result.value).toMatchObject({ action: 'update' })
    expect(read.mock.calls[0]?.[0].displayPath).toBe(value.path)
    expect(value.fragment).toBe('<div id="lab"><p>p99 120ms</p></div>')
    expect(f.ctx.fs.processPath(await f.ctx.fs.resolve(value.path))).toBe(file)
    expect(write.mock.calls[0]?.[0].displayPath).toBe(value.path)
    expect(await readFile(file, 'utf8')).toBe(value.fragment)
  })

  it('chains a second patch in the same reply onto the first', async () => {
    await using f = await fixture(false)
    const file = await f.seed('viz/lab-0badf00d.html', '<div id="lab"><p>步 1 / 1</p><script>s="步 "+i</script></div>')
    const patch = async (oldStr: string, newStr: string) => card(await f.run({
      action: 'update', path: 'viz/lab-0badf00d.html', title: 'Lab', old_str: oldStr, new_str: newStr,
    }))

    await patch('<p>步 1 / 1</p>', '<p>第 1 / 1 步</p>')
    const second = await patch('s="步 "+i', 's="第 "+i')
    expect(second.fragment).toBe('<div id="lab"><p>第 1 / 1 步</p><script>s="第 "+i</script></div>')
    expect(await readFile(file, 'utf8')).toBe(second.fragment)
    expect(f.ctx.fs.processPath(await f.ctx.fs.resolve(second.path))).toBe(file)
  })

  it('fails loud on the arguments each action cannot run without', async () => {
    await using f = await fixture(false)
    await f.seed('viz/a.html', '<div>x</div>')
    const cases = [
      [{}, '`fragment` is required when action is "create"'],
      [{ action: 'update', old_str: 'x', new_str: 'y', title: 'T' }, '`path` is required when action is "update"'],
      [{ action: 'update', path: 'viz/a.html', old_str: 'x', new_str: 'y' }, '`title` is required when action is "update"'],
      [{ action: 'update', path: 'viz/a.html', title: 'T', old_str: '<div>' }, '`new_str` is required when action is "update"'],
    ] satisfies [Record<string, JsonValue>, string][]
    for (const [args, message] of cases) {
      const result = await f.run(args)
      expect(result.isError).toBe(true)
      expect(result.content).toEqual([{ type: 'text', text: `Error: invalid visualization: ${message}` }])
    }
  })

  it('lets creates run in parallel but serialises updates against their base', async () => {
    await using f = await fixture(false)
    expect(f.tool.isConcurrencySafe?.({ fragment: '<div>x</div>' })).toBe(true)
    expect(f.tool.isConcurrencySafe?.({
      action: 'update', path: 'viz/a.html', title: 'T', old_str: 'x', new_str: 'y',
    })).toBe(false)
  })

  it('still writes without a sandboxPolicy service in the composition', async () => {
    await using f = await fixture(false)
    const write = vi.spyOn(f.ctx.fs, 'writeText')
    card(await f.run({ fragment: '<div id="lab">x</div>' }))
    expect(write.mock.calls[0]?.[4]).toBeUndefined()
  })

  it('uses defaults and an ASCII-safe fallback file name without an agent session', async () => {
    await using f = await fixture()
    const policy = vi.spyOn(f.ctx.sandboxPolicy, 'resolve')
    const result = await f.run({ fragment: '<div>x</div>', title: '你好', mode: 'wide' }, false)
    const value = card(result)

    expect(value).toMatchObject({ mode: 'wide', title: '你好' })
    expect(basename(value.path)).toMatch(/^visualization-[0-9a-f]{8}\.html$/)
    expect(await readFile(value.path, 'utf8')).toBe('<div>x</div>')
    expect(policy).toHaveBeenCalledWith({})
  })

  it('renders and presents create, update, error, and malformed outcomes', () => {
    const ctx = new Context()
    const tool = visualizeTool(ctx, 1000)
    const create = {
      action: 'create', path: 'viz/a.html', title: 'A', mode: 'inline', sizeBytes: 12, fragment: '<div>A</div>',
    } as const satisfies Record<string, JsonValue>
    const update = { ...create, action: 'update' } as const satisfies Record<string, JsonValue>
    const createText = tool.output.render({}, create)[0]
    const updateText = tool.output.render({}, update)[0]
    if (createText?.type !== 'text' || updateText?.type !== 'text') throw new Error('visualize render was not text')
    expect(createText.text).toContain('Rendered "A" inline')
    expect(updateText.text).toContain('Updated "A"')
    expect(createText.text).not.toContain('bytes')
    expect(updateText.text).not.toContain('bytes')
    const meta = tool.output.presentationMeta?.({}, create)
    expect(meta).toEqual({ kind: 'visualize', fragment: create.fragment, title: create.title, mode: create.mode, path: create.path })
    expect(tool.presentCall?.({})).toEqual({ card: 'generic', title: 'Visualize', kind: 'other' })
    expect(tool.presentResult?.({}, { isError: true, content: [] })).toBeUndefined()
    expect(tool.presentResult?.({}, { isError: false, content: [] })).toBeUndefined()
    expect(tool.presentResult?.({}, {
      isError: false, content: [], ...meta === undefined ? {} : { meta },
    })).toEqual({ card: 'generic', title: 'Visualization · A' })
  })
})
