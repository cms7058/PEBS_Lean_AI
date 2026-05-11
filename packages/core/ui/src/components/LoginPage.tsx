import React, { useState } from 'react'
import { ApiError, api, type MeResponse } from '../lib/api'

interface Props {
  onLoggedIn: (me: MeResponse) => void
  onCancel?: () => void
}

const INVITE_APPLY_URL = 'https://lingcan.pebs.online/#/pages/copilot/index'

export function LoginPage({ onLoggedIn, onCancel }: Props) {
  const [email, setEmail] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showApplyInvite, setShowApplyInvite] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setShowApplyInvite(false)
    setSubmitting(true)
    try {
      const me = await api.internalInviteLogin(email.trim(), inviteCode.trim())
      onLoggedIn(me)
    } catch (err) {
      const shouldApplyInvite = err instanceof ApiError && err.action === 'apply_invite'
      setShowApplyInvite(shouldApplyInvite)
      setError(shouldApplyInvite ? null : err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#eef5ff',
      color: '#102033',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(135deg, rgba(37,99,235,0.12), rgba(20,184,166,0.08) 48%, rgba(255,255,255,0.4))',
      }} />

      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          style={{
            position: 'absolute', top: 20, left: 20, zIndex: 2,
            padding: '7px 12px', fontSize: 12, color: '#35506f',
            background: 'rgba(255,255,255,0.75)', border: '1px solid rgba(148,163,184,0.35)',
            borderRadius: 6, cursor: 'pointer',
          }}
        >返回预览</button>
      )}

      <main style={{
        position: 'relative',
        zIndex: 1,
        width: 'min(920px, calc(100vw - 32px))',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: 28,
        alignItems: 'center',
      }}>
        <section>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            border: '1px solid rgba(37,99,235,0.18)',
            borderRadius: 999,
            background: 'rgba(255,255,255,0.72)',
            color: '#2563eb',
            fontSize: 12,
            fontWeight: 600,
            marginBottom: 18,
          }}>
            PEBS Lean 内测版开放
          </div>
          <h1 style={{
            margin: 0,
            fontSize: 36,
            lineHeight: 1.16,
            letterSpacing: 0,
            color: '#0f172a',
          }}>
            邮箱与邀请码登录
          </h1>
          <p style={{
            margin: '16px 0 24px',
            maxWidth: 520,
            fontSize: 15,
            lineHeight: 1.8,
            color: '#475569',
          }}>
            当前阶段暂时关闭公开订阅流程。通过 PEBS 云函数验证后，系统会为你自动开通企业版内测空间，用来体验精益诊断、图表生成、报告导出和知识库能力。
          </p>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 12,
            maxWidth: 560,
          }}>
            <Benefit title="邮箱验证" desc="使用登记邮箱识别内测资格" />
            <Benefit title="邀请码准入" desc="未授权用户可直接申请邀请码" />
            <Benefit title="企业版体验" desc="默认解锁完整 Lean Copilot 能力" />
            <Benefit title="14 天内测" desc="适合完成一轮诊断到报告闭环" />
          </div>
        </section>

        <form onSubmit={submit} style={{
          background: 'rgba(255,255,255,0.88)',
          border: '1px solid rgba(148,163,184,0.28)',
          borderRadius: 12,
          padding: '28px 26px',
          boxShadow: '0 18px 50px rgba(30,64,175,0.14)',
          backdropFilter: 'blur(12px)',
        }}>
          <div style={{ marginBottom: 22 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>PEBS Lean</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 5 }}>精益生产 AI 智能体内测登录</div>
          </div>

          <Field label="邮箱">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="请输入内测登记邮箱"
              autoFocus
              required
              style={inputStyle}
            />
          </Field>

          <Field label="邀请码">
            <input
              value={inviteCode}
              onChange={e => setInviteCode(e.target.value)}
              placeholder="请输入 PEBS 内测邀请码"
              required
              style={inputStyle}
            />
          </Field>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 8,
            margin: '16px 0 18px',
          }}>
            <Quota label="默认权限" value="企业版" />
            <Quota label="有效时间" value="14 天" />
            <Quota label="Lean 体验" value="完整" />
          </div>

          {showApplyInvite && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginTop: 4,
              marginBottom: 4,
              fontSize: 13,
              color: '#64748b',
            }}>
              <a
                href={INVITE_APPLY_URL}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: 38,
                  padding: '0 16px',
                  borderRadius: 8,
                  background: '#0f172a',
                  color: '#fff',
                  textDecoration: 'none',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                申请邀请码
              </a>
              <span>未注册用户</span>
            </div>
          )}

          {error && (
            <div style={{
              marginTop: 8, marginBottom: 12, fontSize: 12, color: '#dc2626',
              background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: 6, padding: '8px 10px',
            }}>{error}</div>
          )}

          {!showApplyInvite && (
            <button type="submit" disabled={submitting}
              style={{
                width: '100%', minHeight: 42, fontSize: 13, fontWeight: 700,
                color: '#fff', background: submitting ? '#94a3b8' : '#2563eb',
                border: 'none', borderRadius: 8, cursor: submitting ? 'wait' : 'pointer',
                boxShadow: submitting ? 'none' : '0 10px 24px rgba(37,99,235,0.24)',
              }}
            >
              {submitting ? '验证中...' : '验证并进入'}
            </button>
          )}
        </form>
      </main>
    </div>
  )
}

function Benefit({ title, desc }: { title: string; desc: string }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.68)',
      border: '1px solid rgba(148,163,184,0.26)',
      borderRadius: 8,
      padding: '12px 14px',
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 5 }}>{title}</div>
      <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.55 }}>{desc}</div>
    </div>
  )
}

function Quota({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      border: '1px solid #dbeafe',
      background: '#eff6ff',
      borderRadius: 8,
      padding: '9px 8px',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#1d4ed8' }}>{value}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: '#334155', marginBottom: 6, fontWeight: 600 }}>{label}</div>
      {children}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 42,
  padding: '0 12px',
  fontSize: 13,
  border: '1px solid #cbd5e1',
  borderRadius: 8,
  outline: 'none',
  boxSizing: 'border-box',
  background: '#fff',
  color: '#0f172a',
}
