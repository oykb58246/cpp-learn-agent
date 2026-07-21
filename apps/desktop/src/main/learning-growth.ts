import { createHash, randomUUID } from 'node:crypto'
import type { LearningEvent } from '@cpp-pet/contracts'

interface CodeEditLearningEventInput {
  userId: string
  projectId: string
  relativePath: string
  beforeContent: string
  afterContent: string
  occurredAt?: string
}

const codeFilePattern = /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/i

export function codeEditLearningEvent(input: CodeEditLearningEventInput): LearningEvent | null {
  if (!codeFilePattern.test(input.relativePath)) return null
  if (input.beforeContent === input.afterContent) return null
  const change = changedSpan(input.beforeContent, input.afterContent)
  const effectiveChars = nonWhitespaceLength(change.removed) + nonWhitespaceLength(change.added)
  const changedLines = Math.max(lineCount(change.removed), lineCount(change.added))
  if (effectiveChars === 0) return null
  if (effectiveChars < 12 && changedLines < 2) return null
  const xp = Math.min(12, Math.max(2, Math.ceil(effectiveChars / 80) + Math.ceil(changedLines / 6)))
  const fingerprint = hashText(`${input.projectId}\n${input.relativePath}\n${input.afterContent}`).slice(0, 20)
  const occurredAt = input.occurredAt ?? new Date().toISOString()
  return {
    id: randomUUID(),
    sourceEventId: `code-edited:${input.userId}:${input.projectId}:${fingerprint}`,
    userId: input.userId,
    type: 'code-edited',
    conceptIds: [],
    xp,
    evidence: {
      kind: 'editor',
      referenceId: `code-edit:${fingerprint}`,
      summary: `保存 ${input.relativePath}，有效变更约 ${effectiveChars} 个字符 / ${changedLines} 行`
    },
    occurredAt
  }
}

function changedSpan(before: string, after: string): { removed: string; added: string } {
  let prefix = 0
  const maxPrefix = Math.min(before.length, after.length)
  while (prefix < maxPrefix && before[prefix] === after[prefix]) prefix += 1
  let suffix = 0
  const maxSuffix = Math.min(before.length - prefix, after.length - prefix)
  while (suffix < maxSuffix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1
  return {
    removed: before.slice(prefix, before.length - suffix),
    added: after.slice(prefix, after.length - suffix)
  }
}

function nonWhitespaceLength(value: string): number {
  return value.replace(/\s+/g, '').length
}

function lineCount(value: string): number {
  if (!value) return 0
  return value.split(/\r\n|\r|\n/).length
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}