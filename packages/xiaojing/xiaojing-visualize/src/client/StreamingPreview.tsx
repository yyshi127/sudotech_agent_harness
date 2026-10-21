/**
 * Live preview under the composer reads fragment prefixes from the latest
 * Step's preparing Tool Node. Its sandboxed shell retains completed script
 * blocks and withholds an unfinished trailing script. Dispatch removes the
 * preview, as does interruption; settled results render through the transcript card.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the `conversation.input.dock` SlotMap declaration.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatNode, ChatNodeSource } from '@deepseek-ai/dsh-client-ui-chat/client'
import { trimStreamingScripts, VISUALIZE_TOOL_NAME } from '../fragment.ts'
import { buildStreamShellDoc, HEIGHT_MESSAGE_TYPE, STREAM_MESSAGE_TYPE } from '../shell.ts'
import { resolveTheme } from './theme.ts'

/** Dock entry props: the InputZone owner share (live conversation snapshot). */
type StreamingPreviewProps = PropsRuntime<'conversation.input.dock'> & PropsLocale<'xiaojing.visualize'>

/**
 * Flush interval for posting fragment updates into the persistent shell.
 * Updates are incremental DOM syncs, not reloads, so this can run near
 * per-delta speed; 150ms keeps the reveal continuous at negligible cost.
 */
const FLUSH_MS = 150

/**
 * Preview height ceiling. The frame tracks the shell's *measured* content
 * height (its height reports), so invisible early markup — style blocks,
 * empty containers — keeps the frame collapsed and painted components grow
 * it; the cap stops a tall fragment from crowding out the composer. Reserving
 * space no paint has claimed reads as a layout bug, not as anticipation.
 */
const PREVIEW_MAX_HEIGHT = 300

/**
 * The input dock spans the conversation view, not the composer column, so the
 * preview constrains itself to the composer's width family and centers.
 */
const wrapStyle: CSSProperties = { margin: '6px auto 2px', maxWidth: 760, width: '100%' }

const labelStyle: CSSProperties = {
  fontSize: 12,
  opacity: 0.65,
  margin: '0 0 4px',
}

const frameStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  border: 0,
  background: 'transparent',
  transition: 'height 240ms ease',
}

/**
 * Throttle a fast-changing string: re-emits at most every {@link FLUSH_MS},
 * with a trailing flush so the final value always lands. A plain trailing
 * debounce would starve under a continuous token stream — every delta would
 * reset the timer — so this flushes on the leading edge when the interval has
 * already elapsed.
 * @param value - the raw per-render value.
 * @returns the throttled value.
 */
function useThrottled(value: string): string {
  const [shown, setShown] = useState(value)
  const lastFlush = useRef(0)
  useEffect(() => {
    const elapsed = Date.now() - lastFlush.current
    if (elapsed >= FLUSH_MS) {
      lastFlush.current = Date.now()
      setShown(value)
      return
    }
    const timer = setTimeout(() => {
      lastFlush.current = Date.now()
      setShown(value)
    }, FLUSH_MS - elapsed)
    return () => { clearTimeout(timer) }
  }, [value])
  return shown
}

/** The mounted preview, split out so hooks only run while a call streams. */
function Preview({ fragment, t }: { fragment: string | undefined; t: StreamingPreviewProps['t'] }) {
  const throttled = useThrottled(fragment ?? '')
  const preview = trimStreamingScripts(throttled)
  const hasContent = preview.trim().length > 0
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [contentHeight, setContentHeight] = useState(0)
  // Follow the shell's height reports so the frame hugs what is actually
  // painted; the CSS transition turns each growth step into a smooth reveal.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const report = event.data as { type?: unknown; token?: unknown; height?: unknown } | null
      if (report?.type !== HEIGHT_MESSAGE_TYPE || report.token !== 'streaming-preview') return
      if (typeof report.height !== 'number' || !Number.isFinite(report.height)) return
      setContentHeight(Math.max(0, Math.ceil(report.height)))
    }
    addEventListener('message', onMessage)
    return () => { removeEventListener('message', onMessage) }
  }, [])
  // The shell loads ONCE per streaming call; updates flow over postMessage
  // and sync incrementally, so unchanged components persist and new ones
  // float in instead of the whole frame reloading per flush.
  const doc = useMemo(() => buildStreamShellDoc({
    ...resolveTheme(),
    reportToken: 'streaming-preview',
  }), [])
  useEffect(() => {
    if (!loaded || !hasContent) return
    frameRef.current?.contentWindow?.postMessage({
      type: STREAM_MESSAGE_TYPE,
      token: 'streaming-preview',
      fragment: preview,
    }, '*')
  }, [loaded, hasContent, preview])
  return (
    <div style={wrapStyle}>
      <div style={labelStyle}>
        {t(hasContent ? 'streaming' : 'composing')}
      </div>
      <iframe
        ref={frameRef}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        title={t('streamingTitle')}
        srcDoc={doc}
        style={{ ...frameStyle, height: hasContent ? Math.min(contentHeight, PREVIEW_MAX_HEIGHT) : 0 }}
        onLoad={() => { setLoaded(true) }}
      />
    </div>
  )
}

/**
 * Dock entry: subscribes to the latest Step's most recent visualization call.
 * @param props - Current Chat reader and visualization labels.
 * @returns the preparing call's live preview, or nothing outside preparation.
 */
export function StreamingPreview({ useChat, t }: StreamingPreviewProps) {
  const source = useChat((snapshot) => {
    const turn = snapshot.timeline.turnOrder.at(-1)
    const step = turn === undefined ? undefined : snapshot.timeline.turns.get(turn)?.steps.at(-1)
    if (step === undefined) return undefined
    const keys = snapshot.locations.getStep(step.turn, step.step)
    for (const key of [...keys].reverse()) {
      const node = snapshot.nodes.get(key) as ChatNode | undefined
      if (node?.kind === 'tool-call' && node.data.root.name === VISUALIZE_TOOL_NAME) {
        return snapshot.nodes.source(key)
      }
    }
    return undefined
  })
  return source === undefined ? null : <ToolPreview key={source.getSnapshot()?.key} source={source} t={t} />
}

/** Read lazy arguments on every Tool publication, including tool-only Steps. */
function ToolPreview({ source, t }: { source: ChatNodeSource; t: StreamingPreviewProps['t'] }) {
  const node = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot) as ChatNode | undefined
  if (node?.kind !== 'tool-call' || node.visibility !== 'visible') return null
  const block = node.data.root
  if ('kind' in block || block.phase !== 'preparing') return null
  return <Preview fragment={block.args.text('fragment')} t={t} />
}
