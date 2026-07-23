import type { BrowserWindowConstructorOptions, Rectangle } from 'electron'
import type { LearnerSummary, PetGrowthStage, PetProgress, PetSettings } from '@cpp-pet/contracts'

export interface PetWindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface PetPointerScreenPoint {
  screenX: number
  screenY: number
}

interface PetWindowOptionsInput {
  bounds: PetWindowBounds
  preloadPath: string
  iconPath: string
  iconExists: boolean
}

const BASE_WIDTH = 240
const BASE_HEIGHT = 420
const DOCK_SIZE = 78
const DEFAULT_MARGIN = 28
const EDGE_SNAP_DISTANCE = 24
const PET_STAGE_XP_TARGETS: Record<PetGrowthStage, number> = {
  1: 0,
  2: 200,
  3: 500,
  4: 1_000
}

export function petProgressForGrowthStage(stage: PetGrowthStage): PetProgress {
  return {
    stage,
    totalStages: 4,
    percent: Math.round(stage / 4 * 100),
    label: `${stage}/4 · ${Math.round(stage / 4 * 100)}%`
  }
}

export function petProgressForLearnerSummary(summary: LearnerSummary): PetProgress {
  const stage = normalizePetGrowthStage(summary.growthStage)
  const currentTarget = PET_STAGE_XP_TARGETS[stage]
  const nextStage = stage < 4 ? (stage + 1) as PetGrowthStage : 4
  const nextTarget = PET_STAGE_XP_TARGETS[nextStage]
  const stageSpan = Math.max(1, nextTarget - currentTarget)
  const stageProgress = stage === 4 ? 1 : Math.max(0, Math.min(1, (summary.xp - currentTarget) / stageSpan))
  const basePercent = ((stage - 1) / 4) * 100
  const percent = stage === 4 ? 100 : Math.round(basePercent + stageProgress * 25)
  const label = `Lv.${summary.level} · ${stage}/4 · ${percent}%`
  return { stage, totalStages: 4, percent, label }
}

function normalizePetGrowthStage(value: number): PetGrowthStage {
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : 1
}
export function petWindowBoundsForSettings(settings: PetSettings, workArea: Rectangle): PetWindowBounds {
  if (settings.docked && settings.edgeDockEnabled !== false) {
    const width = Math.min(DOCK_SIZE, workArea.width)
    const height = Math.min(DOCK_SIZE, workArea.height)
    const fallbackX = workArea.x + workArea.width - width
    const fallbackY = workArea.y + Math.round((workArea.height - height) / 2)
    const x = Number.isFinite(settings.x) ? Math.round(settings.x as number) : fallbackX
    const y = Number.isFinite(settings.y) ? Math.round(settings.y as number) : fallbackY
    return clampPetWindowBounds({ x, y, width, height }, workArea)
  }
  const scale = Math.min(Math.max(settings.scale, 0.5), 2)
  const width = Math.min(Math.round(BASE_WIDTH * scale), workArea.width)
  const height = Math.min(Math.round(BASE_HEIGHT * scale), workArea.height)
  const fallbackX = workArea.x + workArea.width - width - DEFAULT_MARGIN
  const fallbackY = workArea.y + workArea.height - height - DEFAULT_MARGIN
  const x = Number.isFinite(settings.x) ? Math.round(settings.x as number) : fallbackX
  const y = Number.isFinite(settings.y) ? Math.round(settings.y as number) : fallbackY

  return clampPetWindowBounds({ x, y, width, height }, workArea)
}

export type PetDockEdge = 'left' | 'right' | 'top' | 'bottom'

export function detectPetDockEdge(bounds: PetWindowBounds, workArea: Rectangle): PetDockEdge | null {
  const atLeft = bounds.x <= workArea.x + 2
  const atRight = bounds.x + bounds.width >= workArea.x + workArea.width - 2
  const atTop = bounds.y <= workArea.y + 2
  const atBottom = bounds.y + bounds.height >= workArea.y + workArea.height - 2
  if (atLeft) return 'left'
  if (atRight) return 'right'
  if (atTop) return 'top'
  if (atBottom) return 'bottom'
  return null
}

/**
 * Shrink to the dock pill while keeping the previous window's visual center.
 * Using top-left of the large window makes the pet jump up/left when docking.
 */
export function dockedPetBounds(
  edge: PetDockEdge,
  workArea: Rectangle,
  fromBounds?: Pick<PetWindowBounds, 'x' | 'y' | 'width' | 'height'>,
  preferY?: number,
  preferX?: number
): PetWindowBounds {
  const width = Math.min(DOCK_SIZE, workArea.width)
  const height = Math.min(DOCK_SIZE, workArea.height)

  const centerX = fromBounds
    ? fromBounds.x + fromBounds.width / 2
    : Number.isFinite(preferX)
      ? (preferX as number) + width / 2
      : workArea.x + workArea.width / 2
  const centerY = fromBounds
    ? fromBounds.y + fromBounds.height / 2
    : Number.isFinite(preferY)
      ? (preferY as number) + height / 2
      : workArea.y + workArea.height / 2

  const anchoredX = Math.round(centerX - width / 2)
  const anchoredY = Math.round(centerY - height / 2)

  if (edge === 'left') return clampPetWindowBounds({ x: workArea.x, y: anchoredY, width, height }, workArea)
  if (edge === 'right') return clampPetWindowBounds({ x: workArea.x + workArea.width - width, y: anchoredY, width, height }, workArea)
  if (edge === 'top') return clampPetWindowBounds({ x: anchoredX, y: workArea.y, width, height }, workArea)
  return clampPetWindowBounds({ x: anchoredX, y: workArea.y + workArea.height - height, width, height }, workArea)
}

