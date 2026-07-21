import type { PetDragWindowRequest } from '@cpp-pet/contracts'

export interface PetDragSessionInput {
  windowX: number
  windowY: number
  windowWidth: number
  windowHeight: number
  pointerScreenX: number
  pointerScreenY: number
}

export interface PetDragSession {
  initialBounds: PetDragWindowRequest['initialBounds']
  pointerStartScreenX: number
  pointerStartScreenY: number
}

export function createPetDragSession(input: PetDragSessionInput): PetDragSession {
  return {
    initialBounds: {
      x: Math.round(input.windowX),
      y: Math.round(input.windowY),
      width: Math.round(input.windowWidth),
      height: Math.round(input.windowHeight)
    },
    pointerStartScreenX: input.pointerScreenX,
    pointerStartScreenY: input.pointerScreenY
  }
}

export function createPetDragRequest(session: PetDragSession, pointerCurrent: { screenX: number; screenY: number }): PetDragWindowRequest {
  return {
    initialBounds: { ...session.initialBounds },
    pointerStartScreenX: session.pointerStartScreenX,
    pointerStartScreenY: session.pointerStartScreenY,
    pointerCurrentScreenX: pointerCurrent.screenX,
    pointerCurrentScreenY: pointerCurrent.screenY
  }
}