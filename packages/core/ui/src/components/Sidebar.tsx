import React from 'react'
import type { Conversation, MeResponse } from '../lib/api'

interface Props {
  conversations: Conversation[]
  activeId: string | null
  onSelect: (conv: Conversation) => void
  onNew: () => void
  onDelete: (id: string) => void
  onOpenSettings: () => void
  onOpenSkills: () => void
  onOpenKnowledge: () => void
  onOpenPricing: () => void
  onOpenUsage: () => void
  onOpenHelp: () => void
  planBadge?: { name: string; warning?: string } | null
  me?: MeResponse | null
  onOpenAdmin?: () => void
  onLogout?: () => void
}

export function Sidebar({
  conversations, activeId, onSelect, onNew, onDelete,
  onOpenSettings, onOpenSkills, onOpenKnowledge,
  onOpenPricing, onOpenUsage, onOpenHelp, planBadge,
  me, onOpenAdmin, onLogout,
}: Props) {
  return (
    <aside style={{
      width: '220px',
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: '#ebebeb',
      borderRight: '1px solid #ddd',
      overflow: 'hidden',
    }}>
      {/* Logo */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '12px 16px', borderBottom: '1px solid #ddd', flexShrink: 0,
      }}>
        <div style={{
          width: 20, height: 20, borderRadius: 4, background: '#d4d4d4',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 6h8M6 2v8" stroke="#666" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
        <span style={{ fontSize: 13, fontWeight: 500, color: '#333' }}>PEBS Lean</span>
        <button
          onClick={onOpenHelp}
          title="帮助 / 文档"
          aria-label="帮助"
          onMouseEnter={e => {
            e.currentTarget.style.background = '#e0e0e0'
            e.currentTarget.style.color = '#111'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = '#888'
          }}
          style={{
            marginLeft: 'auto',
            width: 24, height: 24, borderRadius: 5,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#888', background: 'transparent',
            transition: 'background 0.1s, color 0.1s',
          }}
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
          </svg>
        </button>
      </div>

      {/* New conversation */}
      <div style={{ padding: '8px 8px 4px', flexShrink: 0 }}>
        <SidebarBtn onClick={onNew}>
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
          </svg>
          <span>新建对话</span>
        </SidebarBtn>
      </div>

      {/* Conversation list */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '0 8px' }}>
        {conversations.length > 0 && (
          <>
            <div style={{ padding: '6px 10px 4px', fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              最近
            </div>
            {conversations.map(conv => (
              <ConvItem
                key={conv.id}
                conv={conv}
                active={conv.id === activeId}
                onSelect={() => onSelect(conv)}
                onDelete={() => onDelete(conv.id)}
              />
            ))}
          </>
        )}
      </div>

      {/* Bottom nav */}
      <div style={{ flexShrink: 0, borderTop: '1px solid #ddd', padding: '6px 8px' }}>
        {(me?.capabilities?.pages.usage ?? true) && (
          <SidebarBtn onClick={onOpenUsage}>
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
            </svg>
            <span>用量</span>
          </SidebarBtn>
        )}
        {(me?.capabilities?.pages.pricing ?? true) && (
          <SidebarBtn onClick={onOpenPricing}>
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z M6 6h.008v.008H6V6z" />
            </svg>
            <span>订阅</span>
            {planBadge && (
              <span style={{
                marginLeft: 'auto',
                fontSize: 9,
                color: planBadge.warning ? '#dc2626' : '#888',
                background: planBadge.warning ? '#fee2e2' : '#e4e4e4',
                padding: '1px 5px', borderRadius: 3,
              }}>
                {planBadge.name}
              </span>
            )}
          </SidebarBtn>
        )}
        {(me?.capabilities?.pages.knowledge ?? false) && (
          <SidebarBtn onClick={onOpenKnowledge}>
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <span>知识库</span>
          </SidebarBtn>
        )}
        {(me?.capabilities?.pages.skills ?? false) && (
          <SidebarBtn onClick={onOpenSkills}>
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 01-.657.643 48.39 48.39 0 01-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 01-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 00-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 01-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 00.657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 01-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.401.604-.401.959v0c0 .333.277.599.61.58a48.1 48.1 0 005.427-.63 48.05 48.05 0 00.582-4.717.532.532 0 00-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.959.401v0a.656.656 0 00.658-.663 48.422 48.422 0 00-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 01-.61-.58v0z" />
            </svg>
            <span>技能插件</span>
          </SidebarBtn>
        )}
        <SidebarBtn onClick={onOpenSettings}>
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span>设置</span>
        </SidebarBtn>
        {me && me.user.role === 'admin' && onOpenAdmin && (
          <SidebarBtn onClick={onOpenAdmin}>
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>管理后台</span>
            <span style={{ marginLeft: 'auto', fontSize: 9, color: '#a855f7',
              background: '#f3e8ff', padding: '1px 5px', borderRadius: 3 }}>ADMIN</span>
          </SidebarBtn>
        )}
      </div>

      {me && (
        <div style={{
          flexShrink: 0, borderTop: '1px solid #ddd',
          padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <div style={{
            width: 26, height: 26, borderRadius: '50%',
            background: '#c7c7c7', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 600, flexShrink: 0,
          }}>
            {(me.user.display_name || me.user.username).slice(0, 1).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0, lineHeight: 1.3 }}>
            <div style={{
              fontSize: 12, color: '#333', fontWeight: 500,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {me.user.display_name || me.user.username}
            </div>
            <div style={{
              fontSize: 10, color: '#999',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {me.tenant.name}
            </div>
          </div>
          {onLogout && (
            <button
              onClick={onLogout}
              title="退出登录"
              style={{
                padding: 4, color: '#888', background: 'transparent',
                border: 'none', cursor: 'pointer', lineHeight: 0,
              }}
              onMouseEnter={e => (e.currentTarget.style.color = '#111')}
              onMouseLeave={e => (e.currentTarget.style.color = '#888')}
            >
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7}
                  d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
              </svg>
            </button>
          )}
        </div>
      )}
    </aside>
  )
}

function SidebarBtn({ children, onClick, disabled }: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
}) {
  const [hover, setHover] = React.useState(false)
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 10px', borderRadius: 5, fontSize: 12,
        color: disabled ? '#ccc' : hover ? '#111' : '#777',
        background: hover && !disabled ? '#e0e0e0' : 'transparent',
        cursor: disabled ? 'default' : 'pointer',
        transition: 'background 0.1s, color 0.1s',
        marginBottom: 1,
      }}
    >
      {children}
    </button>
  )
}

function ConvItem({ conv, active, onSelect, onDelete }: {
  conv: Conversation; active: boolean; onSelect: () => void; onDelete: () => void
}) {
  const [hover, setHover] = React.useState(false)
  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center',
        padding: '5px 10px', borderRadius: 5, cursor: 'pointer',
        background: active ? '#ddd' : hover ? '#e4e4e4' : 'transparent',
        marginBottom: 1,
      }}
    >
      <span style={{
        flex: 1, fontSize: 12, color: active ? '#111' : '#666',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        lineHeight: 1.5,
      }}>
        {conv.title}
      </span>
      {hover && (
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          onMouseEnter={e => (e.currentTarget.style.color = '#e53e3e')}
          onMouseLeave={e => (e.currentTarget.style.color = '#bbb')}
          style={{ color: '#bbb', flexShrink: 0, marginLeft: 4, padding: 2, lineHeight: 0 }}
        >
          <svg width="11" height="11" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}
