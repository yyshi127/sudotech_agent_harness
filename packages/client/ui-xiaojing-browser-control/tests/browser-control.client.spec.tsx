// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  NativeBrowserControlStatus, NativeBrowserState,
} from '@deepseek-ai/dsh-xiaojing-browser-control/native-settings-types'
import { apply, inject } from '../src/client/index.ts'
import { BrowserControlController } from '../src/client/controller.ts'
import { BrowserControlSection } from '../src/client/BrowserControlSection.tsx'
import { zh } from '../src/client/locales.ts'

const originalProfile = process.env.DSH_CLIENT_BUILD_PROFILE
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  if (originalClipboard === undefined) Reflect.deleteProperty(navigator, 'clipboard')
  else Object.defineProperty(navigator, 'clipboard', originalClipboard)
  if (originalProfile === undefined) delete process.env.DSH_CLIENT_BUILD_PROFILE
  else process.env.DSH_CLIENT_BUILD_PROFILE = originalProfile
})

const unusedHook = (() => { throw new Error('unused by browser-control settings') }) as never
const kit = {
  useSessions: unusedHook, useWorkspaces: unusedHook, usePanelInfo: unusedHook,
  useSessionStatus: unusedHook, useSessionRetainInfo: unusedHook, useResource: unusedHook,
}
const t = (key: keyof typeof zh): string => zh[key]

function status(chrome: NativeBrowserState = 'disabled', edge: NativeBrowserState = 'disabled'): NativeBrowserControlStatus {
  return {
    canOpenSettings: true,
    browsers: ([['chrome', chrome], ['edge', edge]] as const).map(([browser, state]) => ({
      browser, installed: true, enabled: state !== 'disabled', setupReady: state !== 'setup-required', state,
    })),
  }
}

const DISABLED = status()

function rpc(result: unknown): { caller: ClientConnectionRpc; call: ReturnType<typeof vi.fn> } {
  const call = vi.fn().mockResolvedValue({ ok: true, value: result })
  return { caller: { call }, call }
}

function controller(result: unknown = DISABLED) {
  const { caller, call } = rpc(result)
  return { controller: new BrowserControlController(caller, zh.invalidStatus), call }
}

function props(controller: BrowserControlController) {
  return {
    ...kit,
    close: () => {},
    useBrowserControl: bindSnapshotSelector(controller.store),
    actions: controller,
    t,
  }
}

