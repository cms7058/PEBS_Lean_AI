/**
 * User + tenant CRUD.
 *
 * Registration model:
 *   - Each new self-registered user gets their OWN tenant (workspace).
 *   - Admins can later add additional users INTO an existing tenant via
 *     /api/admin/users, but the public /register endpoint always spawns a
 *     fresh tenant so there's zero blast-radius between signups.
 *   - tenant_id = 1 is reserved for the "default tenant" (legacy/unscoped
 *     data) and is never assigned to self-registered users.
 */
import { getDb } from '../storage/db'
import { hashPassword, verifyPassword } from './password'
import crypto from 'crypto'

export interface TenantRow {
  id: number
  name: string
  status: 'active' | 'suspended'
  plan: 'free' | 'personal' | 'enterprise'
  expires_at: number | null
  seats: number
  license_key: string | null
  notes: string | null
  created_at: number
  updated_at: number
}

export interface UserRow {
  id: number
  tenant_id: number
  username: string
  email: string | null
  display_name: string | null
  password_hash: string
  role: 'admin' | 'user'
  status: 'active' | 'disabled'
  created_at: number
  last_login_at: number | null
}

export type SafeUser = Omit<UserRow, 'password_hash'>

export function toSafeUser(u: UserRow): SafeUser {
  const { password_hash: _ignored, ...safe } = u
  return safe
}

// ---- Tenant ----

export function createTenant(input: {
  name: string
  plan?: TenantRow['plan']
  expiresAt?: number | null
  seats?: number
  notes?: string | null
}): TenantRow {
  const now = Date.now()
  const plan = input.plan ?? 'free'
  // Free trial default: 14 days.
  const expiresAt = input.expiresAt === undefined
    ? (plan === 'free' ? now + 14 * 24 * 60 * 60 * 1000 : null)
    : input.expiresAt
  const info = getDb().prepare(`
    INSERT INTO tenants (name, status, plan, expires_at, seats, license_key, notes, created_at, updated_at)
    VALUES (?, 'active', ?, ?, ?, NULL, ?, ?, ?)
  `).run(input.name, plan, expiresAt, input.seats ?? 1, input.notes ?? null, now, now)
  return getTenant(Number(info.lastInsertRowid))!
}

export function getTenant(id: number): TenantRow | undefined {
  return getDb().prepare('SELECT * FROM tenants WHERE id = ?').get(id) as TenantRow | undefined
}

export function listTenants(): TenantRow[] {
  return getDb().prepare('SELECT * FROM tenants ORDER BY id ASC').all() as TenantRow[]
}

export function updateTenant(id: number, patch: Partial<Pick<TenantRow,
  'name' | 'status' | 'plan' | 'expires_at' | 'seats' | 'license_key' | 'notes'
>>): TenantRow | undefined {
  const current = getTenant(id)
  if (!current) return undefined
  const next = { ...current, ...patch, updated_at: Date.now() }
  getDb().prepare(`
    UPDATE tenants
       SET name = ?, status = ?, plan = ?, expires_at = ?, seats = ?,
           license_key = ?, notes = ?, updated_at = ?
     WHERE id = ?
  `).run(next.name, next.status, next.plan, next.expires_at, next.seats,
    next.license_key, next.notes, next.updated_at, id)
  return getTenant(id)
}

export function deleteTenant(id: number): void {
  if (id === 1) throw new Error('Cannot delete default tenant (id=1)')
  getDb().prepare('DELETE FROM tenants WHERE id = ?').run(id)
}

// ---- User ----

export interface CreateUserInput {
  tenantId: number
  username: string
  email?: string | null
  displayName?: string | null
  password: string
  role?: 'admin' | 'user'
}

export function createUser(input: CreateUserInput): UserRow {
  const now = Date.now()
  const hash = hashPassword(input.password)
  const info = getDb().prepare(`
    INSERT INTO users (tenant_id, username, email, display_name, password_hash, role, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
  `).run(
    input.tenantId, input.username.toLowerCase().trim(),
    input.email?.toLowerCase().trim() || null,
    input.displayName ?? input.username,
    hash, input.role ?? 'user', now,
  )
  return getUser(Number(info.lastInsertRowid))!
}

/**
 * Register a new self-service account. Creates a fresh tenant and one user
 * inside it. Returns both rows. The first user of a tenant is always the
 * tenant-local admin (role='user' — platform admin is separate).
 */
