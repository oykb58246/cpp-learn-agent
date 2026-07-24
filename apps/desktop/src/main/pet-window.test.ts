import { describe, expect, it } from 'vitest'
import {
  createPetWindowOptions,
  dockedPetBounds,
  dragPetWindowBounds,
  petProgressForGrowthStage,
  petProgressForLearnerSummary,
  petWindowBoundsForSettings,
  movePetWindowBounds,
  workAreaForPetSettings
} from './pet-window'

const settings = {
  visible: true,
  assetMode: 'cpppilot-logo' as const,
  scale: 1,
  ignoreMouseEvents: false,
  bubbleEnabled: true,
  frameEnabled: true,
  progressBarEnabled: true,
  edgeDockEnabled: true,
  docked: false,
  focusModeEnabled: false,
  launchAtLogin: false,
  customAssets: []
}

describe('desktop pet window options', () => {
  it('maps growth stages to a stable pass-progress bar model', () => {
    expect(petProgressForGrowthStage(1)).toEqual({ stage: 1, totalStages: 4, percent: 25, label: '1/4 · 25%' })
    expect(petProgressForGrowthStage(4)).toEqual({ stage: 4, totalStages: 4, percent: 100, label: '4/4 · 100%' })
  })

  it('builds a clear real XP pass-progress label from learner summary', () => {
    const progress = petProgressForLearnerSummary({
      userId: 'local-user', xp: 260, level: 3, growthStage: 2, verifiedConcepts: 4, learningConcepts: 1,
      openErrors: 0, dueReviews: 2, achievements: [], recentEvents: []
    })

    expect(progress).toEqual({
      stage: 2,
      totalStages: 4,
      percent: 30,
      label: 'Lv.3 · 2/4 · 30%'
    })
  })


  it('creates a transparent always-on-top companion window outside the taskbar', () => {
    const options = createPetWindowOptions({
      bounds: { x: 10, y: 20, width: 180, height: 220 },
      preloadPath: 'preload.cjs',
      iconPath: 'cpppilot.ico',
      iconExists: true
    })

    expect(options).toMatchObject({
      x: 10,
      y: 20,
      width: 180,
      height: 220,
      transparent: true,
      backgroundColor: '#00000000',
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      hasShadow: false,
      show: false,
      icon: 'cpppilot.ico'
    })
    expect(options.webPreferences).toMatchObject({
      preload: 'preload.cjs',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    })
  })

  it('clamps scaled pet bounds into the current work area', () => {
    const bounds = petWindowBoundsForSettings(
      { ...settings, scale: 2, x: 900, y: 700 },
      { x: 0, y: 0, width: 300, height: 240 }
    )

    expect(bounds.width).toBeLessThanOrEqual(300)
    expect(bounds.height).toBeLessThanOrEqual(240)
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.y).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(300)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(240)
  })
  it('keeps scale=1 and scale=2 window sizes stable while positioning', () => {
    const display = { x: 0, y: 0, width: 1920, height: 1040 }

    expect(petWindowBoundsForSettings({ ...settings, scale: 1, x: 80, y: 90 }, display)).toMatchObject({
      x: 80,
      y: 90,
      width: 240,
      height: 420
    })
    expect(petWindowBoundsForSettings({ ...settings, scale: 2, x: 80, y: 90 }, display)).toMatchObject({
      x: 80,
      y: 90,
      width: 480,
      height: 840
    })
  })

  it('does not shrink the available area after repeated absolute drags into the left edge', () => {
    const display = { x: 0, y: 0, width: 1920, height: 1040 }
    let bounds = { x: 520, y: 240, width: 180, height: 220 }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      bounds = dragPetWindowBounds(
        bounds,
        { screenX: bounds.x + 120, screenY: bounds.y + 120 },
        { screenX: -5000, screenY: bounds.y + 120 },
        [display]
      )
      expect(bounds.x).toBe(display.x)
      expect(bounds.width).toBe(180)
      expect(bounds.height).toBe(220)
    }
  })

  it('keeps right, top and bottom edge drags stable across repeated sessions', () => {
    const display = { x: 0, y: 0, width: 1920, height: 1040 }
    const right = display.x + display.width - 180
    const bottom = display.y + display.height - 220
    let bounds = { x: 520, y: 240, width: 180, height: 220 }

    bounds = dragPetWindowBounds(bounds, { screenX: 600, screenY: 300 }, { screenX: 6000, screenY: 300 }, [display])
    expect(bounds).toMatchObject({ x: right, width: 180, height: 220 })
    bounds = dragPetWindowBounds(bounds, { screenX: bounds.x + 20, screenY: 300 }, { screenX: 6000, screenY: 300 }, [display])
    expect(bounds.x).toBe(right)

    bounds = dragPetWindowBounds(bounds, { screenX: bounds.x + 20, screenY: 300 }, { screenX: bounds.x + 20, screenY: -6000 }, [display])
    expect(bounds.y).toBe(display.y)
    bounds = dragPetWindowBounds(bounds, { screenX: bounds.x + 20, screenY: bounds.y + 20 }, { screenX: bounds.x + 20, screenY: 6000 }, [display])
    expect(bounds.y).toBe(bottom)
  })

  it('does not contract the range after hitting the left edge, moving right, then returning left', () => {
    const display = { x: 0, y: 0, width: 1920, height: 1040 }
    const atLeft = dragPetWindowBounds(
      { x: 400, y: 240, width: 180, height: 220 },
      { screenX: 460, screenY: 300 },
      { screenX: -1000, screenY: 300 },
      [display]
    )
    expect(atLeft.x).toBe(0)

    const movedRight = dragPetWindowBounds(
      atLeft,
      { screenX: 60, screenY: 300 },
      { screenX: 360, screenY: 300 },
      [display]
    )
    expect(movedRight.x).toBe(300)

    const backLeft = dragPetWindowBounds(
      movedRight,
      { screenX: 360, screenY: 300 },
      { screenX: -1000, screenY: 300 },
      [display]
    )
    expect(backLeft.x).toBe(0)
  })

  it('preserves width and height during drag even when the target work area is smaller', () => {
    const tinyDisplay = { x: 0, y: 0, width: 300, height: 240 }
    const initial = { x: 20, y: 30, width: 360, height: 440 }

    const next = dragPetWindowBounds(initial, { screenX: 40, screenY: 50 }, { screenX: 900, screenY: 700 }, [tinyDisplay])

    expect(next.width).toBe(initial.width)
    expect(next.height).toBe(initial.height)
  })

  it('keeps the full work area available when a scaled pet is dragged repeatedly', () => {
    const display = { x: 0, y: 0, width: 1920, height: 1040 }
    const start = petWindowBoundsForSettings({ ...settings, scale: 2, x: 100, y: 100 }, display)

    const first = movePetWindowBounds(start, { deltaX: 5_000, deltaY: 5_000 }, [display])
    const second = movePetWindowBounds(first, { deltaX: 5_000, deltaY: 5_000 }, [display])

    expect(first).toEqual({ x: 1920 - 480, y: 1040 - 840, width: 480, height: 840 })
    expect(second).toEqual(first)
  })

  it('snaps the pet to nearby work area edges', () => {
    const display = { x: 0, y: 0, width: 1200, height: 800 }
    const next = movePetWindowBounds(
      { x: 970, y: 553, width: 180, height: 220 },
      { deltaX: 40, deltaY: 12 },
      [display]
    )

    expect(next).toEqual({ x: 1020, y: 580, width: 180, height: 220 })
  })

  it('restores saved coordinates on the original display when it still exists', () => {
    const primary = { x: 0, y: 0, width: 1920, height: 1040 }
    const secondary = { x: 1920, y: 0, width: 1600, height: 900 }

    expect(workAreaForPetSettings({ ...settings, x: 2300, y: 200 }, [primary, secondary], primary)).toEqual(secondary)
    expect(workAreaForPetSettings({ ...settings, x: 2300, y: 200 }, [primary], primary)).toEqual(primary)
  })
  it('clamps a cross-display drag against the proposed display instead of the old display', () => {
    const primary = { x: 0, y: 0, width: 1920, height: 1040 }
    const secondary = { x: 1920, y: 0, width: 1600, height: 900 }
    const next = dragPetWindowBounds(
      { x: 1680, y: 100, width: 180, height: 220 },
      { screenX: 1780, screenY: 180 },
      { screenX: 2440, screenY: 180 },
      [primary, secondary]
    )

    expect(next.x).toBeGreaterThanOrEqual(secondary.x)
    expect(next.x + next.width).toBeLessThanOrEqual(secondary.x + secondary.width)
  })
  it('keeps the visual center when docking shrinks the window', () => {
    const display = { x: 0, y: 0, width: 1920, height: 1040 }
    const from = { x: 1600, y: 400, width: 240, height: 420 }

    const right = dockedPetBounds('right', display, from)
    expect(right).toMatchObject({ width: 78, height: 78, x: 1920 - 78 })
    // center Y preserved: 400 + 210 - 39 = 571
    expect(right.y).toBe(571)

    const left = dockedPetBounds('left', display, from)
    expect(left.x).toBe(0)
    expect(left.y).toBe(571)

    const bottom = dockedPetBounds('bottom', display, from)
    // center X preserved: 1600 + 120 - 39 = 1681
    expect(bottom.x).toBe(1681)
    expect(bottom.y).toBe(1040 - 78)

    const top = dockedPetBounds('top', display, from)
    expect(top.x).toBe(1681)
    expect(top.y).toBe(0)
  })

  it('does not jump up/left by using the large window top-left as dock origin', () => {
    const display = { x: 0, y: 0, width: 1920, height: 1040 }
    const from = { x: 1500, y: 500, width: 360, height: 440 }
    const docked = dockedPetBounds('right', display, from)
    // Old behavior would set y = 500; center-preserving y = 500 + 220 - 39 = 681
    expect(docked.y).toBe(681)
    expect(docked.y).toBeGreaterThan(from.y)
  })
})
