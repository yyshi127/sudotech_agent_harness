// @vitest-environment jsdom
/** Model-owned text decoration reads and observes one concrete lexicon store. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { Context, FiberState } from '@deepseek-ai/cordis'
import { TestSessions } from '@deepseek-ai/dsh-client-test-runtime/src/sessions.ts'
import { InputTriggerService, type InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { $getRoot } from 'lexical'
import { expect, it, onTestFinished, vi } from 'vitest'
import { DraftEditorRuntime } from '../src/client/input/editor/runtime.ts'
import { InputHub } from '../src/client/input/hub.ts'

type Lexicon = ReadonlyMap<'/' | '@', readonly string[]>

it('updates decorations from its subscribed store after the root resolver becomes unavailable', () => {
  const lexicon = createSnapshotStore<Lexicon>(new Map([['/', ['alpha']]]))
  let available = true
  const readRoot = vi.fn(() => {
    if (!available) throw new Error('root sessions resolver is unavailable')
    return lexicon.getSnapshot()
  })
  const resolveRoot = vi.fn(() => {
    if (!available) throw new Error('root sessions resolver is unavailable')
    return lexicon
  })
  const runtime: DraftEditorRuntime = new DraftEditorRuntime({
    onUpdate: () => { runtime.refreshProjection() },
    openReference: () => false, activeClaimToken: () => null,
    lexicon: readRoot, resolveLexicon: resolveRoot,
    isRootClosing: () => !available,
  })
  const dispose = runtime.register()
  onTestFinished(dispose)
  const subscriberErrors: unknown[][] = []
  const originalError = console.error.bind(console)
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    subscriberErrors.push(args)
    originalError(...args)
  })
  onTestFinished(() => { spy.mockRestore() })
  runtime.setDraft('/alpha ')
  const nodes = () => runtime.editor.read(() => $getRoot().getAllTextNodes().map(node => ({
    type: node.getType(), text: node.getTextContent(),
  })))
  expect(nodes().some(node => node.type === 'composer-text-ref' && node.text === '/alpha')).toBe(true)
  const rootReads = readRoot.mock.calls.length
  const rootResolves = resolveRoot.mock.calls.length
  available = false
  lexicon.set(new Map())
  expect(nodes().some(node => node.type === 'composer-text-ref')).toBe(false)
  lexicon.set(new Map([['/', ['alpha']]]))
  expect(nodes().some(node => node.type === 'composer-text-ref' && node.text === '/alpha')).toBe(true)
  expect(readRoot).toHaveBeenCalledTimes(rootReads)
  expect(resolveRoot).toHaveBeenCalledTimes(rootResolves)
  expect(subscriberErrors).toEqual([])
})

it('keeps lazy reads until a concrete lexicon can be subscribed', () => {
  const lexicon = createSnapshotStore<Lexicon>(new Map([['/', ['alpha']]]))
  let available = false
  const readRoot = vi.fn(() => lexicon.getSnapshot())
  const resolveRoot = vi.fn(() => available ? lexicon : undefined)
  const runtime: DraftEditorRuntime = new DraftEditorRuntime({
    onUpdate: () => { runtime.refreshProjection() },
    openReference: () => false, activeClaimToken: () => null,
    lexicon: readRoot, resolveLexicon: resolveRoot,
    isRootClosing: () => false,
  })
  const dispose = runtime.register()
  onTestFinished(dispose)
  runtime.setDraft('/alpha ')
  expect(readRoot).toHaveBeenCalled()
  expect(resolveRoot).toHaveBeenCalled()
  available = true
  runtime.refreshProjection()
  const rootReads = readRoot.mock.calls.length
  lexicon.set(new Map())
  expect(runtime.editor.read(() => $getRoot().getAllTextNodes().some(node => node.getType() === 'composer-text-ref'))).toBe(false)
  expect(readRoot).toHaveBeenCalledTimes(rootReads)
})

it('unsubscribes on unregister and resolves the replacement store when registered again', () => {
  const first = createSnapshotStore<Lexicon>(new Map([['/', ['alpha']]]))
  const second = createSnapshotStore<Lexicon>(new Map())
  let current = first
  const firstSubscribe = vi.spyOn(first, 'subscribe')
  const secondSubscribe = vi.spyOn(second, 'subscribe')
  onTestFinished(() => { firstSubscribe.mockRestore(); secondSubscribe.mockRestore() })
  const onUpdate = vi.fn(() => { runtime.refreshProjection() })
  const runtime = new DraftEditorRuntime({
    onUpdate, openReference: () => false, activeClaimToken: () => null,
    lexicon: () => current.getSnapshot(), resolveLexicon: () => current,
    isRootClosing: () => false,
  })
  const firstDispose = runtime.register()
  runtime.setDraft('/alpha ')
  expect(firstSubscribe).toHaveBeenCalledOnce()
  firstDispose()
  const updates = onUpdate.mock.calls.length
  first.set(new Map())
  expect(onUpdate).toHaveBeenCalledTimes(updates)
  current = second
  const secondDispose = runtime.register()
  onTestFinished(secondDispose)
  runtime.refreshProjection()
  expect(secondSubscribe).toHaveBeenCalledOnce()
  second.set(new Map([['/', ['alpha']]]))
  expect(runtime.editor.read(() => $getRoot().getAllTextNodes().some(node => node.getType() === 'composer-text-ref'))).toBe(true)
  second.set(new Map())
  expect(runtime.editor.read(() => $getRoot().getAllTextNodes().some(node => node.getType() === 'composer-text-ref'))).toBe(false)
  expect(firstSubscribe).toHaveBeenCalledOnce()
})

it('keeps initial root lookup failures visible before subscribing', () => {
  const runtime = new DraftEditorRuntime({
    onUpdate: () => {}, openReference: () => false, activeClaimToken: () => null,
    lexicon: () => { throw new Error('initial root lookup failed') },
    resolveLexicon: () => undefined,
    isRootClosing: () => false,
  })
  const dispose = runtime.register()
  onTestFinished(dispose)
  expect(() => { runtime.setDraft('/alpha ') }).toThrow('initial root lookup failed')
})

it('keeps active resolver failures visible after observing a lexicon', () => {
  const lexicon = createSnapshotStore<Lexicon>(new Map([['/', ['alpha']]]))
  let available = true
  const runtime: DraftEditorRuntime = new DraftEditorRuntime({
    onUpdate: () => { runtime.refreshProjection() },
    openReference: () => false, activeClaimToken: () => null,
    lexicon: () => lexicon.getSnapshot(), isRootClosing: () => false,
    resolveLexicon: () => {
      if (!available) throw new Error('active root lookup failed')
      return lexicon
    },
  })
  const dispose = runtime.register()
  onTestFinished(dispose)
  runtime.setDraft('/alpha ')
  available = false
  expect(() => { runtime.setDraft('/beta ') }).toThrow('active root lookup failed')
})

it('uses the replacement store when a queued old-store rescan joins a new edit', () => {
  const first = createSnapshotStore<Lexicon>(new Map([['/', ['alpha']]]))
  const second = createSnapshotStore<Lexicon>(new Map([['/', ['beta']]]))
  let current = first
  const runtime: DraftEditorRuntime = new DraftEditorRuntime({
    onUpdate: () => { runtime.refreshProjection() },
    openReference: () => false, activeClaimToken: () => null,
    lexicon: () => current.getSnapshot(), resolveLexicon: () => current,
    isRootClosing: () => false,
  })
  const dispose = runtime.register()
  onTestFinished(dispose)
  runtime.setDraft('/alpha ')
  first.set(new Map())
  current = second
  runtime.setDraft('/beta ')
  const isBeta = () => runtime.editor.read(() => $getRoot().getAllTextNodes().some(node =>
    node.getType() === 'composer-text-ref' && node.getTextContent() === '/beta'))
  expect(isBeta()).toBe(true)
  const beforeLateFirst = runtime.editor.getEditorState()
  first.set(new Map([['/', ['ghost']]]))
  expect(runtime.editor.getEditorState()).toBe(beforeLateFirst)
  second.set(new Map())
  expect(isBeta()).toBe(false)
})

async function retainedShell() {
  const root = new Context()
  const sessions = new TestSessions(async (operation) => { await operation() }, root)
  const withdrawSessions = root.reflect.provide('sessions', sessions)
  const id = await sessions.add({ id: 'editor-lexicon-lifetime' })
  const reference = sessions.retain(id, { source: 'mainView' })
  const binding = await reference.ready
  const hub = new InputHub(root, key => key)
  const fiber = root.plugin(InputTriggerService)
  await fiber.await()
  const provider = root.get('inputTriggers')!
  const words = createSnapshotStore<readonly string[]>(['alpha'])
  const source: InputTriggerSource = {
    trigger: '/', name: 'owned-lexicon', candidates: () => Promise.resolve([]), onPick: () => undefined,
    lexicon: () => words.getSnapshot(), subscribeLexicon: (_session, listener) => words.subscribe(listener),
  }
  fiber.ctx.effect(() => provider.registerSource(source), 'owned lexicon source')
  const controller = provider.sessionOf(binding.ctx)
  const shell = hub.shellFor(binding)
  onTestFinished(async () => {
    reference.release()
    await sessions.disposeScopes()
    await root.fiber.dispose()
  })
  const hasDecoration = (word: string) => shell.editor.read(() => $getRoot().getAllTextNodes().some(node =>
    node.getType() === 'composer-text-ref' && node.getTextContent() === `/${word}`))
  return { root, sessions, reference, binding, hub, fiber, controller, shell, words, withdrawSessions, hasDecoration }
}

it('rebinds a retained shell across actual Cordis provider replacement and follows live updates', async () => {
  const b = await retainedShell()
  const offFirst = vi.spyOn(b.controller.lexicon, 'subscribe')
  onTestFinished(() => { offFirst.mockRestore() })
  b.shell.setDraft('/alpha ')
  expect(b.hasDecoration('alpha')).toBe(true)
  await b.fiber.dispose()
  const secondFiber = b.root.plugin(InputTriggerService)
  await secondFiber.await()
  const secondProvider = b.root.get('inputTriggers')!
  const words = createSnapshotStore<readonly string[]>(['beta'])
  secondFiber.ctx.effect(() => secondProvider.registerSource({
    trigger: '/', name: 'owned-replacement', candidates: () => Promise.resolve([]), onPick: () => undefined,
    lexicon: () => words.getSnapshot(), subscribeLexicon: (_session, listener) => words.subscribe(listener),
  }), 'owned replacement lexicon source')
  const second = secondProvider.sessionOf(b.binding.ctx)
  const subscribeSecond = vi.spyOn(second.lexicon, 'subscribe')
  onTestFinished(() => { subscribeSecond.mockRestore() })
  const trackSecond = vi.spyOn(second, 'track')
  onTestFinished(() => { trackSecond.mockRestore() })
  expect(b.sessions.binding(b.binding.sessionId)).toBe(b.binding)
  expect(b.hub.shellFor(b.binding)).toBe(b.shell)
  expect(second.lexicon).not.toBe(b.controller.lexicon)
  b.shell.setDraft('/beta ')
  expect(b.hasDecoration('beta')).toBe(true)
  expect(offFirst).toHaveBeenCalledOnce()
  expect(subscribeSecond).toHaveBeenCalledOnce()
  expect(trackSecond).toHaveBeenCalled()
  words.set([])
  expect(b.hasDecoration('beta')).toBe(false)
  words.set(['beta'])
  expect(b.hasDecoration('beta')).toBe(true)
  const beforeLateFirst = b.shell.editor.getEditorState()
  b.controller.lexicon.set(new Map([['/', ['ghost']]]))
  expect(b.shell.editor.getEditorState()).toBe(beforeLateFirst)
})

it('uses an observed store while its actual root unloads after withdrawing sessions', async () => {
  const b = await retainedShell()
  b.shell.setDraft('/alpha ')
  expect(b.hasDecoration('alpha')).toBe(true)
  const subscriberErrors: unknown[][] = []
  const originalError = console.error.bind(console)
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    subscriberErrors.push(args)
    originalError(...args)
  })
  onTestFinished(() => { spy.mockRestore() })
  const get = vi.spyOn(b.root, 'get')
  onTestFinished(() => { get.mockRestore() })
  let before = -1
  let after = -1
  let decoratedAfterWithdrawal: boolean | undefined
  b.root.effect(() => async () => {
    await b.withdrawSessions()
    expect(b.root.fiber.state).toBe(FiberState.UNLOADING)
    expect(b.root.get('sessions')).toBeUndefined()
    before = get.mock.calls.filter(([name]) => name === 'sessions').length
    b.controller.lexicon.set(new Map())
    decoratedAfterWithdrawal = b.hasDecoration('alpha')
    after = get.mock.calls.filter(([name]) => name === 'sessions').length
  }, 'owned root-closing lexicon publication')
  await b.root.fiber.dispose()
  expect(decoratedAfterWithdrawal).toBe(false)
  expect(after).toBe(before)
  expect(subscriberErrors).toEqual([])
})

it('does not start trigger tracking from a pending editor commit after its actual root starts unloading', async () => {
  const b = await retainedShell()
  b.shell.setDraft('/alpha ')
  const track = vi.spyOn(b.controller, 'track')
  onTestFinished(() => { track.mockRestore() })
  const closing = b.root.fiber.dispose()
  try {
    expect(b.root.fiber.state).toBe(FiberState.UNLOADING)
    b.controller.lexicon.set(new Map())
    expect(b.hasDecoration('alpha')).toBe(false)
    expect(b.shell.snapshot.draft).toBe('/alpha ')
    expect(track).not.toHaveBeenCalled()
  } finally {
    await closing
  }
})

it('keeps active trigger-tracking failures visible to the editor caller', async () => {
  const b = await retainedShell()
  const track = vi.spyOn(b.controller, 'track').mockImplementation(() => {
    throw new Error('active trigger tracking failed')
  })
  onTestFinished(() => { track.mockRestore() })
  expect(b.root.fiber.state).toBe(FiberState.ACTIVE)
  expect(() => { b.shell.setDraft('/alpha ') }).toThrow('active trigger tracking failed')
})
