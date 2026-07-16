import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type {
  AgentRun,
  Approval,
  ErrorBookEntry,
  KnowledgeNode,
  LearnerKnowledge,
  LearningEvent,
  ReviewItem,
  TimelineEvent
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
      sideEffects: ['write-file'], status: 'pending', createdAt: now
    }

    db.createAgentRun(run)
    db.appendTimeline(timeline)
    db.saveApproval(approval)
    db.close()

    const reopened = new AppDatabase(file)
    expect(reopened.getAgentRun(run.id)).toMatchObject({ id: run.id, timeline: [timeline], approvals: [approval] })
    reopened.close()
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
    expect(db.getLearnerSummary('local-user')).toMatchObject({ xp: 20, level: 1, growthStage: 1 })
    db.close()
  })
})
