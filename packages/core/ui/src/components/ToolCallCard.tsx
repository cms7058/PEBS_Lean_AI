import React, { useState } from 'react'
import type { ToolPart, SkillArtifact } from '../lib/api'
import { renderMarkdown } from '../lib/markdown'

interface Props {
  part: ToolPart
}

/**
 * Collapsible card for a single tool invocation.
 *
 * Auto-collapses after the tool finishes successfully (tools are background
 * context — the user cares about the final answer). Errors stay expanded.
 */
export function ToolCallCard({ part }: Props) {
  const [open, setOpen] = useState(part.status === 'error')

  const statusStyle = STATUS_STYLES[part.status]

  return (
    <div style={{
      margin: '8px 0', border: `1px solid ${statusStyle.border}`,
      borderRadius: 8, background: statusStyle.bg, overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', background: 'transparent',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <StatusIcon status={part.status} />
        <span style={{ fontSize: 11, color: '#666', flexShrink: 0 }}>
          {part.skill}
        </span>
        <span style={{ color: '#ddd' }}>·</span>
        <code style={{
          fontSize: 11, color: '#333',
          fontFamily: '"SF Mono", "JetBrains Mono", Consolas, monospace',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          flex: 1, minWidth: 0,
        }}>
          {part.toolName}
        </code>
        <span style={{ fontSize: 10, color: statusStyle.label }}>
          {statusStyle.text}
        </span>
        <svg width="9" height="9" fill="none" stroke="#bbb" viewBox="0 0 24 24"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div style={{ padding: '4px 12px 10px', borderTop: '1px solid #f0f0f0', background: '#fafafa' }}>
          {part.input && Object.keys(part.input).length > 0 && (
            <Section label="输入">
              <pre style={preStyle}>{JSON.stringify(part.input, null, 2)}</pre>
            </Section>
          )}

          {part.result !== undefined && (
            <Section label={part.isError ? '错误' : '结果'}>
              <pre style={{
                ...preStyle,
                color: part.isError ? '#dc2626' : '#333',
                background: part.isError ? 'rgba(239,68,68,0.05)' : '#fff',
                borderColor: part.isError ? 'rgba(239,68,68,0.18)' : '#eee',
              }}>
                {part.result}
              </pre>
            </Section>
          )}

          {part.artifact && (
            <Section label="产物">
              <ArtifactView artifact={part.artifact} />
            </Section>
          )}

          {part.status === 'running' && (
            <div style={{ fontSize: 11, color: '#aaa', padding: '6px 2px' }}>
              执行中…
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{
        fontSize: 10, color: '#aaa', marginBottom: 4,
        letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 500,
      }}>
        {label}
      </div>
      {children}
    </div>
  )
}

/**
 * Render a skill artifact. Built-in types are handled directly; unknown types
 * fall back to a raw JSON dump so skills can be prototyped without UI churn.
 */
function ArtifactView({ artifact }: { artifact: SkillArtifact }) {
  switch (artifact.type) {
    case 'markdown':
      return (
        <div className="prose" style={{
          fontSize: 12, color: '#333', lineHeight: 1.7,
          padding: '8px 12px', background: '#fff',
          border: '1px solid #eee', borderRadius: 6,
        }}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(String(artifact.data ?? '')) }}
        />
      )
    case 'table':
      return <TableView data={artifact.data} />
    case 'file':
      return <FileArtifact artifact={artifact} />
    case 'svg':
      return <SvgArtifact artifact={artifact} />
    default:
      return (
        <div style={{
          fontSize: 11, color: '#888', padding: '8px 12px',
          background: '#fff', border: '1px dashed #ddd', borderRadius: 6,
        }}>
          <div style={{ marginBottom: 4, color: '#666' }}>
            未识别的产物类型: <code>{artifact.type}</code>
          </div>
          <pre style={{ ...preStyle, margin: 0 }}>
            {JSON.stringify(artifact.data, null, 2).slice(0, 2000)}
          </pre>
        </div>
      )
  }
}

function TableView({ data }: { data: unknown }) {
  // Accept either { columns, rows } or a plain array of row objects.
  let columns: string[] = []
  let rows: unknown[][] = []

  if (data && typeof data === 'object' && 'columns' in data && 'rows' in data) {
    const d = data as { columns: string[]; rows: unknown[][] }
    columns = d.columns
    rows = d.rows
  } else if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
    columns = Object.keys(data[0] as object)
    rows = (data as Record<string, unknown>[]).map(r => columns.map(c => r[c]))
  } else {
    return <pre style={preStyle}>{JSON.stringify(data, null, 2)}</pre>
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 6, overflow: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c} style={{
                padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid #eee',
                color: '#666', fontWeight: 500, background: '#fafafa',
              }}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j} style={{ padding: '6px 10px', borderBottom: '1px solid #f5f5f5', color: '#333' }}>
                  {String(cell ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Render an SVG artifact. The skill emits a self-contained <svg>...</svg> string.
 * We trust the skill output (skills are loaded from the user's local install dir)
 * and render via dangerouslySetInnerHTML so the chart scales and keeps its
 * own fonts / styles. Provides a "查看源码 / 下载" affordance for power users.
 */
function SvgArtifact({ artifact }: { artifact: SkillArtifact }) {
  const [showSource, setShowSource] = useState(false)
  const svg = typeof artifact.data === 'string' ? artifact.data : ''
  if (!svg.trim().startsWith('<svg')) {
    return (
      <pre style={preStyle}>{String(artifact.data ?? '')}</pre>
    )
  }
  const filename = artifact.filename ?? 'chart.svg'
  const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  return (
    <div style={{
      background: '#fff', border: '1px solid #eee', borderRadius: 6, overflow: 'hidden',
    }}>
      <div
        style={{
          padding: 12, display: 'flex', justifyContent: 'center',
          background: '#fff', overflow: 'auto',
        }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '6px 12px', borderTop: '1px solid #f0f0f0',
        background: '#fafafa', fontSize: 10, color: '#888',
      }}>
        <span style={{ flex: 1 }}>SVG · {filename}</span>
        <button
          type="button"
          onClick={() => setShowSource(s => !s)}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: '#666', fontSize: 10, padding: 0,
          }}
        >
          {showSource ? '隐藏源码' : '查看源码'}
        </button>
        <a href={dataUrl} download={filename}
          style={{ color: '#16a34a', textDecoration: 'none' }}>
          下载
        </a>
      </div>
      {showSource && (
        <pre style={{ ...preStyle, margin: 0, borderRadius: 0, borderTop: '1px solid #f0f0f0', maxHeight: 240 }}>
          {svg}
        </pre>
      )}
    </div>
  )
}

