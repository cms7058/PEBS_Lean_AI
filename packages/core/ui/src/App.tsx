import React, { useState, useEffect, useCallback } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatArea } from './components/ChatArea'
import { SettingsModal } from './components/SettingsModal'
import { SkillsModal } from './components/SkillsModal'
import { KnowledgeModal } from './components/KnowledgeModal'
import { PricingModal } from './components/PricingModal'
import { UsageModal } from './components/UsageModal'
import { HelpModal } from './components/HelpModal'
import { LoginPage } from './components/LoginPage'
import { AdminConsole } from './components/AdminConsole'
import { useModels } from './hooks/useModels'
import { api, type Conversation, type Message, type SubscriptionStatus, type MeResponse } from './lib/api'

/**
 * Auth lifecycle:
 *   loading        — checking /api/account/me on boot
 *   preview        — anonymous; show read-only agent preview, any click → login
 *   login          — login / register form
 *   authenticated  — full app
 */
type AuthState =
  | { kind: 'loading' }
  | { kind: 'preview' }
  | { kind: 'login' }
  | { kind: 'authenticated'; me: MeResponse }

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    api.me()
      .then(me => { if (!cancelled) setAuth({ kind: 'authenticated', me }) })
      .catch(() => { if (!cancelled) setAuth({ kind: 'preview' }) })
    return () => { cancelled = true }
  }, [])

  if (auth.kind === 'loading') {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#f4f4f5', color: '#888', fontSize: 13,
      }}>加载中…</div>
    )
  }

  if (auth.kind === 'login') {
    return (
      <LoginPage
        onLoggedIn={me => setAuth({ kind: 'authenticated', me })}
        onCancel={() => setAuth({ kind: 'preview' })}
      />
    )
  }

  if (auth.kind === 'preview') {
    return <PreviewApp onRequireAuth={() => setAuth({ kind: 'login' })} />
  }

  return (
    <AuthenticatedApp
      me={auth.me}
      onLoggedOut={() => setAuth({ kind: 'preview' })}
    />
  )
}

