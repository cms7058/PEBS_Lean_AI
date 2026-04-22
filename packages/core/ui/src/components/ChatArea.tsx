import React, { useEffect, useRef } from 'react'
import { MessageBubble } from './MessageBubble'
import { InputBar } from './InputBar'
import { useChat } from '../hooks/useChat'
import type { Message, Provider } from '../lib/api'

interface Props {
  conversationId: string | null
  initialMessages?: Message[]
  currentProvider: string
  currentModel: string
  providers: Provider[]
  loadingModel: boolean
  onSelectModel: (provider: string, model: string) => void
  onConversationCreated: (id: string) => void
}

export function ChatArea({
  conversationId, initialMessages, currentProvider, currentModel,
  providers, loadingModel, onSelectModel, onConversationCreated,
}: Props) {
  const { messages, status, error, sendMessage, setMessages, setConversationId, cancel } = useChat(
    conversationId ?? undefined
  )
  const bottomRef = useRef<HTMLDivElement>(null)
  const isStreaming = status === 'streaming'

  useEffect(() => {
    setConversationId(conversationId)
    setMessages(initialMessages ?? [])
  }, [conversationId, initialMessages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = (text: string) => {
    sendMessage(text, { provider: currentProvider, model: currentModel })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#f4f4f5' }}>
      {/* Message list */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <div style={{ maxWidth: 680, margin: '0 auto', padding: '40px 24px 20px', minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
          {messages.length === 0 ? (
            <WelcomeScreen currentModel={currentModel} providers={providers} currentProvider={currentProvider} />
          ) : (
            messages.map((msg, i) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                isStreaming={isStreaming && i === messages.length - 1 && msg.role === 'assistant'}
              />
            ))
          )}

          {error && (
            <div style={{
              marginBottom: 16, padding: '8px 12px', borderRadius: 6, fontSize: 12,
              background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)',
              color: '#dc2626',
            }}>
              {error}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <InputBar
        onSend={handleSend}
        disabled={isStreaming}
        onCancel={cancel}
        providers={providers}
        currentProvider={currentProvider}
        currentModel={currentModel}
        loadingModel={loadingModel}
        onSelectModel={onSelectModel}
      />
    </div>
  )
}

function WelcomeScreen({ currentModel, currentProvider, providers }: {
  currentModel: string; currentProvider: string; providers: Provider[]
}) {
  const providerObj = providers.find(p => p.id === currentProvider)
  const configured = providerObj?.configured ?? false

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', minHeight: 300 }}>
      <h1 style={{ fontSize: 18, fontWeight: 600, color: '#1a1a1a', marginBottom: 6 }}>
        PEBS Lean 精益生产顾问
      </h1>
      <p style={{ fontSize: 12, color: '#aaa', marginBottom: 28, lineHeight: 1.7 }}>
        基于 AI 的精益诊断 · 根因分析 · 改善方案制定
      </p>

      {!configured && (
        <div style={{
          marginBottom: 24, padding: '8px 16px', borderRadius: 6, fontSize: 12,
          background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.25)',
          color: '#92400e',
        }}>
          当前模型 <span style={{ color: '#b45309', fontWeight: 500 }}>{currentModel}</span> 尚未配置 API Key，点击左侧「设置」进行配置
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, width: '100%', maxWidth: 400 }}>
        {SUGGESTIONS.map(s => (
          <div key={s.title} style={{
            textAlign: 'left', padding: '10px 12px', borderRadius: 8,
            background: '#fff', border: '1px solid #e8e8e8', cursor: 'default',
          }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = '#ccc')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = '#e8e8e8')}
          >
            <div style={{ fontSize: 12, fontWeight: 500, color: '#333', marginBottom: 2 }}>{s.title}</div>
            <div style={{ fontSize: 11, color: '#aaa', lineHeight: 1.5 }}>{s.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

const SUGGESTIONS = [
  { title: '效率问题诊断', desc: '产能不足、节拍超标、设备停机' },
  { title: '质量问题分析', desc: '良品率低、频繁返工、客户投诉' },
  { title: '库存问题优化', desc: '库存积压、周转慢、WIP 过多' },
  { title: '交期问题改善', desc: '交货延迟、计划不准、插单频繁' },
]
