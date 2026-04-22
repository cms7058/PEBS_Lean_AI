/**
 * User account routes — login / register / logout / me.
 *
 * Mounted at /api/account. Distinct from /api/auth (which handles LLM
 * provider OAuth) to avoid tangling two unrelated "auth" domains.
 *
 * Session transport: httpOnly cookie `leanai_session` (set by login/register,
 * cleared by logout). See src/auth/middleware.ts for the shared helpers.
 */
import { Router, type Request, type Response } from 'express'
import {
  registerAccount,
  authenticate,
  touchUserLogin,
  updateUserPassword,
  toSafeUser,
  getTenant,
} from '../../auth/users'
import { verifyPassword } from '../../auth/password'
import { getUser } from '../../auth/users'
import {
  createSession,
  deleteSession,
} from '../../auth/sessions'
import {
  buildSessionCookie,
  buildClearSessionCookie,
  readSessionCookie,
  requireAuth,
} from '../../auth/middleware'
import { getPlanCapabilities } from '../../billing/capabilities'
import { getSubscription, getTrialDaysRemaining, isTrialExpired } from '../../billing/manager'
import { getLifetimePaidByTenant } from '../../billing/payments'
import { PLANS } from '../../billing/plans'

const router = Router()

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000  // 30 days

// Allow disabling self-registration via env (enterprise deployments that want
// admin-only account creation). Default: open registration.
function registrationAllowed(): boolean {
  return process.env.LEANAI_DISABLE_REGISTRATION !== '1'
}

/** POST /api/account/register — create tenant + user + session. */
router.post('/register', (req: Request, res: Response) => {
  if (!registrationAllowed()) {
    res.status(403).json({ error: '注册已关闭，请联系管理员开通账号' })
    return
  }
  const body = req.body as {
    username?: string
    password?: string
    email?: string
    displayName?: string
    tenantName?: string
  }
  if (!body.username || !body.password) {
    res.status(400).json({ error: '用户名和密码必填' }); return
  }
  try {
    const { user, tenant } = registerAccount({
      username: body.username,
      password: body.password,
      email: body.email || null,
      displayName: body.displayName || null,
      tenantName: body.tenantName,
    })
    const session = createSession({
      userId: user.id,
      ttlMs: SESSION_TTL_MS,
      userAgent: req.get('user-agent') ?? null,
      ip: req.ip ?? null,
    })
    touchUserLogin(user.id)
    res.setHeader('Set-Cookie', buildSessionCookie(session.token, SESSION_TTL_MS))
    res.json({ user: toSafeUser(user), tenant })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(400).json({ error: msg })
  }
})

/** POST /api/account/login — verify creds, issue session. */
router.post('/login', (req: Request, res: Response) => {
  const { identifier, password } = req.body as { identifier?: string; password?: string }
  if (!identifier || !password) {
    res.status(400).json({ error: '用户名/邮箱和密码必填' }); return
  }
  const user = authenticate(identifier, password)
  if (!user) {
    res.status(401).json({ error: '用户名或密码错误' }); return
  }
  const tenant = getTenant(user.tenant_id)
  if (!tenant) {
    res.status(500).json({ error: '账号所属工作区不存在' }); return
  }
  if (tenant.status !== 'active') {
    res.status(403).json({ error: '工作区已暂停，请联系管理员' }); return
  }
  const session = createSession({
    userId: user.id,
    ttlMs: SESSION_TTL_MS,
    userAgent: req.get('user-agent') ?? null,
    ip: req.ip ?? null,
  })
  touchUserLogin(user.id)
  res.setHeader('Set-Cookie', buildSessionCookie(session.token, SESSION_TTL_MS))
  res.json({ user: toSafeUser(user), tenant })
})

/** POST /api/account/logout — destroy session + clear cookie. */
router.post('/logout', (req: Request, res: Response) => {
  const token = readSessionCookie(req)
  if (token) deleteSession(token)
  res.setHeader('Set-Cookie', buildClearSessionCookie())
  res.json({ ok: true })
})

/** GET /api/account/me — current user + tenant + effective capabilities. */
router.get('/me', requireAuth, (req: Request, res: Response) => {
  const tenant = req.auth!.tenant
  const sub = getSubscription(tenant.id)
  const capabilities = getPlanCapabilities(sub.plan)
  const plan = PLANS[sub.plan]
  const paid = getLifetimePaidByTenant(tenant.id)
  res.json({
    user: req.auth!.safeUser,
    tenant,
    registrationAllowed: registrationAllowed(),
    capabilities,
    subscription: {
      plan: sub.plan,
      planName: plan.name,
      startedAt: sub.started_at,
      expiresAt: sub.expires_at,
      daysRemaining: getTrialDaysRemaining(sub),
      expired: isTrialExpired(sub),
      seats: sub.seats,
      licenseKey: sub.license_key,
      cycle: sub.billing_cycle,
      paidCents: paid.amountCents,
      paidOrders: paid.orders,
      currency: paid.currency,
    },
  })
})

/** POST /api/account/password — change own password. */
router.post('/password', requireAuth, (req: Request, res: Response) => {
  const { oldPassword, newPassword } = req.body as { oldPassword?: string; newPassword?: string }
  if (!oldPassword || !newPassword) {
    res.status(400).json({ error: '旧密码和新密码必填' }); return
  }
  const user = getUser(req.auth!.user.id)
  if (!user || !verifyPassword(oldPassword, user.password_hash)) {
    res.status(401).json({ error: '旧密码不正确' }); return
  }
  try {
    updateUserPassword(user.id, newPassword)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

/** GET /api/account/config — public config snapshot used by the login page. */
router.get('/config', (_req: Request, res: Response) => {
  res.json({ registrationAllowed: registrationAllowed() })
})

export default router
