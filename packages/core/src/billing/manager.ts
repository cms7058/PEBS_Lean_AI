/**
 * 订阅状态 + 配额检查 + 用量记录 + 计费汇总（按租户隔离）
 *
 * 数据模型（SQLite）：
 *   tenants            — 每个租户即一个订阅单元（plan/expires_at/seats/license_key）
 *   usage_events       — 用量事件流水（按 tenant_id + category 计数）
 *   billing_periods    — 按 (tenant_id, period) 滚动的账期汇总
 *
 * 所有 API 必须传入 tenantId。对单租户部署可传 1（默认租户）。
 */
import crypto from 'crypto'
import { getDb } from '../storage/db'
import { getTenant, updateTenant, type TenantRow } from '../auth/users'
import { PLANS, type PlanDefinition, type PlanId, LICENSE_FORMAT_RE } from './plans'
import { getPlanCapabilities } from './capabilities'

export type UsageCategory =
  | 'chat_message'
  | 'tool_call'
  | 'kb_upload'
  | 'kb_entry_add'
  | 'kb_query'

/**
 * Tenant-level subscription view, derived from the tenants table row.
 * Kept as a separate type so callers don't couple to full TenantRow.
 */
export interface SubscriptionRow {
  plan: PlanId
  started_at: number
  expires_at: number | null
  billing_cycle: 'monthly' | 'yearly' | null
  license_key: string | null
  activated_email: string | null
  seats: number
  notes: string | null
}

export interface QuotaDecision {
  allowed: boolean
  reason?: string
  remaining?: number
  limit?: number | null
}

export interface UsageSnapshot {
  plan: PlanId
  periodId: string // YYYY-MM
  chatMessages: number
  toolCalls: number
  kbEntryAdds: number
  kbUploads: number
  kbQueries: number
  kbEntriesTotal: number
  kbDocumentsTotal: number
}

// Default tenant id used by legacy / single-user callers that pre-date the
// multi-tenant migration. The tenants table seeds id=1 as the default tenant.
export const DEFAULT_TENANT_ID = 1

