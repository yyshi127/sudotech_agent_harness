/** Return the complete loopback launch URL once its log line has arrived. */
export function backendLaunchUrl(output: string): string | undefined

/** Exchange a Host launch URL for its Cookie header; reject failed authentication. */
export function backendSessionCookie(url: string): Promise<string>

/** Return the companion event endpoint without the launch token. */
export function companionEventsUrl(url: string): string
