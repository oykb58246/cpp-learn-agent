import type { AgentStartRequest } from '@cpp-pet/contracts'

interface EditorSelectionRange {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

export type AgentEditorSelection = NonNullable<AgentStartRequest['selection']>

export function editorSelection(
  range: EditorSelectionRange,
  readContent: (range: EditorSelectionRange) => string
): AgentEditorSelection | undefined {
  if (range.startLineNumber === range.endLineNumber && range.startColumn === range.endColumn) return undefined
  const content = readContent(range)
  if (!content) return undefined
  return {
    startLine: range.startLineNumber,
    startColumn: range.startColumn,
    endLine: range.endLineNumber,
    endColumn: range.endColumn,
    content
  }
}
