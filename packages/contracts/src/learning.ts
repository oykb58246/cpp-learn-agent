import { z } from 'zod'

const timestampSchema = z.string().datetime()

export const knowledgeStatusSchema = z.enum(['locked', 'available', 'learning', 'self-claimed', 'verified', 'review'])
export type KnowledgeStatus = z.infer<typeof knowledgeStatusSchema>

export const knowledgeNodeSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2_000),
  category: z.string().min(1).max(100),
  difficulty: z.number().int().min(1).max(5),
  prerequisites: z.array(z.string().min(1).max(100)).max(20),
  tags: z.array(z.string().min(1).max(100)).max(30)
})
export type KnowledgeNode = z.infer<typeof knowledgeNodeSchema>

export const backgroundStartingPointSchema = z.enum(['zero-beginner', 'some-experience'])
export type BackgroundStartingPoint = z.infer<typeof backgroundStartingPointSchema>
export const backgroundProfileSchema = z.object({
  userId: z.string().min(1).max(100),
  onboardingCompleted: z.boolean(),
  startingPoint: backgroundStartingPointSchema,
  studiedConceptIds: z.array(z.string().min(1).max(100)).max(100),
  focusConceptIds: z.array(z.string().min(1).max(100)).max(100),
  updatedAt: timestampSchema
})
export type BackgroundProfile = z.infer<typeof backgroundProfileSchema>
export const backgroundProfileInputSchema = backgroundProfileSchema.omit({ userId: true, updatedAt: true })
export type BackgroundProfileInput = z.input<typeof backgroundProfileInputSchema>

export const learnerKnowledgeSchema = z.object({
  userId: z.string().min(1).max(100),
  conceptId: z.string().min(1).max(100),
  status: knowledgeStatusSchema,
  confidence: z.number().min(0).max(1),
  verifiedAt: timestampSchema.optional(),
  lastEvidenceId: z.string().max(200).optional(),
  updatedAt: timestampSchema
})
export type LearnerKnowledge = z.infer<typeof learnerKnowledgeSchema>

export const knowledgeGateResultSchema = z.object({
  decision: z.enum(['allow', 'rewrite', 'learn']),
  allowed: z.array(z.string()),
  blocked: z.array(z.string()),
  suggestedConceptIds: z.array(z.string()),
  explanation: z.string().max(2_000)
})
export type KnowledgeGateResult = z.infer<typeof knowledgeGateResultSchema>

export const learningEvidenceSchema = z.object({
  kind: z.enum(['build', 'test', 'analysis', 'debug', 'review', 'user-confirmation', 'editor', 'practice', 'project']),
  referenceId: z.string().min(1).max(200),
  summary: z.string().min(1).max(2_000)
})
export type LearningEvidence = z.infer<typeof learningEvidenceSchema>

export const learningEventTypeSchema = z.enum([
  'environment-ready',
  'concept-started',
  'concept-verified',
  'build-succeeded',
  'test-passed',
  'error-recorded',
  'error-resolved',
  'review-completed',
  'review-failed',
  'project-completed',
  'code-edited',
  'practice-submitted',
  'practice-passed',
  'knowledge-mastered',
  'project-task-completed'
])

export const learningEventSchema = z.object({
  id: z.string().uuid(),
  sourceEventId: z.string().min(1).max(200),
  userId: z.string().min(1).max(100),
  type: learningEventTypeSchema,
  conceptIds: z.array(z.string().min(1).max(100)).max(100),
  xp: z.number().int().nonnegative().max(10_000),
  evidence: learningEvidenceSchema,
  occurredAt: timestampSchema
})
export type LearningEvent = z.infer<typeof learningEventSchema>

export const errorBookEntrySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().min(1).max(100),
  projectId: z.string().uuid().optional(),
  relativePath: z.string().max(1_024).optional(),
  category: z.enum(['compile', 'linker', 'runtime', 'logic', 'analysis', 'debug']),
  title: z.string().min(1).max(200),
  evidence: z.string().min(1).max(20_000),
  conceptIds: z.array(z.string().min(1).max(100)).max(100),
  status: z.enum(['open', 'resolved', 'reviewing']),
  occurrences: z.number().int().positive(),
  firstSeenAt: timestampSchema,
  lastSeenAt: timestampSchema,
  resolvedAt: timestampSchema.optional(),
  nextReviewAt: timestampSchema.optional()
})
export type ErrorBookEntry = z.infer<typeof errorBookEntrySchema>

export const reviewItemSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().min(1).max(100),
  errorBookEntryId: z.string().uuid().optional(),
  conceptId: z.string().min(1).max(100),
  prompt: z.string().min(1).max(20_000),
  expectedEvidence: z.string().min(1).max(2_000),
  intervalIndex: z.number().int().min(0).max(4),
  dueAt: timestampSchema,
  status: z.enum(['pending', 'completed', 'failed']),
  completedAt: timestampSchema.optional()
})
export type ReviewItem = z.infer<typeof reviewItemSchema>

export const achievementDefinitionSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2_000),
  icon: z.string().min(1).max(100),
  rule: z.object({
    eventType: z.string().min(1).max(100),
    threshold: z.number().int().positive(),
    conceptId: z.string().max(100).optional()
  }),
  xpReward: z.number().int().nonnegative().max(10_000)
})
export type AchievementDefinition = z.infer<typeof achievementDefinitionSchema>

export const learnerAchievementSchema = z.object({
  userId: z.string().min(1).max(100),
  achievementId: z.string().min(1).max(100),
  sourceEventId: z.string().min(1).max(200),
  unlockedAt: timestampSchema
})
export type LearnerAchievement = z.infer<typeof learnerAchievementSchema>

export const learnerXpBreakdownSchema = z.object({
  type: z.string().min(1).max(100),
  xp: z.number().int().nonnegative()
}).strict()
export type LearnerXpBreakdown = z.infer<typeof learnerXpBreakdownSchema>

export const learnerSummarySchema = z.object({
  userId: z.string().min(1).max(100),
  xp: z.number().int().nonnegative(),
  level: z.number().int().positive(),
  growthStage: z.number().int().min(1).max(4),
  verifiedConcepts: z.number().int().nonnegative(),
  learningConcepts: z.number().int().nonnegative(),
  openErrors: z.number().int().nonnegative(),
  dueReviews: z.number().int().nonnegative(),
  masteredConcepts: z.number().int().nonnegative().optional(),
  xpBreakdown: z.array(learnerXpBreakdownSchema).optional(),
  achievements: z.array(learnerAchievementSchema),
  recentEvents: z.array(learningEventSchema)
})
export type LearnerSummary = z.infer<typeof learnerSummarySchema>
