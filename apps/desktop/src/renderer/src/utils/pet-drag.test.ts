import { describe, expect, it } from 'vitest'
import { createPetDragRequest, createPetDragSession } from './pet-drag'

describe('pet drag payload', () => {
  it('uses the initial window bounds and absolute pointer positions', () => {
    const session = createPetDragSession({
      windowX: 100.4,
      windowY: 200.6,
      windowWidth: 220,
      windowHeight: 260,
      pointerScreenX: 140,
      pointerScreenY: 250
    })

    expect(createPetDragRequest(session, { screenX: 190, screenY: 280 })).toEqual({
      initialBounds: { x: 100, y: 201, width: 220, height: 260 },
      pointerStartScreenX: 140,
      pointerStartScreenY: 250,
      pointerCurrentScreenX: 190,
      pointerCurrentScreenY: 280
    })
  })
})