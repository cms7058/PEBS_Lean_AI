import React, { useCallback, useEffect, useRef, useState } from 'react'
import { api, type KbDocument, type KbEntrySummary, type KbStats } from '../lib/api'

interface Props {
  onClose: () => void
}

type Tab = 'docs' | 'entries' | 'add'

const SOURCE_FILTERS: Array<{ value: string; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'seed', label: '内置' },
  { value: 'user', label: '用户' },
  { value: 'file', label: '文件' },
  { value: 'customer', label: '客户' },
]

export function KnowledgeModal({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>('docs')
  const [stats, setStats] = useState<KbStats | null>(null)
  const [docs, setDocs] = useState<KbDocument[]>([])
  const [entries, setEntries] = useState<KbEntrySummary[]>([])
  const [sourceFilter, setSourceFilter] = useState<string>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadStats = useCallback(async () => {
    try { setStats(await api.getKbStats()) } catch (e) { /* non-critical */ }
  }, [])

  const loadDocs = useCallback(async () => {
    try { setDocs(await api.getKbDocuments()) } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const loadEntries = useCallback(async (src: string) => {
    try { setEntries(await api.getKbEntries(src === 'all' ? undefined : src)) } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    loadStats()
    if (tab === 'docs') loadDocs()
    if (tab === 'entries') loadEntries(sourceFilter)
  }, [tab, sourceFilter, loadStats, loadDocs, loadEntries])

  const handleFiles = async (files: FileList | File[]) => {
    setError(null)
    const arr = Array.from(files)
    if (arr.length === 0) return
    setUploading(true)
    try {
      for (const f of arr) {
        try {
          await api.uploadKbFile(f)
        } catch (e) {
          setError(`${f.name}：${e instanceof Error ? e.message : String(e)}`)
        }
      }
      await Promise.all([loadDocs(), loadStats()])
    } finally {
      setUploading(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files)
  }

  const deleteDoc = async (id: string) => {
    if (!confirm('确认删除该文档及其所有切片？此操作不可撤销。')) return
    setBusy(id); setError(null)
    try {
      await api.deleteKbDocument(id)
      await Promise.all([loadDocs(), loadStats()])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(null) }
  }

  const deleteEntry = async (id: string, source: string) => {
    const force = source === 'seed'
    const warn = force
      ? '这是内置种子条目，确认强制删除吗？'
      : '确认删除该条目？此操作不可撤销。'
    if (!confirm(warn)) return
    setBusy(id); setError(null)
    try {
      await api.deleteKbEntry(id, force)
      await Promise.all([loadEntries(sourceFilter), loadStats()])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(null) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }} />
      <div style={{
        position: 'relative', width: '100%', maxWidth: 720,
        maxHeight: '88vh', display: 'flex', flexDirection: 'column',
        background: '#fff', border: '1px solid #e4e4e4', borderRadius: 12,
        boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid #eee', flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>
            知识库
            {stats && (
              <span style={{ marginLeft: 8, fontSize: 11, color: '#aaa', fontWeight: 400 }}>
                {stats.entries} 条条目 · {stats.documents} 个文档
              </span>
            )}
          </span>
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
        <div style={{ display: 'flex', gap: 4, padding: '10px 20px 0', borderBottom: '1px solid #eee', flexShrink: 0 }}>
          <TabBtn active={tab === 'docs'} onClick={() => setTab('docs')}>文档</TabBtn>
          <TabBtn active={tab === 'entries'} onClick={() => setTab('entries')}>所有条目</TabBtn>
          <TabBtn active={tab === 'add'} onClick={() => setTab('add')}>手动添加</TabBtn>
        </div>

        {error && (
          <div style={{
            margin: '10px 20px 0', padding: '6px 10px', borderRadius: 5, fontSize: 11,
            background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)',
            color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexShrink: 0,
          }}>
            <span>{error}</span>
            <button onClick={() => setError(null)} style={{ color: '#dc2626', fontSize: 12 }}>×</button>
          </div>
        )}

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px', minHeight: 0 }}>
          {tab === 'docs' && (
            <>
              <div
                onClick={() => !uploading && fileInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                style={{
                  border: `2px dashed ${dragOver ? '#3b82f6' : '#ddd'}`,
                  borderRadius: 8, padding: '22px 16px', textAlign: 'center',
                  color: dragOver ? '#3b82f6' : '#888', fontSize: 12,
                  background: dragOver ? 'rgba(59,130,246,0.04)' : '#fafafa',
                  cursor: uploading ? 'wait' : 'pointer', marginBottom: 14,
                  transition: 'all 0.15s',
                }}
              >
                {uploading
                  ? '正在解析并索引文件…'
                  : (
                    <>
                      <div style={{ fontSize: 13, color: dragOver ? '#3b82f6' : '#555', marginBottom: 4 }}>
                        点击或拖拽文件到此处上传
                      </div>
                      <div style={{ fontSize: 11, color: '#aaa' }}>
                        支持 .pdf / .docx / .xlsx / .md / .txt · 单文件最大 25 MB
                      </div>
                    </>
                  )}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.docx,.xlsx,.md,.txt"
                  style={{ display: 'none' }}
                  onChange={e => { if (e.target.files) handleFiles(e.target.files); e.target.value = '' }}
                />
              </div>

              {docs.length === 0 ? (
                <EmptyHint text="尚未上传任何文档。上传后文件内容会自动切片并加入知识库，可被 kb_search 检索。" />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {docs.map(d => (
                    <DocItem
                      key={d.id}
                      doc={d}
                      busy={busy === d.id}
                      onDelete={() => deleteDoc(d.id)}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'entries' && (
            <>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                {SOURCE_FILTERS.map(f => (
                  <FilterBtn
                    key={f.value}
                    active={sourceFilter === f.value}
                    onClick={() => setSourceFilter(f.value)}
                  >
                    {f.label}
                  </FilterBtn>
                ))}
              </div>

              {entries.length === 0 ? (
                <EmptyHint text="该来源下暂无条目。" />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {entries.map(e => (
                    <EntryRow
                      key={e.id}
                      entry={e}
                      busy={busy === e.id}
                      onDelete={() => deleteEntry(e.id, e.source)}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'add' && (
            <AddEntryForm
              onAdded={() => {
                loadStats()
                setTab('entries')
                setSourceFilter('user')
              }}
              onError={setError}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 12px', fontSize: 12,
        color: active ? '#111' : '#888',
        borderBottom: `2px solid ${active ? '#111' : 'transparent'}`,
        marginBottom: -1,
      }}
    >{children}</button>
  )
}

function FilterBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '3px 10px', borderRadius: 12, fontSize: 11,
        background: active ? '#111' : '#f0f0f0',
        color: active ? '#fff' : '#666',
        border: '1px solid ' + (active ? '#111' : '#e4e4e4'),
      }}
    >{children}</button>
  )
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div style={{ padding: '30px 16px', textAlign: 'center', color: '#aaa', fontSize: 12, lineHeight: 1.7 }}>
      {text}
    </div>
  )
}

function DocItem({ doc, busy, onDelete }: {
  doc: KbDocument; busy: boolean; onDelete: () => void
}) {
  const [hover, setHover] = useState(false)
  const statusColor = doc.status === 'ready' ? '#16a34a' : doc.status === 'error' ? '#dc2626' : '#ca8a04'
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 12px', border: '1px solid #eee', borderRadius: 6,
        background: hover ? '#fafafa' : '#fff',
      }}
    >
      <div style={{
        width: 28, height: 28, borderRadius: 4, flexShrink: 0,
        background: '#f0f0f0', color: '#888',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 9, fontWeight: 600, textTransform: 'uppercase',
      }}>
        {doc.file_type}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12, color: '#1a1a1a',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {doc.filename}
        </div>
        <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>
          {doc.chunk_count} 个切片 · <span style={{ color: statusColor }}>{doc.status}</span> · {new Date(doc.uploaded_at).toLocaleString()}
        </div>
      </div>
      <button
        onClick={onDelete}
        disabled={busy}
        onMouseEnter={e => !busy && (e.currentTarget.style.color = '#dc2626')}
        onMouseLeave={e => (e.currentTarget.style.color = '#bbb')}
        style={{
          color: '#bbb', fontSize: 11, padding: '2px 6px',
          opacity: hover ? 1 : 0.4, transition: 'opacity 0.15s',
        }}
      >
        {busy ? '删除中…' : '删除'}
      </button>
    </div>
  )
}

function EntryRow({ entry, busy, onDelete }: {
  entry: KbEntrySummary; busy: boolean; onDelete: () => void
}) {
  const [hover, setHover] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [detail, setDetail] = useState<string | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  const sourceLabel = sourceDisplay(entry.source)

  const toggle = async () => {
    const next = !expanded
    setExpanded(next)
    if (next && detail == null) {
      setLoadingDetail(true)
      try {
        const full = await api.getKbEntry(entry.id)
        setDetail(full.content)
      } catch { setDetail('（加载失败）') }
      finally { setLoadingDetail(false) }
    }
  }

  return (
    <div
      style={{
        border: '1px solid #eee', borderRadius: 6,
        background: hover ? '#fafafa' : '#fff',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px' }}>
        <button onClick={toggle} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', minWidth: 0 }}>
          <svg width="10" height="10" fill="none" stroke="#bbb" viewBox="0 0 24 24"
            style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          <span style={{
            fontSize: 10, padding: '1px 6px', borderRadius: 3,
            background: sourceLabel.bg, color: sourceLabel.fg, flexShrink: 0,
          }}>
            {sourceLabel.label}
          </span>
          <span style={{
            flex: 1, fontSize: 12, color: '#1a1a1a',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {entry.title}
          </span>
          {entry.length != null && (
            <span style={{ fontSize: 10, color: '#aaa', flexShrink: 0 }}>{entry.length} 字</span>
          )}
        </button>
        <button
          onClick={onDelete}
          disabled={busy}
          onMouseEnter={e => !busy && (e.currentTarget.style.color = '#dc2626')}
          onMouseLeave={e => (e.currentTarget.style.color = '#bbb')}
          style={{
            color: '#bbb', fontSize: 11, padding: '2px 6px',
            opacity: hover ? 1 : 0.3, transition: 'opacity 0.15s',
          }}
        >
          {busy ? '…' : '×'}
        </button>
      </div>
      {expanded && (
        <div style={{
          borderTop: '1px solid #f0f0f0', padding: '10px 14px',
          background: '#fafafa', fontSize: 11, color: '#555',
          whiteSpace: 'pre-wrap', lineHeight: 1.65,
          maxHeight: 240, overflowY: 'auto',
        }}>
          {loadingDetail ? '加载中…' : (detail || '（空）')}
        </div>
      )}
    </div>
  )
}

function AddEntryForm({ onAdded, onError }: { onAdded: () => void; onError: (m: string) => void }) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [tags, setTags] = useState('')
  const [source, setSource] = useState<'user' | 'customer'>('user')
  const [customerName, setCustomerName] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!title.trim() || !content.trim()) {
      onError('请填写标题与正文'); return
    }
    setSaving(true)
    try {
      const srcKey = source === 'customer'
        ? (customerName.trim() ? `customer:${customerName.trim()}` : 'customer:default')
        : 'user'
      await api.addKbEntry({
        title: title.trim(),
        content: content.trim(),
        tags: tags.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean),
        source: srcKey,
      })
      setTitle(''); setContent(''); setTags(''); setCustomerName('')
      onAdded()
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '7px 10px', borderRadius: 5, fontSize: 12,
    background: '#fff', color: '#1a1a1a', border: '1px solid #e4e4e4',
    caretColor: '#555',
  }
  const labelStyle: React.CSSProperties = { fontSize: 11, color: '#888', marginBottom: 4, display: 'block' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label style={labelStyle}>来源分类</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <FilterBtn active={source === 'user'} onClick={() => setSource('user')}>通用知识 (user)</FilterBtn>
          <FilterBtn active={source === 'customer'} onClick={() => setSource('customer')}>客户数据 (customer)</FilterBtn>
        </div>
      </div>

      {source === 'customer' && (
        <div>
          <label style={labelStyle}>客户名称（用于 source 前缀）</label>
          <input
            value={customerName}
            onChange={e => setCustomerName(e.target.value)}
            placeholder="如 华兴焊接事业部"
            style={inputStyle}
          />
        </div>
      )}

      <div>
        <label style={labelStyle}>标题 *</label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="如：焊接工序换型时间基准数据 2024Q3"
          style={inputStyle}
        />
      </div>

      <div>
        <label style={labelStyle}>标签（逗号或空格分隔）</label>
        <input
          value={tags}
          onChange={e => setTags(e.target.value)}
          placeholder="如：SMED 焊接 基准数据"
          style={inputStyle}
        />
      </div>

      <div>
        <label style={labelStyle}>正文 *（支持 markdown；客户生产/管理数据可用表格格式）</label>
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          rows={10}
          placeholder="填写知识内容、标准、案例数据、客户生产数据等…"
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        <button
          onClick={submit}
          disabled={saving}
          style={{
            padding: '7px 18px', borderRadius: 5, fontSize: 12,
            background: saving ? '#f5f5f5' : '#111',
            color: saving ? '#aaa' : '#fff',
            border: '1px solid ' + (saving ? '#e4e4e4' : '#111'),
          }}
        >
          {saving ? '保存中…' : '保存到知识库'}
        </button>
      </div>
    </div>
  )
}

function sourceDisplay(source: string): { label: string; bg: string; fg: string } {
  if (source === 'seed') return { label: '内置', bg: '#f3e8ff', fg: '#7c3aed' }
  if (source === 'user') return { label: '用户', bg: '#dbeafe', fg: '#1d4ed8' }
  if (source.startsWith('file:')) return { label: '文件', bg: '#fef3c7', fg: '#b45309' }
  if (source.startsWith('customer:')) return { label: '客户', bg: '#dcfce7', fg: '#15803d' }
  return { label: source.slice(0, 6), bg: '#f0f0f0', fg: '#666' }
}
