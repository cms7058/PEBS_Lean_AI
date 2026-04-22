/**
 * /api/billing/* — 订阅与用量 API（基于当前登录用户的租户）
 */
import { Router, type Request, type Response } from 'express'
import {
  getSubscription,
  getPlan,
  getUsageSnapshot,
  getBillingHistory,
  activateLicense,
  downgradeToFree,
  generateLicense,
  getTrialDaysRemaining,
  isTrialExpired,
} from '../../billing/manager'
import { PLANS, type PlanId } from '../../billing/plans'
import { requireAuth } from '../../auth/middleware'
import {
  createOrder, getOrder, listOrders, cancelOrder,
  priceFor, type PaymentCycle, type PaymentMethod,
} from '../../billing/payments'
import { loadConfig } from '../../config/manager'

const router = Router()

// /plans is public so an unauthenticated login page can still show pricing.
router.get('/plans', (_req: Request, res: Response) => {
  res.json({ plans: Object.values(PLANS) })
})

// Everything else is tenant-scoped and requires auth.
router.use(requireAuth)

router.get('/status', (req: Request, res: Response) => {
  const tid = req.auth!.tenant.id
  const sub = getSubscription(tid)
  const plan = getPlan(tid)
  res.json({
    subscription: sub,
    plan,
    trialDaysRemaining: getTrialDaysRemaining(sub),
    trialExpired: isTrialExpired(sub),
  })
})

router.get('/usage', (req: Request, res: Response) => {
  const tid = req.auth!.tenant.id
  const snap = getUsageSnapshot(tid)
  const plan = getPlan(tid)
  const L = plan.limits
  const percent = (used: number, limit: number | null) =>
    limit == null ? 0 : Math.min(100, Math.round((used / limit) * 100))
  res.json({
    snapshot: snap,
    limits: L,
    percents: {
      chatMessages: percent(snap.chatMessages, L.chatMessagesPerMonth),
      toolCalls: percent(snap.toolCalls, L.toolCallsPerMonth),
      kbWrites: percent(snap.kbEntryAdds + snap.kbUploads, L.kbWritesPerMonth),
      kbEntries: percent(snap.kbEntriesTotal, L.kbMaxEntries),
      kbDocuments: percent(snap.kbDocumentsTotal, L.kbMaxDocuments),
    },
  })
})

router.get('/history', (req: Request, res: Response) => {
  res.json({ history: getBillingHistory(req.auth!.tenant.id, 12) })
})

router.post('/activate', (req: Request, res: Response) => {
  const { licenseKey, email } = (req.body || {}) as { licenseKey?: string; email?: string }
  if (!licenseKey || typeof licenseKey !== 'string') {
    res.status(400).json({ error: 'licenseKey is required' })
    return
  }
  try {
    const sub = activateLicense(licenseKey, req.auth!.tenant.id, email)
    res.json({ ok: true, subscription: sub, plan: getPlan(req.auth!.tenant.id) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(400).json({ error: msg })
  }
})

router.post('/downgrade', (req: Request, res: Response) => {
  const sub = downgradeToFree(req.auth!.tenant.id)
  res.json({ ok: true, subscription: sub, plan: getPlan(req.auth!.tenant.id) })
})

// ---- Payment orders (user-facing) -----------------------------------------
// Flow: user POST /orders → pending row + QR config → pays offline → admin
// confirms in admin console (which issues license + activates plan).

/** Public QR-code / contact-info shown on the payment page. */
router.get('/payment-info', (_req: Request, res: Response) => {
  const cfg = loadConfig()
  res.json({ gateway: cfg.paymentGateway ?? {} })
})

/** Price-quote endpoint (no order row created). */
router.get('/quote', (req: Request, res: Response) => {
  const plan = req.query.plan as PlanId
  const cycle = req.query.cycle as PaymentCycle
  if (!PLANS[plan] || (cycle !== 'monthly' && cycle !== 'yearly')) {
    res.status(400).json({ error: 'plan / cycle 无效' }); return
  }
  try {
    const amountCents = priceFor(plan, cycle)
    res.json({ plan, cycle, amountCents, currency: PLANS[plan].pricing.currency })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

/** POST /api/billing/orders — user creates a pending order for their tenant. */
router.post('/orders', (req: Request, res: Response) => {
  const { plan, cycle, method, notes } = req.body as {
    plan?: PlanId; cycle?: PaymentCycle; method?: PaymentMethod; notes?: string
  }
  if (!plan || !cycle) { res.status(400).json({ error: 'plan / cycle 必填' }); return }
  try {
    const order = createOrder({
      tenantId: req.auth!.tenant.id,
      userId: req.auth!.user.id,
      plan, cycle, method, notes,
    })
    const cfg = loadConfig()
    res.json({ order, gateway: cfg.paymentGateway ?? {} })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

/** GET /api/billing/orders — current tenant's orders, most-recent first. */
router.get('/orders', (req: Request, res: Response) => {
  const orders = listOrders({ tenantId: req.auth!.tenant.id, limit: 50 })
  res.json({ orders })
})

/** GET /api/billing/orders/:id — polling endpoint to detect status changes. */
router.get('/orders/:id', (req: Request, res: Response) => {
  const o = getOrder(String(req.params.id))
  if (!o || o.tenant_id !== req.auth!.tenant.id) {
    res.status(404).json({ error: '订单不存在' }); return
  }
  res.json({ order: o })
})

/** POST /api/billing/orders/:id/cancel — user cancels their own pending order. */
router.post('/orders/:id/cancel', (req: Request, res: Response) => {
  const o = getOrder(String(req.params.id))
  if (!o || o.tenant_id !== req.auth!.tenant.id) {
    res.status(404).json({ error: '订单不存在' }); return
  }
  try {
    const order = cancelOrder(String(req.params.id), '用户取消')
    res.json({ ok: true, order })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

router.post('/license/preview', (req: Request, res: Response) => {
  if (process.env.LEANAI_DISABLE_LICENSE_PREVIEW === '1') {
    res.status(403).json({ error: '该端点已被禁用' })
    return
  }
  const { plan, expiresAt } = (req.body || {}) as { plan?: 'personal' | 'enterprise'; expiresAt?: number }
  if (plan !== 'personal' && plan !== 'enterprise') {
    res.status(400).json({ error: 'plan must be personal or enterprise' })
    return
  }
  const ts = typeof expiresAt === 'number' && expiresAt > Date.now()
    ? expiresAt
    : Date.now() + 365 * 24 * 60 * 60 * 1000
  try {
    const licenseKey = generateLicense(plan, ts)
    res.json({ licenseKey, expiresAt: ts })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

export default router
