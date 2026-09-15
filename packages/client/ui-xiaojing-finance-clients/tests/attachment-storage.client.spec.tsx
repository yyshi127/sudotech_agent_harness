// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AttachmentStorageSection, type AttachmentStorageSectionProps } from '../src/client/AttachmentStorageSection.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const config = { bucket: 'rhy-attachment', region: 'oss-cn-hangzhou', endpoint: 'https://attachments.sudo.vip', prefix: 'xiaojing/' }
function props(): AttachmentStorageSectionProps {
  return {
    load: vi.fn(async () => ({ revision: 0, config, configured: false, writable: true })),
    save: vi.fn(async () => ({ revision: 1, config, configured: true, writable: true })),
    test: vi.fn(async () => ({ revision: 1, uploaded: true, downloaded: true, deleted: true, message: '测试完成' })),
    t: (key: keyof typeof zh) => zh[key],
  } as AttachmentStorageSectionProps
}
it('prefills non-secret settings, clears saved keys, and requires save before cloud testing', async () => {
  const input = props()
  render(<AttachmentStorageSection {...input} />)
  await screen.findByDisplayValue(config.bucket)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '测试连接' }).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('AccessKey ID'), { target: { value: 'exampleId123' } })
  fireEvent.change(screen.getByLabelText('AccessKey Secret'), { target: { value: 'exampleSecret123' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => { expect(input.save).toHaveBeenCalledWith({ expectedRevision: 0, config, accessKeyId: 'exampleId123', accessKeySecret: 'exampleSecret123' }) })
  await waitFor(() => { expect(screen.getByLabelText<HTMLInputElement>('AccessKey Secret').value).toBe('') })
  fireEvent.click(screen.getByRole('button', { name: '测试连接' }))
  await screen.findByText('连接测试通过')
  expect(input.test).toHaveBeenCalledWith(1)
  fireEvent.change(screen.getByLabelText('Bucket 名称'), { target: { value: 'another-bucket' } })
  expect(screen.queryByText('连接测试通过')).toBeNull()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '测试连接' }).disabled).toBe(true)
})
it('shows load, save and cleanup failures without claiming success', async () => {
  const input = props()
  input.load = vi.fn().mockRejectedValueOnce(new Error('读取失败')).mockResolvedValue({ revision: 1, config, configured: true, writable: true })
  input.save = vi.fn().mockRejectedValue(new Error('配置已变更'))
  input.test = vi.fn(async () => ({ revision: 1, uploaded: true, downloaded: true, deleted: false, message: '清理失败' }))
  render(<AttachmentStorageSection {...input} />)
  await screen.findByText('读取失败')
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  await screen.findByDisplayValue(config.bucket)
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await screen.findByText('配置已变更')
  fireEvent.click(screen.getByRole('button', { name: '测试连接' }))
  await screen.findByText('清理失败')
  expect(screen.queryByText('连接测试通过')).toBeNull()
})
