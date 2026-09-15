/** Bounded original-file reads shared by voucher preparation and attachment transfer. */
import { createHash } from 'node:crypto'
import { open, realpath } from 'node:fs/promises'
import { extname, isAbsolute, relative } from 'node:path'
import type { FinanceManagedFile } from './types.ts'

/**
 * Require a supported extension and matching header before cloud transfer.
 * @param name - Imported original display name.
 * @param content - Bounded bytes verified against the import record.
 * @returns Lowercase extension; this is format screening, not invoice authenticity verification.
 */
export function financeOriginalExtension(name: string, content: Buffer): string {
  const extension = extname(name).toLowerCase()
  if (!['.pdf', '.png', '.jpg', '.jpeg'].includes(extension)) throw new Error('当前支持 PDF、PNG、JPG 发票附件。')
  const valid = extension === '.pdf' ? content.subarray(0, 5).toString() === '%PDF-'
    : extension === '.png' ? content.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      : content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff
  if (!valid) throw new Error('附件内容与 PDF/图片格式不符。')
  return extension
}

/**
 * Read an unchanged imported file inside the caller's verified source directory.
 * @param file - Host-selected import record; the caller must check session/client ownership.
 * @param sourceDirectory - Verified workspace source directory.
 * @param maxBytes - Deployment original-file size limit.
 * @param signal - Cancellation before, during and after reading.
 * @returns Bytes matching the recorded size/hash; does not certify file format, invoice facts or upload success.
 */
export async function readFinanceOriginal(file: FinanceManagedFile, sourceDirectory: string,
  maxBytes: number, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted()
  const root = await realpath(sourceDirectory)
  const path = await realpath(file.path)
  const offset = relative(root, path)
  if (!offset || offset === '..' || offset.startsWith('..\\') || offset.startsWith('../') || isAbsolute(offset)) {
    throw new Error('附件不在当前帐套原始资料目录中。')
  }
  if (file.size < 1 || file.size > maxBytes) throw new Error(`附件大小需在 1 到 ${maxBytes} 字节之间。`)
  const handle = await open(path, 'r')
  const bytes = Buffer.alloc(file.size + 1)
  let length = 0
  try {
    if (!(await handle.stat()).isFile()) throw new Error('附件不是普通文件。')
    while (length < bytes.length) {
      signal.throwIfAborted()
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length)
      if (bytesRead === 0) break
      length += bytesRead
    }
  } finally { await handle.close() }
  signal.throwIfAborted()
  const content = bytes.subarray(0, length)
  if (length !== file.size || createHash('sha256').update(content).digest('hex') !== file.sha256) {
    throw new Error('附件已变更，请重新导入后再准备或上传。')
  }
  return content
}
