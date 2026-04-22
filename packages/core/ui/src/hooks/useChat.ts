import { useState, useCallback, useRef } from 'react'
import type { Message, MessagePart, ToolPart } from '../lib/api'

export type ChatStatus = 'idle' | 'streaming' | 'error'

export interface UseChatReturn {
  messages: Message[]
  status: ChatStatus
  error: string | null
  conversationId: string | null
  sendMessage: (text: string, opts?: { provider?: string; model?: string }) => void
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  setConversationId: (id: string | null) => void
  cancel: () => void
}

/**
 * Appends a text chunk to the assistant message's `parts` array so text and
 * tool cards stay in the stream order the LLM emitted them:
 * - If the last part is still a text block, append to it.
 * - Otherwise (first chunk, or text after a tool) push a new text part.
 */
function appendTextPart(parts: MessagePart[] | undefined, delta: string): MessagePart[] {
  const arr = parts ? [...parts] : []
  const last = arr[arr.length - 1]
  if (last && last.kind === 'text') {
    arr[arr.length - 1] = { ...last, text: last.text + delta }
  } else {
    arr.push({ kind: 'text', text: delta })
  }
  return arr
}

function upsertToolPart(
  parts: MessagePart[] | undefined,
  id: string,
  update: (existing?: ToolPart) => ToolPart,
): MessagePart[] {
  const arr = parts ? [...parts] : []
  const idx = arr.findIndex(p => p.kind === 'tool' && p.id === id)
  if (idx >= 0) {
    arr[idx] = update(arr[idx] as ToolPart)
  } else {
    arr.push(update())
  }
  return arr
}

export function useChat(initialConvId?: string): UseChatReturn {
  const [messages, setMessages] = useState<Message[]>([])
  const [status, setStatus] = useState<ChatStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(initialConvId ?? null)
  const abortRef = useRef<(() => void) | null>(null)

  const sendMessage = useCallback((text: string, opts?: { provider?: string; model?: string }) => {
    if (status === 'streaming') return

    // Optimistically add user message
    const userMsg: Message = {
      id: crypto.randomUUID(),
      conversation_id: conversationId ?? '',
      role: 'user',
      content: text,
      created_at: Date.now(),
    }
    setMessages(prev => [...prev, userMsg])
    setStatus('streaming')
    setError(null)

    // Placeholder for streaming assistant message
    const assistantId = crypto.randomUUID()
    const assistantMsg: Message = {
      id: assistantId,
      conversation_id: conversationId ?? '',
      role: 'assistant',
      content: '',
      parts: [],
      created_at: Date.now(),
    }
    setMessages(prev => [...prev, assistantMsg])

    let currentConvId = conversationId

    const body = JSON.stringify({
      conversationId: currentConvId ?? undefined,
      message: text,
      ...(opts?.provider && { provider: opts.provider }),
      ...(opts?.model && { model: opts.model }),
    })

    const controller = new AbortController()
    abortRef.current = () => controller.abort()

    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`)
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })

          // Parse SSE lines
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.startsWith('data:')) continue
            const jsonStr = line.slice(5).trim()
            if (!jsonStr) continue
            try {
              const event = JSON.parse(jsonStr) as {
                type: string
                delta?: string
                conversationId?: string
                message?: string
                id?: string
                toolName?: string
                skill?: string
                input?: Record<string, unknown>
                content?: string
                isError?: boolean
                artifact?: { type: string; data: unknown; filename?: string; mimeType?: string }
              }

              if (event.type === 'init' && event.conversationId) {
                currentConvId = event.conversationId
                setConversationId(event.conversationId)
              } else if (event.type === 'text' && event.delta) {
                setMessages(prev =>
                  prev.map(m =>
                    m.id === assistantId
                      ? {
                          ...m,
                          content: m.content + event.delta!,
                          parts: appendTextPart(m.parts, event.delta!),
                        }
                      : m,
                  ),
                )
              } else if (event.type === 'tool_start' && event.id && event.toolName) {
                const id = event.id
                const toolName = event.toolName
                const skill = event.skill ?? toolName
                setMessages(prev =>
                  prev.map(m =>
                    m.id === assistantId
                      ? {
                          ...m,
                          parts: upsertToolPart(m.parts, id, (existing) => ({
                            kind: 'tool',
                            id,
                            toolName,
                            skill,
                            status: 'running',
                            ...existing,
                          })),
                        }
                      : m,
                  ),
                )
              } else if (event.type === 'tool_input' && event.id) {
                const id = event.id
                const input = event.input
                setMessages(prev =>
                  prev.map(m =>
                    m.id === assistantId
                      ? {
                          ...m,
                          parts: upsertToolPart(m.parts, id, (existing) => ({
                            kind: 'tool',
                            id,
                            toolName: event.toolName ?? existing?.toolName ?? id,
                            skill: existing?.skill ?? event.toolName ?? id,
                            status: existing?.status ?? 'running',
                            ...existing,
                            input,
                          })),
                        }
                      : m,
                  ),
                )
              } else if (event.type === 'tool_result' && event.id) {
                const id = event.id
                setMessages(prev =>
                  prev.map(m =>
                    m.id === assistantId
                      ? {
                          ...m,
                          parts: upsertToolPart(m.parts, id, (existing) => ({
                            kind: 'tool',
                            id,
                            toolName: existing?.toolName ?? id,
                            skill: existing?.skill ?? id,
                            ...existing,
                            status: event.isError ? 'error' : 'done',
                            result: event.content ?? '',
                            isError: event.isError,
                            artifact: event.artifact,
                          })),
                        }
                      : m,
                  ),
                )
              } else if (event.type === 'done') {
                setStatus('idle')
              } else if (event.type === 'error') {
                setError(event.message ?? 'Unknown error')
                setStatus('error')
                // Remove empty assistant placeholder on error (no text AND no tool parts).
                setMessages(prev =>
                  prev.filter(m =>
                    !(m.id === assistantId && !m.content && !(m.parts && m.parts.length > 0))
                  ),
                )
              }
            } catch {
              /* ignore malformed lines */
            }
          }
        }
        setStatus('idle')
      })
      .catch((err: unknown) => {
        if ((err as Error).name === 'AbortError') {
          setStatus('idle')
          return
        }
        setError(err instanceof Error ? err.message : String(err))
        setStatus('error')
        setMessages(prev =>
          prev.filter(m =>
            !(m.id === assistantId && !m.content && !(m.parts && m.parts.length > 0))
          ),
        )
      })
  }, [status, conversationId])

  const cancel = useCallback(() => {
    abortRef.current?.()
  }, [])

  return { messages, status, error, conversationId, sendMessage, setMessages, setConversationId, cancel }
}
