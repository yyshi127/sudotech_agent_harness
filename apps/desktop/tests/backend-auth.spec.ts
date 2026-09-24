import { afterEach, expect, it, vi } from 'vitest'
import { backendLaunchUrl, backendSessionCookie, companionEventsUrl } from '../backend-auth.mjs'

afterEach(() => vi.unstubAllGlobals())

it('keeps the complete authenticated launch URL from the Host output', () => {
  const output = 'booting\ndsh web: http://127.0.0.1:59177/?token=launch-secret\n'
  expect(backendLaunchUrl(output)).toBe('http://127.0.0.1:59177/?token=launch-secret')
  expect(backendLaunchUrl('dsh web: http://127.0.0.1:59177/\n')).toBeUndefined()
  expect(backendLaunchUrl('dsh web: http://127.0.0.1:59177/?token=launch-sec')).toBeUndefined()
  expect(backendLaunchUrl('dsh web: http://127.0.0.1:59177/?token=launch-secret (LAN: http://192.168.1.5:59177/?token=other)\n'))
    .toBe('http://127.0.0.1:59177/?token=launch-secret')
})

it('exchanges the launch token for the Host cookie and rejects unauthenticated responses', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(null, {
    status: 303,
    headers: { 'set-cookie': 'dsh_session=owned; HttpOnly; SameSite=Strict' },
  })).mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
  vi.stubGlobal('fetch', fetch)

  expect(await backendSessionCookie('http://127.0.0.1:59177/?token=launch-secret')).toBe('dsh_session=owned')
  expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:59177/?token=launch-secret', { redirect: 'manual' })
  await expect(backendSessionCookie('http://127.0.0.1:59177/')).rejects.toThrow('authentication failed')
})

it('builds the companion endpoint without passing the launch token in its URL', () => {
  expect(companionEventsUrl('http://127.0.0.1:59177/?token=launch-secret'))
    .toBe('http://127.0.0.1:59177/xiaojing-desktop-companion/events')
})
