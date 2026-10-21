/** Xiaojing forked reminder refusals retain the product's mandatory deletion approval. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-schedule'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-user-approval'
import { fixtureUserPrompts, launchWebScaffold, readPersistedEvents, selectedSessionFixture, webClientProfile, webSnapshotMode } from './scaffold.ts'

it.skipIf(webClientProfile() !== 'xiaojing' || webSnapshotMode() === 'record')(
  'refuses delegated reminders after one deletion approval without creating a task', async ({ onTestFinished }) => {
    const fixture = fileURLToPath(new URL('../../../snapshots/web/subagent-fork-schedule/session.v4.jsonl', import.meta.url))
    const childFixture = fileURLToPath(new URL('../../../snapshots/web/subagent-fork-schedule/session.1.v4.jsonl', import.meta.url))
    const parentPath = await selectedSessionFixture(fixture)
    const childPath = await selectedSessionFixture(childFixture)
    const scaffold = await launchWebScaffold({ replayFixture: parentPath, replayChildFixtures: [childPath], compareReplaySession: false })
    let closing: Promise<void> | undefined
    const close = (): Promise<void> => closing ??= scaffold.close()
    onTestFinished(close)
    try {
      const approvals: string[] = []
      scaffold.ctx.on('approval/request', (request) => {
        approvals.push(request.toolName)
        return Promise.resolve('allowed-once' as const)
      }, { prepend: true })
      const sessions: Session[] = []
      scaffold.ctx.on('session/created', (session) => { sessions.push(session) })
      const { sessionId } = await scaffold.ctx.sessionController.create({ cwd: scaffold.workspaceCwd })
      const parent = scaffold.ctx.agents.get(sessionId)
      if (parent === undefined) throw new Error('Created parent has no Agent')
      const prompt = fixtureUserPrompts(await readFile(parentPath, 'utf8'))[0]
      if (prompt === undefined) throw new Error('Parent recording has no prompt')
      parent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
      await parent.whenIdle()
      const childPrompt = parseSessionLog(await readFile(childPath, 'utf8'))
        .findLast(event => event.type === 'user/message' && event.data.source.kind === 'user')
      if (childPrompt?.type !== 'user/message') throw new Error('Child recording has no prompt')
      const activation = await scaffold.ctx.subagents.startActivation({
        provider: 'fork', label: 'Check delegated reminder refusal', delivery: 'caller', signal: new AbortController().signal,
        request: { parent, prompt: [...childPrompt.data.content] },
      })
      try { await activation.result } finally { await activation.dispose() }
      expect(sessions).toHaveLength(2)
      const child = sessions[1]!
      expect(child.header).toMatchObject({ parentSession: parent.id, isSeeded: true, agentPreset: 'standard' })
      const childEvents = child.snapshotEvents().slice(child.inheritedEventCount)
      const results = childEvents.filter(event => event.type === 'tool/result')
      expect(results.map(event => event.data.message.content)).toEqual(Array.from({ length: 4 }, () => [
        { type: 'text', text: '{"code":"subagent_session","message":"A delegated subagent cannot use reminders."}' },
      ]))
      expect(approvals).toEqual(['schedule_delete'])
      expect(childEvents.filter(event => event.type === 'approval/asked')).toHaveLength(1)
      expect(childEvents.filter(event => event.type === 'approval/decided')).toHaveLength(1)
      expect(await scaffold.ctx.schedule.list({ sessionId: child.id })).toEqual([])
      expect(await scaffold.ctx.schedule.list({ sessionId: parent.id })).toEqual([])
      for (const session of sessions) {
        expect(await readPersistedEvents(scaffold, session.id)).toEqual(session.snapshotEvents())
      }
    } finally {
      await close()
    }
  },
)
