import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FinanceDocumentStore } from '../src/store.ts'
import type { FinanceNormalizedDocument } from '../src/types.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function store(): Promise<FinanceDocumentStore> {
  const root = await mkdtemp(join(tmpdir(), 'xiaojing-finance-documents-store-'))
  roots.push(root)
  const value = new FinanceDocumentStore(root)
  await value.init()
  return value
}

function document(text: string): FinanceNormalizedDocument {
  return {
    schemaVersion: 3,
    normalizerVersion: 4,
    sha256: createHash('sha256').update(text).digest('hex'),
    size: Buffer.byteLength(text),
    kind: 'txt',
    status: 'parsed',
    normalizedAt: 123,
    summary: { unitCount: 1, charCount: text.length },
    units: [{ index: 0, kind: 'text', locator: '第1行', text }],
    visuals: [],
    warnings: [],
  }
}

describe('FinanceDocumentStore', () => {
  it('isolates identical content by client without exposing client names in paths', async () => {
    const value = await store()
    const record = document('客户资料')
    await value.put('client-A-legal-name', record)

    expect(await value.get('client-A-legal-name', record.sha256, record.kind)).toEqual(record)
    expect(await value.get('client-B-legal-name', record.sha256, record.kind)).toBeUndefined()
    const clients = await readdir(value.directory)
    expect(clients).toHaveLength(1)
    expect(clients[0]).toMatch(/^[a-f0-9]{64}$/u)
    expect(clients[0]).not.toContain('client-A')
  })

  it('preserves and rejects a corrupt durable record', async () => {
    const value = await store()
    const record = document('不可覆盖')
    await value.put('client-A', record)
    const [clientDirectory] = await readdir(value.directory)
    if (clientDirectory === undefined) throw new Error('missing cache directory')
    const clientPath = join(value.directory, clientDirectory)
    const [filename] = await readdir(clientPath)
    if (filename === undefined) throw new Error('missing cache record')
    const path = join(clientPath, filename)
    const malformed = '{"schemaVersion":1'
    await writeFile(path, malformed, 'utf8')

    const restarted = new FinanceDocumentStore(join(value.directory, '..', '..', '..', '..'))
    await expect(restarted.init()).rejects.toThrow(/preserve the file/)
    expect(await readFile(path, 'utf8')).toBe(malformed)
  })
})
