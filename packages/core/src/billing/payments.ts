/**
 * Payment order manager — user initiates a subscription purchase, gets a QR
 * code to scan.  After scanning and paying via WeChat Pay / Alipay, the admin
 * manually confirms the order in the admin console, which issues a license
 * key and upgrades the tenant's plan.
 *
 * Flow:
 *   1. User (or admin) calls createOrder(tenantId, plan, cycle) → row with
 *      status='pending' + a 30-min expiry.  QR URL comes from config.paymentGateway.
 *   2. User scans QR, pays offline.
 *   3. Admin opens console → 付费订单 tab → sees the pending order → clicks
 *      「确认收款」→ confirmOrder(orderId, adminUserId) flips status to 'paid',
 *      generates a license key, and activates it against the tenant.
 *   4. cancelOrder(orderId) / expirePendingOrders() clean up the rest.
 */
import crypto from 'crypto'
import { getDb } from '../storage/db'
import { PLANS, type PlanId } from './plans'
import { activateLicense, generateLicense } from './manager'

export type PaymentCycle = 'monthly' | 'yearly'
export type PaymentMethod = 'wechat' | 'alipay' | 'bank' | 'manual'
export type PaymentStatus = 'pending' | 'paid' | 'canceled' | 'expired'

export interface PaymentOrderRow {
  id: string
  tenant_id: number
  user_id: number | null
  plan: PlanId
  cycle: PaymentCycle
  amount_cents: number
  currency: string
  status: PaymentStatus
  method: PaymentMethod | null
  license_key: string | null
  notes: string | null
  created_at: number
  paid_at: number | null
  confirmed_at: number | null
  confirmed_by: number | null
  expires_at: number | null
}

const ORDER_TTL_MS = 30 * 60 * 1000   // 30 min pending window

/** Compute the price (in cents) for a given plan × cycle. */
export function priceFor(plan: PlanId, cycle: PaymentCycle): number {
  const p = PLANS[plan].pricing
  const cents = cycle === 'yearly' ? p.yearlyCents : p.monthlyCents
  if (cents == null || cents === 0) throw new Error(`方案 ${plan} 为免费或未开放付费`)
  return cents
}

/** Create a pending payment order.  Returns the row; caller decorates with QR URL. */
export function createOrder(params: {
  tenantId: number
  userId: number | null
  plan: PlanId
  cycle: PaymentCycle
  method?: PaymentMethod
  notes?: string
}): PaymentOrderRow {
  if (params.plan === 'free') throw new Error('免费方案无需付费')
  const amount = priceFor(params.plan, params.cycle)
  const id = `PO-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
  const now = Date.now()
  const expiresAt = now + ORDER_TTL_MS
  const currency = PLANS[params.plan].pricing.currency
  getDb().prepare(`
    INSERT INTO payment_orders
      (id, tenant_id, user_id, plan, cycle, amount_cents, currency,
       status, method, license_key, notes, created_at, paid_at,
       confirmed_at, confirmed_by, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, ?, ?, NULL, NULL, NULL, ?)
  `).run(
    id, params.tenantId, params.userId, params.plan, params.cycle,
    amount, currency, params.method ?? null, params.notes ?? null, now, expiresAt,
  )
  const row = getOrder(id)
  if (!row) throw new Error('订单创建失败')
  return row
}

export function getOrder(id: string): PaymentOrderRow | undefined {
  return getDb().prepare('SELECT * FROM payment_orders WHERE id = ?').get(id) as PaymentOrderRow | undefined
}

export function listOrders(filter: {
  tenantId?: number
  status?: PaymentStatus
  limit?: number
} = {}): PaymentOrderRow[] {
  const where: string[] = []
  const args: (string | number)[] = []
  if (filter.tenantId != null) { where.push('tenant_id = ?'); args.push(filter.tenantId) }
  if (filter.status != null)   { where.push('status = ?');    args.push(filter.status) }
  const sql = `SELECT * FROM payment_orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`
  args.push(filter.limit ?? 100)
  return getDb().prepare(sql).all(...args) as PaymentOrderRow[]
}

/** Admin confirms payment received → issue license + activate. */
export function confirmOrder(id: string, adminUserId: number, method?: PaymentMethod): PaymentOrderRow {
  const o = getOrder(id)
  if (!o) throw new Error('订单不存在')
  if (o.status === 'paid') return o
  if (o.status !== 'pending') throw new Error(`订单状态为 ${o.status}，无法确认`)

  // License expiry = now + 1 year for yearly / 30 days for monthly
  const days = o.cycle === 'yearly' ? 365 : 30
  const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000
  const license = generateLicense(o.plan as 'personal' | 'enterprise', expiresAt)
  activateLicense(license, o.tenant_id)

  const now = Date.now()
  getDb().prepare(`
    UPDATE payment_orders SET
      status = 'paid', paid_at = ?, confirmed_at = ?, confirmed_by = ?,
      license_key = ?, method = COALESCE(?, method)
    WHERE id = ?
  `).run(now, now, adminUserId, license, method ?? null, id)
  return getOrder(id)!
}

export function cancelOrder(id: string, reason?: string): PaymentOrderRow {
  const o = getOrder(id)
  if (!o) throw new Error('订单不存在')
  if (o.status !== 'pending') throw new Error(`订单状态为 ${o.status}，无法取消`)
  const note = reason ? `${o.notes ? o.notes + '\n' : ''}[取消] ${reason}` : o.notes
  getDb().prepare(`UPDATE payment_orders SET status = 'canceled', notes = ? WHERE id = ?`)
    .run(note, id)
  return getOrder(id)!
}

/** Call periodically (or on any list query) to age out stale pending orders. */
export function expirePendingOrders(): number {
  const now = Date.now()
  const r = getDb().prepare(`
    UPDATE payment_orders SET status = 'expired'
    WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < ?
  `).run(now)
  return r.changes
}

/** Aggregate: total paid amount per tenant (lifetime). */
export function getLifetimePaidByTenant(tenantId: number): { amountCents: number; orders: number; currency: string } {
  const r = getDb().prepare(`
    SELECT
      COALESCE(SUM(amount_cents), 0) AS amount_cents,
      COUNT(*) AS orders,
      COALESCE(MAX(currency), 'CNY') AS currency
    FROM payment_orders
    WHERE tenant_id = ? AND status = 'paid'
  `).get(tenantId) as { amount_cents: number; orders: number; currency: string }
  return { amountCents: r.amount_cents, orders: r.orders, currency: r.currency }
}
