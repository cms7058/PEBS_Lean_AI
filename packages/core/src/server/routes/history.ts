import { Router, type Request, type Response } from 'express'
import {
  getConversations,
  getConversation,
  getMessages,
  deleteConversation,
} from '../../storage/db'
import { requireAuth } from '../../auth/middleware'

const router = Router()

// All conversation endpoints require auth — conversations are always
// scoped to the caller's user id.
router.use(requireAuth)

// GET /api/conversations — only this user's conversations
router.get('/', (req: Request, res: Response) => {
  const conversations = getConversations({ userId: req.auth!.user.id })
  res.json(conversations)
})

// GET /api/conversations/:id — 404 if not owned
router.get('/:id', (req: Request, res: Response) => {
  const conv = getConversation(String(req.params.id), { userId: req.auth!.user.id })
  if (!conv) { res.status(404).json({ error: 'Not found' }); return }
  const messages = getMessages(String(req.params.id))
  res.json({ ...conv, messages })
})

// DELETE /api/conversations/:id
router.delete('/:id', (req: Request, res: Response) => {
  const conv = getConversation(String(req.params.id), { userId: req.auth!.user.id })
  if (!conv) { res.status(404).json({ error: 'Not found' }); return }
  deleteConversation(String(req.params.id), { userId: req.auth!.user.id })
  res.json({ ok: true })
})

export default router
