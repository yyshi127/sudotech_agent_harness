import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-tools'
import { visualizeTool } from '../src/tool.ts'

/**
 * The workspace write must run under the *session-level* sandbox policy
 * (regression for issue #1): resolve `ctx.get('sandboxPolicy')` with the
 * calling session, resolve the path against the policy's workspace root, and
 * forward the policy to `writeText` — otherwise a confining backend falls back
 * to its process-level default root and denies the write.
 */
describe('visualizeTool sandbox policy', () => {
  it('resolves the session policy and forwards it to the workspace write', async () => {
    const session = { header: { cwd: '/work/session' } }
    const policy = { mode: 'workspace-write', workspaceRoot: '/work/session' }
    const calls: { resolveRequest?: unknown; resolveCwd?: string | undefined; writePolicy?: unknown } = {}
    const ctx = {
      get: (name: string) => name === 'sandboxPolicy'
        ? { resolve: (request: unknown) => { calls.resolveRequest = request; return policy } }
        : undefined,
      fs: {
        resolve: async (path: string, options: { cwd?: string }) => {
          calls.resolveCwd = options.cwd
          return { displayPath: `${options.cwd}/${path}` }
        },
        writeText: async (_t: unknown, _c: unknown, _e: unknown, _s: unknown, sandboxPolicy: unknown) => {
          calls.writePolicy = sandboxPolicy
          return { version: 1 }
        },
      },
    } as unknown as Context

    const tool = visualizeTool(ctx, 1000)
    const value = await tool.execute(
      { fragment: '<div id="lab">x</div>', title: 'Lab' },
      { agent: { session } } as never,
    )

    expect(calls.resolveRequest).toEqual({ session })
    expect(calls.resolveCwd).toBe('/work/session')
    expect(calls.writePolicy).toBe(policy)
    expect((value as { path: string }).path).toMatch(/^\/work\/session\/viz\/lab-[0-9a-f]{8}\.html$/)
  })

  it('patches the workspace copy on update and writes the result beside it', async () => {
    const base = '<div id="lab"><p>p99 480ms</p></div>'
    const written: { path?: string; content?: string } = {}
    const reads: string[] = []
    const ctx = {
      get: () => undefined,
      fs: {
        resolve: async (path: string, options: { cwd?: string }) => ({ displayPath: `${options.cwd}/${path}`, path }),
        readText: async (target: { path: string }) => {
          reads.push(target.path)
          return base
        },
        writeText: async (target: { displayPath: string }, content: string) => {
          written.path = target.displayPath
          written.content = content
          return { version: 1 }
        },
      },
    } as unknown as Context

    const tool = visualizeTool(ctx, 1000)
    const value = await tool.execute(
      {
        action: 'update',
        path: 'viz/lab-0badf00d.html',
        title: 'Lab',
        old_str: 'p99 480ms',
        new_str: 'p99 120ms',
      },
      { agent: { session: { header: { cwd: '/work/session' } } } } as never,
    ) as { action: string; fragment: string; path: string }

    expect(reads).toEqual(['viz/lab-0badf00d.html'])
    expect(value.action).toBe('update')
    expect(value.fragment).toBe('<div id="lab"><p>p99 120ms</p></div>')
    // The patch rewrites its own source, so the card keeps one stable path.
    expect(value.path).toBe('/work/session/viz/lab-0badf00d.html')
    expect(written.path).toBe(value.path)
    expect(written.content).toBe(value.fragment)
  })

  /**
   * Regression: patches used to land on content-addressed *new* paths, so two
   * patches in one reply both read the original card and each wrote a file
   * carrying only its own edit — the first correction vanished silently.
   */
  it('chains a second patch in the same reply onto the first', async () => {
    const files: Record<string, string> = {
      'viz/lab-0badf00d.html': '<div id="lab"><p>步 1 / 1</p><script>s="步 "+i</script></div>',
    }
    const ctx = {
      get: () => undefined,
      fs: {
        resolve: async (path: string, options: { cwd?: string }) => ({ displayPath: `${options.cwd}/${path}`, path }),
        readText: async (target: { path: string }) => files[target.path]!,
        writeText: async (target: { path: string }, content: string) => {
          files[target.path] = content
          return { version: 1 }
        },
      },
    } as unknown as Context

    const tool = visualizeTool(ctx, 1000)
    const exec = { agent: { session: { header: { cwd: '/work/session' } } } } as never
    const patch = async (oldStr: string, newStr: string) => await tool.execute(
      { action: 'update', path: 'viz/lab-0badf00d.html', title: 'Lab', old_str: oldStr, new_str: newStr },
      exec,
    ) as { path: string; fragment: string }

    await patch('<p>步 1 / 1</p>', '<p>第 1 / 1 步</p>')
    const second = await patch('s="步 "+i', 's="第 "+i')

    // Both edits survive, in the one file the card is addressed by.
    expect(second.fragment).toBe('<div id="lab"><p>第 1 / 1 步</p><script>s="第 "+i</script></div>')
    expect(files['viz/lab-0badf00d.html']).toBe(second.fragment)
    expect(second.path).toBe('/work/session/viz/lab-0badf00d.html')
  })

  it('fails loud on the arguments each action cannot run without', async () => {
    const ctx = {
      get: () => undefined,
      fs: {
        resolve: async (path: string, options: { cwd?: string }) => ({ displayPath: `${options.cwd}/${path}`, path }),
        readText: async () => '<div>x</div>',
        writeText: async () => ({ version: 1 }),
      },
    } as unknown as Context
    const tool = visualizeTool(ctx, 1000)
    const exec = { agent: { session: { header: { cwd: '/work/session' } } } } as never

    await expect(tool.execute({}, exec)).rejects.toThrow(/`fragment` is required when action is "create"/)
    await expect(tool.execute({ action: 'update', old_str: 'x', new_str: 'y', title: 'T' }, exec))
      .rejects.toThrow(/`path` is required when action is "update"/)
    await expect(tool.execute({ action: 'update', path: 'viz/a.html', old_str: 'x', new_str: 'y' }, exec))
      .rejects.toThrow(/`title` is required when action is "update"/)
    // An empty new_str is a deletion, so only an absent one is refused.
    await expect(tool.execute({ action: 'update', path: 'viz/a.html', title: 'T', old_str: '<div>' }, exec))
      .rejects.toThrow(/`new_str` is required when action is "update"/)
  })

  it('lets creates run in parallel but serialises updates against their base', () => {
    const ctx = { get: () => undefined, fs: {} } as unknown as Context
    const tool = visualizeTool(ctx, 1000)
    expect(tool.isConcurrencySafe?.({ fragment: '<div>x</div>' })).toBe(true)
    expect(tool.isConcurrencySafe?.({
      action: 'update',
      path: 'viz/a.html',
      title: 'T',
      old_str: 'x',
      new_str: 'y',
    })).toBe(false)
  })

  it('still writes without a sandboxPolicy service in the composition', async () => {
    const calls: { writePolicy?: unknown } = {}
    const ctx = {
      get: () => undefined,
      fs: {
        resolve: async (path: string, options: { cwd?: string }) => ({ displayPath: `${options.cwd}/${path}` }),
        writeText: async (_t: unknown, _c: unknown, _e: unknown, _s: unknown, sandboxPolicy: unknown) => {
          calls.writePolicy = sandboxPolicy
          return { version: 1 }
        },
      },
    } as unknown as Context

    const tool = visualizeTool(ctx, 1000)
    await tool.execute(
      { fragment: '<div id="lab">x</div>' },
      { agent: { session: { header: { cwd: '/work/session' } } } } as never,
    )
    expect(calls.writePolicy).toBeUndefined()
  })

  it('uses defaults and an ASCII-safe fallback file name without an agent session', async () => {
    const written: { path?: string } = {}
    const policyRequests: unknown[] = []
    const ctx = {
      get: (name: string) => name === 'sandboxPolicy'
        ? { resolve: (request: unknown) => { policyRequests.push(request); return undefined } }
        : undefined,
      fs: {
        resolve: async (path: string) => ({ displayPath: path }),
        writeText: async (target: { displayPath: string }) => {
          written.path = target.displayPath
          return { version: 1 }
        },
      },
    } as unknown as Context
    const tool = visualizeTool(ctx, 1000)
    const value = await tool.execute(
      { fragment: '<div>x</div>', title: '你好', mode: 'wide' },
      { signal: new AbortController().signal } as never,
    ) as { mode: string; path: string; title: string }
    expect(value).toMatchObject({ mode: 'wide', title: '你好' })
    expect(value.path).toMatch(/^viz\/visualization-[0-9a-f]{8}\.html$/)
    expect(written.path).toBe(value.path)
    expect(policyRequests).toEqual([{}])
  })

  it('renders and presents create, update, error, and malformed outcomes', () => {
    const ctx = { get: () => undefined, fs: {} } as unknown as Context
    const tool = visualizeTool(ctx, 1000)
    const create = {
      action: 'create',
      path: 'viz/a.html',
      title: 'A',
      mode: 'inline',
      sizeBytes: 12,
      fragment: '<div>A</div>',
    } as const satisfies Record<string, JsonValue>
    const update = { ...create, action: 'update' } as const satisfies Record<string, JsonValue>
    const createContent = tool.output.render({}, create)
    const updateContent = tool.output.render({}, update)
    const createText = createContent[0]
    const updateText = updateContent[0]
    if (createText?.type !== 'text' || updateText?.type !== 'text') throw new Error('visualize render was not text')
    expect(createText.text).toContain('Rendered "A" inline')
    expect(updateText.text).toContain('Patched "A" in place')
    const meta = tool.output.presentationMeta?.({}, create)
    expect(meta).toEqual({
      kind: 'visualize',
      fragment: create.fragment,
      title: create.title,
      mode: create.mode,
      path: create.path,
    })
    expect(tool.presentCall?.({})).toEqual({ card: 'generic', title: 'Visualize', kind: 'other' })
    expect(tool.presentResult?.({}, { isError: true } as never)).toBeUndefined()
    expect(tool.presentResult?.({}, { isError: false, meta: undefined } as never)).toBeUndefined()
    expect(tool.presentResult?.({}, {
      isError: false,
      meta,
    } as never)).toEqual({ card: 'generic', title: 'Visualization · A' })
  })
})