// ---------------------------------------------------------------------------
// Preview mode — anonymous landing page modelled after the real product so
// visitors can feel what LeanAI does before registering.  Any click or key
// press captured at the root switches to the login / register page.
// ---------------------------------------------------------------------------
function PreviewApp({ onRequireAuth }: { onRequireAuth: () => void }) {
  // Capture phase so we preempt any descendant handler (sidebar button, input,
  // etc.).  stopPropagation prevents a stray "open modal" flash during the
  // re-render that swaps us out for LoginPage.
  const intercept = (e: React.SyntheticEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onRequireAuth()
  }

  return (
    <div
      onClickCapture={intercept}
      onKeyDownCapture={intercept}
      onSubmitCapture={intercept}
      style={{
        display: 'flex', height: '100%',
        background: '#f4f4f5', overflow: 'hidden',
        cursor: 'pointer',
      }}
    >
      {/* Dimmed sidebar shell */}
      <aside style={{
        width: 220, flexShrink: 0, background: '#ebebeb',
        borderRight: '1px solid #ddd', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          padding: '12px 16px', borderBottom: '1px solid #ddd',
          fontSize: 14, fontWeight: 700, color: '#1a1a1a',
        }}>
          PEBS Lean
        </div>
        <div style={{ padding: '14px 16px', fontSize: 11, color: '#999', lineHeight: 1.8 }}>
          <div style={{ color: '#666', fontWeight: 500, marginBottom: 8 }}>试用预览</div>
          <div>· 多 LLM 统一对话</div>
          <div>· 精益诊断智能体</div>
          <div>· 价值流 / 鱼骨 / Pareto 图</div>
          <div>· 8D / DMAIC 报告导出</div>
          <div>· 本地知识库 RAG 检索</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{
          padding: '10px 16px', borderTop: '1px solid #ddd',
          fontSize: 11, color: '#a16207', background: '#fef9c3',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', background: '#eab308',
          }} />
          未注册用户
        </div>
      </aside>

      <main style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        minWidth: 0, position: 'relative',
      }}>
        {/* Top banner */}
        <div style={{
          padding: '10px 20px', background: '#fef9c3',
          borderBottom: '1px solid #fde68a', color: '#854d0e',
          fontSize: 12, display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.008v.008H12v-.008z" />
          </svg>
          <span><b>未注册用户</b> · 这是演示预览，所有功能需要登录或注册后使用</span>
          <span style={{ flex: 1 }} />
          <span style={{
            padding: '4px 12px', background: '#111', color: '#fff',
            borderRadius: 6, fontWeight: 500,
          }}>
            点击任意位置登录 / 注册 →
          </span>
        </div>

        {/* Hero demo */}
        <div style={{
          flex: 1, overflow: 'auto',
          padding: '40px 24px', display: 'flex', justifyContent: 'center',
        }}>
          <div style={{ width: '100%', maxWidth: 760 }}>
            <h1 style={{
              fontSize: 28, fontWeight: 700, color: '#111', marginBottom: 8,
            }}>
              PEBS Lean · 精益生产 AI 智能体
            </h1>
            <p style={{ fontSize: 14, color: '#555', lineHeight: 1.7, marginBottom: 32 }}>
              描述产线问题，智能体自动调用诊断、图表、报告、知识库等技能，
              给出结构化改善方案并导出 Word / PDF。支持 Claude、GPT、DeepSeek、通义千问、文心一言、本地 Ollama 多种模型。
            </p>

            {/* Fake chat snippet */}
            <div style={{
              background: '#fff', borderRadius: 10, border: '1px solid #e5e5e5',
              padding: '20px 24px', marginBottom: 20,
            }}>
              <div style={{ fontSize: 12, color: '#777', marginBottom: 14 }}>示例对话</div>

              <UserBubble>我们焊接线产能不足，节拍时间超标 30%</UserBubble>
              <AssistantBubble>
                我来帮您诊断。先分类这个问题并收集数据。<br/>
                <i style={{ color: '#888' }}>▸ 调用 start_diagnosis → probe_data(efficiency)</i>
              </AssistantBubble>
              <AssistantBubble>
                根据您提供的节拍和工序时间，<b>瓶颈在焊点位 #3</b>（CT 78s vs Takt 60s）。
                <br/>建议从 SMED 减少换模、Poka-Yoke 减少返工两方向入手。
                <br/><i style={{ color: '#888' }}>▸ 调用 generate_pareto · generate_fishbone</i>
              </AssistantBubble>
              <UserBubble>生成完整的 8D 报告</UserBubble>
              <AssistantBubble>
                已生成 8D 报告（Word + PDF 两个版本），可直接下载。
                <br/><i style={{ color: '#888' }}>▸ 调用 generate_8d_report · export_report</i>
              </AssistantBubble>
            </div>

            {/* Fake input bar */}
            <div style={{
              background: '#fff', border: '1px solid #ddd', borderRadius: 10,
              padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10,
              boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
            }}>
              <input
                readOnly
                placeholder="描述您的精益问题 …（需登录后使用）"
                style={{
                  flex: 1, border: 'none', outline: 'none', fontSize: 13,
                  color: '#666', background: 'transparent',
                }}
              />
              <button style={{
                padding: '8px 16px', background: '#111', color: '#fff',
                border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 500,
                cursor: 'pointer',
              }}>
                登录使用
              </button>
            </div>

            <div style={{ textAlign: 'center', marginTop: 24, fontSize: 12, color: '#888' }}>
              新账号享 <b style={{ color: '#111' }}>14 天免费试用</b>，无需信用卡
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
      <div style={{
        maxWidth: '70%', padding: '10px 14px', borderRadius: 10,
        background: '#111', color: '#fff', fontSize: 13, lineHeight: 1.6,
      }}>{children}</div>
    </div>
  )
}

