import { describe, expect, it } from 'vitest'
import {
  DEFAULT_COMPANION_SCALE,
  IDLE_COMPANION_SNAPSHOT,
  defaultCompanionBounds,
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
