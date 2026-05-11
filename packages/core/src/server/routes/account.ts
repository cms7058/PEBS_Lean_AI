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
  upsertInviteAccount,
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
const INVITE_VERIFY_URL = 'https://fc-mp-ad17509f-ebae-4693-974b-769771dd93c5.next.bspapp.com/pebs-copilot-api'
const INVITE_TRIAL_DAYS = 14

// Allow disabling self-registration via env (enterprise deployments that want
// admin-only account creation). Default: open registration.
function registrationAllowed(): boolean {
  return process.env.LEANAI_DISABLE_REGISTRATION !== '1'
}

function inviteProductKey(): string {
  return (process.env.INVITE_PRODUCT_KEY || 'lean-copilot').trim().toLowerCase()
}

function inviteApply(res: Response, message = '邀请码尚未激活，请先申请邀请码'): void {
  res.status(403).json({
    error: message,
    action: 'apply_invite',
    status: 'inactive',
  })
}

async function verifyInvite(email: string, inviteCode: string): Promise<void> {
  const url = process.env.INVITE_VERIFY_URL || INVITE_VERIFY_URL
  if (!url) return

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (process.env.INVITE_APP_ID) headers['X-Invite-App-Id'] = process.env.INVITE_APP_ID
  if (process.env.INVITE_APP_SECRET) headers['X-Invite-App-Secret'] = process.env.INVITE_APP_SECRET

  let res: globalThis.Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'loginWithInvite',
        productKey: inviteProductKey(),
        email,
        inviteCode,
      }),
    })
  } catch (err) {
    throw new Error('邀请码验证服务暂时不可用')
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || '邮箱或邀请码验证失败')
  }

  const data = await res.json().catch(() => ({})) as {
    code?: number | string
    ok?: boolean
    success?: boolean
    valid?: boolean
    access?: boolean
    status?: string
    message?: string
    data?: { status?: string; message?: string }
  }
  const message = data.message || data.data?.message || '邮箱或邀请码验证失败'
  const status = String(data.status || data.data?.status || '').toLowerCase()
  const successCodes = new Set<unknown>([0, 200, '0', '200', 'OK', 'ok', 'SUCCESS', 'success'])

  if (message === '缺少 action' || message === '未知 action' || (status && status !== 'active')) {
    const err = new Error(message || '邀请码尚未激活，请先申请邀请码')
    ;(err as Error & { action?: string }).action = 'apply_invite'
    throw err
  }
  if (
    data.ok === false ||
    data.success === false ||
    data.valid === false ||
    data.access === false ||
    (data.code !== undefined && !successCodes.has(data.code))
  ) {
    throw new Error(message)
  }
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

/** POST /api/account/internal-login — beta invite login via PEBS cloud function. */
router.post('/internal-login', async (req: Request, res: Response) => {
  const body = req.body as { email?: string; invite_code?: string; inviteCode?: string }
  const email = String(body.email || '').trim().toLowerCase()
  const inviteCode = String(body.invite_code || body.inviteCode || '').trim()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: '请输入有效邮箱' }); return
  }
  if (!inviteCode) {
    res.status(400).json({ error: '请输入邀请码' }); return
  }

  try {
    await verifyInvite(email, inviteCode)
    const { user, tenant } = upsertInviteAccount({
      email,
      inviteCode,
      durationDays: INVITE_TRIAL_DAYS,
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
    const action = (err as Error & { action?: string }).action
    const msg = err instanceof Error ? err.message : String(err)
    if (action === 'apply_invite') {
      inviteApply(res, msg)
      return
    }
    res.status(msg.includes('暂时不可用') ? 502 : 401).json({ error: msg })
  }
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
