import { describe, expect, it } from 'vitest'
import { buildOjScreenshotChatCompletionsRequest, buildOjScreenshotImportRequest, parseOjImportModelOutput } from './practice-import'

describe('OJ screenshot practice import', () => {
  it('sends screenshots as native Responses input_image and not as text', () => {
    const dataUrl = 'data:image/png;base64,AAAA'
    const body = buildOjScreenshotImportRequest({
      model: 'gpt-5.1',
      previewDataUrl: dataUrl,
      mimeType: 'image/png',
      width: 640,
      height: 480
    })
    const content = body.input[0]?.content ?? []

    expect(content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'input_image', image_url: dataUrl })
    ]))
    expect(content).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'input_text', text: expect.stringContaining(dataUrl) })
    ]))
    expect(content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'input_text', text: expect.stringContaining('5 个判题用例') })
    ]))
  })

  it('requires five trustworthy judge cases before adding an imported OJ exercise', () => {
    const judgeCases = Array.from({ length: 5 }, (_, index) => ({
      id: `case-${index + 1}`,
      input: `${index} ${index + 1}`,
      expectedOutput: `${index * 2 + 1}`,
      score: 20,
      visibility: index === 0 ? 'sample' : 'hidden',
      reason: index === 0 ? '题目样例' : 'AI 补充边界用例'
    }))
    const accepted = parseOjImportModelOutput({
      decision: 'accept', title: '两数之和', knowledgePoint: '输入输出', conceptIds: ['basics.io'], difficulty: 1,
      statement: '输入两个整数，输出它们的和。', constraints: ['-100 <= a,b <= 100'], samples: [{ input: '1 2', output: '3' }],
      judgeCases,
      starterCode: '#include <iostream>\nint main() { return 0; }'
    }, '2026-07-20T10:00:00.000Z')
    expect(accepted.status).toBe('added')
    if (accepted.status === 'added') {
      expect(accepted.exercise.source).toBe('user')
      expect(accepted.exercise.judgeCases).toHaveLength(5)
    }

    expect(parseOjImportModelOutput({ decision: 'reject', reason: '截图缺少输入输出格式。' }, '2026-07-20T10:00:00.000Z')).toEqual({
      status: 'refused', reason: '截图缺少输入输出格式。'
    })
    expect(parseOjImportModelOutput({
      decision: 'accept', title: '缺判题用例', knowledgePoint: '输入输出', conceptIds: ['basics.io'], difficulty: 1,
      statement: '输入两个整数，输出它们的和。', constraints: [], samples: [{ input: '1 2', output: '3' }]
    }, '2026-07-20T10:00:00.000Z')).toEqual({
      status: 'refused', reason: '截图信息不足，无法形成完整练习题和 5 个可信判题用例。'
    })
  })

  it('builds a DeepSeek-compatible chat request for screenshot import', () => {
    const dataUrl = 'data:image/png;base64,AAAA'
    const body = buildOjScreenshotChatCompletionsRequest({
      model: 'deepseek-v4-pro', previewDataUrl: dataUrl,
      mimeType: 'image/png', width: 640, height: 480
    })

    expect(body).toMatchObject({
      model: 'deepseek-v4-pro',
      response_format: { type: 'json_object' },
      stream: false,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: expect.any(String) },
          { type: 'image_url', image_url: { url: dataUrl, detail: 'auto' } }
        ]
      }]
    })
  })
})
