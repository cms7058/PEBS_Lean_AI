import React, { useEffect, useState } from 'react'
import { api, type MeResponse } from '../lib/api'

interface Props {
  onLoggedIn: (me: MeResponse) => void
  onCancel?: () => void
}

/**
 * Fullscreen login / register gate shown until /api/account/me succeeds.
 * Two tabs: 登录 and 注册. Toggle "注册" disabled when
 * LEANAI_DISABLE_REGISTRATION is set on the server.
 */
export function LoginPage({ onLoggedIn, onCancel }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [registrationAllowed, setRegistrationAllowed] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.accountConfig().then(c => setRegistrationAllowed(c.registrationAllowed)).catch(() => {})
  }, [])

  useEffect(() => { if (!registrationAllowed) setMode('login') }, [registrationAllowed])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const me = mode === 'login'
        ? await api.login(identifier.trim(), password)
        : await api.register({
            username: identifier.trim(), password,
            email: email.trim() || undefined,
            displayName: displayName.trim() || undefined,
          })
      onLoggedIn(me)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #f4f4f5 0%, #e9e9ec 100%)',
      position: 'relative',
    }}>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          style={{
            position: 'absolute', top: 20, left: 20,
            padding: '6px 12px', fontSize: 12, color: '#555',
            background: 'rgba(255,255,255,0.7)', border: '1px solid #ddd',
            borderRadius: 6, cursor: 'pointer',
          }}
        >← 返回预览</button>
      )}
      <div style={{
        width: 360, background: '#fff', borderRadius: 12, padding: '32px 28px',
        boxShadow: '0 8px 30px rgba(0,0,0,0.08)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1a1a' }}>PEBS Lean</div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>精益生产 AI 智能体</div>
        </div>

        <div style={{ display: 'flex', marginBottom: 20, borderBottom: '1px solid #eee' }}>
          <TabBtn active={mode === 'login'} onClick={() => setMode('login')}>登录</TabBtn>
          {registrationAllowed && (
            <TabBtn active={mode === 'register'} onClick={() => setMode('register')}>注册</TabBtn>
          )}
        </div>

        <form onSubmit={submit}>
          <Field label={mode === 'login' ? '用户名 / 邮箱' : '用户名'}>
            <input
              value={identifier}
              onChange={e => setIdentifier(e.target.value)}
              placeholder={mode === 'login' ? 'alice 或 alice@example.com' : '3-32 位字母数字 . _ -'}
              autoFocus required
              style={inputStyle}
            />
          </Field>

          {mode === 'register' && (
            <>
              <Field label="邮箱（可选）">
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="name@company.com" style={inputStyle} />
              </Field>
              <Field label="显示名（可选）">
                <input value={displayName} onChange={e => setDisplayName(e.target.value)}
                  placeholder="张三" style={inputStyle} />
              </Field>
            </>
          )}

          <Field label="密码">
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="至少 6 位" required minLength={6} style={inputStyle} />
          </Field>

          {error && (
            <div style={{
              marginTop: 8, marginBottom: 12, fontSize: 12, color: '#dc2626',
              background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: 6, padding: '8px 10px',
            }}>{error}</div>
          )}

          <button type="submit" disabled={submitting}
            style={{
              width: '100%', padding: '10px', fontSize: 13, fontWeight: 500,
              color: '#fff', background: submitting ? '#888' : '#111',
              border: 'none', borderRadius: 8, cursor: submitting ? 'wait' : 'pointer',
              marginTop: 4,
            }}
          >
            {submitting ? '处理中…' : (mode === 'login' ? '登录' : '注册并登录')}
          </button>

          <div style={{ marginTop: 14, fontSize: 11, color: '#999', textAlign: 'center', lineHeight: 1.6 }}>
            {mode === 'register'
              ? '注册即创建新的工作区；新账号享 14 天免费试用'
              : (registrationAllowed ? '还没有账号？点击上方「注册」' : '注册已关闭，请联系管理员开通账号')}
          </div>
        </form>
      </div>
    </div>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      style={{
        flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 500,
        color: active ? '#111' : '#888', background: 'transparent',
        border: 'none', borderBottom: active ? '2px solid #111' : '2px solid transparent',
        cursor: 'pointer',
      }}>{children}</button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: '#666', marginBottom: 4, fontWeight: 500 }}>{label}</div>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 10px', fontSize: 13,
  border: '1px solid #ddd', borderRadius: 6, outline: 'none',
  boxSizing: 'border-box',
}
