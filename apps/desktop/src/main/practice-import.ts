import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { practiceExerciseSchema, type PracticeOjImportResult } from '@cpp-pet/contracts'

export interface OjScreenshotImportRequestInput {
  model: string
  previewDataUrl: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  width: number
  height: number
}

const ojJudgeCaseModelSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  input: z.string().min(1).max(20_000),
  expectedOutput: z.string().min(1).max(20_000),
  visibility: z.enum(['sample', 'hidden']).optional(),
  reason: z.string().min(1).max(2_000).optional()
}).passthrough()

const ojModelOutputSchema = z.object({
  decision: z.enum(['accept', 'reject']),
  reason: z.string().max(2_000).optional(),
  title: z.string().min(1).max(200).optional(),
  knowledgePoint: z.string().min(1).max(100).optional(),
  conceptIds: z.array(z.string().min(1).max(100)).optional(),
  difficulty: z.number().int().min(1).max(5).optional(),
  statement: z.string().min(1).max(100_000).optional(),
  constraints: z.array(z.string().min(1).max(2_000)).optional(),
  samples: z.array(z.object({ input: z.string().max(20_000), output: z.string().max(20_000) }).strict()).optional(),
  judgeCases: z.array(ojJudgeCaseModelSchema).length(5).optional(),
  starterCode: z.string().max(100_000).optional()
}).passthrough()

export function buildOjScreenshotImportRequest(input: OjScreenshotImportRequestInput) {
  return {
    model: input.model,
    store: false,
    input: [{
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: [
            '你是 C++ OJ 题面整理助手。请只根据随后的截图提取题目信息，不要编造截图中没有的关键条件。',
            `截图元信息：${input.mimeType}，${input.width}x${input.height}。`,
            '如果截图缺少完整题意、输入格式、输出格式或样例，请返回 JSON：{"decision":"reject","reason":"..."}。',
            '如果截图样例不足 5 个，请在题意足够明确时补充边界判题用例；如果无法确定期望输出，必须 reject，不要猜。',
            '如果信息足够，请返回 JSON：{"decision":"accept","title":"...","knowledgePoint":"...","conceptIds":["..."],"difficulty":1-5,"statement":"...","constraints":["..."],"samples":[{"input":"...","output":"..."}],"judgeCases":[{"input":"...","expectedOutput":"...","visibility":"sample","reason":"题目样例或边界说明"}],"starterCode":"可选 C++ 起始代码"}；judgeCases 必须正好 5 个判题用例，每个 20 分，输入和 expectedOutput 都不能为空。',
            'knowledgePoint 使用简短中文分类，例如 输入输出、条件分支、循环、数组、字符串、函数、排序、STL 容器、递归、二分查找。conceptIds 尽量映射到 basics.io、control.conditions、control.loops、data.arrays、data.strings、functions.basic、sorting.basic、stl.vector、stl.map、recursion.basic、search.binary。'
          ].join('\n')
        },
        { type: 'input_image', image_url: input.previewDataUrl, detail: 'auto' }
      ]
    }],
    text: {
      format: {
        type: 'json_object'
      }
    }
  }
}

export function buildOjScreenshotChatCompletionsRequest(input: OjScreenshotImportRequestInput) {
  const responsesRequest = buildOjScreenshotImportRequest(input)
  const text = responsesRequest.input[0]!.content
    .filter(part => part.type === 'input_text')
    .map(part => 'text' in part ? part.text : '')
    .join('\n')

  return {
    model: input.model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text },
        { type: 'image_url', image_url: { url: input.previewDataUrl, detail: 'auto' } }
      ]
    }],
    response_format: { type: 'json_object' },
    stream: false
  }
}

export function parseOjImportModelOutput(raw: unknown, now: string): PracticeOjImportResult {
  const value = typeof raw === 'string' ? parseJson(raw) : raw
  const parsed = ojModelOutputSchema.safeParse(value)
  if (!parsed.success) return insufficient()
  if (parsed.data.decision === 'reject') {
    return { status: 'refused', reason: parsed.data.reason?.trim() || '截图信息不足，无法形成完整练习题和 5 个可信判题用例。' }
  }
  if (!parsed.data.judgeCases || parsed.data.judgeCases.length !== 5) return insufficient()
  const judgeCases = parsed.data.judgeCases.map((item, index) => ({
    id: item.id?.trim() || `case-${index + 1}`,
    input: item.input,
    expectedOutput: item.expectedOutput,
    score: 20 as const,
    visibility: index === 0 ? 'sample' as const : item.visibility ?? 'hidden' as const,
    ...(item.reason ? { reason: item.reason } : {})
  }))
  const exercise = practiceExerciseSchema.safeParse({
    id: `oj-${randomUUID()}`,
    title: parsed.data.title,
    knowledgePoint: parsed.data.knowledgePoint,
    conceptIds: parsed.data.conceptIds,
    difficulty: parsed.data.difficulty,
    statement: parsed.data.statement,
    constraints: parsed.data.constraints ?? [],
    samples: parsed.data.samples,
    judgeCases,
    ...(parsed.data.starterCode ? { starterCode: parsed.data.starterCode } : {}),
    source: 'user',
    createdAt: now,
    updatedAt: now
  })
  if (!exercise.success) return insufficient()
  return { status: 'added', exercise: exercise.data }
}

function parseJson(raw: string): unknown {
  try { return JSON.parse(raw) }
  catch { return undefined }
}

function insufficient(): PracticeOjImportResult {
  return { status: 'refused', reason: '截图信息不足，无法形成完整练习题和 5 个可信判题用例。' }
}