function AssistantBubble({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 12 }}>
      <div style={{
        maxWidth: '82%', padding: '10px 14px', borderRadius: 10,
        background: '#f4f4f5', color: '#333', fontSize: 13, lineHeight: 1.7,
      }}>{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Real authenticated app (unchanged logic — just extracted to a subcomponent
// so the anonymous preview branch can render without triggering protected API
// polling).
// ---------------------------------------------------------------------------
function AuthenticatedApp({ me, onLoggedOut }: { me: MeResponse; onLoggedOut: () => void }) {
  const { providers, currentProvider, currentModel, setModel, loading, reload: reloadModels } = useModels()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeMessages, setActiveMessages] = useState<Message[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [showSkills, setShowSkills] = useState(false)
  const [showKnowledge, setShowKnowledge] = useState(false)
  const [showPricing, setShowPricing] = useState(false)
  const [showUsage, setShowUsage] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showAdmin, setShowAdmin] = useState(false)
  const [subStatus, setSubStatus] = useState<SubscriptionStatus | null>(null)

  const loadSubStatus = useCallback(() => {
    api.getSubscriptionStatus().then(setSubStatus).catch(() => {})
  }, [])
  useEffect(() => { loadSubStatus() }, [loadSubStatus])
  useEffect(() => {
    const id = setInterval(loadSubStatus, 30000)
    return () => clearInterval(id)
  }, [loadSubStatus])

  const planBadge = subStatus ? {
    name: subStatus.plan.name.replace('订阅', '').replace('试用', '试用'),
    warning: subStatus.trialExpired
      ? '已到期'
      : (subStatus.trialDaysRemaining != null && subStatus.trialDaysRemaining <= 3
          ? `${subStatus.trialDaysRemaining}天`
          : undefined),
  } : null

  const loadConversations = useCallback(() => {
    api.getConversations().then(setConversations).catch(console.error)
  }, [])

  useEffect(() => { loadConversations() }, [loadConversations])
  useEffect(() => {
    const id = setInterval(loadConversations, 3000)
    return () => clearInterval(id)
  }, [loadConversations])

  const selectConversation = async (conv: Conversation) => {
    setActiveId(conv.id)
    try {
      const detail = await api.getConversation(conv.id)
      setActiveMessages(detail.messages)
    } catch { setActiveMessages([]) }
  }

  const newConversation = () => { setActiveId(null); setActiveMessages([]) }

  const deleteConversation = async (id: string) => {
    await api.deleteConversation(id).catch(console.error)
    setConversations(prev => prev.filter(c => c.id !== id))
    if (activeId === id) newConversation()
  }

  const handleLogout = async () => {
    try { await api.logout() } catch { /* ignore */ }
    onLoggedOut()
  }

  return (
    <div style={{ display: 'flex', height: '100%', background: '#f4f4f5', overflow: 'hidden' }}>
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={selectConversation}
        onNew={newConversation}
        onDelete={deleteConversation}
        onOpenSettings={() => setShowSettings(true)}
        onOpenSkills={() => setShowSkills(true)}
        onOpenKnowledge={() => setShowKnowledge(true)}
        onOpenPricing={() => setShowPricing(true)}
        onOpenUsage={() => setShowUsage(true)}
        onOpenHelp={() => setShowHelp(true)}
        planBadge={planBadge}
        me={me}
        onOpenAdmin={() => setShowAdmin(true)}
        onLogout={handleLogout}
      />

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: '#f4f4f5' }}>
        <ChatArea
          conversationId={activeId}
          initialMessages={activeMessages}
          currentProvider={currentProvider}
          currentModel={currentModel}
          providers={providers}
          loadingModel={loading}
          onSelectModel={setModel}
          onConversationCreated={(id) => { setActiveId(id); loadConversations() }}
        />
      </main>

      {showSettings && (
        <SettingsModal providers={providers} onClose={() => { setShowSettings(false); reloadModels() }} />
      )}
      {showSkills && (
        <SkillsModal onClose={() => setShowSkills(false)} />
      )}
      {showKnowledge && (
        <KnowledgeModal onClose={() => setShowKnowledge(false)} />
      )}
      {showPricing && (
        <PricingModal
          onClose={() => setShowPricing(false)}
          onChanged={loadSubStatus}
        />
      )}
      {showUsage && (
        <UsageModal
          onClose={() => setShowUsage(false)}
          onOpenPricing={() => { setShowUsage(false); setShowPricing(true) }}
        />
      )}
      {showHelp && (
        <HelpModal onClose={() => setShowHelp(false)} />
      )}
      {showAdmin && me.user.role === 'admin' && (
        <AdminConsole onClose={() => setShowAdmin(false)} />
      )}
    </div>
  )
}
