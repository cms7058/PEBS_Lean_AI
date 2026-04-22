import React, { useState } from 'react'
import { useSkills } from '../hooks/useSkills'
import type { SkillEntry } from '../lib/api'

interface Props {
  onClose: () => void
}

export function SkillsModal({ onClose }: Props) {
  const { skills, loading, busy, error, toggle, install, remove, setError } = useSkills()
  const [installSpec, setInstallSpec] = useState('')

  const handleInstall = async () => {
    const s = installSpec.trim()
    if (!s) return
    const r = await install(s)
    if (r.ok) setInstallSpec('')
  }

  const ok = skills.filter((s): s is Extract<SkillEntry, { ok: true }> => s.ok)
  const broken = skills.filter((s): s is Extract<SkillEntry, { ok: false }> => !s.ok)

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }} />
      <div style={{
        position: 'relative', width: '100%', maxWidth: 560,
        maxHeight: '88vh', display: 'flex', flexDirection: 'column',
        background: '#fff', border: '1px solid #e4e4e4', borderRadius: 12,
        boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid #eee', flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>
            技能插件
            <span style={{ marginLeft: 8, fontSize: 11, color: '#aaa', fontWeight: 400 }}>
              {ok.length} 个已安装
            </span>
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

        {/* Install bar */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid #eee', flexShrink: 0, background: '#fafafa' }}>
          <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 5 }}>
            安装技能包
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={installSpec}
              onChange={e => setInstallSpec(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleInstall() }}
              placeholder="@lean-ai/skill-diagnosis 或本地路径"
              style={{
                flex: 1, padding: '6px 10px', borderRadius: 5, fontSize: 11,
                background: '#fff', color: '#1a1a1a', border: '1px solid #e4e4e4',
                fontFamily: '"SF Mono", "JetBrains Mono", Consolas, monospace',
                caretColor: '#555',
              }}
            />
            <button
              onClick={handleInstall}
              disabled={!installSpec.trim() || busy === 'install'}
              style={{
                padding: '6px 14px', borderRadius: 5, fontSize: 11, flexShrink: 0,
                background: busy === 'install' ? '#f5f5f5' : '#fafafa',
                color: busy === 'install' || !installSpec.trim() ? '#ccc' : '#555',
                border: '1px solid #e4e4e4',
                cursor: busy === 'install' || !installSpec.trim() ? 'default' : 'pointer',
              }}>
              {busy === 'install' ? '安装中…' : '安装'}
            </button>
          </div>
          {error && (
            <div style={{
              marginTop: 8, padding: '6px 10px', borderRadius: 5, fontSize: 11,
              background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)',
              color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span>{error}</span>
              <button onClick={() => setError(null)} style={{ color: '#dc2626', fontSize: 12 }}>×</button>
            </div>
          )}
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px', minHeight: 0 }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', fontSize: 12, color: '#aaa' }}>加载中…</div>
          ) : skills.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              {ok.map(s => (
                <SkillCard
                  key={s.packageName}
                  skill={s}
                  busy={busy === s.packageName}
                  onToggle={(en) => toggle(s.packageName, en)}
                  onRemove={() => remove(s.packageName)}
                />
              ))}

              {broken.length > 0 && (
                <>
                  <div style={{
                    marginTop: 14, marginBottom: 6, fontSize: 10, color: '#aaa',
                    letterSpacing: '0.06em', textTransform: 'uppercase',
                  }}>
                    加载失败
                  </div>
                  {broken.map(s => (
                    <BrokenCard
                      key={s.packageName}
                      skill={s}
                      busy={busy === s.packageName}
                      onRemove={() => remove(s.packageName)}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center', color: '#aaa' }}>
      <div style={{ fontSize: 12, marginBottom: 8 }}>尚未安装任何技能</div>
      <div style={{ fontSize: 11, color: '#bbb', lineHeight: 1.7 }}>
        在上方输入框中填入 npm 包名或本地路径后点击安装，<br />
        例如 <code style={{ color: '#888', fontFamily: 'monospace' }}>@lean-ai/skill-diagnosis</code>
      </div>
    </div>
  )
}

function SkillCard({ skill, busy, onToggle, onRemove }: {
  skill: Extract<SkillEntry, { ok: true }>
  busy: boolean
  onToggle: (enabled: boolean) => void
  onRemove: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [confirming, setConfirming] = useState(false)

  return (
    <div style={{ border: '1px solid #eee', borderRadius: 8, marginBottom: 8, overflow: 'hidden', background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
        <button
          onClick={() => setExpanded(e => !e)}
          style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', minWidth: 0 }}
        >
          <svg width="10" height="10" fill="none" stroke="#bbb" viewBox="0 0 24 24"
            style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: skill.enabled ? '#1a1a1a' : '#aaa' }}>
                {skill.displayName}
              </span>
              <code style={{
                fontSize: 10, color: '#bbb',
                fontFamily: '"SF Mono", "JetBrains Mono", Consolas, monospace',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                v{skill.version}
              </code>
            </div>
            <div style={{
              fontSize: 11, color: '#aaa', marginTop: 2, lineHeight: 1.5,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {skill.description}
            </div>
          </div>
        </button>
        <ToggleSwitch checked={skill.enabled} disabled={busy} onChange={onToggle} />
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid #f0f0f0', padding: '10px 14px', background: '#fafafa' }}>
          <div style={{
            fontSize: 10, color: '#aaa', marginBottom: 6,
            letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>
            包名
          </div>
          <code style={{
            fontSize: 11, color: '#666', display: 'block', marginBottom: 10,
            fontFamily: '"SF Mono", "JetBrains Mono", Consolas, monospace',
          }}>
            {skill.packageName}
          </code>

          <div style={{
            fontSize: 10, color: '#aaa', marginBottom: 6,
            letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>
            工具 ({skill.tools.length})
          </div>
          {skill.tools.length === 0 ? (
            <div style={{ fontSize: 11, color: '#bbb' }}>（该技能未定义任何工具）</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
              {skill.tools.map(t => (
                <div key={t.name} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <code style={{
                    fontSize: 11, color: '#333',
                    fontFamily: '"SF Mono", "JetBrains Mono", Consolas, monospace',
                    flexShrink: 0,
                  }}>
                    {t.name}
                  </code>
                  <span style={{ fontSize: 11, color: '#888', lineHeight: 1.5 }}>
                    {t.description}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
            {confirming ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setConfirming(false)}
                  style={{ padding: '4px 10px', borderRadius: 4, fontSize: 11, color: '#888', border: '1px solid #e4e4e4' }}>
                  取消
                </button>
                <button
                  onClick={() => { setConfirming(false); onRemove() }}
                  disabled={busy}
                  style={{
                    padding: '4px 10px', borderRadius: 4, fontSize: 11,
                    color: '#dc2626', border: '1px solid #fecaca',
                    background: busy ? '#f5f5f5' : '#fff',
                  }}>
                  {busy ? '卸载中…' : '确认卸载'}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirming(true)}
                disabled={busy}
                onMouseEnter={e => { if (!busy) e.currentTarget.style.color = '#dc2626' }}
                onMouseLeave={e => (e.currentTarget.style.color = '#aaa')}
                style={{ fontSize: 11, color: '#aaa', padding: '4px 8px' }}>
                卸载
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function BrokenCard({ skill, busy, onRemove }: {
  skill: Extract<SkillEntry, { ok: false }>
  busy: boolean
  onRemove: () => void
}) {
  return (
    <div style={{
      border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, marginBottom: 8,
      padding: '10px 14px', background: 'rgba(239,68,68,0.03)',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <code style={{
          fontSize: 11, color: '#dc2626',
          fontFamily: '"SF Mono", "JetBrains Mono", Consolas, monospace',
        }}>
          {skill.packageName}
        </code>
      </div>
      <div style={{ fontSize: 11, color: '#b91c1c', lineHeight: 1.5, marginBottom: 6 }}>
        {skill.error}
      </div>
      <button
        onClick={onRemove}
        disabled={busy}
        style={{
          fontSize: 11, color: '#dc2626', padding: '3px 8px',
          border: '1px solid #fecaca', borderRadius: 4,
        }}>
        {busy ? '卸载中…' : '卸载'}
      </button>
    </div>
  )
}

function ToggleSwitch({ checked, disabled, onChange }: {
  checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void
}) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      style={{
        width: 32, height: 18, borderRadius: 10, flexShrink: 0,
        background: checked ? '#22c55e' : '#ddd',
        position: 'relative', transition: 'background 0.15s',
        cursor: disabled ? 'wait' : 'pointer', opacity: disabled ? 0.5 : 1,
      }}>
      <span style={{
        position: 'absolute', top: 2,
        left: checked ? 16 : 2,
        width: 14, height: 14, borderRadius: '50%',
        background: '#fff', transition: 'left 0.15s',
        boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
      }} />
    </button>
  )
}
