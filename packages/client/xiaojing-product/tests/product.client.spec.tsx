// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { HeroBrandContent, HeroBrandMark } from '../src/client/HeroBrand.tsx'
import { OnboardingContent } from '../src/client/OnboardingContent.tsx'
import { SidebarBrandMark, SidebarBrandName } from '../src/client/SidebarBrand.tsx'
import { apply, inject } from '../src/client/index.ts'
import { zh } from '../src/client/locales.ts'

const t = (key: keyof typeof zh): string => zh[key]
const unusedHook = (() => { throw new Error('unused by Xiaojing product components') }) as never
const kit = { useSessions: unusedHook, useWorkspaces: unusedHook }

afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
  delete document.body.dataset.xiaojingProduct
  vi.unstubAllEnvs()
})

const HOLES = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
  'conversation.hero.brand.mark',
  'conversation.hero.brand.content',
  'onboarding.content',
] as const

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const disposeHoles = slots.register({
    name: 'root',
    children: Object.fromEntries(HOLES.map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  return { ctx, slots, disposeHoles }
}

describe('Xiaojing product UI', () => {
  it('renders the product hero copy and beta badge', () => {
    render(<HeroBrandMark {...kit} size={34} className="hero-mark" t={t} />)
    expect(screen.getByRole('img', { name: '小兢会计' }).getAttribute('src')).toBe('/sdoobot-avatar.png')
    expect(screen.getByRole('img', { name: '小兢会计' }).getAttribute('style')).toContain('width: 34px')
    render(<HeroBrandContent {...kit} t={t} />)
    expect(screen.getByText('小兢会计，您的AI办公搭子')).toBeTruthy()
    expect(screen.getByText('内测版')).toBeTruthy()
  })

  it('renders independent sidebar mark and name occupants', () => {
    const view = render(<SidebarBrandMark {...kit} size={24} />)
    expect(view.container.querySelector('img[src="/sdoobot-avatar.png"]')).toBeTruthy()
    render(<SidebarBrandName {...kit} t={t} />)
    expect(screen.getByRole('img', { name: '数豆科技' }).getAttribute('src')).toBe('/sudo-logo-gray.png')
    expect(screen.getByText('用AI重新定义财务')).toBeTruthy()
  })

  it('activates every product occupant and theme only for the Xiaojing build profile', async () => {
    expect(inject).toEqual(['slots', 'locale'])
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'official')
    const official = await bench()
    await official.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) expect(official.slots.entries(hole)).toHaveLength(0)
    expect(document.body.dataset.xiaojingProduct).toBeUndefined()
    await official.ctx.fiber.dispose()

    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'xiaojing')
    const product = await bench()
    const fiber = product.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of HOLES) expect(product.slots.entries(hole)).toHaveLength(1)
    expect(document.body.dataset.xiaojingProduct).toBe('')
    await fiber.dispose()
    for (const hole of HOLES) expect(product.slots.entries(hole)).toHaveLength(0)
    expect(document.body.dataset.xiaojingProduct).toBeUndefined()
    await product.ctx.fiber.dispose()
  })

  it('renders the blocking first-use API-key guide and acknowledges it', () => {
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    document.body.append(appRoot)
    const acknowledge = vi.fn(() => Promise.resolve())
    render(<OnboardingContent {...kit} acknowledge={acknowledge} saving={false} failed={false} t={t} />)

    expect(screen.getByRole('dialog', { name: '初次使用说明' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '打开 DeepSeek 开放平台' }).getAttribute('href'))
      .toBe('https://platform.deepseek.com/')
    expect(appRoot.inert).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: '初次使用说明' }))
    fireEvent.click(screen.getByRole('button', { name: '开始使用' }))
    expect(acknowledge).toHaveBeenCalledOnce()
  })
})
