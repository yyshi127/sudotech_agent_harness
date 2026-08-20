/** Xiaojing first-use API key guide. */

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { XiaojingProductKey } from './locales.ts'
import css from './OnboardingContent.module.css'

const DEEPSEEK_PLATFORM_URL = 'https://platform.deepseek.com/'
const ignoreImplicitDismiss = (): void => {}

/** Product copy injected into the first-use guide. */
export interface OnboardingContentInjected {
  t: (key: XiaojingProductKey) => string
}

/** Product onboarding content props. */
export type OnboardingContentProps = PropsRuntime<'onboarding.content'> & InjectFace<OnboardingContentInjected>

/** Render the versioned DeepSeek API key setup guide. */
export function OnboardingContent({ acknowledge, saving, failed, t }: OnboardingContentProps): ReactNode {
  const paragraphs = t('onboardingBody').split('\n\n')
  const titleRef = useRef<HTMLHeadingElement | null>(null)

  useEffect(() => {
    const appRoot = document.getElementById('root')
    if (appRoot === null) return
    const previous = appRoot.inert
    appRoot.inert = true
    return () => { appRoot.inert = previous }
  }, [])

  useEffect(() => { titleRef.current?.focus() }, [])

  return (
    <Modal open title={t('onboardingTitle')} onClose={ignoreImplicitDismiss} headless className={css.dialog as string}>
      <div className={css.content}>
        <h2 ref={titleRef} className={css.title} tabIndex={-1}>{t('onboardingTitle')}</h2>
        <div className={css.body}>
          <div className={css.copy}>
            {paragraphs.map((paragraph, index) => (
              <p key={paragraph}>
                {paragraph}
                {index === 0 && (
                  <>
                    {' '}
                    <a href={DEEPSEEK_PLATFORM_URL} target="_blank" rel="noreferrer">{t('platform')}</a>
                  </>
                )}
              </p>
            ))}
          </div>
          {failed && <p className={css.error} role="alert">{t('saveError')}</p>}
          <div className={css.actions}>
            <Button variant="primary" className={css.primary} disabled={saving} onClick={() => { void acknowledge() }}>
              {t('start')}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
