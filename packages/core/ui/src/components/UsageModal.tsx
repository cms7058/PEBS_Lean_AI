import React, { useEffect, useState } from 'react'
import {
  api,
  type BillingPeriod,
  type SubscriptionStatus,
  type UsageResponse,
  type MeResponse,
  type PaymentOrder,
} from '../lib/api'

interface Props {
  onClose: () => void
  onOpenPricing: () => void
}

export function UsageModal({ onClose, onOpenPricing }: Props) {
  const [status, setStatus] = useState<SubscriptionStatus | null>(null)
  const [usage, setUsage] = useState<UsageResponse | null>(null)
  const [history, setHistory] = useState<BillingPeriod[]>([])
  const [me, setMe] = useState<MeResponse | null>(null)
  const [orders, setOrders] = useState<PaymentOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = async () => {
    setLoading(true); setError(null)
    try {
      const [s, u, h, m, o] = await Promise.all([
        api.getSubscriptionStatus(),
        api.getUsage(),
        api.getBillingHistory(),
        api.me(),
        api.listMyOrders().catch(() => ({ orders: [] as PaymentOrder[] })),
      ])
      setStatus(s); setUsage(u); setHistory(h.history); setMe(m); setOrders(o.orders)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setLoading(false) }
  }

  useEffect(() => { reload() }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }} />
      <div style={{
        position: 'relative', width: '100%', maxWidth: 780,
        maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        background: '#fff', border: '1px solid #e4e4e4', borderRadius: 12,
        boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 22px', borderBottom: '1px solid #eee', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>用量与账单</div>
            {status && (
              <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                {status.plan.name}
                {status.trialDaysRemaining != null && (
                  <> · 试用剩余 <b style={{ color: status.trialDaysRemaining <= 3 ? '#dc2626' : '#ca8a04' }}>{status.trialDaysRemaining}</b> 天</>
                )}
                {' · '}账期 {usage?.snapshot.periodId}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={onOpenPricing}
              style={{
                fontSize: 11, padding: '5px 12px', borderRadius: 5,
                background: '#111', color: '#fff', border: '1px solid #111',
              }}
            >升级方案</button>
            <button onClick={onClose}
              onMouseEnter={e => (e.currentTarget.style.color = '#333')}
              onMouseLeave={e => (e.currentTarget.style.color = '#bbb')}
              style={{ color: '#bbb', lineHeight: 0, padding: '0 4px' }}>
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {error && (
          <div style={{
            margin: '10px 22px 0', padding: '6px 10px', borderRadius: 5, fontSize: 11,
            background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)',
            color: '#dc2626', flexShrink: 0,
          }}>{error}</div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 22px', minHeight: 0 }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', fontSize: 12, color: '#aaa' }}>加载中…</div>
          ) : !usage ? null : (
            <>
              {/* Trial banner */}
              {status?.trialExpired && (
                <div style={{
                  padding: '10px 14px', borderRadius: 8, marginBottom: 14,
                  background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)',
                  color: '#b91c1c', fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <span>免费试用已到期。升级订阅以继续使用。</span>
                  <button onClick={onOpenPricing} style={{ fontSize: 11, color: '#b91c1c', textDecoration: 'underline' }}>查看方案 →</button>
                </div>
              )}
              {status && !status.trialExpired && status.trialDaysRemaining != null && status.trialDaysRemaining <= 3 && (
                <div style={{
                  padding: '10px 14px', borderRadius: 8, marginBottom: 14,
                  background: '#fef3c7', border: '1px solid #fde68a',
                  color: '#92400e', fontSize: 12,
                }}>
                  免费试用仅剩 {status.trialDaysRemaining} 天，建议尽早升级订阅以避免服务中断。
                </div>
              )}

              {/* 订阅概览 — 当前方案 / 起止时间 / 到期倒计时 / 累计付费 */}
              {me?.subscription && (
                <>
                  <SectionTitle>订阅概览</SectionTitle>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
                    <SubCard label="当前方案" value={me.subscription.planName} />
                    <SubCard
                      label="订阅时长"
                      value={me.subscription.cycle === 'yearly' ? '年付' : me.subscription.cycle === 'monthly' ? '月付' : '免费 / 试用'}
                    />
                    <SubCard
                      label="到期倒计时"
                      value={
                        me.subscription.expired
                          ? '已过期'
                          : me.subscription.daysRemaining != null
                            ? `${me.subscription.daysRemaining} 天`
                            : '—'
                      }
                      color={me.subscription.expired
                        ? '#dc2626'
                        : (me.subscription.daysRemaining != null && me.subscription.daysRemaining <= 7
                            ? '#f59e0b' : '#16a34a')}
                    />
                    <SubCard
                      label="累计付费"
                      value={me.subscription.paidCents > 0
                        ? `¥${(me.subscription.paidCents / 100).toFixed(2)}`
                        : '—'}
                      sub={me.subscription.paidOrders > 0 ? `${me.subscription.paidOrders} 笔订单` : undefined}
                    />
                  </div>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 20, lineHeight: 1.7 }}>
                    订阅起始：{new Date(me.subscription.startedAt).toLocaleDateString('zh-CN')}
                    {me.subscription.expiresAt && <> · 订阅截止：{new Date(me.subscription.expiresAt).toLocaleDateString('zh-CN')}</>}
                    {me.subscription.licenseKey && <> · 许可证：<code style={{ color: '#666' }}>{me.subscription.licenseKey.slice(0, 28)}...</code></>}
                  </div>
                </>
              )}

              {/* 本期用量 */}
              <SectionTitle>本账期用量</SectionTitle>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 20 }}>
                <UsageBar
                  label="对话消息"
                  used={usage.snapshot.chatMessages}
                  limit={usage.limits.chatMessagesPerMonth}
                  percent={usage.percents.chatMessages}
                />
                <UsageBar
                  label="工具调用"
                  used={usage.snapshot.toolCalls}
                  limit={usage.limits.toolCallsPerMonth}
                  percent={usage.percents.toolCalls}
                />
                <UsageBar
                  label="本月知识库新增"
                  used={usage.snapshot.kbEntryAdds + usage.snapshot.kbUploads}
                  limit={usage.limits.kbWritesPerMonth}
                  percent={usage.percents.kbWrites}
                />
                <UsageBar
                  label="知识库条目总数"
                  used={usage.snapshot.kbEntriesTotal}
                  limit={usage.limits.kbMaxEntries}
                  percent={usage.percents.kbEntries}
                />
                <UsageBar
                  label="知识库文档总数"
                  used={usage.snapshot.kbDocumentsTotal}
                  limit={usage.limits.kbMaxDocuments}
                  percent={usage.percents.kbDocuments}
                />
                <StatCard label="知识检索次数" value={usage.snapshot.kbQueries} />
              </div>

              {/* 计费历史 */}
              <SectionTitle>账期计费记录</SectionTitle>
              {history.length === 0 ? (
                <div style={{ padding: '30px 16px', textAlign: 'center', color: '#aaa', fontSize: 12 }}>
                  暂无账期数据。开始使用后会按月生成账单记录。
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ color: '#888', borderBottom: '1px solid #eee' }}>
                      <th style={thStyle}>账期</th>
                      <th style={thStyle}>方案</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>对话</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>工具调用</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>KB 新增</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>金额</th>
                      <th style={{ ...thStyle, textAlign: 'center' }}>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map(h => (
                      <tr key={h.period} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={tdStyle}>{h.period}</td>
                        <td style={tdStyle}>
                          <span style={{ padding: '1px 6px', borderRadius: 3, background: planBadgeBg(h.plan), color: planBadgeFg(h.plan), fontSize: 10 }}>
                            {planBadgeName(h.plan)}
                          </span>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{h.chat_messages.toLocaleString()}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{h.tool_calls.toLocaleString()}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{(h.kb_entry_adds + h.kb_uploads).toLocaleString()}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 500 }}>
                          {h.amount_cents === 0 ? '—' : `¥${(h.amount_cents / 100).toFixed(0)}`}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          <span style={{
                            fontSize: 10, padding: '1px 6px', borderRadius: 3,
                            background: h.closed ? '#f0fdf4' : '#fffbeb',
                            color: h.closed ? '#15803d' : '#a16207',
                          }}>
                            {h.closed ? '已结算' : '进行中'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* 付费订单历史 */}
              {orders.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <SectionTitle>付费订单</SectionTitle>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ color: '#888', borderBottom: '1px solid #eee' }}>
                        <th style={thStyle}>订单号</th>
                        <th style={thStyle}>方案 / 周期</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>金额</th>
                        <th style={thStyle}>创建时间</th>
                        <th style={{ ...thStyle, textAlign: 'center' }}>状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map(o => (
                        <tr key={o.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                          <td style={tdStyle}><code style={{ fontSize: 10 }}>{o.id}</code></td>
                          <td style={tdStyle}>
                            <span style={{ padding: '1px 6px', borderRadius: 3, background: planBadgeBg(o.plan), color: planBadgeFg(o.plan), fontSize: 10 }}>
                              {planBadgeName(o.plan)}
                            </span>
                            <span style={{ color: '#999', marginLeft: 6 }}>{o.cycle === 'yearly' ? '年付' : '月付'}</span>
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 500 }}>
                            ¥{(o.amount_cents / 100).toFixed(2)}
                          </td>
                          <td style={tdStyle}>{new Date(o.created_at).toLocaleDateString('zh-CN')}</td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>
                            <OrderStatusBadge status={o.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function SubCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ border: '1px solid #eee', borderRadius: 8, padding: '10px 12px', background: '#fff' }}>
      <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, color: color ?? '#111' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: '#999', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function OrderStatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; bg: string; label: string }> = {
    pending:  { color: '#a16207', bg: '#fffbeb', label: '待确认' },
    paid:     { color: '#15803d', bg: '#f0fdf4', label: '已付费' },
    canceled: { color: '#666',    bg: '#f3f4f6', label: '已取消' },
    expired:  { color: '#b91c1c', bg: '#fee2e2', label: '已过期' },
  }
  const m = map[status] || map.canceled
  return (
    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: m.bg, color: m.color }}>
      {m.label}
    </span>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, color: '#aaa', letterSpacing: '0.06em',
      textTransform: 'uppercase', marginBottom: 8,
    }}>{children}</div>
  )
}

