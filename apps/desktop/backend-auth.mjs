export function backendLaunchUrl(output) {
  return output.match(/(?:^|\r?\n)dsh web:[ \t]+(http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+)(?:[ \t]+\([^\r\n]*\))?\r?\n/)?.[1]
}

export async function backendSessionCookie(url) {
  const response = await fetch(url, { redirect: 'manual' })
  const cookie = response.headers.get('set-cookie')
  await response.body?.cancel()
  if (response.status !== 303 || cookie === null) throw new Error('Desktop Host authentication failed')
  return cookie.split(';', 1)[0]
}

export function companionEventsUrl(url) {
  return new URL('/xiaojing-desktop-companion/events', url).href
}
