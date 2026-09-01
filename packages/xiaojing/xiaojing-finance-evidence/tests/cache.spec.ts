import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FinanceEvidenceCache } from '../src/cache.ts'
import { FinanceEvidenceSourceId, type FinanceEvidenceItem } from '../src/types.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function cache(maxEntries = 2, ttlMs = 1_000): Promise<FinanceEvidenceCache> {
  const root = await mkdtemp(join(tmpdir(), 'xiaojing-finance-evidence-cache-'))
  roots.push(root)
  const value = new FinanceEvidenceCache(root, maxEntries, ttlMs)
  await value.init()
  return value
}

function item(url: string, title: string): FinanceEvidenceItem {
  return {
    sourceId: FinanceEvidenceSourceId('state-tax-policy'),
    authority: '国家税务总局政策法规库',
    authorityLevel: 'L1',
    title,
    lifecycle: 'current',
    legalEffect: 'normative-document',
    applicability: 'national-conditional',
    role: 'official-text',
    url,
    retrievedAt: '2026-08-28T00:00:00.000Z',
    sha256: 'a'.repeat(64),
    excerpt: '短摘录',
    retrieval: 'network',
    rightsStatus: 'terms-review-pending',
    limitations: [],
  }
}

describe('FinanceEvidenceCache', () => {
  it('returns unexpired metadata as a detached cache hit and never stores full text', async () => {
    const value = await cache()
    await value.put(item('https://fgk.chinatax.gov.cn/a', '甲'), 100)
    const cached = await value.get('https://fgk.chinatax.gov.cn/a', 200)
    expect(cached).toMatchObject({ title: '甲', retrieval: 'cache', excerpt: '短摘录' })
    expect(await readFile(value.filePath, 'utf8')).not.toContain('完整法规正文')
  })

  it('expires old entries and keeps only the newest configured count', async () => {
    const value = await cache(2, 1_000)
    await value.put(item('https://fgk.chinatax.gov.cn/a', '甲'), 100)
    await value.put(item('https://fgk.chinatax.gov.cn/b', '乙'), 200)
    await value.put(item('https://fgk.chinatax.gov.cn/c', '丙'), 300)
    expect(await value.get('https://fgk.chinatax.gov.cn/a', 400)).toBeUndefined()
    expect(await value.get('https://fgk.chinatax.gov.cn/c', 400)).toMatchObject({ title: '丙' })
    expect(await value.get('https://fgk.chinatax.gov.cn/c', 1_301)).toBeUndefined()
  })

  it('refuses malformed durable data without replacing it', async () => {
    const value = await cache()
    const malformed = '{"schemaVersion":1,"entries":['
    await writeFile(value.filePath, malformed, 'utf8')
    const restarted = new FinanceEvidenceCache(dirname(dirname(value.filePath)), 2, 1_000)
    await expect(restarted.init()).rejects.toThrow()
    expect(await readFile(value.filePath, 'utf8')).toBe(malformed)
  })

  it('rejects discovery-only results', async () => {
    const value = await cache()
    const discovery = { ...item('https://fgk.chinatax.gov.cn/a', '甲'), role: 'discovery-only' as const }
    await expect(value.put(discovery, 100)).rejects.toThrow(/only bounded fetched/)
  })
})
