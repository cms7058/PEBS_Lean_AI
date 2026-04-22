/**
 * Express middleware for authentication & authorization.
 *
 * Cookie name: `leanai_session`. httpOnly, SameSite=Lax, Secure when behind
 * a TLS proxy (respecting `x-forwarded-proto` via trust proxy in server/index).
 *
 * Two guards:
 *   - requireAuth — any authenticated active user; 401 otherwise
 *   - requireAdmin — platform admin only (role === 'admin'); 403 if wrong role
 *
 * Both attach `req.auth = { user, tenant, sessionToken }` on success.
 */
import type { Request, Response, NextFunction } from 'express'
import { findSession, touchSession, getUserBySession } from './sessions'
import { getTenant, updateTenant, type TenantRow, type UserRow, toSafeUser, type SafeUser } from './users'

export const SESSION_COOKIE = 'leanai_session'

export interface AuthContext {
  user: UserRow
  tenant: TenantRow
  sessionToken: string
  safeUser: SafeUser
}

// Augment Express Request with auth field.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext
    }
  }
}

/**
 * Parse the session cookie from the `Cookie:` header manually. We avoid
 * pulling in cookie-parser just to extract one named cookie — the parsing
 * rules here are deliberately lax (tolerates whitespace, no decoding needed
 * since tokens are hex).
 */
export function readSessionCookie(req: Request): string | null {
  const header = req.headers.cookie
  if (!header) return null
  const parts = header.split(';')
  for (const p of parts) {
    const idx = p.indexOf('=')
    if (idx < 0) continue
    const name = p.slice(0, idx).trim()
    if (name === SESSION_COOKIE) {
      return p.slice(idx + 1).trim()
    }
  }
  return null
}

/** Build the Set-Cookie value for a session token. */
export function buildSessionCookie(token: string, maxAgeMs: number): string {
  const maxAgeSec = Math.floor(maxAgeMs / 1000)
  // Secure flag: enabled if LEANAI_COOKIE_SECURE=1 (behind TLS proxy).
  const secure = process.env.LEANAI_COOKIE_SECURE === '1' ? '; Secure' : ''
  return `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`
}

export function buildClearSessionCookie(): string {
  const secure = process.env.LEANAI_COOKIE_SECURE === '1' ? '; Secure' : ''
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`
}

/** Attach req.auth if a valid session exists; never blocks the request. */
export function attachAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = readSessionCookie(req)
  if (!token) { next(); return }
  const session = findSession(token)
  if (!session) { next(); return }
  const user = getUserBySession(token)
  if (!user || user.status !== 'active') { next(); return }
  let tenant = getTenant(user.tenant_id)
  if (!tenant) { next(); return }

  // Auto-suspend tenants whose subscription has expired (any plan that carries
  // an expires_at timestamp — free trial AND paid plans alike). Admin tenants
  // with no expiry sail through. The admin can resume the tenant after renewal.
  if (tenant.status === 'active' && tenant.expires_at != null && tenant.expires_at < Date.now()) {
    try {
      updateTenant(tenant.id, { status: 'suspended' })
      const refreshed = getTenant(tenant.id)
      if (refreshed) tenant = refreshed
    } catch { /* non-fatal; treat as suspended below regardless */ }
  }

  // Refresh last_used_at (cheap; one UPDATE per request).
  touchSession(token)

  req.auth = { user, tenant, sessionToken: token, safeUser: toSafeUser(user) }
  next()
}

/** 401 if no authenticated user is present. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHENTICATED' })
    return
  }
  // Hard-stop if tenant is suspended or expired — even admins need a working
  // tenant to actually do anything productive (except admin endpoints, which
  // operate on OTHER tenants and are allowed to pass through regardless; see
  // requireAdmin below which deliberately does NOT enforce tenant status).
  if (req.auth.tenant.status !== 'active') {
    res.status(403).json({ error: 'Tenant is suspended', code: 'TENANT_SUSPENDED' })
    return
  }
  next()
}

/** 401/403 if not a platform admin. Bypasses tenant status check. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHENTICATED' })
    return
  }
  if (req.auth.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required', code: 'NOT_ADMIN' })
    return
  }
  next()
}
