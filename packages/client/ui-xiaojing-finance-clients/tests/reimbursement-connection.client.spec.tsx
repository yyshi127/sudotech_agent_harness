// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FinanceClientId } from '@deepseek-ai/dsh-xiaojing-finance-domain/types'
import { ReimbursementConnectionSection, type ReimbursementConnectionActions } from '../src/client/ReimbursementConnectionSection.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const clientId = FinanceClientId('6ba7b810-9dad-11d1-80b4-00c04fd430c8')
const view = { revision: 2, apiUrl: 'https://yiqbdata.superboss.cc', appKey: 'shared-example-key', configured: true, writable: true }
const t = (key: keyof typeof zh): string => zh[key]

it('preserves the independent secret on blank save and clears replacement input before verification', async () => {
  const actions: ReimbursementConnectionActions = {
    read: vi.fn(async () => view), save: vi.fn(async () => ({ ...view, revision: 3 })), test: vi.fn(async () => '只读验证通过'),
  }
  render(<ReimbursementConnectionSection clientId={clientId} actions={actions} disabled={false} t={t} />)
  await screen.findByDisplayValue('shared-example-key')
  expect(screen.getByLabelText('报销 AppSecret').getAttribute('placeholder')).toBe('已保存；留空表示保持不变')
  fireEvent.click(screen.getByRole('button', { name: '保存报销配置' }))
  await waitFor(() => {
    expect(actions.save).toHaveBeenCalledWith({ clientId, expectedRevision: 2, apiUrl: view.apiUrl, appKey: view.appKey })
  })
  await screen.findByText(zh.reimbursementSaved)
  fireEvent.change(screen.getByLabelText('报销 AppSecret'), { target: { value: 'replacement-secret' } })
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '验证报销连接' }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '保存报销配置' }))
  await waitFor(() => {
    expect(actions.save).toHaveBeenLastCalledWith({
      clientId, expectedRevision: 3, apiUrl: view.apiUrl, appKey: view.appKey, appSecret: 'replacement-secret',
    })
  })
  await waitFor(() => { expect(screen.getByLabelText<HTMLInputElement>('报销 AppSecret').value).toBe('') })
  fireEvent.click(screen.getByRole('button', { name: '验证报销连接' }))
  await screen.findByText('只读验证通过')
  expect(actions.test).toHaveBeenCalledWith(clientId)
})

it('reloads after read failure and reports save conflicts without claiming verification', async () => {
  const actions: ReimbursementConnectionActions = {
    read: vi.fn().mockRejectedValueOnce(new Error('读取失败')).mockResolvedValue(view),
    save: vi.fn().mockRejectedValue(new Error('配置冲突')), test: vi.fn(),
  }
  render(<ReimbursementConnectionSection clientId={clientId} actions={actions} disabled={false} t={t} />)
  await screen.findByText('读取失败')
  fireEvent.click(screen.getByRole('button', { name: zh.storageReload }))
  await screen.findByDisplayValue('shared-example-key')
  fireEvent.click(screen.getByRole('button', { name: '保存报销配置' }))
  await screen.findByText('配置冲突')
  expect(screen.queryByText(zh.reimbursementSaved)).toBeNull()
  expect(actions.test).not.toHaveBeenCalled()
})
