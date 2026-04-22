/**
 * Server-side session store.
 *
 * Token: 32 random bytes, hex-encoded (64 chars). Stored both in the DB
 * (primary key) and in the client's httpOnly cookie. The DB is the source of
 * truth — we can revoke a session instantly by deleting the row.
 *
 * Rotation: every authenticated request calls `touchSession` to bump
 * `last_used_at` so idle sessions can be cleaned up without rotating tokens.
 */
import { randomBytes } from 'crypto'
import { getDb } from '../storage/db'
import type { UserRow } from './users'

export interface SessionRow {
  token: string
  user_id: number
  created_at: number
  expires_at: number
  last_used_at: number
  user_agent: string | null
  ip: string | null
}

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000  // 30 days

export function generateToken(): string {
  return randomBytes(32).toString('hex')
}

export function createSession(input: {
  userId: number
  ttlMs?: number
  userAgent?: string | null
  ip?: string | null
}): SessionRow {
  const now = Date.now()
  const token = generateToken()
  const expiresAt = now + (input.ttlMs ?? DEFAULT_TTL_MS)
  getDb().prepare(`
    INSERT INTO sessions (token, user_id, created_at, expires_at, last_used_at, user_agent, ip)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(token, input.userId, now, expiresAt, now, input.userAgent ?? null, input.ip ?? null)
  return { token, user_id: input.userId, created_at: now, expires_at: expiresAt, last_used_at: now,
           user_agent: input.userAgent ?? null, ip: input.ip ?? null }
}

export function findSession(token: string): SessionRow | undefined {
  if (!token) return undefined
  const row = getDb().prepare('SELECT * FROM sessions WHERE token = ?')
    .get(token) as SessionRow | undefined
  if (!row) return undefined
  if (row.expires_at < Date.now()) {
    deleteSession(token)
    return undefined
  }
  return row
}

export function touchSession(token: string): void {
  getDb().prepare('UPDATE sessions SET last_used_at = ? WHERE token = ?')
    .run(Date.now(), token)
}

export function deleteSession(token: string): void {
  getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

export function deleteAllUserSessions(userId: number): void {
  getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
}

export function purgeExpiredSessions(): number {
  const result = getDb().prepare('DELETE FROM sessions WHERE expires_at < ?')
    .run(Date.now())
  return result.changes
}

/** Find the user behind a session token (joined lookup, one query). */
export function getUserBySession(token: string): UserRow | undefined {
  if (!token) return undefined
  const row = getDb().prepare(`
    SELECT u.* FROM users u
      JOIN sessions s ON s.user_id = u.id
     WHERE s.token = ? AND s.expires_at > ?
  `).get(token, Date.now()) as UserRow | undefined
  return row
}
