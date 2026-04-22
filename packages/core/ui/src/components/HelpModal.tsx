import React, { useCallback, useEffect, useState } from 'react'
import { api, type DocEntry } from '../lib/api'
import { renderMarkdown } from '../lib/markdown'

interface Props {
  onClose: () => void
}

/**
 * 帮助 / 文档 Modal
 *
 * 左侧列出可用文档（使用说明 / 部署指南），右侧渲染 markdown 内容。
 * 文档源文件位于仓库 docs/ 目录，由 /api/docs 动态加载。
 * 用户也可以点击右上角"在新标签页打开"直接访问原始 markdown。
 */
export function HelpModal({ onClose }: Props) {
  const [docs, setDocs] = useState<DocEntry[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [content, setContent] = useState<string>('')
  const [loadingList, setLoadingList] = useState(true)
  const [loadingDoc, setLoadingDoc] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadList = useCallback(async () => {
    setLoadingList(true)
    try {
      const resp = await api.getDocs()
      setDocs(resp.docs)
      // 默认选中第一个可用文档
      const first = resp.docs.find(d => d.available) ?? resp.docs[0]
      if (first) setActiveId(first.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingList(false)
    }
  }, [])

  useEffect(() => { loadList() }, [loadList])

  useEffect(() => {
    if (!activeId) return
    setLoadingDoc(true)
    setError(null)
    api.getDoc(activeId)
      .then(r => setContent(r.content))
      .catch(e => {
        setContent('')
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => setLoadingDoc(false))
  }, [activeId])

  const activeDoc = docs.find(d => d.id === activeId) ?? null

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }} />
      <div style={{
        position: 'relative', width: '100%', maxWidth: 960,
        height: '88vh', display: 'flex', flexDirection: 'column',
        background: '#fff', border: '1px solid #e4e4e4', borderRadius: 12,
        boxShadow: '0 20px 60px rgba(0,0,0,0.15)', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', borderBottom: '1px solid #eee', flexShrink: 0,
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>
            帮助文档
            {activeDoc && (
              <span style={{ marginLeft: 8, fontSize: 11, color: '#aaa', fontWeight: 400 }}>
                · {activeDoc.title}
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

        {/* Body */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* Left: doc list */}
          <div style={{
            width: 220, flexShrink: 0, borderRight: '1px solid #eee',
            padding: '10px 8px', overflowY: 'auto', background: '#fafafa',
          }}>
            {loadingList && (
              <div style={{ padding: '8px 10px', fontSize: 11, color: '#aaa' }}>加载中...</div>
            )}
            {!loadingList && docs.length === 0 && (
              <div style={{ padding: '8px 10px', fontSize: 11, color: '#aaa' }}>暂无文档</div>
            )}
            {docs.map(d => (
              <DocItem
                key={d.id}
                doc={d}
                active={d.id === activeId}
                onClick={() => d.available && setActiveId(d.id)}
              />
            ))}
            <div style={{
              marginTop: 12, padding: '8px 10px', fontSize: 10, color: '#aaa',
              lineHeight: 1.6, borderTop: '1px solid #eee',
            }}>
              源文件位于项目的 <code style={{ fontSize: 10 }}>docs/</code> 目录，可通过 GitHub / 本地编辑器查看。
            </div>
          </div>

          {/* Right: rendered content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
            {error && (
              <div style={{
                marginBottom: 12, padding: '8px 12px', borderRadius: 5, fontSize: 11,
                background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)',
                color: '#dc2626',
              }}>
                {error}
              </div>
            )}
            {loadingDoc && (
              <div style={{ fontSize: 12, color: '#aaa' }}>加载文档中...</div>
            )}
            {!loadingDoc && !error && content && (
              <div
                className="help-doc-body"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
              />
            )}
            {!loadingDoc && !content && !error && (
              <div style={{ fontSize: 12, color: '#aaa' }}>请在左侧选择要阅读的文档。</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function DocItem({ doc, active, onClick }: {
  doc: DocEntry
  active: boolean
  onClick: () => void
}) {
  const [hover, setHover] = useState(false)
  const disabled = !doc.available
  return (
    <div
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: '8px 10px', borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer',
        background: active ? '#e0ecff' : (hover && !disabled ? '#eee' : 'transparent'),
        marginBottom: 2, opacity: disabled ? 0.5 : 1,
      }}
    >
      <div style={{
        fontSize: 12, fontWeight: active ? 600 : 500,
        color: active ? '#1d4ed8' : '#333',
      }}>
        {doc.title}
      </div>
      {doc.description && (
        <div style={{ fontSize: 10, color: '#999', marginTop: 2, lineHeight: 1.4 }}>
          {doc.description}
        </div>
      )}
      {disabled && (
        <div style={{ fontSize: 10, color: '#dc2626', marginTop: 2 }}>
          文档文件未找到
        </div>
      )}
    </div>
  )
}
