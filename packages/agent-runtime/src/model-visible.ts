export interface SanitizedModelVisibleText {
  text: string
  redacted: boolean
}

export function sanitizeModelVisibleText(value: string): SanitizedModelVisibleText {
  const text = value
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{4,}/gi, 'Bearer [redacted]')
    .replace(/(?<![A-Za-z0-9])(?:[A-Za-z]:[\\/]|\\\\)[^\s"'<>|]*/g, '[local path redacted]')
    .replace(/\bfile:\/\/\/(?:Users|home|private|tmp|var|etc|opt|mnt|root|workspace|usr|data|srv)(?:\/[^\s"'<>]*)?/g, 'file:///[local path redacted]')
    .replace(/(?<![A-Za-z0-9:/])\/(?:Users|home|private|tmp|var|etc|opt|mnt|root|workspace|usr|data|srv)(?:\/[^\s"'<>]*)?/g, '[local path redacted]')
  return { text, redacted: text !== value }
}
