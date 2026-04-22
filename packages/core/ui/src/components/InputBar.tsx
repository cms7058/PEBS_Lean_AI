import React, { useState, useRef, useEffect } from 'react'
import { api, type Provider } from '../lib/api'

interface Props {
  onSend: (text: string) => void
  disabled?: boolean
  onCancel?: () => void
  providers: Provider[]
  currentProvider: string
  currentModel: string
  loadingModel: boolean
  onSelectModel: (provider: string, model: string) => void
}

export function InputBar({
  onSend, disabled, onCancel,
  providers, currentProvider, currentModel, loadingModel, onSelectModel,
}: Props) {
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const canSend = !!text.trim() && !disabled

  const isAcceptedFile = (f: File) =>
    /\.(xls|xlsx|csv|tsv)$/i.test(f.name)

  const handleDataUpload = async (file: File) => {
    if (!isAcceptedFile(file)) {
      setUploadError(`仅支持 .xls / .xlsx / .csv / .tsv（当前：${file.name}）`)
      return
    }
    setUploading(true); setUploadError(null)
    try {
      const parsed = await api.parseChartData(file)
      // Build a self-describing block the LLM can read & chart.
      const first = parsed.sheets[0]
      const header = `[已导入数据文件 ${parsed.filename}]`
      const meta = parsed.sheets
        .map(s => `- 工作表 "${s.name}"：${s.rowCount} 行，列：${s.headers.join(' / ')}`)
        .join('\n')
      const body = `以下是第一个工作表 "${first.name}" 的前 20 行（CSV）：\n\`\`\`csv\n${first.preview}\n\`\`\``
      const ask = '\n请根据上述数据，选择合适的图表工具（柏拉图/箱型图/鱼骨图/VSM）生成图表。'
      const chunk = [header, meta, body, ask].join('\n\n')
      setText(prev => (prev ? prev + '\n\n' : '') + chunk)
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleSend = () => {
    const t = text.trim()
    if (!t || disabled) return
    onSend(t)
    setText('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
  }, [text])

  return (
    <div style={{ flexShrink: 0, padding: '0 16px 16px', background: '#f4f4f5' }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        {/* Input box (with drag-and-drop for xls/csv) */}
        <div
          onDragEnter={(e) => { e.preventDefault(); if (!disabled && !uploading) setDragging(true) }}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
          onDragLeave={(e) => {
            // Only hide when leaving the outer container (not moving between children)
            if (e.currentTarget === e.target) setDragging(false)
          }}
          onDrop={(e) => {
            e.preventDefault(); setDragging(false)
            if (disabled || uploading) return
            const f = e.dataTransfer.files?.[0]
            if (f) handleDataUpload(f)
          }}
          style={{
            position: 'relative',
            background: '#fff',
            border: `1px solid ${dragging ? '#3b82f6' : (focused ? '#bbb' : '#e4e4e4')}`,
            borderRadius: 10,
            transition: 'border-color 0.15s, box-shadow 0.15s',
            boxShadow: dragging
              ? '0 0 0 3px rgba(59,130,246,0.15)'
              : (focused ? '0 0 0 3px rgba(0,0,0,0.04)' : '0 1px 3px rgba(0,0,0,0.06)'),
          }}>
          {dragging && (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 2, borderRadius: 10,
              background: 'rgba(239,246,255,0.92)',
              border: '1.5px dashed #3b82f6',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 500, color: '#1d4ed8',
              pointerEvents: 'none',
            }}>
              📎 松开以导入数据文件（.xls / .xlsx / .csv / .tsv）
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            disabled={disabled}
            placeholder="发送消息…"
            rows={1}
            style={{
              display: 'block', width: '100%', resize: 'none',
              background: 'transparent', padding: '12px 14px 6px',
              fontSize: 13, lineHeight: 1.6, color: '#1a1a1a',
              caretColor: '#555', minHeight: 42,
            }}
          />

          {/* Toolbar */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '4px 10px 8px',
          }}>
            {/* Model selector + data upload */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {!loadingModel && (
                <ModelPill
                  providers={providers}
                  currentProvider={currentProvider}
                  currentModel={currentModel}
                  onSelect={onSelectModel}
                />
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".xls,.xlsx,.csv,.tsv"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleDataUpload(f)
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || disabled}
                title="导入 xls / xlsx / csv 数据文件用于图表生成（也可直接拖拽到此输入框）"
                onMouseEnter={e => {
                  if (!uploading && !disabled) {
                    e.currentTarget.style.background = '#eff6ff'
                    e.currentTarget.style.borderColor = '#93c5fd'
                    e.currentTarget.style.color = '#1d4ed8'
                  }
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = '#f8fafc'
                  e.currentTarget.style.borderColor = '#e2e8f0'
                  e.currentTarget.style.color = uploading ? '#bbb' : '#475569'
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 500,
                  color: uploading ? '#bbb' : '#475569',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  cursor: uploading || disabled ? 'default' : 'pointer',
                  transition: 'all 0.1s',
                }}
              >
                {/* Paperclip icon — universally recognizable as "attach file" */}
                <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/>
                </svg>
                <span>{uploading ? '解析中…' : '导入数据'}</span>
              </button>
              {uploadError && (
                <span style={{ fontSize: 10, color: '#dc2626' }}>{uploadError}</span>
              )}
            </div>

            {/* Send / Stop */}
            {disabled ? (
              <button
                onClick={onCancel}
                title="停止"
                onMouseEnter={e => { e.currentTarget.style.color = '#dc2626'; e.currentTarget.style.background = '#f5f5f5' }}
                onMouseLeave={e => { e.currentTarget.style.color = '#bbb'; e.currentTarget.style.background = 'transparent' }}
                style={{
                  width: 28, height: 28, borderRadius: 6, display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  color: '#bbb', background: 'transparent', transition: 'all 0.1s',
                }}
              >
                <svg width="11" height="11" fill="currentColor" viewBox="0 0 12 12">
                  <rect x="2" y="2" width="8" height="8" rx="1.5" />
                </svg>
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!canSend}
                title="发送 (Enter)"
                onMouseEnter={e => { if (canSend) { e.currentTarget.style.color = '#111'; e.currentTarget.style.background = '#ebebeb' } }}
                onMouseLeave={e => { e.currentTarget.style.color = canSend ? '#555' : '#ccc'; e.currentTarget.style.background = canSend ? '#f0f0f0' : 'transparent' }}
                style={{
                  width: 28, height: 28, borderRadius: 6, display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  color: canSend ? '#555' : '#ccc',
                  background: canSend ? '#f0f0f0' : 'transparent',
                  cursor: canSend ? 'pointer' : 'default',
                  transition: 'all 0.1s',
                }}
              >
                <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <p style={{ textAlign: 'center', fontSize: 11, color: '#ccc', marginTop: 6 }}>
          Enter 发送 · Shift+Enter 换行 · 可拖拽 xls/csv 到此处导入
        </p>
      </div>
    </div>
  )
}

/* ── 模型选择器 ── */
function ModelPill({ providers, currentProvider, currentModel, onSelect }: {
  providers: Provider[]
  currentProvider: string
  currentModel: string
  onSelect: (provider: string, model: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [hoveredProvider, setHoveredProvider] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const providerObj = providers.find(p => p.id === currentProvider)
  const providerShort = providerObj?.name?.split(' ')[0] ?? currentProvider

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        onMouseEnter={e => { if (!open) e.currentTarget.style.borderColor = '#ccc' }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.borderColor = 'transparent' }}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '3px 8px', borderRadius: 5, fontSize: 11,
          color: open ? '#333' : '#999',
          background: open ? '#f0f0f0' : 'transparent',
          border: `1px solid ${open ? '#ddd' : 'transparent'}`,
          cursor: 'pointer', transition: 'all 0.1s',
          fontFamily: '"SF Mono", "JetBrains Mono", Consolas, monospace',
        }}
      >
        <span style={{
          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
          background: providerObj?.configured ? '#22c55e' : '#d0d0d0',
        }} />
        <span>{providerShort}</span>
        <span style={{ color: '#ddd' }}>/</span>
        <span style={{
          maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{currentModel}</span>
        <svg width="8" height="8" fill="none" stroke="currentColor" viewBox="0 0 24 24"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, zIndex: 100,
          width: 300, background: '#fff', border: '1px solid #e4e4e4',
          borderRadius: 8, overflow: 'hidden',
          boxShadow: '0 -8px 32px rgba(0,0,0,0.10)',
        }}>
          <div style={{ padding: '6px 12px 4px', fontSize: 10, color: '#bbb', borderBottom: '1px solid #f0f0f0', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            选择模型
          </div>
          <div style={{ display: 'flex', maxHeight: 280 }}>
            {/* Providers */}
            <div style={{ width: 120, flexShrink: 0, overflowY: 'auto', borderRight: '1px solid #f0f0f0', padding: '4px 0' }}>
              {providers.map(p => {
                const isActive = (hoveredProvider ?? currentProvider) === p.id
                return (
                  <button
                    key={p.id}
                    onMouseEnter={() => setHoveredProvider(p.id)}
                    onClick={() => { onSelect(p.id, p.models[0]); setOpen(false) }}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 6,
                      padding: '6px 12px', fontSize: 11, textAlign: 'left',
                      background: isActive ? '#f5f5f5' : 'transparent',
                      color: isActive ? '#111' : '#888',
                      cursor: 'pointer', transition: 'all 0.08s',
                    }}
                  >
                    <span style={{
                      width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                      background: p.configured ? '#22c55e' : '#ddd',
                    }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {shortProviderLabel(p.name)}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* Models */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
              {(providers.find(p => p.id === (hoveredProvider ?? currentProvider))?.models ?? []).map(m => {
                const isSel = currentModel === m && currentProvider === (hoveredProvider ?? currentProvider)
                return (
                  <button
                    key={m}
                    onClick={() => { onSelect(hoveredProvider ?? currentProvider, m); setOpen(false) }}
                    onMouseEnter={e => { if (!isSel) e.currentTarget.style.color = '#111' }}
                    onMouseLeave={e => { if (!isSel) e.currentTarget.style.color = '#888' }}
                    style={{
                      width: '100%', textAlign: 'left', padding: '6px 12px',
                      fontSize: 11, cursor: 'pointer', transition: 'color 0.08s',
                      color: isSel ? '#111' : '#888',
                      background: isSel ? '#f0f0f0' : 'transparent',
                      fontWeight: isSel ? 500 : 400,
                      fontFamily: '"SF Mono", "JetBrains Mono", Consolas, monospace',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                  >
                    {m}
                  </button>
                )
              })}
            </div>
          </div>
          <div style={{
            padding: '5px 12px', fontSize: 10, color: '#ccc',
            borderTop: '1px solid #f0f0f0', display: 'flex', gap: 12,
          }}>
            <span><span style={{ color: '#22c55e' }}>●</span> 已配置</span>
            <span><span style={{ color: '#ddd' }}>●</span> 未配置</span>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Short label for the provider picker's left column (~120px wide).
 *   "MiniMax (按量付费)"          → "MiniMax"
 *   "MiniMax Token Plan (M2.7)"  → "MiniMax Plan"
 *   "Claude (Anthropic)"         → "Claude"
 *   "通义千问 (Qianwen)"          → "通义千问"
 */
function shortProviderLabel(name: string): string {
  // Strip the trailing parenthesized segment (ASCII and Chinese parens).
  const stripped = name.replace(/\s*[（(][^（）()]*[)）]\s*$/u, '').trim()
  // Collapse whitespace; drop the "Token" filler word so "MiniMax Token Plan" → "MiniMax Plan".
  return stripped.replace(/\bToken\s+/g, '').trim()
}