function FileArtifact({ artifact }: { artifact: SkillArtifact }) {
  const filename = artifact.filename ?? '下载文件'
  // If data is a string, treat as base64 or plain text and offer download.
  const href = typeof artifact.data === 'string' && artifact.data.startsWith('data:')
    ? artifact.data
    : undefined

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 12px', background: '#fff',
      border: '1px solid #eee', borderRadius: 6,
    }}>
      <svg width="14" height="14" fill="none" stroke="#888" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <span style={{ flex: 1, fontSize: 12, color: '#333' }}>{filename}</span>
      {artifact.mimeType && (
        <span style={{ fontSize: 10, color: '#aaa' }}>{artifact.mimeType}</span>
      )}
      {href && (
        <a href={href} download={filename}
          style={{ fontSize: 11, color: '#16a34a', textDecoration: 'none' }}>
          下载
        </a>
      )}
    </div>
  )
}

function StatusIcon({ status }: { status: ToolPart['status'] }) {
  if (status === 'running') {
    return (
      <span
        className="spin"
        style={{
          width: 10, height: 10, flexShrink: 0, borderRadius: '50%',
          border: '1.5px solid #ddd', borderTopColor: '#888',
          display: 'inline-block',
        }}
      />
    )
  }
  if (status === 'error') {
    return (
      <svg width="12" height="12" fill="none" stroke="#dc2626" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    )
  }
  return (
    <svg width="12" height="12" fill="none" stroke="#16a34a" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
    </svg>
  )
}

const STATUS_STYLES: Record<ToolPart['status'], { border: string; bg: string; label: string; text: string }> = {
  running: { border: '#e4e4e4', bg: '#fafafa', label: '#aaa', text: '执行中' },
  done:    { border: '#e4e4e4', bg: '#fafafa', label: '#16a34a', text: '已完成' },
  error:   { border: 'rgba(239,68,68,0.25)', bg: 'rgba(239,68,68,0.04)', label: '#dc2626', text: '失败' },
}

const preStyle: React.CSSProperties = {
  margin: 0, padding: '8px 12px',
  background: '#fff', border: '1px solid #eee', borderRadius: 6,
  fontSize: 11, lineHeight: 1.6, color: '#333',
  fontFamily: '"SF Mono", "JetBrains Mono", Consolas, monospace',
  overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  maxHeight: 300,
}
