/** Keep reserved test-host DNS failures independent of host resolvers and VPN routing. */
import type { LookupFunction } from 'node:net'
import type { Agent } from 'undici'
import { vi } from 'vitest'

vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>()
  const dns = await import('node:dns')
  const lookup: LookupFunction = (hostname, options, callback) => {
    if (hostname.endsWith('.invalid') || hostname.endsWith('.test')) {
      callback(Object.assign(new Error('Reserved fixture hostname'), { code: 'ENOTFOUND' }), [])
      return
    }
    dns.lookup(hostname, options, callback)
  }
  return {
    ...actual,
    Agent: class extends actual.Agent {
      constructor(options?: Agent.Options) {
        super({ ...options, connect: { lookup } })
      }
    },
  }
})