function UsageBar({ label, used, limit, percent }: {
  label: string; used: number; limit: number | null; percent: number
}) {
  const unlimited = limit == null
  const warn = !unlimited && percent >= 80
  const danger = !unlimited && percent >= 100
  const color = danger ? '#dc2626' : warn ? '#ea580c' : '#16a34a'
  return (
    <div style={{ border: '1px solid #eee', borderRadius: 8, padding: '10px 12px', background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: '#666' }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 500, color: danger ? '#dc2626' : '#111' }}>
          {used.toLocaleString()}
          <span style={{ color: '#aaa', fontWeight: 400 }}>
            {' / '}{unlimited ? '无限' : limit.toLocaleString()}
          </span>
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: '#f3f4f6', overflow: 'hidden' }}>
        <div style={{
          width: unlimited ? '15%' : `${Math.min(100, percent)}%`,
          height: '100%', background: unlimited ? '#d1d5db' : color,
          transition: 'width 0.3s',
        }} />
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={{ border: '1px solid #eee', borderRadius: 8, padding: '10px 12px', background: '#fff' }}>
      <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: '#111' }}>{value.toLocaleString()}</div>
    </div>
  )
}

const thStyle: React.CSSProperties = { padding: '8px 10px', textAlign: 'left', fontWeight: 500, fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase' }
const tdStyle: React.CSSProperties = { padding: '8px 10px', color: '#444' }

function planBadgeName(p: string): string {
  if (p === 'enterprise') return '企业'
  if (p === 'personal') return '个人'
  return '免费'
}
function planBadgeBg(p: string): string {
  if (p === 'enterprise') return '#fef3c7'
  if (p === 'personal') return '#dbeafe'
  return '#f3f4f6'
}
function planBadgeFg(p: string): string {
  if (p === 'enterprise') return '#b45309'
  if (p === 'personal') return '#1d4ed8'
  return '#666'
}
