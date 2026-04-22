import React from 'react'
import { renderMarkdown } from '../lib/markdown'
import { ToolCallCard } from './ToolCallCard'
import type { Message, MessagePart } from '../lib/api'

interface Props {
  message: Message
  isStreaming?: boolean
}

export function MessageBubble({ message, isStreaming }: Props) {
  const isUser = message.role === 'user'

  if (isUser) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 24 }}>
        <div style={{
          maxWidth: '72%',
          background: '#fff',
          border: '1px solid #e4e4e4',
          borderRadius: 10,
          padding: '10px 14px',
          fontSize: 13,
          color: '#1a1a1a',
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}>
          {message.content}
        </div>
      </div>
    )
  }

  // Assistant — prose style, no bubble, render parts if present (live streaming)
  // or fall back to plain content for persisted messages loaded from the DB.
  const parts = message.parts
  const hasParts = Array.isArray(parts) && parts.length > 0
  const hasAnyContent = hasParts || !!message.content

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{
        fontSize: 10, fontWeight: 600, letterSpacing: '0.1em',
        color: '#bbb', marginBottom: 8, textTransform: 'uppercase',
      }}>
        PEBS Lean
      </div>

      {hasParts ? (
        <PartsView parts={parts!} isStreaming={isStreaming} />
      ) : message.content ? (
        <TextBlock text={message.content} isStreaming={isStreaming} />
      ) : isStreaming ? (
        <ThinkingDots />
      ) : null}

      {!hasAnyContent && !isStreaming && null}
    </div>
  )
}

function PartsView({ parts, isStreaming }: { parts: MessagePart[]; isStreaming?: boolean }) {
  // The "currently streaming" cursor attaches to the last text part, if any.
  const lastTextIdx = (() => {
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i].kind === 'text') return i
    }
    return -1
  })()

  const hasAnyText = lastTextIdx >= 0
  const onlyToolsSoFar = isStreaming && !hasAnyText && parts.some(p => p.kind === 'tool')

  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === 'text') {
          return (
            <TextBlock
              key={i}
              text={p.text}
              isStreaming={isStreaming && i === lastTextIdx}
            />
          )
        }
        return <ToolCallCard key={p.id} part={p} />
      })}
      {onlyToolsSoFar && (
        <div style={{ marginTop: 4 }}>
          <ThinkingDots />
        </div>
      )}
    </>
  )
}

function TextBlock({ text, isStreaming }: { text: string; isStreaming?: boolean }) {
  if (!text) {
    return isStreaming ? <ThinkingDots /> : null
  }
  return (
    <div style={{ position: 'relative' }}>
      <div
        className="prose"
        style={{ fontSize: 13, color: '#333', lineHeight: 1.7 }}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
      />
      {isStreaming && (
        <span className="cursor-blink" style={{
          display: 'inline-block', width: 2, height: 13,
          background: '#aaa', marginLeft: 2, verticalAlign: 'middle',
        }} />
      )}
    </div>
  )
}

function ThinkingDots() {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', height: 20 }}>
      <span className="dot-bounce" style={{ width: 5, height: 5, borderRadius: '50%', background: '#ccc', display: 'inline-block' }} />
      <span className="dot-bounce" style={{ width: 5, height: 5, borderRadius: '50%', background: '#ccc', display: 'inline-block' }} />
      <span className="dot-bounce" style={{ width: 5, height: 5, borderRadius: '50%', background: '#ccc', display: 'inline-block' }} />
    </div>
  )
}
