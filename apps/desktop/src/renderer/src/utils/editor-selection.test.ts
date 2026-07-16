import { describe, expect, it } from 'vitest'
import { editorSelection } from './editor-selection'

describe('editorSelection', () => {
  it('returns exact content and one-based bounds for a non-empty selection', () => {
    const selection = editorSelection({ startLineNumber: 2, startColumn: 3, endLineNumber: 3, endColumn: 5 }, () => 'selected code')

    expect(selection).toEqual({ startLine: 2, startColumn: 3, endLine: 3, endColumn: 5, content: 'selected code' })
  })

  it('omits empty selections', () => {
    expect(editorSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, () => '')).toBeUndefined()
  })
})
