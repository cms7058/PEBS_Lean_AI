import React, { useState, useEffect } from 'react'
import { api } from '../lib/api'
import type { Provider } from '../lib/api'

interface AuthStatus {
  provider: string; name: string; authMethod: string
  configured: boolean; oauthConnected: boolean; apiKeySet: boolean
  apiKeyUrl?: string; supportsOAuth: boolean; supportsBrowserLogin?: boolean; hint?: string
}

interface Props { providers: Provider[]; onClose: () => void }

export function SettingsModal({ providers, onClose }: Props) {
  const [tab, setTab] = useState<'models' | 'about'>('models')
  const [authStatus, setAuthStatus] = useState<AuthStatus[]>([])
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [wenxin, setWenxin] = useState({ apiKey: '', secretKey: '' })
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434')
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [oauthLoading, setOauthLoading] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [perProviderTest, setPerProviderTest] = useState<Record<string, { ok: boolean; msg: string } | undefined>>({})
  const [testingProvider, setTestingProvider] = useState<string | null>(null)
  const [browserLoading, setBrowserLoading] = useState<string | null>(null)

  const loadStatus = () =>
    fetch('/api/auth/status').then(r => r.json()).then(setAuthStatus).catch(console.error)

  useEffect(() => {
    loadStatus()
    api.getConfig().then(cfg => {
      const k = cfg.apiKeys as Record<string, unknown>
      if (k.ollama && typeof k.ollama === 'object')
        setOllamaUrl((k.ollama as { baseUrl?: string }).baseUrl ?? 'http://localhost:11434')
    }).catch(console.error)
  }, [])

  const saveApiKey = async (provider: string) => {
    setSaving(provider)
    setSaveError(null)
    try {
      if (provider === 'wenxin') await api.setWenxinKeys(wenxin.apiKey, wenxin.secretKey)
      else if (provider === 'ollama') {
        await fetch('/api/config/apikey/ollama', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: ollamaUrl }),
        })
      } else await api.setApiKey(provider, keys[provider] ?? '')
      setSaved(provider)
      // Auto-test the provider we just configured (uses provider's default model).
      testProvider(provider)
      setTimeout(() => { setSaved(null); loadStatus() }, 1500)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '保存失败，请重试')
    } finally {
      setSaving(null)
    }
  }

  const startOAuth = async (provider: string) => {
    setOauthLoading(provider)
    try {
      const res = await fetch('/api/auth/oauth/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error)
      const poll = setInterval(loadStatus, 2000)
      setTimeout(() => { clearInterval(poll); setOauthLoading(null) }, 120_000)
    } catch (err) { console.error(err); setOauthLoading(null) }
  }

  const revokeOAuth = async (provider: string) => {
    await fetch(`/api/auth/oauth/${provider}`, { method: 'DELETE' })
    loadStatus()
  }

  const testProvider = async (provider: string) => {
    setTestingProvider(provider)
    setPerProviderTest(prev => ({ ...prev, [provider]: { ok: true, msg: '测试中…' } }))
    try {
      const r = await api.testProvider(provider)
      setPerProviderTest(prev => ({
        ...prev,
        [provider]: r.ok
          ? { ok: true, msg: '✓ 连接成功' }
          : { ok: false, msg: `✗ ${r.error ?? '连接失败'}` },
      }))
    } catch (err) {
      setPerProviderTest(prev => ({
        ...prev,
        [provider]: { ok: false, msg: `✗ ${err instanceof Error ? err.message : '连接失败'}` },
      }))
    } finally {
      setTestingProvider(null)
    }
  }

  const browserLogin = async (provider: string) => {
    setBrowserLoading(provider)
    try {
      await fetch(`/api/auth/browser-login/${provider}`, { method: 'POST' })
    } catch (err) { console.error(err) }
    finally { setTimeout(() => setBrowserLoading(null), 800) }
  }

  const testConnection = async () => {
    setTestResult({ ok: true, msg: '测试中...' })
    const r = await api.testConnection()
    setTestResult(r.ok ? { ok: true, msg: '✓ 连接成功' } : { ok: false, msg: `✗ ${r.error ?? '连接失败'}` })
    setTimeout(() => setTestResult(null), 4000)
  }

  const getAuth = (pid: string) => authStatus.find(s => s.provider === pid)

  const TABS = [{ key: 'models', label: '模型配置' }, { key: 'about', label: '关于' }] as const

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }} />
      <div style={{
        position: 'relative', width: '100%', maxWidth: 520,
        maxHeight: '88vh', display: 'flex', flexDirection: 'column',
        background: '#fff', border: '1px solid #e4e4e4', borderRadius: 12,
        boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid #eee', flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>设置</span>
          <button onClick={onClose}
            onMouseEnter={e => (e.currentTarget.style.color = '#333')}
            onMouseLeave={e => (e.currentTarget.style.color = '#bbb')}
            style={{ color: '#bbb', lineHeight: 0 }}>
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #eee', flexShrink: 0 }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{
                padding: '10px 20px', fontSize: 12,
                color: tab === t.key ? '#1a1a1a' : '#aaa',
                borderBottom: `2px solid ${tab === t.key ? '#333' : 'transparent'}`,
                marginBottom: -1, transition: 'color 0.1s',
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20, minHeight: 0 }}>
          {tab === 'models' && (
            <>
              <p style={{ fontSize: 11, color: '#aaa', marginBottom: 14 }}>
                API Key 仅保存于本地 <code style={{ color: '#666', fontFamily: 'monospace' }}>~/.lean-ai/config.json</code>
              </p>

              {providers.map(p => (
                <ProviderCard
                  key={p.id} provider={p} auth={getAuth(p.id)}
                  keyValue={p.id === 'ollama' ? ollamaUrl : (keys[p.id] ?? '')}
                  wenxin={wenxin}
                  saving={saving === p.id} saved={saved === p.id}
                  oauthLoading={oauthLoading === p.id}
                  browserLoading={browserLoading === p.id}
                  testing={testingProvider === p.id}
                  testResult={perProviderTest[p.id]}
                  onChangeKey={v => setKeys(k => ({ ...k, [p.id]: v }))}
                  onChangeOllama={setOllamaUrl}
                  onChangeWenxin={setWenxin}
                  onSave={() => saveApiKey(p.id)}
                  onTest={() => testProvider(p.id)}
                  onStartOAuth={() => startOAuth(p.id)}
                  onRevokeOAuth={() => revokeOAuth(p.id)}
                  onBrowserLogin={() => browserLogin(p.id)}
                />
              ))}

              {saveError && (
                <div style={{ marginTop: 8, padding: '7px 12px', borderRadius: 6, fontSize: 11, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)', color: '#dc2626' }}>
                  {saveError}
                </div>
              )}

              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #eee' }}>
                <button onClick={testConnection}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#bbb')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = '#e4e4e4')}
                  style={{
                    padding: '6px 12px', borderRadius: 5, fontSize: 11,
                    background: '#fafafa', color: '#555', border: '1px solid #e4e4e4',
                  }}>
                  测试当前模型连接
                </button>
                {testResult && (
                  <p style={{ marginTop: 8, fontSize: 11, color: testResult.ok ? '#16a34a' : '#dc2626' }}>
                    {testResult.msg}
                  </p>
                )}
              </div>
            </>
          )}

          {tab === 'about' && (
            <div style={{ fontSize: 12, color: '#666', lineHeight: 1.8 }}>
              <div style={{ textAlign: 'center', padding: '16px 0 20px', borderBottom: '1px solid #eee', marginBottom: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a', marginBottom: 4 }}>PEBS Lean v1.0.0</div>
                <div style={{ color: '#aaa' }}>精益生产 AI 智能体</div>
              </div>
              <p style={{ marginBottom: 12, color: '#555' }}>
                帮助制造业企业通过 AI 辅助识别浪费、分析根因、制定改善方案。
              </p>
              <ul style={{ color: '#666', paddingLeft: 0, listStyle: 'none' }}>
                {['数据存储于本地 ~/.lean-ai/', '支持 Claude、OpenAI、DeepSeek、通义千问、MiniMax、文心一言、Ollama', 'Phase 2: Skill 插件系统 & Tool Calling', 'Phase 3: 知识库 RAG 检索', 'Phase 4: 8D / DMAIC 报告导出'].map(s => (
                  <li key={s} style={{ marginBottom: 4 }}>· {s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ProviderCard({
  provider, auth, keyValue, wenxin, saving, saved, oauthLoading,
  browserLoading, testing, testResult,
  onChangeKey, onChangeOllama, onChangeWenxin,
  onSave, onTest, onStartOAuth, onRevokeOAuth, onBrowserLogin,
}: {
  provider: Provider; auth?: AuthStatus; keyValue: string
  wenxin: { apiKey: string; secretKey: string }
  saving: boolean; saved: boolean; oauthLoading: boolean
  browserLoading: boolean; testing: boolean
  testResult?: { ok: boolean; msg: string }
  onChangeKey: (v: string) => void; onChangeOllama: (v: string) => void
  onChangeWenxin: (v: { apiKey: string; secretKey: string }) => void
  onSave: () => void; onTest: () => void
  onStartOAuth: () => void; onRevokeOAuth: () => void
  onBrowserLogin: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [hover, setHover] = useState(false)
  const isConfigured = auth?.configured ?? provider.configured
  const isOAuth = auth?.oauthConnected ?? false

  return (
    <div style={{ border: '1px solid #eee', borderRadius: 8, marginBottom: 6, overflow: 'hidden' }}>
      {/* Header */}
      <button
        onClick={() => setExpanded(e => !e)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', background: expanded || hover ? '#f9f9f9' : '#fafafa',
          cursor: 'pointer', transition: 'background 0.1s',
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: isConfigured ? '#22c55e' : '#ddd' }} />
        <span style={{ flex: 1, textAlign: 'left', fontSize: 12, color: isConfigured ? '#1a1a1a' : '#aaa' }}>
          {provider.name}
        </span>
        {isOAuth && (
          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0', marginRight: 4 }}>
            OAuth
          </span>
        )}
        {isConfigured && !isOAuth && <span style={{ fontSize: 10, color: '#ccc', marginRight: 4 }}>已配置</span>}
        <svg width="10" height="10" fill="none" stroke="#ccc" viewBox="0 0 24 24"
          style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div style={{ padding: '12px 14px 14px', background: '#fff', borderTop: '1px solid #eee' }}>
          {auth?.hint && <p style={{ fontSize: 11, color: '#aaa', marginBottom: 10 }}>{auth.hint}</p>}

          {/* Ollama */}
          {provider.id === 'ollama' && (
            <div>
              <label style={labelStyle}>服务地址</label>
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <input value={keyValue} onChange={e => onChangeOllama(e.target.value)}
                  placeholder="http://localhost:11434" style={inputStyle} />
                <SaveBtn saving={saving} saved={saved} disabled={!keyValue.trim()} onClick={onSave} />
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
                <button onClick={onTest} disabled={testing}
                  style={{
                    padding: '4px 10px', borderRadius: 4, fontSize: 11,
                    background: '#fafafa', color: testing ? '#ccc' : '#555',
                    border: '1px solid #e4e4e4', cursor: testing ? 'default' : 'pointer',
                  }}>
                  {testing ? '测试中…' : '测试连接'}
                </button>
                {testResult && (
                  <span style={{ fontSize: 11, color: testResult.ok ? '#16a34a' : '#dc2626' }}>
                    {testResult.msg}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Wenxin */}
          {provider.id === 'wenxin' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input value={wenxin.apiKey} onChange={e => onChangeWenxin({ ...wenxin, apiKey: e.target.value })}
                type="password" placeholder="API Key" style={inputStyle} />
              <input value={wenxin.secretKey} onChange={e => onChangeWenxin({ ...wenxin, secretKey: e.target.value })}
                type="password" placeholder="Secret Key" style={inputStyle} />
              <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                <SaveBtn saving={saving} saved={saved} disabled={!wenxin.apiKey || !wenxin.secretKey} onClick={onSave} />
                {auth?.apiKeyUrl && <LinkBtn href={auth.apiKeyUrl} label="获取凭证" />}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
                <button onClick={onTest} disabled={testing || !auth?.apiKeySet}
                  style={{
                    padding: '4px 10px', borderRadius: 4, fontSize: 11,
                    background: '#fafafa', color: testing || !auth?.apiKeySet ? '#ccc' : '#555',
                    border: '1px solid #e4e4e4',
                    cursor: testing || !auth?.apiKeySet ? 'default' : 'pointer',
                  }}>
                  {testing ? '测试中…' : '测试连接'}
                </button>
                {testResult && (
                  <span style={{ fontSize: 11, color: testResult.ok ? '#16a34a' : '#dc2626' }}>
                    {testResult.msg}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Standard providers */}
          {provider.id !== 'ollama' && provider.id !== 'wenxin' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Auth login block — real OAuth where available, browser-assist otherwise */}
              {(auth?.supportsOAuth || auth?.supportsBrowserLogin) && !isOAuth && (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  padding: '10px 12px', background: '#fafafa', border: '1px solid #eee', borderRadius: 6,
                }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 500, color: '#333', marginBottom: 2 }}>
                      {auth.supportsOAuth ? 'OAuth 授权登录' : '浏览器登录获取 Key'}
                    </div>
                    <div style={{ fontSize: 10, color: '#aaa' }}>
                      {auth.supportsOAuth
                        ? '浏览器授权，自动获取访问凭证'
                        : '打开官网凭证页面，登录后复制 Key 粘贴到下方'}
                    </div>
                  </div>
                  <button
                    onClick={auth.supportsOAuth ? onStartOAuth : onBrowserLogin}
                    disabled={oauthLoading || browserLoading}
                    onMouseEnter={e => { if (!oauthLoading && !browserLoading) e.currentTarget.style.background = '#f0fdf4' }}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    style={{
                      padding: '4px 10px', borderRadius: 4, fontSize: 11, flexShrink: 0,
                      color: (oauthLoading || browserLoading) ? '#aaa' : '#16a34a',
                      border: `1px solid ${(oauthLoading || browserLoading) ? '#eee' : '#bbf7d0'}`,
                      cursor: (oauthLoading || browserLoading) ? 'wait' : 'pointer',
                    }}>
                    {oauthLoading ? '授权中…' : browserLoading ? '打开中…' : '授权登录'}
                  </button>
                </div>
              )}

              {/* OAuth connected state */}
              {auth?.supportsOAuth && isOAuth && (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  padding: '10px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6,
                }}>
                  <div style={{ fontSize: 11, color: '#166534' }}>已通过 OAuth 连接</div>
                  <button onClick={onRevokeOAuth}
                    onMouseEnter={e => (e.currentTarget.style.background = '#fef2f2')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    style={{ padding: '4px 10px', borderRadius: 4, fontSize: 11, color: '#dc2626', border: '1px solid #fecaca' }}>
                    断开连接
                  </button>
                </div>
              )}

              {/* API Key input */}
              {!isOAuth && (
                <>
                  <label style={labelStyle}>API Key</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input value={keyValue} onChange={e => onChangeKey(e.target.value)}
                      type="password" placeholder="sk-..." style={inputStyle} />
                    <SaveBtn saving={saving} saved={saved} disabled={!keyValue.trim()} onClick={onSave} />
                    {auth?.apiKeyUrl && <LinkBtn href={auth.apiKeyUrl} label="获取" />}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
                    <button onClick={onTest} disabled={testing || !auth?.apiKeySet}
                      onMouseEnter={e => { if (!testing && auth?.apiKeySet) e.currentTarget.style.borderColor = '#bbb' }}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = '#e4e4e4')}
                      style={{
                        padding: '4px 10px', borderRadius: 4, fontSize: 11,
                        background: '#fafafa',
                        color: testing || !auth?.apiKeySet ? '#ccc' : '#555',
                        border: '1px solid #e4e4e4',
                        cursor: testing || !auth?.apiKeySet ? 'default' : 'pointer',
                      }}>
                      {testing ? '测试中…' : '测试连接'}
                    </button>
                    {testResult && (
                      <span style={{ fontSize: 11, color: testResult.ok ? '#16a34a' : '#dc2626' }}>
                        {testResult.msg}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const labelStyle: React.CSSProperties = { fontSize: 11, color: '#888' }

const inputStyle: React.CSSProperties = {
  flex: 1, padding: '6px 10px', borderRadius: 5, fontSize: 11,
  background: '#fafafa', color: '#1a1a1a', border: '1px solid #e4e4e4',
  caretColor: '#555',
}

function SaveBtn({ saving, saved, disabled, onClick }: { saving: boolean; saved: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled || saving}
      style={{
        padding: '6px 10px', borderRadius: 5, fontSize: 11, flexShrink: 0,
        background: saved ? '#f0fdf4' : '#fafafa',
        color: saved ? '#16a34a' : disabled ? '#ccc' : '#555',
        border: `1px solid ${saved ? '#bbf7d0' : '#e4e4e4'}`,
        cursor: disabled || saving ? 'default' : 'pointer',
      }}>
      {saving ? '...' : saved ? '✓ 已保存' : '保存'}
    </button>
  )
}

function LinkBtn({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      onMouseEnter={e => { e.currentTarget.style.color = '#333'; e.currentTarget.style.borderColor = '#bbb' }}
      onMouseLeave={e => { e.currentTarget.style.color = '#888'; e.currentTarget.style.borderColor = '#e4e4e4' }}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '6px 10px', borderRadius: 5, fontSize: 11,
        color: '#888', border: '1px solid #e4e4e4', flexShrink: 0,
        textDecoration: 'none', transition: 'all 0.1s',
      }}>
      {label}
      <svg width="9" height="9" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </a>
  )
}
