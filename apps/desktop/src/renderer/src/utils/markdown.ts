import DOMPurify from 'dompurify'
import { marked } from 'marked'

const allowedTags = [
  'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'li', 'ol', 'p', 'pre', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul'
]

export function renderMarkdown(source: string): string {
  const parsed = marked.parse(source, { async: false, breaks: true, gfm: true })
  const sanitized = DOMPurify.sanitize(parsed, {
    ALLOWED_ATTR: ['class', 'href', 'title'],
    ALLOWED_TAGS: allowedTags
  })
  const template = document.createElement('template')
  template.innerHTML = sanitized

  for (const link of template.content.querySelectorAll('a')) {
    const href = link.getAttribute('href')
    if (!href) continue
    try {
      const url = new URL(href)
      if (url.protocol !== 'https:') throw new Error('Unsupported link protocol')
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
    } catch {
      link.removeAttribute('href')
    }
  }

  return template.innerHTML
}
