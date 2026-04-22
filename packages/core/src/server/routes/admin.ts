/**
 * /api/admin/* — platform administration.
 *
 * All routes require `requireAdmin` (role='admin' on the authenticated user).
 * Admins operate on every tenant — they are NOT gated by their own tenant's
 * subscription status.
 *
 * Endpoints:
 *   GET    /tenants                        — list all tenants
 *   POST   /tenants                        — create tenant
 *   GET    /tenants/:id                    — tenant detail + users + usage
 *   PATCH  /tenants/:id                    — update tenant (plan, expires_at, status, seats, notes)
 *   DELETE /tenants/:id                    — delete tenant (cascades users/sessions)
 *   POST   /tenants/:id/renew              — shortcut: extend expires_at by N days
 *   POST   /tenants/:id/license            — activate license on this tenant
 *
 *   GET    /users                          — list all users
 *   POST   /users                          — create user (inside an existing tenant)
 *   PATCH  /users/:id                      — update email / displayName / role / status
 *   POST   /users/:id/password             — reset a user's password
 *   DELETE /users/:id                      — delete user
 *
 *   GET    /usage                          — aggregate usage per tenant (current period)
 *   GET    /skills                         — list installed skills + per-tenant enabled flag
 *   POST   /skills/:pkg/toggle             — enable/disable a skill globally
 */
import { Router, type Request, type Response } from 'express'
import { requireAuth, requireAdmin } from '../../auth/middleware'
import {
  listTenants, getTenant, createTenant, updateTenant, deleteTenant,
  listUsers, getUser, createUser, updateUser, updateUserPassword, deleteUser,
  toSafeUser, findUserByUsername,
} from '../../auth/users'
import { deleteAllUserSessions } from '../../auth/sessions'
import {
  getUsageSnapshot, getSubscription, getPlan, activateLicense,
  getTrialDaysRemaining, isTrialExpired,
} from '../../billing/manager'
import {
  getAllPlanCapabilities, getPlanCapabilities, setPlanCapabilities,
} from '../../billing/capabilities'
import {
  listOrders, confirmOrder, cancelOrder, expirePendingOrders,
  getLifetimePaidByTenant, createOrder, type PaymentStatus,
} from '../../billing/payments'
import { PLANS, type PlanId } from '../../billing/plans'
import { discoverSkills } from '../../skills/discovery'
import { buildToolRegistry } from '../../skills/registry'
import { loadConfig, saveConfig } from '../../config/manager'

const router = Router()

router.use(requireAuth, requireAdmin)

// ---- Tenants --------------------------------------------------------------

router.get('/tenants', (_req: Request, res: Response) => {
  const tenants = listTenants().map(t => {
    const users = listUsers({ tenantId: t.id }).length
    const usage = getUsageSnapshot(t.id)
    const sub = getSubscription(t.id)
    const paid = getLifetimePaidByTenant(t.id)
    return {
      ...t,
      userCount: users,
      usage,
      subscription: {
        plan: sub.plan,
        expiresAt: sub.expires_at,
        daysRemaining: getTrialDaysRemaining(sub),
        expired: isTrialExpired(sub),
        paidCents: paid.amountCents,
        paidOrders: paid.orders,
        currency: paid.currency,
      },
    }
  })
  res.json({ tenants })
})

