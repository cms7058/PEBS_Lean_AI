import React, { useEffect, useState, useRef } from 'react'
import {
  api, type PlanDefinition, type SubscriptionStatus,
  type PaymentOrder, type PaymentGateway, type PlanId,
} from '../lib/api'

interface Props {
  onClose: () => void
  onChanged?: () => void
}

export function PricingModal({ onClose, onChanged }: Props) {
  const [plans, setPlans] = useState<PlanDefinition[]>([])
  const [status, setStatus] = useState<SubscriptionStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [licenseKey, setLicenseKey] = useState('')
  const [email, setEmail] = useState('')
  const [cycle, setCycle] = useState<'monthly' | 'yearly'>('yearly')
  const [showActivate, setShowActivate] = useState<'personal' | 'enterprise' | null>(null)
  const [payOrder, setPayOrder] = useState<PaymentOrder | null>(null)
  const [payGateway, setPayGateway] = useState<PaymentGateway>({})

  const reload = async () => {
    setLoading(true)
    try {
      const [plansRes, statusRes] = await Promise.all([
        api.getPlans(),
        api.getSubscriptionStatus(),
      ])
      setPlans(plansRes.plans)
      setStatus(statusRes)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setLoading(false) }
  }

  useEffect(() => { reload() }, [])

  const activate = async () => {
    setError(null); setBusy(true)
    try {
      await api.activateLicense(licenseKey.trim(), email.trim() || undefined)
      setLicenseKey(''); setEmail(''); setShowActivate(null)
      await reload()
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  const previewKey = async (plan: 'personal' | 'enterprise') => {
    setError(null)
    try {
      const r = await api.previewLicense(plan)
      setLicenseKey(r.licenseKey)
      setShowActivate(plan)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  /** Kick off the 扫码付费 flow — creates a pending order and shows QR. */
  const startPayment = async (plan: 'personal' | 'enterprise') => {
    setError(null); setBusy(true)
    try {
      const r = await api.createOrder(plan, cycle)
      setPayOrder(r.order)
      setPayGateway(r.gateway || {})
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  const downgrade = async () => {
    if (!confirm('确认取消订阅并回退到免费试用？用量配额将按免费档重新限制。')) return
    setError(null); setBusy(true)
    try {
      await api.downgradeToFree()
      await reload()
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }} />
      <div style={{
        position: 'relative', width: '100%', maxWidth: 980,
        maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        background: '#fff', border: '1px solid #e4e4e4', borderRadius: 12,
        boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 22px', borderBottom: '1px solid #eee', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>订阅方案</div>
            {status && (
              <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                当前：<b style={{ color: '#111' }}>{status.plan.name}</b>
                {status.trialDaysRemaining != null && (
                  <> · 试用剩余 <b style={{ color: status.trialDaysRemaining <= 3 ? '#dc2626' : '#ca8a04' }}>{status.trialDaysRemaining}</b> 天</>
                )}
                {status.subscription.expires_at && status.plan.id !== 'free' && (
                  <> · 到期 {new Date(status.subscription.expires_at).toLocaleDateString('zh-CN')}</>
                )}
              </div>
            )}
          </div>
          <button onClick={onClose}
            onMouseEnter={e => (e.currentTarget.style.color = '#333')}
            onMouseLeave={e => (e.currentTarget.style.color = '#bbb')}
            style={{ color: '#bbb', lineHeight: 0 }}>
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Cycle toggle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '14px 22px 0', flexShrink: 0 }}>
          <div style={{ display: 'inline-flex', gap: 0, background: '#f3f4f6', borderRadius: 6, padding: 3 }}>
            <CycleBtn active={cycle === 'monthly'} onClick={() => setCycle('monthly')}>按月</CycleBtn>
            <CycleBtn active={cycle === 'yearly'} onClick={() => setCycle('yearly')}>按年 · 省 15%</CycleBtn>
          </div>
        </div>

        {error && (
          <div style={{
            margin: '10px 22px 0', padding: '6px 10px', borderRadius: 5, fontSize: 11,
            background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)',
            color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexShrink: 0,
          }}>
            <span>{error}</span>
            <button onClick={() => setError(null)} style={{ color: '#dc2626', fontSize: 12 }}>×</button>
          </div>
        )}

        {/* Cards */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px', minHeight: 0 }}>
          {loading ? (
            <div style={{ padding: 60, textAlign: 'center', color: '#aaa', fontSize: 12 }}>加载中…</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
                {plans.map(p => (
                  <PlanCard
                    key={p.id}
                    plan={p}
                    cycle={cycle}
                    isCurrent={status?.plan.id === p.id}
                    onActivate={p.id === 'free' ? downgrade : () => startPayment(p.id as 'personal' | 'enterprise')}
                    onPreviewKey={p.id === 'free' ? undefined : () => previewKey(p.id as 'personal' | 'enterprise')}
                    busy={busy}
                  />
                ))}
              </div>

              {/* Activate form */}
              <div style={{
                marginTop: 18, padding: 16, borderRadius: 10,
                border: '1px solid #e4e4e4', background: '#fafafa',
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a', marginBottom: 4 }}>
                  已有许可证密钥？
                </div>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 12, lineHeight: 1.6 }}>
                  输入从销售/客服获取的许可证密钥即可激活订阅。密钥格式：<code style={{ color: '#666', fontFamily: 'monospace' }}>LEANAI-PERSONAL|ENTERPRISE-YYYYMMDD-XXXXXXXX</code>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 8 }}>
                  <input
                    value={licenseKey}
                    onChange={e => setLicenseKey(e.target.value)}
                    placeholder="LEANAI-PERSONAL-20270420-XXXXXXXX"
                    style={inputStyle}
                  />
                  <input
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="邮箱（可选）"
                    style={inputStyle}
                  />
                  <button
                    onClick={activate}
                    disabled={!licenseKey.trim() || busy}
                    style={{
                      padding: '7px 18px', borderRadius: 5, fontSize: 12,
                      background: busy ? '#f5f5f5' : '#111',
                      color: busy ? '#aaa' : '#fff',
                      border: '1px solid ' + (busy ? '#e4e4e4' : '#111'),
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {busy ? '激活中…' : '激活'}
                  </button>
                </div>
                {showActivate && (
                  <div style={{ marginTop: 10, fontSize: 11, color: '#16a34a', background: '#f0fdf4', padding: '6px 10px', borderRadius: 5 }}>
                    已为你生成一个 <b>{showActivate === 'personal' ? '个人' : '企业'}</b> 订阅的演示密钥（有效期 1 年）。点击「激活」即可生效。
                    <br />
                    生产环境中，该密钥应由销售系统基于支付成功事件生成并通过邮件发送。
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {payOrder && (
        <QrPayModal
          order={payOrder}
          gateway={payGateway}
          onClose={() => setPayOrder(null)}
          onPaid={async () => {
            await reload()
            onChanged?.()
          }}
        />
      )}
    </div>
  )
}

function CycleBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 14px', fontSize: 11, borderRadius: 4,
        background: active ? '#fff' : 'transparent',
        color: active ? '#111' : '#888',
        fontWeight: active ? 500 : 400,
        boxShadow: active ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
      }}
    >
      {children}
    </button>
  )
}

function PlanCard({ plan, cycle, isCurrent, onActivate, onPreviewKey, busy }: {
  plan: PlanDefinition; cycle: 'monthly' | 'yearly'; isCurrent: boolean;
  onActivate: () => void;
  onPreviewKey?: () => void;
  busy: boolean
}) {
  const cents = cycle === 'monthly' ? plan.pricing.monthlyCents : plan.pricing.yearlyCents
  const priceLabel = cents == null ? '联系销售' : cents === 0 ? '免费' : `¥${(cents / 100).toFixed(0)}`
  const unit = cents == null || cents === 0 ? '' : (cycle === 'monthly' ? '/月' : '/年')
  const featured = plan.id === 'personal'

  return (
    <div style={{
      position: 'relative',
      border: `${featured ? 2 : 1}px solid ${featured ? '#111' : '#e4e4e4'}`,
      borderRadius: 10, padding: '18px 16px', background: '#fff',
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      {featured && (
        <div style={{
          position: 'absolute', top: -10, left: 14, padding: '2px 8px',
          background: '#111', color: '#fff', fontSize: 10, borderRadius: 10,
          letterSpacing: '0.03em',
        }}>推荐</div>
      )}
      {isCurrent && (
        <div style={{
          position: 'absolute', top: -10, right: 14, padding: '2px 8px',
          background: '#16a34a', color: '#fff', fontSize: 10, borderRadius: 10,
        }}>当前</div>
      )}
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#111' }}>{plan.name}</div>
        <div style={{ fontSize: 11, color: '#888', marginTop: 3, minHeight: 28, lineHeight: 1.5 }}>
          {plan.tagline}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontSize: 28, fontWeight: 700, color: '#111' }}>{priceLabel}</span>
        <span style={{ fontSize: 12, color: '#888' }}>{unit}</span>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
        {plan.features.map((f, i) => (
          <li key={i} style={{
            display: 'flex', fontSize: 11, lineHeight: 1.5,
            color: f.muted ? '#bbb' : '#444',
          }}>
            <span style={{ color: f.muted ? '#ccc' : '#16a34a', marginRight: 6, flexShrink: 0 }}>
              {f.muted ? '—' : '✓'}
            </span>
            <span style={{ flex: 1 }}>
              <span style={{ color: f.muted ? '#bbb' : '#666' }}>{f.label}：</span>
              <span>{f.value}</span>
            </span>
          </li>
        ))}
      </ul>
      <div style={{ flex: 1 }} />
      <button
        onClick={onActivate}
        disabled={isCurrent || busy}
        style={{
          width: '100%', padding: '9px', borderRadius: 6, fontSize: 12,
          background: isCurrent
            ? '#f5f5f5'
            : featured ? '#111' : '#fff',
          color: isCurrent
            ? '#aaa'
            : featured ? '#fff' : '#111',
          border: '1px solid ' + (isCurrent ? '#e4e4e4' : '#111'),
          cursor: isCurrent || busy ? 'default' : 'pointer',
          fontWeight: 500,
        }}
      >
        {isCurrent ? '当前方案' : plan.id === 'free' ? '回退到免费' : '扫码付费'}
      </button>
      {!isCurrent && onPreviewKey && (
        <button
          onClick={onPreviewKey}
          disabled={busy}
          style={{
            width: '100%', padding: '6px', borderRadius: 5, fontSize: 11,
            background: 'transparent', color: '#888',
            border: '1px solid #e4e4e4', cursor: busy ? 'default' : 'pointer',
          }}
        >
          生成测试密钥
        </button>
      )}
    </div>
  )
}

// ---- QR code payment modal -------------------------------------------------
// Shown after a user clicks "扫码付费" on a plan card.  Creates a pending
// payment order server-side and displays the admin-configured QR code.  Polls
// /api/billing/orders/:id every 4s; when the admin flips status to 'paid',
// we close the modal and reload subscription status.

export function QrPayModal({ order, gateway, onClose, onPaid }: {
  order: PaymentOrder
  gateway: PaymentGateway
  onClose: () => void
  onPaid: () => void
}) {
  const [current, setCurrent] = useState<PaymentOrder>(order)
  const [method, setMethod] = useState<'wechat' | 'alipay'>('wechat')
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    timer.current = setInterval(async () => {
      try {
        const r = await api.getOrder(order.id)
        setCurrent(r.order)
        if (r.order.status === 'paid') {
          if (timer.current) clearInterval(timer.current)
          onPaid()
        } else if (r.order.status !== 'pending') {
          if (timer.current) clearInterval(timer.current)
        }
      } catch { /* transient */ }
    }, 4000)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [order.id, onPaid])

  const qr = method === 'wechat' ? gateway.wechatQrUrl : gateway.alipayQrUrl
  const priceYuan = (current.amount_cents / 100).toFixed(2)
  const expiresMin = current.expires_at ? Math.max(0, Math.round((current.expires_at - Date.now()) / 60000)) : null

  const planLabel: Record<PlanId, string> = { free: 'Free', personal: 'Personal 个人版', enterprise: 'Enterprise 企业版' }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' }} />
      <div style={{
        position: 'relative', width: 420, background: '#fff',
        borderRadius: 12, padding: '22px 24px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#111', marginBottom: 6 }}>扫码支付</div>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 14 }}>
          {planLabel[current.plan]} · {current.cycle === 'yearly' ? '年付' : '月付'}
          <span style={{ float: 'right', fontSize: 18, color: '#111', fontWeight: 700 }}>¥{priceYuan}</span>
        </div>

        <div style={{ display: 'flex', gap: 0, background: '#f3f4f6', borderRadius: 6, padding: 3, marginBottom: 14 }}>
          <button onClick={() => setMethod('wechat')} style={tabStyle(method === 'wechat')}>微信</button>
          <button onClick={() => setMethod('alipay')} style={tabStyle(method === 'alipay')}>支付宝</button>
        </div>

        <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
          {qr ? (
            <img src={qr} alt={method} style={{ width: 220, height: 220, objectFit: 'contain', border: '1px solid #eee', borderRadius: 6 }} />
          ) : (
            <div style={{
              width: 220, height: 220, margin: '0 auto', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              background: '#fafafa', border: '1px dashed #ddd', borderRadius: 6,
              color: '#999', fontSize: 11, padding: 20,
            }}>
              管理员尚未配置 {method === 'wechat' ? '微信' : '支付宝'} 收款码。
              {gateway.contactPhone && <><br/>联系客服：{gateway.contactPhone}</>}
              {gateway.contactEmail && <><br/>{gateway.contactEmail}</>}
            </div>
          )}
        </div>

        <div style={{
          fontSize: 11, color: '#666', background: '#fafafa', padding: '10px 12px',
          borderRadius: 6, lineHeight: 1.6, marginBottom: 12,
        }}>
          <div style={{ color: '#111', fontWeight: 500, marginBottom: 4 }}>订单号：<code>{current.id}</code></div>
          <div>{gateway.instructions || '扫码付款后请将付款截图发送给客服核实。核实后我们会激活您的订阅。'}</div>
          {expiresMin != null && current.status === 'pending' && (
            <div style={{ color: '#f59e0b', marginTop: 4 }}>⏱ 订单将在 {expiresMin} 分钟后过期</div>
          )}
        </div>

        <div style={{ fontSize: 11, color: '#666', textAlign: 'center', marginBottom: 10 }}>
          {current.status === 'pending' && <><span style={{ color: '#f59e0b' }}>● 等待客服确认收款…</span>（自动轮询中）</>}
          {current.status === 'paid' && <span style={{ color: '#16a34a' }}>✓ 已收款，订阅已激活</span>}
          {current.status === 'canceled' && <span style={{ color: '#999' }}>订单已取消</span>}
          {current.status === 'expired' && <span style={{ color: '#dc2626' }}>订单已过期</span>}
        </div>

        <button onClick={onClose} style={{
          width: '100%', padding: '8px', borderRadius: 6, fontSize: 12,
          background: '#f5f5f5', color: '#333', border: '1px solid #e4e4e4',
        }}>
          {current.status === 'paid' ? '完成' : '稍后付款'}
        </button>
      </div>
    </div>
  )
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1, padding: '6px', fontSize: 12, borderRadius: 4,
    background: active ? '#fff' : 'transparent',
    color: active ? '#111' : '#888',
    fontWeight: active ? 500 : 400,
    boxShadow: active ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
  }
}

const inputStyle: React.CSSProperties = {
  padding: '7px 10px', borderRadius: 5, fontSize: 11,
  background: '#fff', color: '#1a1a1a', border: '1px solid #e4e4e4',
  fontFamily: '"SF Mono", "JetBrains Mono", Consolas, monospace',
  caretColor: '#555',
}