export function registerAccount(input: {
  username: string
  password: string
  email?: string | null
  displayName?: string | null
  tenantName?: string
}): { user: UserRow; tenant: TenantRow } {
  const db = getDb()
  const username = input.username.toLowerCase().trim()
  if (!/^[a-z0-9_.-]{3,32}$/.test(username)) {
    throw new Error('Username must be 3-32 chars: letters, digits, . _ -')
  }
  const existing = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)
  if (existing) throw new Error('Username already taken')
  if (input.email) {
    const emailExists = db.prepare('SELECT 1 FROM users WHERE email = ?').get(input.email.toLowerCase().trim())
    if (emailExists) throw new Error('Email already registered')
  }

  const tenant = createTenant({
    name: input.tenantName || `${input.displayName || input.username} 的工作区`,
    plan: 'free',
  })
  const user = createUser({
    tenantId: tenant.id,
    username,
    email: input.email ?? null,
    displayName: input.displayName ?? null,
    password: input.password,
    role: 'user',
  })
  return { user, tenant }
}

export function upsertInviteAccount(input: {
  email: string
  inviteCode: string
  durationDays?: number
}): { user: UserRow; tenant: TenantRow } {
  const db = getDb()
  const email = input.email.toLowerCase().trim()
  const digest = crypto.createHash('sha1').update(email).digest('hex')
  const username = `beta_${digest.slice(0, 20)}`
  const displayName = email.split('@')[0] || '内测用户'
  const now = Date.now()
  const expiresAt = now + (input.durationDays ?? 14) * 24 * 60 * 60 * 1000
  const password = `internal:${email}:${input.inviteCode}`
  const notes = JSON.stringify({
    source: 'internal-beta',
    product: 'lean-copilot',
    email,
    inviteCode: input.inviteCode,
  })

  const existingUser = findUserByUsername(username) || findUserByEmail(email)
  let tenant: TenantRow
  let user: UserRow

  const tx = db.transaction(() => {
    if (existingUser) {
      tenant = getTenant(existingUser.tenant_id) || createTenant({
        name: `${displayName} 的 Lean 内测企业空间`,
        plan: 'enterprise',
        expiresAt,
        seats: 10,
        notes,
      })
      tenant = updateTenant(tenant.id, {
        name: tenant.name || `${displayName} 的 Lean 内测企业空间`,
        status: 'active',
        plan: 'enterprise',
        expires_at: expiresAt,
        seats: Math.max(tenant.seats || 1, 10),
        notes,
      })!
      db.prepare(`
        UPDATE users
           SET tenant_id = ?, username = ?, email = ?, display_name = ?,
               password_hash = ?, role = 'user', status = 'active'
         WHERE id = ?
      `).run(tenant.id, username, email, existingUser.display_name || displayName, hashPassword(password), existingUser.id)
      user = getUser(existingUser.id)!
      return
    }

    tenant = createTenant({
      name: `${displayName} 的 Lean 内测企业空间`,
      plan: 'enterprise',
      expiresAt,
      seats: 10,
      notes,
    })
    user = createUser({
      tenantId: tenant.id,
      username,
      email,
      displayName,
      password,
      role: 'user',
    })
  })
  tx()

  return { user: user!, tenant: tenant! }
}

export function getUser(id: number): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
}

export function findUserByUsername(username: string): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE username = ?')
    .get(username.toLowerCase().trim()) as UserRow | undefined
}

export function findUserByEmail(email: string): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE email = ?')
    .get(email.toLowerCase().trim()) as UserRow | undefined
}

export function listUsers(opts: { tenantId?: number } = {}): UserRow[] {
  if (opts.tenantId !== undefined) {
    return getDb().prepare('SELECT * FROM users WHERE tenant_id = ? ORDER BY id ASC')
      .all(opts.tenantId) as UserRow[]
  }
  return getDb().prepare('SELECT * FROM users ORDER BY id ASC').all() as UserRow[]
}

export function updateUser(id: number, patch: Partial<Pick<UserRow,
  'email' | 'display_name' | 'role' | 'status'
>>): UserRow | undefined {
  const cur = getUser(id)
  if (!cur) return undefined
  const next = { ...cur, ...patch }
  getDb().prepare(`
    UPDATE users SET email = ?, display_name = ?, role = ?, status = ? WHERE id = ?
  `).run(next.email, next.display_name, next.role, next.status, id)
  return getUser(id)
}

export function updateUserPassword(id: number, newPassword: string): void {
  const hash = hashPassword(newPassword)
  getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id)
}

export function touchUserLogin(id: number): void {
  getDb().prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(Date.now(), id)
}

export function deleteUser(id: number): void {
  getDb().prepare('DELETE FROM users WHERE id = ?').run(id)
}

/**
 * Authenticate with username (or email) + password.
 * Returns the user on success, undefined on any failure (bad creds, disabled,
 * tenant suspended/expired — all collapsed to "undefined" to avoid leaking
 * which axis failed).
 */
export function authenticate(identifier: string, password: string): UserRow | undefined {
  const trimmed = identifier.trim().toLowerCase()
  const user = trimmed.includes('@') ? findUserByEmail(trimmed) : findUserByUsername(trimmed)
  if (!user) return undefined
  if (user.status !== 'active') return undefined
  if (!verifyPassword(password, user.password_hash)) return undefined
  return user
}
