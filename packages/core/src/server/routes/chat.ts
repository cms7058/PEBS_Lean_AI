import { Router, type Request, type Response } from 'express'
import { chat } from '../../agent/index'
import { checkChatMessage, recordUsage } from '../../billing/manager'
import { requireAuth } from '../../auth/middleware'

const router = Router()

// Chat is always authenticated. Usage + quota are tenant-scoped.
router.use(requireAuth)

/**
 * POST /api/chat  — SSE stream
 * See comment block in earlier version for event shape.
 */
router.post('/', async (req: Request, res: Response) => {
  const { conversationId, message, provider, model } = req.body as {
    conversationId?: string
    message?: string
    provider?: string
    model?: string
  }

  if (!message || typeof message !== 'string' || !message.trim()) {
    res.status(400).json({ error: 'message is required' })
    return
  }

  const tenantId = req.auth!.tenant.id
  const userId = req.auth!.user.id

  // Quota: chat messages per month / trial expiry (per-tenant)
  const q = checkChatMessage(tenantId)
  if (!q.allowed) {
    res.status(402).json({ error: q.reason, quota: q, upgradeRequired: true })
    return
  }
  try { recordUsage(tenantId, 'chat_message', '') } catch { /* non-fatal */ }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const send = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  let closed = false
  res.on('close', () => { closed = true })

  try {
    for await (const event of chat({
      conversationId, message: message.trim(), provider, model,
      userId, tenantId,
    })) {
      if (closed) break

      switch (event.type) {
        case 'text':
          if (event.conversationId) {
            send({ type: 'init', conversationId: event.conversationId })
          } else if (event.delta) {
            send({ type: 'text', delta: event.delta })
          }
          break
        case 'tool_start':
          send({ type: 'tool_start', id: event.id, toolName: event.toolName, skill: event.skill })
          break
        case 'tool_input':
          send({ type: 'tool_input', id: event.id, toolName: event.toolName, input: event.input })
          break
        case 'tool_result':
          send({
            type: 'tool_result',
            id: event.id,
            content: event.content,
            isError: event.isError ?? false,
            ...(event.artifact ? { artifact: event.artifact } : {}),
          })
          break
        case 'done':
          send({ type: 'done', conversationId: event.conversationId })
          break
        case 'error':
          send({ type: 'error', message: event.message })
          break
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!closed) send({ type: 'error', message: msg })
  } finally {
    res.end()
  }
})

export default router
