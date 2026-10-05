import { describe, expect, it } from 'vitest'
import {
  DEFAULT_COMPANION_SCALE,
  IDLE_COMPANION_SNAPSHOT,
  defaultCompanionBounds,
  composerCompanionBounds,
  isCompanionLayout,
  isCompanionScale,
  isCompanionSnapshot,
  normalizeCompanionPreferences,
  resolveCompanionBounds,
} from '../src/xiaojing-companion-geometry.ts'

const primary = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }
const left = { id: 2, workArea: { x: -1280, y: 0, width: 1280, height: 984 } }
const mainWindow = { x: 180, y: 70, width: 1440, height: 900 }

describe('desktop companion persistence and geometry', () => {
  it('defaults new and malformed preferences to a visible companion', () => {
    expect(normalizeCompanionPreferences(undefined)).toEqual({
      schemaVersion: 1, visible: true, scale: DEFAULT_COMPANION_SCALE, trayHintShown: false,
    })
    expect(normalizeCompanionPreferences({ visible: false, trayHintShown: true, position: { x: 'bad' } })).toEqual({
      schemaVersion: 1, visible: false, scale: DEFAULT_COMPANION_SCALE, trayHintShown: true,
    })
  })

  it('normalizes a remembered cross-display position', () => {
    expect(normalizeCompanionPreferences({
      schemaVersion: 99,
      visible: true,
      position: { x: -900.4, y: 111.6, displayId: '2' },
    })).toEqual({
      schemaVersion: 1,
      visible: true,
      scale: DEFAULT_COMPANION_SCALE,
      trayHintShown: false,
      position: { x: -900, y: 112, displayId: '2' },
    })
  })

  it('keeps a supported scale and defaults invalid persisted values to half size', () => {
    expect(normalizeCompanionPreferences({ scale: 0.75 }).scale).toBe(0.75)
    expect(normalizeCompanionPreferences({ scale: 1.1 }).scale).toBe(DEFAULT_COMPANION_SCALE)
    expect(isCompanionScale(0.3)).toBe(true)
    expect(isCompanionScale(1)).toBe(true)
    expect(isCompanionScale(0.25)).toBe(false)
  })

  it('places the companion at the primary work-area bottom right', () => {
    expect(defaultCompanionBounds(primary)).toEqual({ x: 1584, y: 644, width: 320, height: 380 })
  })

  it('places a new companion fully inside the main-window bottom right', () => {
    expect(defaultCompanionBounds(primary, mainWindow)).toEqual({
      x: 1284, y: 574, width: 320, height: 380,
    })
    expect(resolveCompanionBounds({}, [primary], primary, mainWindow)).toEqual({
      x: 1284, y: 574, width: 320, height: 380,
    })
  })

  it('falls back to the display when an anchor cannot contain the companion', () => {
    expect(defaultCompanionBounds(primary, { x: 100, y: 100, width: 300, height: 300 })).toEqual({
      x: 1584, y: 644, width: 320, height: 380,
    })
  })

  it('keeps saved bounds visible and recovers a removed display', () => {
    expect(resolveCompanionBounds({ position: { x: -2_000, y: 900, displayId: 2 } }, [primary, left], primary)).toEqual({
      x: -1280, y: 604, width: 320, height: 380,
    })
    expect(resolveCompanionBounds({ position: { x: -800, y: 100, displayId: 404 } }, [primary], primary)).toEqual({
      x: 0, y: 100, width: 320, height: 380,
    })
  })

  it('accepts only the redacted snapshot vocabulary', () => {
    expect(isCompanionSnapshot(IDLE_COMPANION_SNAPSHOT)).toBe(true)
    expect(isCompanionSnapshot({ ...IDLE_COMPANION_SNAPSHOT, activeTaskCount: -1 })).toBe(false)
    expect(isCompanionSnapshot({ ...IDLE_COMPANION_SNAPSHOT, state: 'secret', task: 'private' })).toBe(false)
    expect(isCompanionSnapshot(null)).toBe(false)
  })
})

describe('desktop companion responsive composer gutter', () => {
  it.each([1366, 1920, 2560, 3840].flatMap(width => [1, 1.25, 1.5, 2].map(dpiScale => [width, dpiScale])))
  ('centers between composer and content edges at screen width %s and DPI scale %s', (width, dpiScale) => {
    for (const zoom of [0.8, 1, 1.25]) {
      const content = { x: 80, y: 30, width: width / dpiScale, height: 900 / dpiScale }
      const display = { id: 1, workArea: { x: 0, y: 0, width: content.width + 160, height: content.height + 100 } }
      const layout = {
        viewportWidth: content.width / zoom, viewportHeight: content.height / zoom,
        composerRight: (content.width - 220) / zoom, composerTop: (content.height - 170) / zoom,
      }
      const bounds = composerCompanionBounds(layout, content, 0.5, display)
      const characterCenter = bounds.x + 320 - 20 - 140 / 2
      expect(Math.abs(characterCenter - (content.x + content.width - 110))).toBeLessThanOrEqual(0.5)
      expect(Math.abs(bounds.y + 380 - (content.y + content.height - 24))).toBeLessThanOrEqual(0.5)
    }
  })

  it('keeps the character off the input when the gutter is too narrow', () => {
    const content = { x: 0, y: 0, width: 960, height: 600 }
    const layout = { viewportWidth: 960, viewportHeight: 600, composerRight: 944, composerTop: 430 }
    const bounds = composerCompanionBounds(layout, content, 0.5, primary)
    expect(bounds.y + bounds.height).toBeLessThan(layout.composerTop)
    expect(bounds.x + 320 - 20 - 70 + 49).toBeLessThanOrEqual(content.width - 16)
  })

  it('keeps the same center when the character size changes and supports a monitor left of the primary', () => {
    const content = { x: -1200, y: 40, width: 1100, height: 800 }
    const layout = { viewportWidth: 1100, viewportHeight: 800, composerRight: 800, composerTop: 640 }
    for (const scale of [0.3, 0.5, 1]) {
      const bounds = composerCompanionBounds(layout, content, scale, left)
      expect(bounds.x + 320 - 20 - 280 * scale / 2).toBe(-250)
    }
  })

  it.each([null, {}, { viewportWidth: 0 },
    { viewportWidth: 960, viewportHeight: 600, composerRight: Infinity, composerTop: 430 },
    { viewportWidth: 960, viewportHeight: 600, composerRight: 1000, composerTop: 430 },
    { viewportWidth: 960, viewportHeight: 600, composerRight: 900, composerTop: -1 },
  ])('rejects invalid layout input %j', (value) => {
    expect(isCompanionLayout(value)).toBe(false)
  })
})
