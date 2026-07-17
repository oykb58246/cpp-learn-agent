import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type {
  AgentRun,
  BackgroundProfile,
  AchievementDefinition,
  Approval,
  ErrorBookEntry,
  KnowledgeNode,
  LearnerKnowledge,
  LearningEvent,
  ModelProfile,
  ReviewItem,
  TimelineEvent,
  ToolCall
} from '@cpp-pet/contracts'
import { AppDatabase } from './index'

const dirs: string[] = []
const now = new Date().toISOString()

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'cpppilot-h3-db-'))
  dirs.push(dir)
  return { dir, file: join(dir, 'app.sqlite'), db: new AppDatabase(join(dir, 'app.sqlite')) }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('H3 persistence', () => {
  it('persists an editable assistant background profile', () => {
    const { db } = setup()
    const profile: BackgroundProfile = {
      userId: 'local-user',
      onboardingCompleted: true,
      startingPoint: 'some-experience',
      studiedConceptIds: ['basics.program'],
      focusConceptIds: ['control.loops'],
      updatedAt: now
    }

    db.saveBackgroundProfile(profile)
    expect(db.getBackgroundProfile('local-user')).toEqual(profile)
    db.close()
  })

  it('rolls back the run row when creating its steps fails', () => {
    const { db } = setup()
    const duplicateStepId = crypto.randomUUID()
    const run: AgentRun = {
      id: crypto.randomUUID(), requestId: crypto.randomUUID(), source: 'editor', mode: 'diagnose',
      message: '原子创建', status: 'planning', createdAt: now, updatedAt: now,
      steps: [
        { id: duplicateStepId, sequence: 0, kind: 'tool', status: 'pending', title: '第一步' },
        { id: duplicateStepId, sequence: 1, kind: 'validate', status: 'pending', title: '重复步骤' }
      ]
    }

    expect(() => db.createAgentRun(run)).toThrow()
    expect(db.db.prepare('SELECT id FROM agent_runs WHERE id = ?').get(run.id)).toBeUndefined()
    db.close()
  })

  it('rolls back the run update when replacing its steps fails', () => {
    const { db } = setup()
    const originalStepId = crypto.randomUUID()
    const run: AgentRun = {
      id: crypto.randomUUID(), requestId: crypto.randomUUID(), source: 'editor', mode: 'diagnose',
      message: '原子更新', status: 'planning', createdAt: now, updatedAt: now,
      steps: [{ id: originalStepId, sequence: 0, kind: 'tool', status: 'pending', title: '原始步骤' }]
    }
    db.createAgentRun(run)
    const duplicateStepId = crypto.randomUUID()
    const invalidUpdate: AgentRun = {
      ...run,
      status: 'executing',
      steps: [
        { id: duplicateStepId, sequence: 0, kind: 'tool', status: 'running', title: '第一步' },
        { id: duplicateStepId, sequence: 1, kind: 'validate', status: 'pending', title: '重复步骤' }
      ]
    }

    expect(() => db.updateAgentRun(invalidUpdate)).toThrow()
    expect(db.getAgentRun(run.id)).toMatchObject({
      status: 'planning',
      steps: [{ id: originalStepId, title: '原始步骤' }]
    })
    db.close()
  })

  it('persists runs, timeline and approvals across restarts', () => {
    const { file, db } = setup()
    const run: AgentRun = {
      id: crypto.randomUUID(), requestId: crypto.randomUUID(), source: 'editor', mode: 'diagnose',
      message: '解释编译错误', status: 'waiting-approval', steps: [], createdAt: now, updatedAt: now
    }
    const timeline: TimelineEvent = {
      id: crypto.randomUUID(), runId: run.id, sequence: 1, kind: 'intent', status: 'completed',
      title: '识别意图', summary: '编译错误诊断', occurredAt: now
    }
    const approval: Approval = {
      id: crypto.randomUUID(), runId: run.id, stepId: 'patch', toolName: 'workspace.apply_patch',
      risk: 'L2', title: '应用修复', description: '修改 main.cpp', parameterSummary: { relativePath: 'main.cpp' },
      diff: '--- a/main.cpp\n+++ b/main.cpp\n@@ -1 +1 @@\n-return 0;\n+return 1;',
      sideEffects: ['write-file'], status: 'pending', createdAt: now
    }
    const toolCall: ToolCall = {
      id: crypto.randomUUID(), runId: run.id, stepId: 'build', serverName: 'cpppilot-local-tools', toolName: 'compiler.build',
      risk: 'L1', parameterSummary: { relativePath: 'main.cpp' }, status: 'completed',
      result: { ok: true, exitCode: 0, summary: '编译通过', diagnostics: [], artifacts: [], sideEffects: [], retryable: false, durationMs: 12 },
      startedAt: now, finishedAt: now, durationMs: 12
    }

    db.createAgentRun(run)
    db.appendTimeline(timeline)
    db.saveApproval(approval)
    db.saveToolCall(toolCall)
    db.close()

    const reopened = new AppDatabase(file)
    expect(reopened.getAgentRun(run.id)).toMatchObject({ id: run.id, timeline: [timeline], approvals: [approval], toolCalls: [toolCall] })
    reopened.close()
  })

  it('recovers unfinished runs as readable cancelled timelines without replaying work', () => {
    const { file, db } = setup()
    const approval: Approval = {
      id: crypto.randomUUID(), runId: crypto.randomUUID(), stepId: 'patch', toolName: 'workspace.apply_patch', risk: 'L2',
      title: '应用修改', description: '修改 main.cpp', parameterSummary: { relativePath: 'main.cpp' }, sideEffects: ['write-file'],
      status: 'pending', createdAt: now
    }
    const run: AgentRun = {
      id: approval.runId, requestId: crypto.randomUUID(), source: 'editor', mode: 'diagnose', message: '修复错误',
      status: 'waiting-approval', steps: [], pendingApproval: approval, createdAt: now, updatedAt: now
    }
    db.createAgentRun(run)
    db.saveApproval(approval)
    db.close()

    const reopened = new AppDatabase(file)
    try {
      const recovered = reopened.recoverInterruptedAgentRuns('2026-07-17T00:00:00.000Z')
      const detail = reopened.getAgentRun(run.id)

      expect(recovered).toHaveLength(1)
      expect(detail).toMatchObject({ status: 'cancelled', errorCode: 'RUN_INTERRUPTED' })
      expect(detail?.pendingApproval).toBeUndefined()
      expect(detail?.timeline.at(-1)).toMatchObject({ kind: 'cancelled', status: 'cancelled', title: '任务在重启后恢复为只读记录' })
      expect(detail?.approvals[0]).toMatchObject({ status: 'expired' })
    } finally {
      reopened.close()
    }
  })

  it('persists knowledge, errors and due reviews', () => {
    const { db } = setup()
    const node: KnowledgeNode = {
      id: 'control.loops', title: '循环', description: '重复执行代码', category: 'control-flow',
      difficulty: 1, prerequisites: [], tags: ['for', 'while']
    }
    const state: LearnerKnowledge = {
      userId: 'local-user', conceptId: node.id, status: 'learning', confidence: 0.4, updatedAt: now
    }
    const error: ErrorBookEntry = {
      id: crypto.randomUUID(), userId: 'local-user', category: 'compile', title: '变量未声明',
      evidence: 'main.cpp:3', conceptIds: [node.id], status: 'open', occurrences: 1,
      firstSeenAt: now, lastSeenAt: now, nextReviewAt: now
    }
    const review: ReviewItem = {
      id: crypto.randomUUID(), userId: 'local-user', errorBookEntryId: error.id, conceptId: node.id,
      prompt: '修复循环变量', expectedEvidence: '编译通过', intervalIndex: 0, dueAt: now, status: 'pending'
    }

    db.seedKnowledge([node])
    db.upsertLearnerKnowledge(state)
    db.saveErrorBookEntry(error)
    db.saveReviewItem(review)

    expect(db.listKnowledgeNodes()).toEqual([node])
    expect(db.listLearnerKnowledge('local-user')).toEqual([state])
    expect(db.listErrorBookEntries('local-user', 'open')).toEqual([error])
    expect(db.listReviewItems('local-user', true, new Date(now))).toEqual([review])
    db.close()
  })

  it('awards XP only once for a stable source event id', () => {
    const { db } = setup()
    const event: LearningEvent = {
      id: crypto.randomUUID(), sourceEventId: 'run:1:validation:2', userId: 'local-user',
      type: 'error-resolved', conceptIds: ['control.loops'], xp: 20,
      evidence: { kind: 'build', referenceId: 'build-1', summary: '回归编译通过' }, occurredAt: now
    }

    expect(db.applyLearningEvent(event)).toBe(true)
    expect(db.applyLearningEvent({ ...event, id: crypto.randomUUID() })).toBe(false)
    const definition: AchievementDefinition = {
      id: 'first-fix', title: '第一次修复', description: '首次验证修复', icon: 'wrench',
      rule: { eventType: 'error-resolved', threshold: 1 }, xpReward: 10
    }
    db.seedAchievementDefinitions([definition])
    expect(db.awardAchievement({ userId: 'local-user', achievementId: definition.id, sourceEventId: event.sourceEventId, unlockedAt: now })).toBe(true)
    expect(db.awardAchievement({ userId: 'local-user', achievementId: definition.id, sourceEventId: event.sourceEventId, unlockedAt: now })).toBe(false)
    expect(db.getLearnerSummary('local-user')).toMatchObject({ xp: 20, level: 1, growthStage: 1 })
    expect(db.getLearnerSummary('local-user').achievements.map(item => item.achievementId)).toContain('first-fix')
    db.close()
  })

  it('persists model profiles without storing an API key', () => {
    const { db } = setup()
    const profile: ModelProfile = {
      id: crypto.randomUUID(), name: 'OpenAI compatible', baseUrl: 'https://models.example/v1', model: 'teacher',
      enabled: true, timeoutMs: 30_000, apiKeyConfigured: true, createdAt: now, updatedAt: now
    }
    db.saveModelProfile(profile)
    expect(db.listModelProfiles()).toEqual([profile])
    const columns = db.db.pragma('table_info(model_profiles)') as Array<{ name: string }>
    expect(columns.map(column => column.name)).not.toContain('api_key')
    db.removeModelProfile(profile.id)
    expect(db.listModelProfiles()).toEqual([])
    db.close()
  })
})
