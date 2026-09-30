/**
 * The `visualize` toolview: renders the persisted fragment from the call's
 * durable meta inside `<iframe sandbox="allow-scripts">` with the frame's own
 * CSP. Replay-stable by construction — everything drawn derives from the
 * logged call slice, never from the fragment file.
 *
 * Theme isolation: the card injects the plugin's original whale-blue light
 * palette into the frame document as `--dsh-viz-*` variables. It deliberately
 * ignores Harness, Xiaojing, and operating-system theme changes. The frame
 * body stays transparent to blend with the conversation surface.
 *
 * Height: a sandboxed frame's document is unreachable from the parent, so the
 * frame posts its scroll height (tagged with this call's id) and the card
 * sizes the iframe, capped per mode with internal scrolling past the cap.
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { visualizeMetaFrom, type VisualizeMeta } from '../fragment.ts'
import { buildFrameDoc, HEIGHT_MESSAGE_TYPE } from '../shell.ts'
import { resolveTheme } from './theme.ts'

/** Iframe height bounds; content beyond the cap scrolls inside the frame. */
const MIN_HEIGHT = 48
const HEIGHT_CAP: Record<'inline' | 'wide', number> = { inline: 800, wide: 1200 }

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  fontSize: 12,
  opacity: 0.65,
  margin: '2px 0 6px',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
}

const frameStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  border: 0,
  background: 'transparent',
  colorScheme: 'normal',
}

/** First text line of the durable result content, for the error row. */
function firstResultLine(content: readonly { type: string; text?: string }[], fallback: string): string {
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
      const newline = block.text.indexOf('\n')
      return newline === -1 ? block.text : block.text.slice(0, newline)
    }
  }
  return fallback
}

/**
 * Render persisted visualization content independently of tool-process disclosure.
 * @param props - validated metadata and the owning call identifier.
 * @returns the titled, sandboxed interactive frame.
 */
export function VisualizeFrame({ meta, callId }: { meta: VisualizeMeta; callId: string }) {
  const [height, setHeight] = useState(MIN_HEIGHT)

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data: unknown = event.data
      if (typeof data !== 'object' || data === null) return
      const report = data as { type?: unknown; token?: unknown; height?: unknown }
      if (report.type !== HEIGHT_MESSAGE_TYPE || report.token !== callId) return
      if (typeof report.height !== 'number' || !Number.isFinite(report.height)) return
      setHeight(Math.max(MIN_HEIGHT, Math.min(Math.ceil(report.height), HEIGHT_CAP[meta.mode])))
    }
    addEventListener('message', onMessage)
    return () => { removeEventListener('message', onMessage) }
  }, [callId, meta.mode])

  const doc = useMemo(() => {
    const { themeVars, colorScheme } = resolveTheme()
    return buildFrameDoc({
      fragment: meta.fragment,
      title: meta.title,
      themeVars,
      colorScheme,
      reportToken: callId,
    })
  }, [meta, callId])

  return (
    <div>
      <div style={headerStyle} title={meta.path}>
        <span style={{ fontWeight: 500 }}>{meta.title}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta.path}</span>
      </div>
      <iframe
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        title={meta.title}
        srcDoc={doc}
        style={{ ...frameStyle, height }}
      />
    </div>
  )
}

/**
 * Keyed toolview for the `visualize` tool. Running calls and malformed or
 * failed results stay quiet single lines; only a well-formed persisted meta
 * mounts the frame.
 */
export function VisualizeCard({ callId, block, t }: ToolCallViewProps & PropsLocale<'xiaojing.visualize'>) {
  if (!('kind' in block)) {
    return <div style={headerStyle}>{t('rendering')}</div>
  }
  if (block.isError) {
    return <div style={headerStyle}>{t('errorPrefix')}{firstResultLine(block.content, t('failed'))}</div>
  }
  const meta = visualizeMetaFrom(block.meta)
  if (meta === undefined) {
    // An older or foreign log without the descriptor: show the durable result
    // text instead of guessing at markup.
    return <div style={headerStyle}>{firstResultLine(block.content, t('failed'))}</div>
  }
  return <VisualizeFrame meta={meta} callId={callId} />
}