router.post('/tenants', (req: Request, res: Response) => {
  const { name, plan, expiresAt, seats, notes } = req.body as {
    name?: string; plan?: 'free' | 'personal' | 'enterprise';
    expiresAt?: number | null; seats?: number; notes?: string
  }
  if (!name) { res.status(400).json({ error: 'name 必填' }); return }
  try {
    const tenant = createTenant({ name, plan, expiresAt: expiresAt ?? undefined, seats, notes })
    res.json({ tenant })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

router.get('/tenants/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id)
  const tenant = getTenant(id)
  if (!tenant) { res.status(404).json({ error: '租户不存在' }); return }
  const users = listUsers({ tenantId: id }).map(toSafeUser)
  const usage = getUsageSnapshot(id)
  const plan = getPlan(id)
  const subscription = getSubscription(id)
  res.json({ tenant, users, usage, plan, subscription })
})

router.patch('/tenants/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id)
  const patch = req.body as Record<string, unknown>
  const allowed: Record<string, unknown> = {}
  for (const k of ['name', 'status', 'plan', 'expires_at', 'seats', 'license_key', 'notes']) {
    if (k in patch) allowed[k] = patch[k]
  }
  const updated = updateTenant(id, allowed as Parameters<typeof updateTenant>[1])
  if (!updated) { res.status(404).json({ error: '租户不存在' }); return }
  res.json({ tenant: updated })
})

router.delete('/tenants/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id)
  try {
    deleteTenant(id)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

/** POST /api/admin/tenants/:id/renew  body: { days: number } — extend expires_at */
router.post('/tenants/:id/renew', (req: Request, res: Response) => {
  const id = Number(req.params.id)
  const { days } = req.body as { days?: number }
  if (typeof days !== 'number' || !Number.isFinite(days) || days <= 0) {
    res.status(400).json({ error: 'days 必须是正数' }); return
  }
  const t = getTenant(id)
  if (!t) { res.status(404).json({ error: '租户不存在' }); return }
  const base = Math.max(Date.now(), t.expires_at ?? Date.now())
  const nextExpires = base + days * 24 * 60 * 60 * 1000
  const updated = updateTenant(id, { expires_at: nextExpires })
  res.json({ tenant: updated })
})

/** POST /api/admin/tenants/:id/license  body: { licenseKey, email? } */
router.post('/tenants/:id/license', (req: Request, res: Response) => {
  const id = Number(req.params.id)
  const { licenseKey, email } = req.body as { licenseKey?: string; email?: string }
  if (!licenseKey) { res.status(400).json({ error: 'licenseKey 必填' }); return }
  try {
    const sub = activateLicense(licenseKey, id, email)
    res.json({ ok: true, subscription: sub, plan: getPlan(id) })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// ---- Users ----------------------------------------------------------------

router.get('/users', (req: Request, res: Response) => {
  const tid = req.query.tenantId ? Number(req.query.tenantId) : undefined
  const users = listUsers(tid !== undefined ? { tenantId: tid } : {}).map(u => ({
    ...toSafeUser(u),
    tenantName: getTenant(u.tenant_id)?.name ?? null,
  }))
  res.json({ users })
})

router.post('/users', (req: Request, res: Response) => {
  const body = req.body as {
    tenantId?: number; username?: string; password?: string; email?: string;
    displayName?: string; role?: 'admin' | 'user'
  }
  if (!body.tenantId || !body.username || !body.password) {
    res.status(400).json({ error: 'tenantId / username / password 必填' }); return
  }
  if (findUserByUsername(body.username)) {
    res.status(400).json({ error: '用户名已被占用' }); return
  }
  if (!getTenant(body.tenantId)) {
    res.status(400).json({ error: '租户不存在' }); return
  }
  try {
    const user = createUser({
      tenantId: body.tenantId,
      username: body.username,
      password: body.password,
      email: body.email || null,
      displayName: body.displayName || null,
      role: body.role ?? 'user',
    })
    res.json({ user: toSafeUser(user) })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

router.patch('/users/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id)
  const patch = req.body as Record<string, unknown>
  const allowed: Record<string, unknown> = {}
  for (const k of ['email', 'display_name', 'role', 'status']) {
    if (k in patch) allowed[k] = patch[k]
  }
  const updated = updateUser(id, allowed as Parameters<typeof updateUser>[1])
  if (!updated) { res.status(404).json({ error: '用户不存在' }); return }
  // Revoke sessions if disabling or changing role downward.
  if (patch.status === 'disabled' || patch.role === 'user') {
    deleteAllUserSessions(id)
  }
  res.json({ user: toSafeUser(updated) })
})

router.post('/users/:id/password', (req: Request, res: Response) => {
  const id = Number(req.params.id)
  const { newPassword } = req.body as { newPassword?: string }
  if (!newPassword) { res.status(400).json({ error: 'newPassword 必填' }); return }
  const user = getUser(id)
  if (!user) { res.status(404).json({ error: '用户不存在' }); return }
  try {
    updateUserPassword(id, newPassword)
    // Force logout everywhere after a password reset.
    deleteAllUserSessions(id)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

router.delete('/users/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (id === req.auth!.user.id) {
    res.status(400).json({ error: '不能删除当前登录的管理员账号' }); return
  }
  deleteUser(id)
  res.json({ ok: true })
})

// ---- Usage dashboard ------------------------------------------------------

router.get('/usage', (_req: Request, res: Response) => {
  const rows = listTenants().map(t => {
    const snap = getUsageSnapshot(t.id)
    const plan = getPlan(t.id)
    return {
      tenantId: t.id,
      tenantName: t.name,
      plan: t.plan,
      status: t.status,
      expiresAt: t.expires_at,
      usage: snap,
      limits: plan.limits,
    }
  })
  res.json({ tenants: rows })
})

// ---- Skill management -----------------------------------------------------
// Skills are installed/enabled globally for the instance. Each tenant sees
// the same set (gated by plan.limits.skills). Admin can toggle a skill off
// globally to hide it from everyone.

router.get('/skills', (_req: Request, res: Response) => {
  const skills = discoverSkills()
  const config = loadConfig()
  const disabled = config.skills?.disabled ?? []
  // Build the registry to count loaded tools per package (falls back to 0
  // if the skill failed to load or is currently disabled).
  let toolsBySkill = new Map<string, number>()
  try {
    const reg = buildToolRegistry()
    for (const t of reg.snapshot.tools) {
      toolsBySkill.set(t.skillPackageName, (toolsBySkill.get(t.skillPackageName) ?? 0) + 1)
    }
  } catch { /* non-fatal */ }
  res.json({
    skills: skills.map(s => ({
      packageName: s.packageName,
      displayName: s.displayName,
      description: s.description,
      version: s.version,
      toolCount: toolsBySkill.get(s.packageName) ?? 0,
      enabled: !disabled.includes(s.packageName),
    })),
  })
})

router.post('/skills/:pkg/toggle', (req: Request, res: Response) => {
  const pkg = String(req.params.pkg)
  const { enabled } = req.body as { enabled?: boolean }
  const config = loadConfig()
  const disabled = new Set<string>(config.skills?.disabled ?? [])
  if (enabled) disabled.delete(pkg); else disabled.add(pkg)
  saveConfig({
    ...config,
    skills: { ...(config.skills ?? { disabled: [], configs: {} }), disabled: Array.from(disabled) },
  })
  res.json({ ok: true, enabled: !disabled.has(pkg) })
})

// ---- Plan capabilities (feature-flag matrix) ------------------------------
// Admin can toggle booleans controlling what each plan's tenants may do:
// data import, API-key config, page visibility, per-plan skill allowlist.

router.get('/plan-capabilities', (_req: Request, res: Response) => {
  res.json({
    plans: Object.values(PLANS).map(p => ({
      id: p.id,
      name: p.name,
      tagline: p.tagline,
      pricing: p.pricing,
      limits: p.limits,
    })),
    capabilities: getAllPlanCapabilities(),
  })
})

router.put('/plan-capabilities/:plan', (req: Request, res: Response) => {
  const plan = req.params.plan as PlanId
  if (!PLANS[plan]) { res.status(400).json({ error: '未知方案' }); return }
  const body = req.body as {
    knowledgeImport?: boolean
    apiKeyConfig?: boolean
    pages?: Partial<{ knowledge: boolean; skills: boolean; pricing: boolean; usage: boolean; admin: boolean }>
    skillAllowlist?: string[] | '*'
  }
  try {
    setPlanCapabilities(plan, body)
    res.json({ ok: true, capabilities: getPlanCapabilities(plan) })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// ---- Payment orders --------------------------------------------------------
// Users initiate a payment via /api/billing/orders; admin lists / confirms /
// cancels them here.  Confirmation issues a license key and activates the
// tenant's plan.

router.get('/payments', (req: Request, res: Response) => {
  // Age out stale pending orders before listing.
  expirePendingOrders()
  const status = req.query.status ? String(req.query.status) as PaymentStatus : undefined
  const tenantId = req.query.tenantId ? Number(req.query.tenantId) : undefined
  const orders = listOrders({ status, tenantId, limit: 500 }).map(o => ({
    ...o,
    tenantName: getTenant(o.tenant_id)?.name ?? null,
    userName: o.user_id != null ? (getUser(o.user_id)?.username ?? null) : null,
  }))
  res.json({ orders })
})

router.post('/payments/:id/confirm', (req: Request, res: Response) => {
  const id = String(req.params.id)
  const { method } = req.body as { method?: 'wechat' | 'alipay' | 'bank' | 'manual' }
  try {
    const order = confirmOrder(id, req.auth!.user.id, method)
    res.json({ ok: true, order })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

router.post('/payments/:id/cancel', (req: Request, res: Response) => {
  const id = String(req.params.id)
  const { reason } = req.body as { reason?: string }
  try {
    const order = cancelOrder(id, reason)
    res.json({ ok: true, order })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

/** Admin creates an order directly on behalf of a tenant (e.g. offline sale). */
router.post('/payments', (req: Request, res: Response) => {
  const { tenantId, plan, cycle, method, notes } = req.body as {
    tenantId?: number; plan?: PlanId; cycle?: 'monthly' | 'yearly';
    method?: 'wechat' | 'alipay' | 'bank' | 'manual'; notes?: string
  }
  if (!tenantId || !plan || !cycle) {
    res.status(400).json({ error: 'tenantId / plan / cycle 必填' }); return
  }
  if (!getTenant(tenantId)) { res.status(400).json({ error: '租户不存在' }); return }
  try {
    const order = createOrder({
      tenantId, userId: req.auth!.user.id, plan, cycle, method, notes,
    })
    res.json({ order })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// ---- Payment gateway config (QR code URLs, contact info) ------------------

router.get('/payment-gateway', (_req: Request, res: Response) => {
  const cfg = loadConfig()
  res.json({ gateway: cfg.paymentGateway ?? {} })
})

router.put('/payment-gateway', (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>
  const cfg = loadConfig()
  const allowed: Record<string, unknown> = {}
  for (const k of ['wechatQrUrl', 'alipayQrUrl', 'bankAccount', 'contactPhone', 'contactEmail', 'instructions']) {
    if (k in body) allowed[k] = body[k]
  }
  saveConfig({ ...cfg, paymentGateway: { ...(cfg.paymentGateway ?? {}), ...allowed } })
  res.json({ ok: true, gateway: loadConfig().paymentGateway ?? {} })
})

export default router