export function workAreaForPetSettings(settings: PetSettings, workAreas: Rectangle[], fallback: Rectangle): Rectangle {
  if (!workAreas.length) return fallback
  if (Number.isFinite(settings.x) && Number.isFinite(settings.y)) {
    const point = { x: Math.round(settings.x as number), y: Math.round(settings.y as number) }
    const area = workAreas.find(item => containsPoint(item, point))
    if (area) return area
  }
  return fallback
}

export function movePetWindowBounds(bounds: PetWindowBounds, delta: { deltaX: number; deltaY: number }, workAreas: Rectangle[]): PetWindowBounds {
  const fallback = workAreaForBounds(bounds, workAreas) ?? workAreas[0]
  if (!fallback) return bounds
  const proposed = {
    ...bounds,
    x: bounds.x + Math.round(delta.deltaX),
    y: bounds.y + Math.round(delta.deltaY)
  }
  const targetArea = workAreaForBounds(proposed, workAreas) ?? fallback
  return snapPetWindowBounds(clampPetWindowPosition(proposed, targetArea), targetArea)
}

export function dragPetWindowBounds(
  initialBounds: PetWindowBounds,
  pointerStart: PetPointerScreenPoint,
  pointerCurrent: PetPointerScreenPoint,
  workAreas: Rectangle[]
): PetWindowBounds {
  const fallback = workAreaForBounds(initialBounds, workAreas) ?? workAreas[0]
  if (!fallback) return initialBounds
  const proposed = {
    ...initialBounds,
    x: initialBounds.x + Math.round(pointerCurrent.screenX - pointerStart.screenX),
    y: initialBounds.y + Math.round(pointerCurrent.screenY - pointerStart.screenY)
  }
  const targetArea = workAreaForBounds(proposed, workAreas) ?? workAreaForPoint(boundsCenter(proposed), workAreas) ?? fallback
  return snapPetWindowBounds(clampPetWindowPosition(proposed, targetArea), targetArea)
}

export function clampPetWindowBounds(bounds: PetWindowBounds, workArea: Rectangle): PetWindowBounds {
  const width = Math.min(bounds.width, workArea.width)
  const height = Math.min(bounds.height, workArea.height)
  const minX = workArea.x
  const minY = workArea.y
  const maxX = workArea.x + workArea.width - width
  const maxY = workArea.y + workArea.height - height

  return {
    x: Math.min(Math.max(bounds.x, minX), maxX),
    y: Math.min(Math.max(bounds.y, minY), maxY),
    width,
    height
  }
}

export function snapPetWindowBounds(bounds: PetWindowBounds, workArea: Rectangle): PetWindowBounds {
  const minX = workArea.x
  const minY = workArea.y
  const maxX = workArea.x + workArea.width - bounds.width
  const maxY = workArea.y + workArea.height - bounds.height
  return {
    ...bounds,
    x: snapToEdge(bounds.x, minX, maxX),
    y: snapToEdge(bounds.y, minY, maxY)
  }
}

export function createPetWindowOptions(input: PetWindowOptionsInput): BrowserWindowConstructorOptions {
  const options: BrowserWindowConstructorOptions = {
    ...input.bounds,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    title: 'CppPilot 桌宠',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    thickFrame: false,
    focusable: true,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: input.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  }
  if (input.iconExists) options.icon = input.iconPath
  return options
}

function clampPetWindowPosition(bounds: PetWindowBounds, workArea: Rectangle): PetWindowBounds {
  const minX = workArea.x
  const minY = workArea.y
  const maxX = workArea.x + workArea.width - bounds.width
  const maxY = workArea.y + workArea.height - bounds.height
  return {
    ...bounds,
    x: bounds.width > workArea.width ? minX : Math.min(Math.max(bounds.x, minX), maxX),
    y: bounds.height > workArea.height ? minY : Math.min(Math.max(bounds.y, minY), maxY)
  }
}

function snapToEdge(value: number, min: number, max: number): number {
  if (Math.abs(value - min) <= EDGE_SNAP_DISTANCE) return min
  if (Math.abs(value - max) <= EDGE_SNAP_DISTANCE) return max
  return value
}

function workAreaForBounds(bounds: PetWindowBounds, workAreas: Rectangle[]): Rectangle | undefined {
  let best: { area: Rectangle; overlap: number } | undefined
  for (const area of workAreas) {
    const overlap = intersectionArea(bounds, area)
    if (overlap > 0 && (!best || overlap > best.overlap)) best = { area, overlap }
  }
  if (best) return best.area
  return workAreaForPoint(boundsCenter(bounds), workAreas)
}

function workAreaForPoint(point: { x: number; y: number }, workAreas: Rectangle[]): Rectangle | undefined {
  return workAreas.find(area => containsPoint(area, point))
}

function boundsCenter(bounds: PetWindowBounds): { x: number; y: number } {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}

function intersectionArea(a: Rectangle, b: Rectangle): number {
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  return Math.max(0, right - left) * Math.max(0, bottom - top)
}

function containsPoint(area: Rectangle, point: { x: number; y: number }): boolean {
  return point.x >= area.x
    && point.y >= area.y
    && point.x < area.x + area.width
    && point.y < area.y + area.height
}