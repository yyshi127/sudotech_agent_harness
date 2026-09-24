/** Xiaojing release information shared by product surfaces. */

import { useEffect, useState } from 'react'

/** Web fallback kept in lockstep with the desktop package by the product-layer gate. */
export const XIAOJING_PRODUCT_VERSION = '0.3.1'

interface ApplicationInfo {
  version: string
}

interface DesktopApplicationInfoBridge {
  getApplicationInfo?: () => Promise<unknown>
}

function desktopBridge(): DesktopApplicationInfoBridge | undefined {
  return (window as unknown as { xiaojingDesktop?: DesktopApplicationInfoBridge }).xiaojingDesktop
}

function isApplicationInfo(value: unknown): value is ApplicationInfo {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const version = (value as Record<string, unknown>).version
  return typeof version === 'string' && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)
}

/**
 * Read the packaged application version while retaining a deterministic Web preview fallback.
 * @returns The packaged desktop version or the product Web fallback.
 */
export async function resolveApplicationVersion(): Promise<string> {
  const read = desktopBridge()?.getApplicationInfo
  if (read === undefined) return XIAOJING_PRODUCT_VERSION
  try {
    const info = await read()
    return isApplicationInfo(info) ? info.version : XIAOJING_PRODUCT_VERSION
  } catch {
    return XIAOJING_PRODUCT_VERSION
  }
}

/**
 * Subscribe one product component to the resolved desktop or Web release version.
 * @returns The current Xiaojing application version.
 */
export function useApplicationVersion(): string {
  const [version, setVersion] = useState(XIAOJING_PRODUCT_VERSION)
  useEffect(() => {
    let mounted = true
    void resolveApplicationVersion().then((next) => {
      if (mounted) setVersion(next)
    })
    return () => { mounted = false }
  }, [])
  return version
}