/** 启动时确保表存在 */
export function ensureBillingSchema(): void {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_events (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      ts        INTEGER NOT NULL,
      period    TEXT NOT NULL,       -- YYYY-MM
      plan      TEXT NOT NULL,
      tenant_id INTEGER,
      category  TEXT NOT NULL,
      subject   TEXT,
      tokens    INTEGER NOT NULL DEFAULT 0,
      bytes     INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_usage_period_cat ON usage_events(period, category);
    CREATE INDEX IF NOT EXISTS idx_usage_tenant ON usage_events(tenant_id, period);
    CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage_events(ts DESC);

    CREATE TABLE IF NOT EXISTS billing_periods (
      period          TEXT NOT NULL,
      tenant_id       INTEGER NOT NULL DEFAULT 1,
      plan            TEXT NOT NULL,
      chat_messages   INTEGER NOT NULL DEFAULT 0,
      tool_calls      INTEGER NOT NULL DEFAULT 0,
      kb_entry_adds   INTEGER NOT NULL DEFAULT 0,
      kb_uploads      INTEGER NOT NULL DEFAULT 0,
      kb_queries      INTEGER NOT NULL DEFAULT 0,
      amount_cents    INTEGER NOT NULL DEFAULT 0,
      currency        TEXT NOT NULL DEFAULT 'CNY',
      closed          INTEGER NOT NULL DEFAULT 0,
      updated_at      INTEGER NOT NULL,
      PRIMARY KEY (tenant_id, period)
    );
  `)
  // Backfill tenant_id on legacy rows created before the migration.
  try { db.exec('UPDATE usage_events    SET tenant_id = 1 WHERE tenant_id IS NULL') } catch {}
  try { db.exec('UPDATE billing_periods SET tenant_id = 1 WHERE tenant_id IS NULL') } catch {}
}

// ---- Subscription state (tenant-scoped) ----------------------------------

function tenantToSubscription(t: TenantRow): SubscriptionRow {
  return {
    plan: t.plan as PlanId,
    started_at: t.created_at,
    expires_at: t.expires_at,
    billing_cycle: t.license_key ? 'yearly' : null,
    license_key: t.license_key,
    activated_email: null,
    seats: t.seats,
    notes: t.notes,
  }
}

export function getSubscription(tenantId: number = DEFAULT_TENANT_ID): SubscriptionRow {
  ensureBillingSchema()
  const t = getTenant(tenantId)
  if (!t) {
    // Fabricate a free trial view if tenant doesn't exist (shouldn't happen
    // post-migration but keeps callers defensive against race conditions).
    return {
      plan: 'free',
      started_at: Date.now(),
      expires_at: null,
      billing_cycle: null,
      license_key: null,
      activated_email: null,
      seats: 1,
      notes: null,
    }
  }
  return tenantToSubscription(t)
}

export function getPlan(tenantId: number = DEFAULT_TENANT_ID): PlanDefinition {
  const sub = getSubscription(tenantId)
  return PLANS[sub.plan]
}

export function isTrialExpired(sub: SubscriptionRow): boolean {
  if (sub.plan !== 'free') {
    // Paid plans also respect expires_at (license expiry = subscription end).
    return sub.expires_at != null && Date.now() > sub.expires_at
  }
  if (sub.expires_at == null) return false
  return Date.now() > sub.expires_at
}

export function getTrialDaysRemaining(sub: SubscriptionRow): number | null {
  if (sub.expires_at == null) return null
  const ms = sub.expires_at - Date.now()
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)))
}

// ---- Usage aggregation ---------------------------------------------------

export function currentPeriod(ts = Date.now()): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

function countUsage(tenantId: number, period: string, category: UsageCategory): number {
  const r = getDb().prepare(
    'SELECT COUNT(*) AS n FROM usage_events WHERE tenant_id = ? AND period = ? AND category = ?',
  ).get(tenantId, period, category) as { n: number } | undefined
  return r?.n ?? 0
}

/** 记录一条用量事件；同步写入 billing_periods 汇总（累加器）*/
export function recordUsage(
  tenantId: number,
  category: UsageCategory,
  subject = '',
  extra: { tokens?: number; bytes?: number } = {},
): void {
  ensureBillingSchema()
  const db = getDb()
  const now = Date.now()
  const period = currentPeriod(now)
  const plan = getSubscription(tenantId).plan
  db.prepare(`
    INSERT INTO usage_events (ts, period, plan, tenant_id, category, subject, tokens, bytes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(now, period, plan, tenantId, category, subject, extra.tokens ?? 0, extra.bytes ?? 0)

  const existing = db.prepare(
    'SELECT * FROM billing_periods WHERE tenant_id = ? AND period = ?'
  ).get(tenantId, period) as { period: string } | undefined
  const currency = PLANS[plan].pricing.currency
  const cents = monthlyAmountCents(plan)
  if (!existing) {
    db.prepare(`
      INSERT INTO billing_periods
        (period, tenant_id, plan, chat_messages, tool_calls, kb_entry_adds, kb_uploads, kb_queries, amount_cents, currency, closed, updated_at)
      VALUES (?, ?, ?, 0, 0, 0, 0, 0, ?, ?, 0, ?)
    `).run(period, tenantId, plan, cents, currency, now)
  }
  const col = categoryToColumn(category)
  if (col) {
    db.prepare(`UPDATE billing_periods SET ${col} = ${col} + 1, plan = ?, amount_cents = ?, currency = ?, updated_at = ? WHERE tenant_id = ? AND period = ?`)
      .run(plan, cents, currency, now, tenantId, period)
  }
}

function categoryToColumn(cat: UsageCategory): string | null {
  switch (cat) {
    case 'chat_message': return 'chat_messages'
    case 'tool_call': return 'tool_calls'
    case 'kb_entry_add': return 'kb_entry_adds'
    case 'kb_upload': return 'kb_uploads'
    case 'kb_query': return 'kb_queries'
    default: return null
  }
}

function monthlyAmountCents(plan: PlanId): number {
  const p = PLANS[plan].pricing
  return p.monthlyCents ?? 0
}

export function getUsageSnapshot(tenantId: number = DEFAULT_TENANT_ID): UsageSnapshot {
  ensureBillingSchema()
  const sub = getSubscription(tenantId)
  const period = currentPeriod()
  const db = getDb()
  let kbEntriesTotal = 0
  let kbDocumentsTotal = 0
  try {
    kbEntriesTotal = (db.prepare('SELECT COUNT(*) AS n FROM kb_entries WHERE tenant_id = ?')
      .get(tenantId) as { n: number } | undefined)?.n ?? 0
  } catch { /* table may not exist */ }
  try {
    kbDocumentsTotal = (db.prepare('SELECT COUNT(*) AS n FROM knowledge_documents WHERE tenant_id = ?')
      .get(tenantId) as { n: number } | undefined)?.n ?? 0
  } catch { /* */ }
  return {
    plan: sub.plan,
    periodId: period,
    chatMessages: countUsage(tenantId, period, 'chat_message'),
    toolCalls: countUsage(tenantId, period, 'tool_call'),
    kbEntryAdds: countUsage(tenantId, period, 'kb_entry_add'),
    kbUploads: countUsage(tenantId, period, 'kb_upload'),
    kbQueries: countUsage(tenantId, period, 'kb_query'),
    kbEntriesTotal,
    kbDocumentsTotal,
  }
}

// ---- Quota checks --------------------------------------------------------

function denyIfExpired(tenantId: number): QuotaDecision | null {
  const sub = getSubscription(tenantId)
  if (isTrialExpired(sub)) {
    return { allowed: false, reason: sub.plan === 'free'
      ? '免费试用已到期，请升级至个人或企业订阅以继续使用。'
      : '订阅已到期，请续期后继续使用。' }
  }
  return null
}

function deny(reason: string, remaining?: number, limit?: number | null): QuotaDecision {
  return { allowed: false, reason, remaining, limit }
}
function allow(remaining?: number, limit?: number | null): QuotaDecision {
  return { allowed: true, remaining, limit }
}

export function checkChatMessage(tenantId: number = DEFAULT_TENANT_ID): QuotaDecision {
  const expired = denyIfExpired(tenantId)
  if (expired) return expired
  const plan = getPlan(tenantId)
  const limit = plan.limits.chatMessagesPerMonth
  if (limit == null) return allow(undefined, null)
  const used = countUsage(tenantId, currentPeriod(), 'chat_message')
  if (used >= limit) {
    return deny(
      `本月对话消息已达上限 ${limit}/月（当前计划：${plan.name}）。请升级订阅以继续使用。`,
      0, limit,
    )
  }
  return allow(limit - used, limit)
}

export function checkToolCall(
  toolName: string, skillPackageName: string,
  tenantId: number = DEFAULT_TENANT_ID,
): QuotaDecision {
  const expired = denyIfExpired(tenantId)
  if (expired) return expired
  const plan = getPlan(tenantId)
  const allowlist = getPlanCapabilities(plan.id).skillAllowlist
  if (allowlist !== '*' && !allowlist.includes(skillPackageName)) {
    return deny(
      `当前计划（${plan.name}）未包含技能「${skillPackageName}」。升级个人/企业订阅可解锁全部技能。`,
    )
  }
  const limit = plan.limits.toolCallsPerMonth
  if (limit == null) return allow(undefined, null)
  const used = countUsage(tenantId, currentPeriod(), 'tool_call')
  if (used >= limit) {
    return deny(
      `本月工具调用已达上限 ${limit}/月（当前计划：${plan.name}）。请升级订阅。`,
      0, limit,
    )
  }
  return allow(limit - used, limit)
}

export function checkSkillAllowed(
  skillPackageName: string, tenantId: number = DEFAULT_TENANT_ID,
): QuotaDecision {
  const expired = denyIfExpired(tenantId)
  if (expired) return expired
  const plan = getPlan(tenantId)
  const allowlist = getPlanCapabilities(plan.id).skillAllowlist
  if (allowlist === '*') return allow()
  if (allowlist.includes(skillPackageName)) return allow()
  return deny(
    `当前计划（${plan.name}）不包含技能「${skillPackageName}」。升级个人/企业订阅可解锁。`,
  )
}

export function checkKbUpload(fileBytes: number, tenantId: number = DEFAULT_TENANT_ID): QuotaDecision {
  const expired = denyIfExpired(tenantId)
  if (expired) return expired
  const plan = getPlan(tenantId)
  const L = plan.limits
  if (fileBytes > L.kbMaxFileBytes) {
    return deny(`文件过大（${formatMB(fileBytes)}），当前计划单文件上限 ${formatMB(L.kbMaxFileBytes)}。`)
  }
  if (L.kbMaxDocuments != null) {
    const snap = getUsageSnapshot(tenantId)
    if (snap.kbDocumentsTotal >= L.kbMaxDocuments) {
      return deny(
        `知识库文档数已达上限 ${L.kbMaxDocuments}（当前计划：${plan.name}）。请删除旧文档或升级订阅。`,
        0, L.kbMaxDocuments,
      )
    }
  }
  if (L.kbWritesPerMonth != null) {
    const used = countUsage(tenantId, currentPeriod(), 'kb_upload') + countUsage(tenantId, currentPeriod(), 'kb_entry_add')
    if (used >= L.kbWritesPerMonth) {
      return deny(
        `本月知识库新增次数已达上限 ${L.kbWritesPerMonth}（当前计划：${plan.name}）。`,
        0, L.kbWritesPerMonth,
      )
    }
  }
  return allow()
}

export function checkKbEntryAdd(tenantId: number = DEFAULT_TENANT_ID): QuotaDecision {
  const expired = denyIfExpired(tenantId)
  if (expired) return expired
  const plan = getPlan(tenantId)
  const L = plan.limits
  if (L.kbMaxEntries != null) {
    const snap = getUsageSnapshot(tenantId)
    if (snap.kbEntriesTotal >= L.kbMaxEntries) {
      return deny(
        `知识库条目数已达上限 ${L.kbMaxEntries}（当前计划：${plan.name}）。`,
        0, L.kbMaxEntries,
      )
    }
  }
  if (L.kbWritesPerMonth != null) {
    const used = countUsage(tenantId, currentPeriod(), 'kb_upload') + countUsage(tenantId, currentPeriod(), 'kb_entry_add')
    if (used >= L.kbWritesPerMonth) {
      return deny(
        `本月知识库新增次数已达上限 ${L.kbWritesPerMonth}（当前计划：${plan.name}）。`,
        0, L.kbWritesPerMonth,
      )
    }
  }
  return allow()
}

// ---- License activation --------------------------------------------------

const LICENSE_SECRET = process.env.LEANAI_LICENSE_SECRET || 'LEANAI_DEMO_SECRET'

/** 激活许可证：更新租户的 plan/expires_at/license_key. 成功返回新订阅视图。 */
export function activateLicense(
  licenseKey: string,
  tenantId: number = DEFAULT_TENANT_ID,
  _email?: string,
): SubscriptionRow {
  ensureBillingSchema()
  const key = licenseKey.trim().toUpperCase()
  const m = key.match(LICENSE_FORMAT_RE)
  if (!m) {
    throw new Error('许可证密钥格式不正确（期望 LEANAI-PERSONAL|ENTERPRISE-YYYYMMDD-XXXXXXXX）')
  }
  const planRaw = m[1].toLowerCase() as 'personal' | 'enterprise'
  const expiresStr = m[2]
  const hash = m[3]
  const y = parseInt(expiresStr.slice(0, 4), 10)
  const mo = parseInt(expiresStr.slice(4, 6), 10)
  const d = parseInt(expiresStr.slice(6, 8), 10)
  const expiresAt = new Date(y, mo - 1, d, 23, 59, 59, 999).getTime()
  if (expiresAt < Date.now()) {
    throw new Error(`许可证已过期（到期日 ${y}-${mo}-${d}）`)
  }
  const expected = crypto.createHash('sha256')
    .update(`${planRaw}|${expiresStr}|${LICENSE_SECRET}`)
    .digest('hex').toUpperCase().slice(0, 8)
  if (expected !== hash) {
    throw new Error('许可证签名无效。请联系客服确认密钥。')
  }
  const seats = planRaw === 'enterprise' ? 10 : 1
  updateTenant(tenantId, {
    plan: planRaw,
    expires_at: expiresAt,
    license_key: key,
    seats,
    status: 'active',
  })
  return getSubscription(tenantId)
}

export function generateLicense(plan: 'personal' | 'enterprise', expiresAt: number): string {
  const d = new Date(expiresAt)
  const yyyymmdd =
    `${d.getFullYear()}` +
    `${String(d.getMonth() + 1).padStart(2, '0')}` +
    `${String(d.getDate()).padStart(2, '0')}`
  const hash = crypto.createHash('sha256')
    .update(`${plan}|${yyyymmdd}|${LICENSE_SECRET}`)
    .digest('hex').toUpperCase().slice(0, 8)
  return `LEANAI-${plan.toUpperCase()}-${yyyymmdd}-${hash}`
}

export function downgradeToFree(tenantId: number = DEFAULT_TENANT_ID): SubscriptionRow {
  ensureBillingSchema()
  const expires = Date.now() + 14 * 24 * 60 * 60 * 1000
  updateTenant(tenantId, {
    plan: 'free', expires_at: expires, license_key: null, seats: 1,
  })
  return getSubscription(tenantId)
}

// ---- Billing history -----------------------------------------------------

export interface BillingPeriodRow {
  period: string
  plan: PlanId
  tenant_id: number
  chat_messages: number
  tool_calls: number
  kb_entry_adds: number
  kb_uploads: number
  kb_queries: number
  amount_cents: number
  currency: string
  closed: number
  updated_at: number
}

export function getBillingHistory(
  tenantId: number = DEFAULT_TENANT_ID, limit = 12,
): BillingPeriodRow[] {
  ensureBillingSchema()
  return getDb().prepare(`
    SELECT * FROM billing_periods WHERE tenant_id = ? ORDER BY period DESC LIMIT ?
  `).all(tenantId, limit) as BillingPeriodRow[]
}

// ---- helpers -------------------------------------------------------------

function formatMB(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}
