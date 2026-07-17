import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export function createElectronEnvironment(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment = { ...process.env, ...overrides }
  delete environment.ELECTRON_RUN_AS_NODE
  return environment
}

export interface StreamingModelFixture {
  baseUrl: string
  close(): Promise<void>
}

export async function startStreamingModelFixture(): Promise<StreamingModelFixture> {
  let slowStopResponseServed = false
  const server: Server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { messages?: Array<{ content?: string }> }
    const prompt = payload.messages?.at(-1)?.content ?? ''
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'close'
    })
    const send = (content: string) => response.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
    if (prompt.includes('停止测试') && !slowStopResponseServed) {
      slowStopResponseServed = true
      send('这是一段尚未完成的回答')
      setTimeout(() => {
        if (response.destroyed || response.writableEnded) return
        send('，稍后才会结束。')
        response.end('data: [DONE]\n\n')
      }, 4_000)
      return
    }
    send(prompt.includes('错误') ? '先看共同原因：' : '我们一步一步来看。')
    await new Promise(resolve => setTimeout(resolve, 25))
    send(prompt.includes('错误') ? '字符串不能直接赋值给 int，请逐个检查两个出现位置。' : '这次回答已经完成。')
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: () => new Promise<void>((resolve, reject) => {
      server.closeAllConnections()
      server.close(error => error ? reject(error) : resolve())
    })
  }
}
