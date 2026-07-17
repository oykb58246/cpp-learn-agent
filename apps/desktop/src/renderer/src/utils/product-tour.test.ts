import { describe, expect, it } from 'vitest'
import { agentTourSuggestion, beginnerTourSteps, panelPlacement, productTourTarget, progressForStep } from './product-tour'

describe('product tour model', () => {
  it('covers home, real assistant input, result, and workspace continuation', () => {
    expect(beginnerTourSteps.map(step => step.id)).toEqual([
      'welcome', 'navigation', 'assistant-input', 'assistant-result', 'workspace-agent', 'complete'
    ])
    expect(beginnerTourSteps.find(step => step.id === 'assistant-input')).toMatchObject({
      route: '/runs',
      interactive: true
    })
    expect(agentTourSuggestion).toMatchObject({ mode: 'explain', label: '试着解释这段循环' })
    expect(agentTourSuggestion.message).toContain('for (int i = 0; i < 3; ++i)')
  })

  it('reports task progress without counting the completion screen', () => {
    expect(progressForStep(0)).toEqual({ completed: 0, total: 3 })
    expect(progressForStep(3)).toEqual({ completed: 2, total: 3 })
    expect(progressForStep(5)).toEqual({ completed: 3, total: 3 })
  })

  it('keeps the tour on the active Agent flow before and after approval', () => {
    const assistantStep = beginnerTourSteps.find(step => step.id === 'assistant-input')!

    expect(productTourTarget(assistantStep, 'idle')).toBe('[data-tour="assistant-composer"]')
    expect(productTourTarget(assistantStep, 'approval')).toBe('[data-tour="assistant-approval"]')
    expect(productTourTarget(assistantStep, 'running')).toBe('[data-tour="assistant-progress"]')
  })

  it('places the dialog beside its target when the viewport has room', () => {
    expect(panelPlacement(
      { left: 80, top: 70, right: 380, bottom: 190, width: 300, height: 120 },
      { width: 1024, height: 720 },
      { width: 360, height: 260 }
    )).toEqual({ left: 404, top: 70, centered: false })
  })

  it('centers the dialog when no target can be located', () => {
    expect(panelPlacement(null, { width: 640, height: 480 }, { width: 360, height: 260 }))
      .toEqual({ left: 140, top: 110, centered: true })
  })

  it('keeps fallback placement inside the viewport', () => {
    const placement = panelPlacement(
      { left: 910, top: 650, right: 1000, bottom: 710, width: 90, height: 60 },
      { width: 1024, height: 720 },
      { width: 360, height: 260 }
    )
    expect(placement.left).toBeGreaterThanOrEqual(16)
    expect(placement.top).toBeGreaterThanOrEqual(16)
    expect(placement.left + 360).toBeLessThanOrEqual(1008)
    expect(placement.top + 260).toBeLessThanOrEqual(704)
  })
})
