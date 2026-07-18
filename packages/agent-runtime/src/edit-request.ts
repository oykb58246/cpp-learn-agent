export interface RequestedEditResult {
  content: string
  changed: boolean
}

export function applyRequestedEdit(content: string, message: string): RequestedEditResult {
  const fragments = extractDelimitedFragments(message)
  let updated = content

  for (let index = 0; index + 1 < fragments.length; index += 2) {
    const from = fragments[index]!
    const to = fragments[index + 1]!
    if (from && updated.includes(from)) updated = updated.replaceAll(from, to)
  }

  if (fragments.length === 1 && /(?:输出|文字|字符串|string|message)/i.test(message) && /(?:改成|改为|修改为|替换为|设为|change\s+to|replace\s+with)/i.test(message)) {
    const literals = [...content.matchAll(/"(?:\\.|[^"\\])*"/g)]
    if (literals.length === 1) {
      const literal = literals[0]![0]
      updated = updated.replace(literal, `"${fragments[0]!}"`)
    }
  }

  if (/(?:编译|compile|build)/i.test(message)) {
    updated = updated.replace(/\bint\s+Main\s*\(/, 'int main(')
  }

  return { content: updated, changed: updated !== content }
}

function extractDelimitedFragments(message: string): string[] {
  const matches: Array<{ index: number; value: string }> = []
  for (const pattern of [/"([^"\r\n]+)"/g, /“([^”\r\n]+)”/g, /`([^`\r\n]+)`/g]) {
    for (const match of message.matchAll(pattern)) {
      if (match[1]) matches.push({ index: match.index, value: match[1] })
    }
  }
  return matches.sort((left, right) => left.index - right.index).map(item => item.value)
}
