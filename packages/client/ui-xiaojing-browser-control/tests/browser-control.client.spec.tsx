// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import {
  apply, inject,
} from '../src/client/index.ts'
import {
  BrowserControlSettingsController, type BrowserControlSettings,
} from '../src/client/controller.ts'
import { BrowserControlSection } from '../src/client/BrowserControlSection.tsx'
import { zh } from '../src/client/locales.ts'

const originalProfile = process.env.DSH_CLIENT_BUILD_PROFILE

afterEach(async () => {
  cleanup()
  if (originalProfile === undefined) delete process.env.DSH_CLIENT_BUILD_PROFILE
  else process.env.DSH_CLIENT_BUILD_PROFILE = originalProfile
})

const unusedHook = (() => { throw new Error('unused by browser-control settings') }) as never
const kit = { useSessions: unusedHook, useWorkspaces: unusedHook }
const t = (key: keyof typeof zh): string => zh[key]

describe('browser-control settings page', () => {
  it('renders Edge and Chrome choices and writes the selected browser', async () => {
    const host = stubSettingsScope<BrowserControlSettings>()
    host.publish({
      status: 'ready', value: { browser: 'edge' }, revision: 0, writable: true,
    })
    const controller = new BrowserControlSettingsController(host.scope)
    render(<BrowserControlSection
      {...kit}
      close={() => {}}
      useBrowserControl={bindSnapshotSelector(controller.store)}
      actions={controller}
      t={t}
    />)

    expect(screen.getByRole('heading', { name: '浏览器控制' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Microsoft Edge/u }).getAttribute('aria-checked')).toBe('true')
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: /Google Chrome/u })) })
    expect(host.set).toHaveBeenCalledWith('browser', 'chrome')
    controller.dispose()
  })

  it('registers one removable standalone section only for a loopback Xiaojing client', async () => {
    process.env.DSH_CLIENT_BUILD_PROFILE = 'xiaojing'
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({
      name: 'root',
      children: { 'settings.section': { kind: 'list', scope: 'root' } },
    } as never, () => null)
    const locale = new LocaleRuntime(ctx)
    locale.setLocale('zh')
    ctx.provide('locale', locale)
    ctx.provide('connection', { isLoopback: true } as never)
    const host = stubSettingsScope<BrowserControlSettings>()
    ctx.provide('settingsScope', { bind: () => host.scope } as never)

    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const section = slots.entries('settings.section')[0]
    expect(section?.options).toMatchObject({ id: 'browser-control', order: 30 })
    expect(resolveSlotLabel(section?.options.label)).toBe('浏览器控制')

    await fiber.dispose()
    expect(slots.entries('settings.section')).toHaveLength(0)
    await ctx.fiber.dispose()
  })

  it('does not register outside the Xiaojing build profile', async () => {
    process.env.DSH_CLIENT_BUILD_PROFILE = 'official'
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({
      name: 'root',
      children: { 'settings.section': { kind: 'list', scope: 'root' } },
    } as never, () => null)
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    expect(slots.entries('settings.section')).toHaveLength(0)
    await ctx.fiber.dispose()
  })
})
