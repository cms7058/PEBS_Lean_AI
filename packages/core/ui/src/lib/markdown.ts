/**
 * Minimal Markdown renderer — no external deps for Phase 1.
 * Handles: headings, bold, italic, code, pre, lists, tables, blockquote, hr, links.
 */
export function renderMarkdown(text: string): string {
  let html = text
    // Escape HTML entities
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // Fenced code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, _lang, code) =>
    `<pre><code>${code.trim()}</code></pre>`
  )

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')

  // Bold / Italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // HR
  html = html.replace(/^---+$/gm, '<hr/>')

  // Blockquote
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')

  // Unordered list
  html = html.replace(/((?:^[-*] .+\n?)+)/gm, (match) => {
    const items = match.trim().split('\n').map(l => `<li>${l.replace(/^[-*] /, '')}</li>`).join('')
    return `<ul>${items}</ul>`
  })

  // Ordered list
  html = html.replace(/((?:^\d+\. .+\n?)+)/gm, (match) => {
    const items = match.trim().split('\n').map(l => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('')
    return `<ol>${items}</ol>`
  })

  // Simple table
  html = html.replace(/((?:^\|.+\|\n?)+)/gm, (match) => {
    const rows = match.trim().split('\n').filter(r => !/^\|[-| :]+\|$/.test(r.trim()))
    const tableRows = rows.map((r, i) => {
      const cells = r.split('|').filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)
      const tag = i === 0 ? 'th' : 'td'
      return `<tr>${cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('')}</tr>`
    })
    return `<table>${tableRows.join('')}</table>`
  })

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')

  // Paragraphs (lines not already wrapped)
  const lines = html.split('\n')
  const out: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) { out.push(''); continue }
    if (/^<(h[1-6]|ul|ol|li|pre|blockquote|table|tr|th|td|hr)/.test(trimmed)) {
      out.push(trimmed)
    } else {
      out.push(`<p>${trimmed}</p>`)
    }
  }

  return out.join('\n')
}
