import { describe, expect, it } from 'vitest'
import { featureHelpTopic, featureHelpTopics } from './feature-help'

describe('feature help catalog', () => {
  it('provides actionable guidance for every workspace command topic', () => {
    expect(featureHelpTopics.map(topic => topic.id)).toEqual([
      'workspace-files',
      'compile',
      'run',
      'cmake',
      'ctest',
      'analysis',
      'debug',
      'vscode',
      'snapshots',
      'agent'
    ])
    for (const topic of featureHelpTopics) {
      expect(topic.summary.length).toBeGreaterThan(10)
      expect(topic.principle.length).toBeGreaterThan(10)
      expect(topic.steps.length).toBeGreaterThanOrEqual(2)
      expect(topic.notes.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('falls back to file management help for an unknown runtime value', () => {
    expect(featureHelpTopic('missing' as never).id).toBe('workspace-files')
  })
})
