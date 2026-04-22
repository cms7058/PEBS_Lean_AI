/**
 * Password hashing using Node's built-in scrypt.
 *
 * Hash format (stored in users.password_hash):
 *   scrypt$N=16384,r=8,p=1$<salt_hex>$<derived_hex>
 *
 * We pin scrypt parameters explicitly so they travel with the hash — future
 * rotations can up N without invalidating existing passwords.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'

const N = 16384       // CPU/memory cost
const r = 8           // block size
const p = 1           // parallelism
const KEY_LEN = 64    // bytes
const SALT_LEN = 16   // bytes

export function hashPassword(plain: string): string {
  if (!plain || plain.length < 6) {
    throw new Error('Password must be at least 6 characters')
  }
  const salt = randomBytes(SALT_LEN)
  const derived = scryptSync(plain, salt, KEY_LEN, { N, r, p })
  return `scrypt$N=${N},r=${r},p=${p}$${salt.toString('hex')}$${derived.toString('hex')}`
}

export function verifyPassword(plain: string, stored: string): boolean {
  try {
    const parts = stored.split('$')
    if (parts.length !== 4 || parts[0] !== 'scrypt') return false

    const params = Object.fromEntries(parts[1].split(',').map(s => {
      const [k, v] = s.split('=')
      return [k, Number(v)]
    })) as { N: number; r: number; p: number }

    const salt = Buffer.from(parts[2], 'hex')
    const expected = Buffer.from(parts[3], 'hex')
    const derived = scryptSync(plain, salt, expected.length, {
      N: params.N, r: params.r, p: params.p,
    })
    if (derived.length !== expected.length) return false
    return timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}
