let buffer = Buffer.alloc(0)
let documentUri = ''

const send = payload => {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  process.stdout.write(`Content-Length: ${body.byteLength}\r\n\r\n`)
  process.stdout.write(body)
}

const handle = message => {
  if (message.method === 'initialize') {
    send({ jsonrpc: '2.0', id: message.id, result: { capabilities: {} } })
    return
  }
  if (message.method === 'shutdown') {
    send({ jsonrpc: '2.0', id: message.id, result: null })
    return
  }
  if (message.method === 'exit') {
    process.exit(0)
  }
  if (message.method === 'textDocument/didOpen') {
    documentUri = message.params.textDocument.uri
    send({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: {
        uri: documentUri,
        diagnostics: [{
          severity: 2,
          code: 'fake-warning',
          message: 'fake diagnostic',
          range: { start: { line: 1, character: 4 }, end: { line: 1, character: 9 } }
        }]
      }
    })
    return
  }
  if (message.method === 'textDocument/completion') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        items: [{
          label: 'value',
          detail: 'int value',
          insertText: 'value',
          documentation: { kind: 'markdown', value: '**fake completion**' }
        }]
      }
    })
    return
  }
  if (message.method === 'textDocument/hover') {
    send({ jsonrpc: '2.0', id: message.id, result: { contents: { language: 'cpp', value: 'int value' } } })
    return
  }
  if (message.method === 'textDocument/definition') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: { uri: documentUri, range: { start: { line: 1, character: 4 }, end: { line: 1, character: 9 } } }
    })
  }
}

process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk])
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n')
    if (headerEnd < 0) return
    const header = buffer.subarray(0, headerEnd).toString('ascii')
    const length = Number(header.match(/Content-Length:\s*(\d+)/i)?.[1] ?? 0)
    const bodyStart = headerEnd + 4
    if (!length || buffer.byteLength < bodyStart + length) return
    const body = buffer.subarray(bodyStart, bodyStart + length).toString('utf8')
    buffer = buffer.subarray(bodyStart + length)
    handle(JSON.parse(body))
  }
})