describe('native browser settings page', () => {
  it('shows Chrome and Edge installation, management, and permissions without pairing controls', async () => {
    const { controller: owner } = controller()
    render(<BrowserControlSection {...props(owner)} />)
    expect(await screen.findByRole('switch', { name: zh.enableChrome })).toBeTruthy()
    expect(screen.getByRole('switch', { name: zh.enableEdge }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('button', { name: zh.manageChrome })).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.manageEdge })).toBeTruthy()
    expect(screen.getAllByText(zh.installed)).toHaveLength(2)
    expect(screen.getAllByText(zh.disabled)).toHaveLength(2)
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.queryByText('生成配对码')).toBeNull()
    expect(screen.queryByText('固定扩展 ID')).toBeNull()
  })

  it.each(['chrome', 'edge'] as const)('enables %s without claiming a live connection', async (browser) => {
    const { controller: owner, call } = controller()
    render(<BrowserControlSection {...props(owner)} />)
    const label = browser === 'chrome' ? zh.enableChrome : zh.enableEdge
    const toggle = await screen.findByRole('switch', { name: label })
    call.mockResolvedValue({ ok: true, value: browser === 'chrome' ? status('ready') : status('disabled', 'ready') })
    await act(async () => { fireEvent.click(toggle) })
    expect(call).toHaveBeenCalledWith('/xiaojing-native-browser-control', 'set-enabled', { browser, enabled: true })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText(zh.ready)).toBeTruthy()
    expect(screen.queryByText(zh.connected)).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it.each(['chrome', 'edge'] as const)('shows fixed %s setup instructions without launching until the explicit open button is clicked', async (browser) => {
    const { controller: owner, call } = controller()
    render(<BrowserControlSection {...props(owner)} />)
    const label = browser === 'chrome' ? zh.manageChrome : zh.manageEdge
    const manager = await screen.findByRole('button', { name: label })
    await act(async () => { fireEvent.click(manager) })
    const guide = screen.getByRole('dialog', { name: browser === 'chrome' ? zh.guideChrome : zh.guideEdge })
    const address = within(guide).getByRole<HTMLInputElement>('textbox', { name: zh.addressLabel })
    expect(address.value).toBe(`${browser}://inspect/#remote-debugging`)
    expect(address.readOnly).toBe(true)
    expect(address).toBe(document.activeElement)
    expect(guide.textContent).toContain(browser === 'chrome' ? zh.guideOpenChrome : zh.guideOpenEdge)
    expect(guide.textContent).toContain(zh.guideAllow)
    expect(guide.textContent).toContain(zh.guideConnect)
    expect(call).toHaveBeenCalledTimes(1)
    expect(within(guide).getByRole('button', { name: browser === 'chrome' ? zh.openChromeSettings : zh.openEdgeSettings })).toBeTruthy()
    expect({ title: guide.getAttribute('aria-label'), address: address.value, instructions: guide.textContent }).toMatchSnapshot()
  })

  it.each(['chrome', 'edge'] as const)('copies only the fixed %s settings address with confirmed feedback', async (browser) => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { controller: owner } = controller()
    render(<BrowserControlSection {...props(owner)} />)
    fireEvent.click(await screen.findByRole('button', { name: browser === 'chrome' ? zh.manageChrome : zh.manageEdge }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.copyAddress })) })
    expect(writeText).toHaveBeenCalledWith(`${browser}://inspect/#remote-debugging`)
    expect(screen.getByRole('button', { name: zh.addressCopied })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('retains a selectable address and shows a failed copy without claiming success', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Clipboard denied'))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { controller: owner } = controller()
    render(<BrowserControlSection {...props(owner)} />)
    fireEvent.click(await screen.findByRole('button', { name: zh.manageChrome }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.copyAddress })) })
    expect(screen.getByRole('alert').textContent).toBe(zh.copyFailed)
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: zh.addressLabel }).value).toBe('chrome://inspect/#remote-debugging')
    expect(screen.queryByRole('button', { name: zh.addressCopied })).toBeNull()
    writeText.mockResolvedValue(undefined)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.copyAddress })) })
    expect(screen.getByRole('button', { name: zh.addressCopied })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each(['chrome', 'edge'] as const)('shows %s setup once after the Host confirms enabled but not ready', async (browser) => {
    const { controller: owner, call } = controller()
    render(<BrowserControlSection {...props(owner)} />)
    const toggle = await screen.findByRole('switch', { name: browser === 'chrome' ? zh.enableChrome : zh.enableEdge })
    const pending = Promise.withResolvers<{ ok: true; value: NativeBrowserControlStatus }>()
    call.mockReturnValueOnce(pending.promise)
    fireEvent.click(toggle)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    const confirmed = browser === 'chrome' ? status('setup-required') : status('disabled', 'setup-required')
    call.mockResolvedValue({ ok: true, value: confirmed })
    await act(async () => { pending.resolve({ ok: true, value: confirmed }); await pending.promise })
    expect(screen.getByRole('dialog', { name: browser === 'chrome' ? zh.guideChrome : zh.guideEdge })).toBeTruthy()
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByText(zh.connected)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh.guideDone }))
    call.mockResolvedValue({ ok: true, value: confirmed })
    await act(async () => { await owner.load() })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    call.mockResolvedValue({ ok: true, value: DISABLED })
    await act(async () => { fireEvent.click(toggle) })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not show setup when an enable request fails', async () => {
    const { controller: owner, call } = controller()
    render(<BrowserControlSection {...props(owner)} />)
    const toggle = await screen.findByRole('switch', { name: zh.enableChrome })
    call.mockResolvedValue({ ok: false, error: { message: '无法保存许可' } })
    await act(async () => { fireEvent.click(toggle) })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('alert').textContent).toContain('无法保存许可')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes the instructions with Escape and restores focus without changing permission', async () => {
    const { controller: owner, call } = controller(status('ready'))
    render(<BrowserControlSection {...props(owner)} />)
    const manager = await screen.findByRole('button', { name: zh.manageChrome })
    manager.focus()
    fireEvent.click(manager)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(manager)
    expect(screen.getByRole('switch', { name: zh.enableChrome }).getAttribute('aria-checked')).toBe('true')
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('waits for verified Host navigation before claiming that settings opened', async () => {
    const { controller: owner, call } = controller()
    render(<BrowserControlSection {...props(owner)} />)
    const manage = await screen.findByRole('button', { name: zh.manageChrome })
    const pending = Promise.withResolvers<{ ok: true; value: NativeBrowserControlStatus }>()
    call.mockReturnValueOnce(pending.promise)
    fireEvent.click(manage)
    fireEvent.click(screen.getByRole('button', { name: zh.openChromeSettings }))
    expect(screen.getByRole('button', { name: zh.openingSettings }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByText(zh.settingsOpened)).toBeNull()
    expect(manage.hasAttribute('disabled')).toBe(true)
    await act(async () => { pending.resolve({ ok: true, value: DISABLED }); await pending.promise })
    expect(screen.getByText(zh.settingsOpened)).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.openChromeSettings }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('switch', { name: zh.enableChrome }).getAttribute('aria-checked')).toBe('false')
  })

  it('keeps manual setup available after failed navigation and retries only on another explicit click', async () => {
    const { controller: owner, call } = controller()
    render(<BrowserControlSection {...props(owner)} />)
    const manage = await screen.findByRole('button', { name: zh.manageEdge })
    call.mockResolvedValueOnce({ ok: false, error: { message: 'Could not verify the new settings page' } })
    fireEvent.click(manage)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.openEdgeSettings })) })
    expect(screen.getByText(zh.settingsOpenFailed)).toBeTruthy()
    expect(screen.queryByText(zh.settingsOpened)).toBeNull()
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: zh.addressLabel }).value).toBe('edge://inspect/#remote-debugging')
    expect(call).toHaveBeenCalledTimes(2)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.openEdgeSettings })) })
    expect(call).toHaveBeenCalledTimes(3)
    expect(call).toHaveBeenLastCalledWith('/xiaojing-native-browser-control', 'open-settings', { browser: 'edge' })
    expect(screen.getByText(zh.settingsOpened)).toBeTruthy()
    expect(screen.queryByText(zh.settingsOpenFailed)).toBeNull()
  })

  it('keeps manual setup instructions without an opening button on unsupported Host platforms', async () => {
    const snapshot = { ...DISABLED, canOpenSettings: false }
    const { controller: owner, call } = controller(snapshot)
    render(<BrowserControlSection {...props(owner)} />)
    fireEvent.click(await screen.findByRole('button', { name: zh.manageChrome }))
    expect(screen.queryByRole('button', { name: zh.openChromeSettings })).toBeNull()
    expect(screen.getByText(zh.manualSettingsOnly)).toBeTruthy()
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: zh.addressLabel }).value).toBe('chrome://inspect/#remote-debugging')
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('does not apply a closed Chrome launch result to newly opened Edge instructions', async () => {
    const { controller: owner, call } = controller()
    render(<BrowserControlSection {...props(owner)} />)
    const pending = Promise.withResolvers<{ ok: true; value: NativeBrowserControlStatus }>()
    const manage = await screen.findByRole('button', { name: zh.manageChrome })
    fireEvent.click(manage)
    call.mockReturnValueOnce(pending.promise)
    fireEvent.click(screen.getByRole('button', { name: zh.openChromeSettings }))
    fireEvent.click(screen.getByRole('button', { name: zh.guideDone }))
    expect(screen.getByRole('button', { name: zh.manageEdge }).hasAttribute('disabled')).toBe(true)
    await act(async () => { pending.resolve({ ok: true, value: DISABLED }); await pending.promise })
    fireEvent.click(screen.getByRole('button', { name: zh.manageEdge }))
    expect(screen.getByRole('dialog', { name: zh.guideEdge })).toBeTruthy()
    expect(screen.queryByText(zh.settingsOpened)).toBeNull()
    expect(screen.getByRole('button', { name: zh.openEdgeSettings }).hasAttribute('disabled')).toBe(false)
    expect(call).toHaveBeenCalledTimes(2)
  })

  it('does not apply a previous browser copy result to newly opened instructions', async () => {
    const pending = Promise.withResolvers<undefined>()
    const writeText = vi.fn().mockReturnValueOnce(pending.promise)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { controller: owner } = controller()
    render(<BrowserControlSection {...props(owner)} />)
    fireEvent.click(await screen.findByRole('button', { name: zh.manageChrome }))
    fireEvent.click(screen.getByRole('button', { name: zh.copyAddress }))
    expect(screen.getByRole('button', { name: zh.copyAddress }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: zh.guideDone }))
    fireEvent.click(screen.getByRole('button', { name: zh.manageEdge }))
    await act(async () => { pending.resolve(undefined); await pending.promise })
    expect(screen.getByRole('dialog', { name: zh.guideEdge })).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.copyAddress })).toBeTruthy()
    expect(screen.queryByRole('button', { name: zh.addressCopied })).toBeNull()
  })

  it('keeps an enabled switch during required browser setup and disables controls for a missing browser', async () => {
    const snapshot = status('setup-required')
    snapshot.browsers[1] = { browser: 'edge', installed: false, enabled: false, setupReady: false, state: 'disabled' }
    const { controller: owner } = controller(snapshot)
    render(<BrowserControlSection {...props(owner)} />)
    const chrome = await screen.findByRole('switch', { name: zh.enableChrome })
    expect(chrome.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText(zh['setup-required'])).toBeTruthy()
    expect(screen.getByText(zh.notInstalled)).toBeTruthy()
    expect(screen.getByRole('switch', { name: zh.enableEdge }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: zh.manageEdge }).hasAttribute('disabled')).toBe(true)
  })

  it('turns a connected permission off only after the Host confirms revocation', async () => {
    const { controller: owner, call } = controller(status('connected', 'ready'))
    render(<BrowserControlSection {...props(owner)} />)
    const toggle = await screen.findByRole('switch', { name: zh.enableChrome })
    expect(screen.getByText(zh.connected)).toBeTruthy()
    const pending = Promise.withResolvers<{ ok: true; value: NativeBrowserControlStatus }>()
    call.mockReturnValue(pending.promise)
    act(() => { fireEvent.click(toggle) })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(toggle.hasAttribute('disabled')).toBe(true)
    expect(call).toHaveBeenCalledWith('/xiaojing-native-browser-control', 'set-enabled', { browser: 'chrome', enabled: false })
    await act(async () => { pending.resolve({ ok: true, value: status('disabled', 'ready') }); await pending.promise })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(toggle.hasAttribute('disabled')).toBe(false)
    expect(screen.queryByText(zh.connected)).toBeNull()
  })

  it('allows revocation after an enabled browser is no longer installed', async () => {
    const missing = status('disconnected')
    missing.browsers[0] = { browser: 'chrome', installed: false, enabled: true, setupReady: false, state: 'disconnected' }
    const { controller: owner, call } = controller(missing)
    render(<BrowserControlSection {...props(owner)} />)
    const toggle = await screen.findByRole('switch', { name: zh.enableChrome })
    expect(toggle.hasAttribute('disabled')).toBe(false)
    call.mockResolvedValue({ ok: true, value: DISABLED })
    await act(async () => { fireEvent.click(toggle) })
    expect(call).toHaveBeenCalledWith('/xiaojing-native-browser-control', 'set-enabled', { browser: 'chrome', enabled: false })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })

  it('keeps the other browser usable when one installation cannot be detected', async () => {
    const snapshot = status('disabled', 'ready')
    snapshot.browsers[0] = { browser: 'chrome', installed: null, enabled: false, setupReady: false, state: 'disabled', error: '无法读取 Chrome 的浏览器策略' }
    const { controller: owner } = controller(snapshot)
    render(<BrowserControlSection {...props(owner)} />)
    const chrome = await screen.findByRole('switch', { name: zh.enableChrome })
    expect(chrome.hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: zh.manageChrome }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('switch', { name: zh.enableEdge }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: zh.manageEdge }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByText(zh.detectionFailed)).toBeTruthy()
    expect(screen.queryByText(zh.notInstalled)).toBeNull()
    expect(screen.getByText('无法读取 Chrome 的浏览器策略')).toBeTruthy()
  })

  it('confirms revocation and preserves a row error when installation discovery still fails', async () => {
    const unknown = status('disconnected')
    unknown.browsers[0] = { browser: 'chrome', installed: null, enabled: true, setupReady: false, state: 'disconnected', error: '无法识别 Chrome 安装情况' }
    const { controller: owner, call } = controller(unknown)
    render(<BrowserControlSection {...props(owner)} />)
    const toggle = await screen.findByRole('switch', { name: zh.enableChrome })
    expect(toggle.hasAttribute('disabled')).toBe(false)
    const revoked = { ...unknown, browsers: unknown.browsers.map(row => row.browser === 'chrome' ? { ...row, enabled: false, state: 'disabled' as const } : row) }
    call.mockResolvedValue({ ok: true, value: revoked })
    await act(async () => { fireEvent.click(toggle) })
    expect(call).toHaveBeenCalledWith('/xiaojing-native-browser-control', 'set-enabled', { browser: 'chrome', enabled: false })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(toggle.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('无法识别 Chrome 安装情况')).toBeTruthy()
    expect(screen.getAllByRole('switch')).toHaveLength(2)
    expect(owner.store.getSnapshot().error).toBeNull()
  })

  it('retains both rows and the confirmed permission when a write fails', async () => {
    const { controller: owner, call } = controller(status('connected', 'ready'))
    render(<BrowserControlSection {...props(owner)} />)
    const toggle = await screen.findByRole('switch', { name: zh.enableChrome })
    call.mockResolvedValue({ ok: false, error: { message: '暂时无法保存设置' } })
    await act(async () => { fireEvent.click(toggle) })
    expect(screen.getByRole('alert').textContent).toContain('暂时无法保存设置')
    expect(screen.getAllByRole('switch')).toHaveLength(2)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(toggle.hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: zh.retry })).toBeTruthy()
  })

  it('retains rows throughout a slow refresh and a subsequent read failure', async () => {
    const { controller: owner, call } = controller(status('connecting', 'disconnected'))
    render(<BrowserControlSection {...props(owner)} />)
    await screen.findByRole('switch', { name: zh.enableChrome })
    const pending = Promise.withResolvers<{ ok: true; value: NativeBrowserControlStatus }>()
    call.mockReturnValue(pending.promise)
    let refreshing: Promise<void> = Promise.resolve()
    act(() => { refreshing = owner.load() })
    expect(screen.getAllByRole('switch')).toHaveLength(2)
    expect(screen.queryByRole('status', { name: zh.loading })).toBeNull()
    expect(screen.getByText(zh.connecting)).toBeTruthy()
    await act(async () => { pending.reject(new Error('无法读取浏览器状态')); await refreshing })
    expect(screen.getAllByRole('switch')).toHaveLength(2)
    expect(screen.getByText(zh.disconnected)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('无法读取浏览器状态')
    expect(owner.store.getSnapshot().status).toBe('ready')
  })

  it('shows one centered loader for the first read and allows retry after an initial failure', async () => {
    const { controller: owner, call } = controller()
    const pending = Promise.withResolvers<{ ok: true; value: NativeBrowserControlStatus }>()
    call.mockReturnValue(pending.promise)
    render(<BrowserControlSection {...props(owner)} />)
    expect(screen.getByRole('status', { name: zh.loading })).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
    await act(async () => { pending.reject(new Error('浏览器服务不可用')); await Promise.resolve() })
    expect(screen.queryByRole('status', { name: zh.loading })).toBeNull()
    call.mockResolvedValue({ ok: true, value: DISABLED })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.retry })) })
    expect(screen.getAllByRole('switch')).toHaveLength(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('ignores an older read after a confirmed permission change', async () => {
    const { controller: owner, call } = controller()
    const pending = Promise.withResolvers<{ ok: true; value: NativeBrowserControlStatus }>()
    call.mockReturnValueOnce(pending.promise)
    const reading = owner.load()
    call.mockResolvedValue({ ok: true, value: status('ready') })
    await owner.setEnabled('chrome', true)
    pending.resolve({ ok: true, value: DISABLED })
    await reading
    expect(owner.store.getSnapshot().snapshot?.browsers[0]).toMatchObject({ browser: 'chrome', enabled: true, state: 'ready' })
  })

  it('does not overlap reads or writes while their owning request is pending', async () => {
    const { controller: owner, call } = controller()
    const reading = Promise.withResolvers<{ ok: true; value: NativeBrowserControlStatus }>()
    call.mockReturnValueOnce(reading.promise)
    const first = owner.load()
    await owner.load()
    expect(call).toHaveBeenCalledTimes(1)
    reading.resolve({ ok: true, value: DISABLED })
    await first
    const writing = Promise.withResolvers<{ ok: true; value: NativeBrowserControlStatus }>()
    call.mockReturnValueOnce(writing.promise)
    const write = owner.setEnabled('edge', true)
    await owner.load()
    await owner.setEnabled('chrome', true)
    expect(call).toHaveBeenCalledTimes(2)
    writing.resolve({ ok: true, value: status('disabled', 'ready') })
    await write
  })

  it.each([
    null,
    [],
    { ...DISABLED, canOpenSettings: 'yes' },
    { browsers: DISABLED.browsers },
    { canOpenSettings: true, browsers: [] },
    { canOpenSettings: true, browsers: [DISABLED.browsers[0], DISABLED.browsers[0]] },
    { canOpenSettings: true, browsers: [DISABLED.browsers[0], { ...DISABLED.browsers[1], installed: 'yes' }] },
    { canOpenSettings: true, browsers: [DISABLED.browsers[0], { ...DISABLED.browsers[1], enabled: 1 }] },
    { canOpenSettings: true, browsers: [DISABLED.browsers[0], { ...DISABLED.browsers[1], setupReady: null }] },
    { canOpenSettings: true, browsers: [DISABLED.browsers[0], { ...DISABLED.browsers[1], state: 'paired' }] },
    { canOpenSettings: true, browsers: [DISABLED.browsers[0], { ...DISABLED.browsers[1], browser: 'firefox' }] },
    { canOpenSettings: true, browsers: [DISABLED.browsers[0], { ...DISABLED.browsers[1], error: {} }] },
    { canOpenSettings: true, browsers: [DISABLED.browsers[0], null] },
  ])('rejects malformed status at the RPC JSON parser: %#', async (value) => {
    const { controller: owner } = controller(value)
    await owner.load()
    expect(owner.store.getSnapshot()).toMatchObject({ status: 'error', snapshot: null, error: zh.invalidStatus })
  })

  it('drops non-status fields and normalizes rows into Chrome then Edge order', async () => {
    const { controller: owner } = controller({
      canOpenSettings: true,
      browsers: [...status('disconnected', 'ready').browsers].reverse().map(row => ({
        ...row, secret: 'private-token', executablePath: 'private-path', error: '连接已关闭',
      })),
    })
    await owner.load()
    const snapshot = owner.store.getSnapshot().snapshot
    expect(snapshot?.browsers.map(row => row.browser)).toEqual(['chrome', 'edge'])
    expect(snapshot?.browsers[0]?.error).toBe('连接已关闭')
    expect(JSON.stringify(snapshot)).not.toContain('private-token')
    expect(JSON.stringify(snapshot)).not.toContain('private-path')
  })

  it('clears the refresh timer when the settings section unmounts', async () => {
    vi.useFakeTimers()
    const { controller: owner, call } = controller()
    const page = render(<BrowserControlSection {...props(owner)} />)
    await act(async () => { await Promise.resolve() })
    expect(call).toHaveBeenCalledTimes(1)
    await act(async () => { vi.advanceTimersByTime(2_000); await Promise.resolve() })
    expect(call).toHaveBeenCalledTimes(2)
    page.unmount()
    await act(async () => { vi.advanceTimersByTime(6_000); await Promise.resolve() })
    expect(call).toHaveBeenCalledTimes(2)
  })
})

async function settingsContext(isLoopback: boolean) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  ctx.provide('connection', { isLoopback, rpc: rpc(DISABLED).caller } as never)
  return { ctx, slots }
}

describe('native browser settings registration', () => {
  it('registers one removable standalone section for a loopback Xiaojing client', async () => {
    process.env.DSH_CLIENT_BUILD_PROFILE = 'xiaojing'
    const { ctx, slots } = await settingsContext(true)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const section = slots.entries('settings.section')[0]
    expect(section?.options).toMatchObject({ id: 'browser-control', order: 30 })
    expect(resolveSlotLabel(section?.options.label)).toBe(zh.nav)
    await fiber.dispose()
    expect(slots.entries('settings.section')).toHaveLength(0)
    await ctx.fiber.dispose()
  })

  it.each([
    ['official', true], ['xiaojing', false],
  ] as const)('does not register for profile %s and loopback=%s', async (profile, isLoopback) => {
    process.env.DSH_CLIENT_BUILD_PROFILE = profile
    const { ctx, slots } = await settingsContext(isLoopback)
    await ctx.plugin({ inject: [...inject], apply }).await()
    expect(slots.entries('settings.section')).toHaveLength(0)
    await ctx.fiber.dispose()
  })
})
