import { describe, expect, it } from 'vitest'
import { codeEditLearningEvent } from './learning-growth'

const baseInput = {
  userId: 'local-user',
  projectId: 'b9d622b1-2a09-4b2d-9f39-66114db1b0e3',
  relativePath: 'src/main.cpp',
  occurredAt: '2026-07-21T00:00:00.000Z'
}

describe('code edit learning growth', () => {
  it('records bounded XP for a meaningful C++ file save', () => {
    const event = codeEditLearningEvent({
      ...baseInput,
      beforeContent: '#include <iostream>\nint main(){return 0;}\n',
      afterContent: '#include <iostream>\nusing namespace std;\nint main(){\n  cout << "hello" << endl;\n  return 0;\n}\n'
    })

    expect(event).toMatchObject({
      userId: 'local-user',
      type: 'code-edited',
      conceptIds: [],
      xp: expect.any(Number),
      evidence: { kind: 'editor', referenceId: expect.stringMatching(/^code-edit:/) }
    })
    expect(event!.xp).toBeGreaterThanOrEqual(2)
    expect(event!.xp).toBeLessThanOrEqual(12)
    expect(event!.sourceEventId).toContain('code-edited:local-user')
  })

  it('ignores non C++ files and tiny whitespace-only edits', () => {
    expect(codeEditLearningEvent({ ...baseInput, relativePath: 'README.md', beforeContent: '', afterContent: 'notes' })).toBeNull()
    expect(codeEditLearningEvent({ ...baseInput, beforeContent: 'int main(){return 0;}\n', afterContent: 'int main(){return 0;}\n\n' })).toBeNull()
  })

  it('uses the saved content fingerprint for idempotent source ids', () => {
    const first = codeEditLearningEvent({ ...baseInput, beforeContent: 'int main(){}\n', afterContent: 'int main(){ return 1 + 2 + 3; }\n' })
    const replay = codeEditLearningEvent({ ...baseInput, beforeContent: 'int main(){}\n', afterContent: 'int main(){ return 1 + 2 + 3; }\n' })

    expect(first?.sourceEventId).toBe(replay?.sourceEventId)
    expect(first?.id).not.toBe(replay?.id)
  })
})