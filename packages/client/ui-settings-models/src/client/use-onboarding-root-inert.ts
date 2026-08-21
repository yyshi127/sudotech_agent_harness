/** Shared accessibility lifecycle for modal onboarding steps. */

import { useEffect } from 'react'

/** Keep the application root inert while a modal onboarding step is mounted. */
export function useOnboardingRootInert(): void {
  useEffect(() => {
    const appRoot = document.getElementById('root')
    if (appRoot === null) return
    const previous = appRoot.inert
    appRoot.inert = true
    return () => { appRoot.inert = previous }
  }, [])
}
