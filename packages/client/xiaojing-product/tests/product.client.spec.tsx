// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HeroBrand } from '../src/client/HeroBrand.tsx'
import { OnboardingContent } from '../src/client/OnboardingContent.tsx'
import { SidebarBrand } from '../src/client/SidebarBrand.tsx'
import { zh } from '../src/client/locales.ts'

const t = (key: keyof typeof zh): string => zh[key]
const unusedHook = (() => { throw new Error('unused by Xiaojing product components') }) as never
const kit = { useSessions: unusedHook, useWorkspaces: unusedHook }

afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
})

describe('Xiaojing product UI', () => {
  it('renders the product hero copy and beta badge', () => {
    render(<HeroBrand {...kit} t={t} />)
    expect(screen.getByRole('img', { name: '小兢会计' }).getAttribute('src')).toBe('/sdoobot-avatar.png')
    expect(screen.getByText('小兢会计，您的AI办公搭子')).toBeTruthy()
    expect(screen.getByText('内测版')).toBeTruthy()
  })

  it('owns both expanded and collapsed sidebar brands', () => {
    const startSession = vi.fn()
    const toggleSidebar = vi.fn()
    const props = {
      ...kit,
      wide: true,
      collapsed: false,
      startSession,
      toggleSidebar,
      newSessionLabel: '新建会话',
      toggleLabel: '收起侧边栏',
    }
    const view = render(<SidebarBrand {...props} />)
    expect(screen.getByRole('img', { name: 'SUDO 数豆科技' }).getAttribute('src')).toBe('/sudo-logo-gray.png')
    expect(screen.getByText('用AI重新定义财务')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '新建会话' }))
    expect(startSession).toHaveBeenCalledOnce()

    view.rerender(<SidebarBrand {...props} wide={false} collapsed toggleLabel="打开侧边栏" />)
    expect(view.container.querySelector('img[src="/sdoobot-avatar.png"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '打开侧边栏' }))
    expect(toggleSidebar).toHaveBeenCalledOnce()
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
