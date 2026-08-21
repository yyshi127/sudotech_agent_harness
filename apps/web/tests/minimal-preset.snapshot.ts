import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { assertFixtureInventory, launchWebScaffold, type WebScaffold } from './scaffold.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/minimal-preset', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.jsonl')
const PROMPT = 'Reply exactly MINIMAL_PRESET_REQUEST_OK and stop.'
const SHELL_TOOL = process.platform === 'win32' ? 'pwsh' : 'bash'

describe('minimal agent preset', () => {
  let scaffold: WebScaffold
  let agentHandle: AgentHandle
  let disposeInjectedPrompt: () => void

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE })
    disposeInjectedPrompt = scaffold.ctx.systemPrompt.section({
      name: 'test:injected-prompt',
      order: 999,
      text: 'THIS TEXT MUST NOT REACH THE MODEL.',
    })
    agentHandle = await scaffold.ctx.agents.create({
      sessionId: SessionId('minimal-preset-smoke'),
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'minimal' },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx, 'minimal').then(() => undefined),
    })
  })

  afterAll(async () => {
    const failures: unknown[] = []
    await agentHandle?.dispose().catch((error: unknown) => failures.push(error))
    try {
      disposeInjectedPrompt?.()
    } catch (error: unknown) {
      failures.push(error)
    }
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'minimal preset smoke teardown failed')
  })

  it('sends the exact RL prompt and schemas, then executes the persistent shell and editor', async () => {
    agentHandle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: PROMPT }],
      source: { kind: 'user' },
    }))
    await agentHandle.agent.whenIdle()

    const requestHeader = agentHandle.agent.session.requestHeader()
    if (requestHeader === undefined) throw new Error('the minimal agent issued no model request')
    expect(agentHandle.agent.session.events.some(event => event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt')).toBe(false)
    const presetFileSystem = scaffold.ctx.agentPresets.serviceFor(agentHandle.agent, 'fs')
    expect(presetFileSystem).toBeDefined()
    expect(presetFileSystem?.sandboxMode).toBeUndefined()
    expect(scaffold.ctx.agentPresets.serviceFor(agentHandle.agent, 'compaction')).toBeUndefined()

    const stateDir = join(scaffold.workspaceCwd, 'persistent-state')
    await mkdir(stateDir)
    const signal = new AbortController().signal
    await scaffold.ctx.tools.execute({
      signal,
      callId: CallId('minimal-shell-state-setup'),
      name: SHELL_TOOL,
      arguments: {
        command: process.platform === 'win32'
          ? `Set-Location -LiteralPath ${JSON.stringify(stateDir)}; $env:DSH_MINIMAL_STATE = 'PERSISTED'`
          : `cd ${JSON.stringify(stateDir)} && export DSH_MINIMAL_STATE=PERSISTED`,
      },
      agent: agentHandle.agent,
    })
    const shell = await scaffold.ctx.tools.execute({
      signal,
      callId: CallId('minimal-shell-state-read'),
      name: SHELL_TOOL,
      arguments: {
        command: process.platform === 'win32'
          ? "Write-Output ($env:DSH_MINIMAL_STATE + ':' + (Get-Location).Path)"
          : 'printf \'%s:%s\n\' "$DSH_MINIMAL_STATE" "$PWD"',
      },
      agent: agentHandle.agent,
    })
    const seedPath = join(scaffold.workspaceCwd, 'preset-smoke.txt')
    await writeFile(seedPath, 'MINIMAL_EDITOR_OK\n')
    const editor = await scaffold.ctx.tools.execute({
      signal,
      callId: CallId('minimal-editor-smoke'),
      name: 'str_replace_editor',
      arguments: { command: 'view', path: seedPath },
      agent: agentHandle.agent,
    })

    const text = (result: typeof shell): string => result.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
      .replaceAll(scaffold.workspaceCwd, '{{cwd}}')
      .replaceAll('\\', '/')
      .trimEnd()

    expect({
      prompt: requestHeader.system,
      tools: requestHeader.tools?.map(tool => tool.name === SHELL_TOOL ? 'platform_shell' : tool.name),
      browserDescription: requestHeader.tools?.find(tool => tool.name === 'browser_control')?.description,
      computerDescription: requestHeader.tools?.find(tool => tool.name === 'computer_control')?.description,
      shell: text(shell),
      editor: text(editor),
    }).toMatchInlineSnapshot(`
      {
        "browserDescription": "Control a dedicated visible browser using semantic page observations. Use open, then target only opaque IDs from the latest observation. Actions return a fresh observation automatically. Never guess target IDs. Use this tool for websites instead of computer_control. Private-network navigation, file uploads, submissions, payments, deletions, sends, and similar high-impact actions require one-time user approval.",
        "computerDescription": "Control a visible native Windows application through semantic UI Automation when direct file, command, or data tools cannot complete the task more efficiently. Use browser_control for websites. If the required application is closed, call list_apps with its name and launch_app with the returned opaque app ID. Then list or use the returned windows, observe one window, and invoke only advertised target actions. Never guess IDs or launch an application merely to perform work that a direct tool can complete. This tool cannot control UAC, secure desktop, sign-in screens, elevated applications, pixel-only canvases, or controls without UI Automation semantics.",
        "editor": "Here's the content of {{cwd}}/preset-smoke.txt with line numbers (which has a total of 2 lines):
           1  MINIMAL_EDITOR_OK
           2",
        "prompt": "You are a helpful software engineer assistant.",
        "shell": "PERSISTED:{{cwd}}/persistent-state",
        "tools": [
          "browser_control",
          "computer_control",
          "platform_shell",
          "str_replace_editor",
        ],
      }
    `)
    expect(requestHeader.tools?.toSorted((left, right) => left.name.localeCompare(right.name)))
      .toEqual(scaffold.ctx.tools.schemas(agentHandle.agent).toSorted((left, right) => left.name.localeCompare(right.name)))
    await assertFixtureInventory(SNAPSHOT_DIR, ['session.jsonl'])
  })
})
