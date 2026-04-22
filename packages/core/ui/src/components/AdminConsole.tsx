import React, { useEffect, useState, useCallback } from 'react'
import {
  api, type AdminTenant, type AdminUser, type AdminSkill,
  type AdminTenantUsage, type PlanId,
  type PlanCapabilities, type PlanCapabilitiesResponse,
  type AdminPaymentOrder, type PaymentGateway, type PaymentStatus,
} from '../lib/api'

interface Props {
  onClose: () => void
}

type Tab = 'tenants' | 'users' | 'usage' | 'skills' | 'capabilities' | 'payments' | 'gateway'

/**
 * Platform admin console — modal full-screen overlay with four tabs:
 *   Tenants | Users | Usage | Skills
 *
 * Only reachable when the logged-in user has role='admin'.
 */
export function AdminConsole({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>('tenants')

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#fafafa', zIndex: 9999,
      display: 'flex', flexDirection: 'column',
    }}>
      <header style={{
        display: 'flex', alignItems: 'center', padding: '14px 24px',
        borderBottom: '1px solid #e5e5e5', background: '#fff',
      }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#111' }}>管理后台</div>
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={closeBtnStyle}>关闭 ✕</button>
      </header>

      <nav style={{ display: 'flex', gap: 2, padding: '12px 24px 0', background: '#fff', borderBottom: '1px solid #eee', flexWrap: 'wrap' }}>
        <TabBtn active={tab === 'tenants'}      onClick={() => setTab('tenants')}>租户管理</TabBtn>
        <TabBtn active={tab === 'users'}        onClick={() => setTab('users')}>用户管理</TabBtn>
        <TabBtn active={tab === 'usage'}        onClick={() => setTab('usage')}>用量统计</TabBtn>
        <TabBtn active={tab === 'skills'}       onClick={() => setTab('skills')}>技能管理</TabBtn>
        <TabBtn active={tab === 'capabilities'} onClick={() => setTab('capabilities')}>方案权限</TabBtn>
        <TabBtn active={tab === 'payments'}     onClick={() => setTab('payments')}>付费订单</TabBtn>
        <TabBtn active={tab === 'gateway'}      onClick={() => setTab('gateway')}>收款配置</TabBtn>
      </nav>

      <main style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        {tab === 'tenants'      && <TenantsPanel />}
        {tab === 'users'        && <UsersPanel />}
        {tab === 'usage'        && <UsagePanel />}
        {tab === 'skills'       && <SkillsPanel />}
        {tab === 'capabilities' && <CapabilitiesPanel />}
        {tab === 'payments'     && <PaymentsPanel />}
        {tab === 'gateway'      && <GatewayPanel />}
      </main>
    </div>
  )
}

// ---- Tenants panel ---------------------------------------------------------

function TenantsPanel() {
  const [tenants, setTenants] = useState<AdminTenant[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)

  const reload = useCallback(() => {
    setLoading(true); setErr(null)
    api.adminListTenants()
      .then(r => setTenants(r.tenants))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { reload() }, [reload])

  return (
    <div>
      <PanelHeader title="租户 (Workspace)" hint="每个租户 = 一个计费单元，可独立管理计划/到期/用量">
        <button onClick={() => setShowNew(true)} style={primaryBtn}>+ 新建租户</button>
      </PanelHeader>

      {err && <ErrBanner>{err}</ErrBanner>}
      {loading && <div style={{ color: '#888', fontSize: 12 }}>加载中...</div>}

      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>ID</th>
            <th style={thStyle}>名称</th>
            <th style={thStyle}>计划</th>
            <th style={thStyle}>状态</th>
            <th style={thStyle}>到期 / 倒计时</th>
            <th style={thStyle}>累计付费</th>
            <th style={thStyle}>用户数</th>
            <th style={thStyle}>本月消息</th>
            <th style={thStyle}>操作</th>
          </tr>
        </thead>
        <tbody>
          {tenants.map(t => (
            <TenantRow key={t.id} tenant={t} onChanged={reload} />
          ))}
        </tbody>
      </table>

      {showNew && <NewTenantModal onClose={() => setShowNew(false)} onDone={() => { setShowNew(false); reload() }} />}
    </div>
  )
}

function TenantRow({ tenant, onChanged }: { tenant: AdminTenant; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const expires = tenant.expires_at ? new Date(tenant.expires_at).toISOString().slice(0, 10) : '不限'

  const renew = async (days: number) => {
    setBusy(true)
    try { await api.adminRenewTenant(tenant.id, days); onChanged() }
    catch (e) { alert((e as Error).message) } finally { setBusy(false) }
  }
  const suspend = async () => {
    if (!confirm(`暂停租户 "${tenant.name}"？该租户所有用户将无法使用系统。`)) return
    setBusy(true)
    try { await api.adminUpdateTenant(tenant.id, { status: 'suspended' }); onChanged() }
    catch (e) { alert((e as Error).message) } finally { setBusy(false) }
  }
  const resume = async () => {
    setBusy(true)
    try { await api.adminUpdateTenant(tenant.id, { status: 'active' }); onChanged() }
    catch (e) { alert((e as Error).message) } finally { setBusy(false) }
  }
  const del = async () => {
    if (!confirm(`永久删除租户 "${tenant.name}" 及其所有用户？此操作不可恢复。`)) return
    setBusy(true)
    try { await api.adminDeleteTenant(tenant.id); onChanged() }
    catch (e) { alert((e as Error).message) } finally { setBusy(false) }
  }
  const license = async () => {
    const key = prompt(`为租户 "${tenant.name}" 输入许可证密钥:`)
    if (!key) return
    setBusy(true)
    try { await api.adminActivateLicense(tenant.id, key.trim()); onChanged(); alert('激活成功') }
    catch (e) { alert((e as Error).message) } finally { setBusy(false) }
  }

  const statusColor = tenant.status === 'active' ? '#16a34a' : '#dc2626'
  const sub = tenant.subscription
  const daysRemaining = sub?.daysRemaining ?? null
  const expired = sub?.expired ?? false
  const countdownColor = expired ? '#dc2626' : (daysRemaining != null && daysRemaining <= 7 ? '#f59e0b' : '#666')
  const countdownLabel = expired
    ? '已过期'
    : daysRemaining == null ? '—' : `剩 ${daysRemaining} 天`
  const paidCents = sub?.paidCents ?? 0
  const paidYuan = (paidCents / 100).toFixed(2)
  const paidOrders = sub?.paidOrders ?? 0
  return (
    <tr style={{ opacity: busy ? 0.5 : 1 }}>
      <td style={tdStyle}>{tenant.id}</td>
      <td style={tdStyle}>{tenant.name}</td>
      <td style={tdStyle}><PlanBadge plan={tenant.plan} /></td>
      <td style={tdStyle}>
        <span style={{ color: statusColor, fontWeight: 500 }}>
          ● {tenant.status === 'active' ? '活跃' : '暂停'}
        </span>
      </td>
      <td style={tdStyle}>
        <div>{expires}</div>
        <div style={{ color: countdownColor, fontSize: 11, fontWeight: 500 }}>{countdownLabel}</div>
      </td>
      <td style={tdStyle}>
        {paidCents > 0 ? <>¥{paidYuan} <span style={{ color: '#999', fontSize: 10 }}>({paidOrders} 单)</span></> : <span style={{ color: '#bbb' }}>—</span>}
      </td>
      <td style={tdStyle}>{tenant.userCount ?? '-'}</td>
      <td style={tdStyle}>{tenant.usage?.chatMessages ?? 0}</td>
      <td style={tdStyle}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button style={miniBtn} onClick={() => renew(30)} disabled={busy}>+30天</button>
          <button style={miniBtn} onClick={() => renew(365)} disabled={busy}>+1年</button>
          <button style={miniBtn} onClick={license} disabled={busy}>激活License</button>
          {tenant.status === 'active'
            ? <button style={miniBtn} onClick={suspend} disabled={busy}>暂停</button>
            : <button style={miniBtn} onClick={resume} disabled={busy}>恢复</button>}
          {tenant.id !== 1 && <button style={{ ...miniBtn, color: '#dc2626' }} onClick={del} disabled={busy}>删除</button>}
        </div>
      </td>
    </tr>
  )
}

function NewTenantModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('')
  const [plan, setPlan] = useState<PlanId>('personal')
  const [days, setDays] = useState(365)
  const [err, setErr] = useState<string | null>(null)
  const submit = async () => {
    setErr(null)
    try {
      await api.adminCreateTenant({
        name, plan,
        expiresAt: Date.now() + days * 24 * 60 * 60 * 1000,
      })
      onDone()
    } catch (e) { setErr((e as Error).message) }
  }
  return (
    <ModalShell title="新建租户" onClose={onClose}>
      <Field label="名称"><input value={name} onChange={e => setName(e.target.value)} style={inputStyle} /></Field>
      <Field label="计划">
        <select value={plan} onChange={e => setPlan(e.target.value as PlanId)} style={inputStyle}>
          <option value="free">Free 试用</option>
          <option value="personal">Personal 个人版</option>
          <option value="enterprise">Enterprise 企业版</option>
        </select>
      </Field>
      <Field label="有效期（天）">
        <input type="number" value={days} min={1} onChange={e => setDays(Number(e.target.value))} style={inputStyle} />
      </Field>
      {err && <ErrBanner>{err}</ErrBanner>}
      <button onClick={submit} style={primaryBtn}>创建</button>
    </ModalShell>
  )
}

// ---- Users panel -----------------------------------------------------------

function UsersPanel() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)

  const reload = useCallback(() => {
    setLoading(true); setErr(null)
    api.adminListUsers()
      .then(r => setUsers(r.users))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { reload() }, [reload])

  return (
    <div>
      <PanelHeader title="用户" hint="平台所有账号。admin 角色可访问管理后台，user 角色仅可使用对话">
        <button onClick={() => setShowNew(true)} style={primaryBtn}>+ 新建用户</button>
      </PanelHeader>
      {err && <ErrBanner>{err}</ErrBanner>}
      {loading && <div style={{ color: '#888', fontSize: 12 }}>加载中...</div>}
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>ID</th>
            <th style={thStyle}>用户名</th>
            <th style={thStyle}>邮箱</th>
            <th style={thStyle}>租户</th>
            <th style={thStyle}>角色</th>
            <th style={thStyle}>状态</th>
            <th style={thStyle}>操作</th>
          </tr>
        </thead>
        <tbody>
          {users.map(u => <UserRow key={u.id} user={u} onChanged={reload} />)}
        </tbody>
      </table>
      {showNew && <NewUserModal onClose={() => setShowNew(false)} onDone={() => { setShowNew(false); reload() }} />}
    </div>
  )
}

function UserRow({ user, onChanged }: { user: AdminUser; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const toggleRole = async () => {
    setBusy(true)
    try { await api.adminUpdateUser(user.id, { role: user.role === 'admin' ? 'user' : 'admin' }); onChanged() }
    catch (e) { alert((e as Error).message) } finally { setBusy(false) }
  }
  const toggleStatus = async () => {
    const next = user.status === 'active' ? 'disabled' : 'active'
    if (next === 'disabled' && !confirm(`禁用用户 "${user.username}"？`)) return
    setBusy(true)
    try { await api.adminUpdateUser(user.id, { status: next }); onChanged() }
    catch (e) { alert((e as Error).message) } finally { setBusy(false) }
  }
  const reset = async () => {
    const pw = prompt(`为用户 "${user.username}" 重置密码（至少 6 位）:`)
    if (!pw || pw.length < 6) return
    setBusy(true)
    try { await api.adminResetUserPassword(user.id, pw); alert('已重置') }
    catch (e) { alert((e as Error).message) } finally { setBusy(false) }
  }
  const del = async () => {
    if (!confirm(`删除用户 "${user.username}"？此操作不可恢复。`)) return
    setBusy(true)
    try { await api.adminDeleteUser(user.id); onChanged() }
    catch (e) { alert((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <tr style={{ opacity: busy ? 0.5 : 1 }}>
      <td style={tdStyle}>{user.id}</td>
      <td style={tdStyle}>{user.username}</td>
      <td style={tdStyle}>{user.email ?? '-'}</td>
      <td style={tdStyle}>{user.tenantName ?? `#${user.tenant_id}`}</td>
      <td style={tdStyle}>
        {user.role === 'admin'
          ? <span style={{ color: '#a855f7', fontWeight: 600, fontSize: 11 }}>ADMIN</span>
          : <span style={{ color: '#666', fontSize: 11 }}>USER</span>}
      </td>
      <td style={tdStyle}>
        <span style={{ color: user.status === 'active' ? '#16a34a' : '#dc2626', fontWeight: 500 }}>
          ● {user.status === 'active' ? '活跃' : '禁用'}
        </span>
      </td>
      <td style={tdStyle}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button style={miniBtn} onClick={toggleRole} disabled={busy}>
            {user.role === 'admin' ? '降级为普通' : '升级为管理员'}
          </button>
          <button style={miniBtn} onClick={toggleStatus} disabled={busy}>
            {user.status === 'active' ? '禁用' : '启用'}
          </button>
          <button style={miniBtn} onClick={reset} disabled={busy}>重置密码</button>
          <button style={{ ...miniBtn, color: '#dc2626' }} onClick={del} disabled={busy}>删除</button>
        </div>
      </td>
    </tr>
  )
}

function NewUserModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [tenants, setTenants] = useState<AdminTenant[]>([])
  const [tenantId, setTenantId] = useState<number | ''>('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'user'>('user')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => { api.adminListTenants().then(r => {
    setTenants(r.tenants)
    if (r.tenants[0]) setTenantId(r.tenants[0].id)
  }) }, [])

  const submit = async () => {
    setErr(null)
    if (!tenantId) { setErr('请选择租户'); return }
    try {
      await api.adminCreateUser({
        tenantId: Number(tenantId), username, password,
        email: email || undefined, role,
      })
      onDone()
    } catch (e) { setErr((e as Error).message) }
  }
  return (
    <ModalShell title="新建用户" onClose={onClose}>
      <Field label="所属租户">
        <select value={tenantId} onChange={e => setTenantId(Number(e.target.value))} style={inputStyle}>
          {tenants.map(t => <option key={t.id} value={t.id}>{t.name} (#{t.id})</option>)}
        </select>
      </Field>
      <Field label="用户名"><input value={username} onChange={e => setUsername(e.target.value)} style={inputStyle} /></Field>
      <Field label="密码（至少 6 位）">
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} style={inputStyle} />
      </Field>
      <Field label="邮箱（可选）">
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} />
      </Field>
      <Field label="角色">
        <select value={role} onChange={e => setRole(e.target.value as 'admin' | 'user')} style={inputStyle}>
          <option value="user">普通用户</option>
          <option value="admin">平台管理员</option>
        </select>
      </Field>
      {err && <ErrBanner>{err}</ErrBanner>}
      <button onClick={submit} style={primaryBtn}>创建</button>
    </ModalShell>
  )
}

// ---- Usage panel -----------------------------------------------------------

function UsagePanel() {
  const [rows, setRows] = useState<AdminTenantUsage[]>([])
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { api.adminGetUsage().then(r => setRows(r.tenants)).catch(e => setErr(e.message)) }, [])
  return (
    <div>
      <PanelHeader title="用量统计" hint={`本月账期用量（按租户分组）`} />
      {err && <ErrBanner>{err}</ErrBanner>}
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>租户</th>
            <th style={thStyle}>计划</th>
            <th style={thStyle}>到期</th>
            <th style={thStyle}>消息数</th>
            <th style={thStyle}>工具调用</th>
            <th style={thStyle}>KB 文档</th>
            <th style={thStyle}>KB 条目</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const exp = r.expiresAt ? new Date(r.expiresAt).toISOString().slice(0, 10) : '不限'
            const msgLimit = r.limits.chatMessagesPerMonth
            const toolLimit = r.limits.toolCallsPerMonth
            return (
              <tr key={r.tenantId}>
                <td style={tdStyle}>{r.tenantName} <span style={{ color: '#999' }}>#{r.tenantId}</span></td>
                <td style={tdStyle}><PlanBadge plan={r.plan} /></td>
                <td style={tdStyle}>{exp}</td>
                <td style={tdStyle}>{r.usage.chatMessages} / {msgLimit ?? '∞'}</td>
                <td style={tdStyle}>{r.usage.toolCalls} / {toolLimit ?? '∞'}</td>
                <td style={tdStyle}>{r.usage.kbDocumentsTotal}</td>
                <td style={tdStyle}>{r.usage.kbEntriesTotal}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---- Skills panel ----------------------------------------------------------

function SkillsPanel() {
  const [skills, setSkills] = useState<AdminSkill[]>([])
  const [err, setErr] = useState<string | null>(null)
  const reload = useCallback(() => {
    api.adminListSkills().then(r => setSkills(r.skills)).catch(e => setErr(e.message))
  }, [])
  useEffect(() => { reload() }, [reload])

  const toggle = async (pkg: string, enabled: boolean) => {
    try { await api.adminToggleSkill(pkg, enabled); reload() }
    catch (e) { alert((e as Error).message) }
  }

  return (
    <div>
      <PanelHeader title="技能插件" hint="全局开关 — 禁用后所有租户的 LLM 将看不到该技能的工具" />
      {err && <ErrBanner>{err}</ErrBanner>}
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>包名</th>
            <th style={thStyle}>显示名称</th>
            <th style={thStyle}>版本</th>
            <th style={thStyle}>工具数</th>
            <th style={thStyle}>状态</th>
            <th style={thStyle}>操作</th>
          </tr>
        </thead>
        <tbody>
          {skills.map(s => (
            <tr key={s.packageName}>
              <td style={tdStyle}><code style={{ fontSize: 11 }}>{s.packageName}</code></td>
              <td style={tdStyle}>{s.displayName}</td>
              <td style={tdStyle}>{s.version}</td>
              <td style={tdStyle}>{s.toolCount}</td>
              <td style={tdStyle}>
                <span style={{ color: s.enabled ? '#16a34a' : '#999', fontWeight: 500 }}>
                  {s.enabled ? '● 启用' : '○ 禁用'}
                </span>
              </td>
              <td style={tdStyle}>
                <button style={miniBtn} onClick={() => toggle(s.packageName, !s.enabled)}>
                  {s.enabled ? '禁用' : '启用'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---- Capabilities panel ----------------------------------------------------

function CapabilitiesPanel() {
  const [data, setData] = useState<PlanCapabilitiesResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [skills, setSkills] = useState<AdminSkill[]>([])
  const reload = useCallback(() => {
    api.adminGetPlanCapabilities()
      .then(setData).catch(e => setErr(e.message))
    api.adminListSkills().then(r => setSkills(r.skills)).catch(() => {})
  }, [])
  useEffect(() => { reload() }, [reload])

  const update = async (plan: PlanId, patch: Partial<PlanCapabilities>) => {
    try {
      await api.adminUpdatePlanCapabilities(plan, patch)
      reload()
    } catch (e) { alert((e as Error).message) }
  }

  if (!data) return <div style={{ color: '#888', fontSize: 12 }}>加载中...{err}</div>

  const plans: PlanId[] = ['free', 'personal', 'enterprise']

  return (
    <div>
      <PanelHeader
        title="方案权限矩阵"
        hint="为每种订阅方案控制：数据导入、APIKey 配置、页面跳转与可用技能。MVP 阶段所有页面跳转默认关闭，管理员按需打开。"
      />
      {err && <ErrBanner>{err}</ErrBanner>}
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>能力</th>
            {plans.map(p => <th key={p} style={thStyle}><PlanBadge plan={p} /></th>)}
          </tr>
        </thead>
        <tbody>
          <CapRow label="数据导入" description="允许上传文档/添加知识库条目" plans={plans} data={data.capabilities} get={c => c.knowledgeImport} onChange={(p, v) => update(p, { knowledgeImport: v })} />
          <CapRow label="APIKey 配置" description="允许用户自行填写/修改 LLM API Key" plans={plans} data={data.capabilities} get={c => c.apiKeyConfig} onChange={(p, v) => update(p, { apiKeyConfig: v })} />
          <tr><td colSpan={plans.length + 1} style={{ ...tdStyle, fontWeight: 600, background: '#fafafa', color: '#666', fontSize: 11 }}>— 页面跳转 —</td></tr>
          <CapRow label="  知识库页面" plans={plans} data={data.capabilities} get={c => c.pages.knowledge} onChange={(p, v) => update(p, { pages: { knowledge: v } })} />
          <CapRow label="  技能管理页面" plans={plans} data={data.capabilities} get={c => c.pages.skills} onChange={(p, v) => update(p, { pages: { skills: v } })} />
          <CapRow label="  订阅方案页面" plans={plans} data={data.capabilities} get={c => c.pages.pricing} onChange={(p, v) => update(p, { pages: { pricing: v } })} />
          <CapRow label="  用量统计页面" plans={plans} data={data.capabilities} get={c => c.pages.usage} onChange={(p, v) => update(p, { pages: { usage: v } })} />
          <CapRow label="  管理后台入口" description="仅对 role=admin 用户生效" plans={plans} data={data.capabilities} get={c => c.pages.admin} onChange={(p, v) => update(p, { pages: { admin: v } })} />
        </tbody>
      </table>

      <div style={{ marginTop: 32 }}>
        <PanelHeader title="每方案可用技能" hint="勾选该方案下允许使用的技能；未勾选的技能其工具不会暴露给该方案下的用户" />
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>技能</th>
              {plans.map(p => <th key={p} style={thStyle}><PlanBadge plan={p} /></th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={tdStyle}><strong>全部技能 (*)</strong></td>
              {plans.map(p => {
                const caps = data.capabilities[p]
                const isAll = caps.skillAllowlist === '*'
                return (
                  <td key={p} style={tdStyle}>
                    <input type="checkbox" checked={isAll}
                      onChange={e => update(p, { skillAllowlist: e.target.checked ? '*' : [] })} />
                  </td>
                )
              })}
            </tr>
            {skills.map(s => (
              <tr key={s.packageName}>
                <td style={tdStyle}><code style={{ fontSize: 11 }}>{s.packageName}</code></td>
                {plans.map(p => {
                  const caps = data.capabilities[p]
                  const list = caps.skillAllowlist
                  const checked = list === '*' || (Array.isArray(list) && list.includes(s.packageName))
                  const disabled = list === '*'
                  return (
                    <td key={p} style={tdStyle}>
                      <input type="checkbox" checked={checked} disabled={disabled}
                        onChange={e => {
                          const cur = Array.isArray(list) ? list : []
                          const next = e.target.checked
                            ? Array.from(new Set([...cur, s.packageName]))
                            : cur.filter(x => x !== s.packageName)
                          update(p, { skillAllowlist: next })
                        }} />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CapRow({ label, description, plans, data, get, onChange }: {
  label: string
  description?: string
  plans: PlanId[]
  data: Record<PlanId, PlanCapabilities>
  get: (c: PlanCapabilities) => boolean
  onChange: (plan: PlanId, value: boolean) => void
}) {
  return (
    <tr>
      <td style={tdStyle}>
        <div>{label}</div>
        {description && <div style={{ color: '#999', fontSize: 11 }}>{description}</div>}
      </td>
      {plans.map(p => (
        <td key={p} style={tdStyle}>
          <input type="checkbox" checked={get(data[p])}
            onChange={e => onChange(p, e.target.checked)} />
        </td>
      ))}
    </tr>
  )
}

// ---- Payments panel --------------------------------------------------------

function PaymentsPanel() {
  const [orders, setOrders] = useState<AdminPaymentOrder[]>([])
  const [filter, setFilter] = useState<'all' | PaymentStatus>('all')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const reload = useCallback(() => {
    setErr(null)
    api.adminListPayments(filter === 'all' ? undefined : filter)
      .then(r => setOrders(r.orders)).catch(e => setErr(e.message))
  }, [filter])
  useEffect(() => { reload() }, [reload])

  const confirm_ = async (id: string) => {
    if (!confirm(`确认订单 ${id} 已收到付款？系统将自动签发许可证并激活对应租户的订阅。`)) return
    setBusy(id)
    try { await api.adminConfirmPayment(id); reload() }
    catch (e) { alert((e as Error).message) } finally { setBusy(null) }
  }
  const cancel_ = async (id: string) => {
    const reason = prompt(`取消订单 ${id}？请输入原因：`, '管理员取消')
    if (!reason) return
    setBusy(id)
    try { await api.adminCancelPayment(id, reason); reload() }
    catch (e) { alert((e as Error).message) } finally { setBusy(null) }
  }

  return (
    <div>
      <PanelHeader title="付费订单" hint="用户扫码付款后，在此确认收款，系统会自动签发许可证并激活订阅。">
        <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)} style={{ ...inputStyle, width: 140, height: 32 }}>
          <option value="all">全部订单</option>
          <option value="pending">待确认</option>
          <option value="paid">已付费</option>
          <option value="canceled">已取消</option>
          <option value="expired">已失效</option>
        </select>
      </PanelHeader>
      {err && <ErrBanner>{err}</ErrBanner>}
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>订单号</th>
            <th style={thStyle}>租户</th>
            <th style={thStyle}>用户</th>
            <th style={thStyle}>方案 / 周期</th>
            <th style={thStyle}>金额</th>
            <th style={thStyle}>状态</th>
            <th style={thStyle}>创建时间</th>
            <th style={thStyle}>操作</th>
          </tr>
        </thead>
        <tbody>
          {orders.map(o => (
            <tr key={o.id} style={{ opacity: busy === o.id ? 0.5 : 1 }}>
              <td style={tdStyle}><code style={{ fontSize: 10 }}>{o.id}</code></td>
              <td style={tdStyle}>{o.tenantName ?? `#${o.tenant_id}`}</td>
              <td style={tdStyle}>{o.userName ?? '-'}</td>
              <td style={tdStyle}><PlanBadge plan={o.plan} /> <span style={{ color: '#666', fontSize: 11 }}>{o.cycle === 'yearly' ? '年付' : '月付'}</span></td>
              <td style={tdStyle}>{o.currency === 'CNY' ? '¥' : '$'}{(o.amount_cents / 100).toFixed(2)}</td>
              <td style={tdStyle}><PayStatusBadge status={o.status} /></td>
              <td style={tdStyle}>{new Date(o.created_at).toLocaleString('zh-CN')}</td>
              <td style={tdStyle}>
                {o.status === 'pending' && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button style={{ ...miniBtn, background: '#16a34a', color: '#fff', border: 'none' }}
                      onClick={() => confirm_(o.id)} disabled={!!busy}>确认收款</button>
                    <button style={{ ...miniBtn, color: '#dc2626' }} onClick={() => cancel_(o.id)} disabled={!!busy}>取消</button>
                  </div>
                )}
                {o.status === 'paid' && o.license_key && (
                  <code style={{ fontSize: 10, color: '#666' }} title={o.license_key}>
                    {o.license_key.slice(0, 20)}...
                  </code>
                )}
              </td>
            </tr>
          ))}
          {orders.length === 0 && (
            <tr><td colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: '#bbb' }}>暂无订单</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function PayStatusBadge({ status }: { status: PaymentStatus }) {
  const map: Record<PaymentStatus, { color: string; label: string }> = {
    pending:  { color: '#f59e0b', label: '待确认' },
    paid:     { color: '#16a34a', label: '已付费' },
    canceled: { color: '#999',    label: '已取消' },
    expired:  { color: '#dc2626', label: '已失效' },
  }
  const m = map[status]
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: m.color,
      border: `1px solid ${m.color}`, borderRadius: 4, padding: '1px 6px' }}>
      ● {m.label}
    </span>
  )
}

// ---- Gateway panel ---------------------------------------------------------

function GatewayPanel() {
  const [gw, setGw] = useState<PaymentGateway>({})
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api.adminGetPaymentGateway().then(r => setGw(r.gateway || {})).catch(e => setErr(e.message))
  }, [])

  const save = async () => {
    setErr(null); setSaved(false)
    try {
      await api.adminUpdatePaymentGateway(gw)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) { setErr((e as Error).message) }
  }

  return (
    <div style={{ maxWidth: 680 }}>
      <PanelHeader
        title="收款配置"
        hint="用户扫码付费时显示的微信/支付宝收款码与客服联系方式。"
      />
      {err && <ErrBanner>{err}</ErrBanner>}
      <Field label="微信收款码 URL">
        <input value={gw.wechatQrUrl ?? ''} onChange={e => setGw({ ...gw, wechatQrUrl: e.target.value })}
          placeholder="https://... 或 data:image/png;base64,..." style={inputStyle} />
      </Field>
      <Field label="支付宝收款码 URL">
        <input value={gw.alipayQrUrl ?? ''} onChange={e => setGw({ ...gw, alipayQrUrl: e.target.value })}
          placeholder="https://... 或 data:image/png;base64,..." style={inputStyle} />
      </Field>
      <Field label="银行账户（可选）">
        <input value={gw.bankAccount ?? ''} onChange={e => setGw({ ...gw, bankAccount: e.target.value })} style={inputStyle} />
      </Field>
      <Field label="客服电话">
        <input value={gw.contactPhone ?? ''} onChange={e => setGw({ ...gw, contactPhone: e.target.value })} style={inputStyle} />
      </Field>
      <Field label="客服邮箱">
        <input value={gw.contactEmail ?? ''} onChange={e => setGw({ ...gw, contactEmail: e.target.value })} style={inputStyle} />
      </Field>
      <Field label="付款说明">
        <textarea value={gw.instructions ?? ''} onChange={e => setGw({ ...gw, instructions: e.target.value })}
          rows={3} style={{ ...inputStyle, fontFamily: 'inherit' }} />
      </Field>
      <button onClick={save} style={primaryBtn}>保存</button>
      {saved && <span style={{ marginLeft: 12, color: '#16a34a', fontSize: 12 }}>✓ 已保存</span>}

      <div style={{ marginTop: 32, padding: 16, background: '#fff', border: '1px solid #eee', borderRadius: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#666', marginBottom: 12 }}>预览</div>
        <div style={{ display: 'flex', gap: 24 }}>
          {gw.wechatQrUrl && (
            <div style={{ textAlign: 'center' }}>
              <img src={gw.wechatQrUrl} alt="微信" style={{ width: 160, height: 160, objectFit: 'contain', border: '1px solid #eee' }} />
              <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>微信</div>
            </div>
          )}
          {gw.alipayQrUrl && (
            <div style={{ textAlign: 'center' }}>
              <img src={gw.alipayQrUrl} alt="支付宝" style={{ width: 160, height: 160, objectFit: 'contain', border: '1px solid #eee' }} />
              <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>支付宝</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---- Shared UI bits --------------------------------------------------------

function PanelHeader({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{title}</div>
        {hint && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{hint}</div>}
      </div>
      <div style={{ flex: 1 }} />
      {children}
    </div>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      padding: '8px 16px', fontSize: 13, fontWeight: 500,
      color: active ? '#111' : '#666', background: 'transparent', border: 'none',
      borderBottom: active ? '2px solid #111' : '2px solid transparent',
      cursor: 'pointer', marginBottom: -1,
    }}>{children}</button>
  )
}

function PlanBadge({ plan }: { plan: PlanId }) {
  const colors: Record<PlanId, string> = {
    free: '#888', personal: '#0ea5e9', enterprise: '#a855f7',
  }
  const labels: Record<PlanId, string> = {
    free: 'Free', personal: 'Personal', enterprise: 'Enterprise',
  }
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, color: colors[plan],
      border: `1px solid ${colors[plan]}`, borderRadius: 4, padding: '1px 6px',
    }}>{labels[plan]}</span>
  )
}

function ErrBanner({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 12, color: '#dc2626', marginBottom: 12,
      background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)',
      padding: '8px 10px', borderRadius: 6,
    }}>{children}</div>
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

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 10000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 10, padding: 24, width: 360,
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>{title}</div>
        {children}
      </div>
    </div>
  )
}

const tableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', background: '#fff',
  borderRadius: 8, overflow: 'hidden', fontSize: 12,
  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
}
const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 600,
  color: '#666', borderBottom: '1px solid #eee', background: '#fafafa',
}
const tdStyle: React.CSSProperties = {
  padding: '10px 12px', fontSize: 12, color: '#222', borderBottom: '1px solid #f0f0f0',
  verticalAlign: 'middle',
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 13,
  border: '1px solid #ddd', borderRadius: 6, outline: 'none', boxSizing: 'border-box',
}
const primaryBtn: React.CSSProperties = {
  padding: '8px 14px', fontSize: 12, fontWeight: 500,
  color: '#fff', background: '#111', border: 'none', borderRadius: 6, cursor: 'pointer',
}
const miniBtn: React.CSSProperties = {
  padding: '4px 8px', fontSize: 11, color: '#333',
  background: '#fff', border: '1px solid #ddd', borderRadius: 4, cursor: 'pointer',
}
const closeBtnStyle: React.CSSProperties = {
  padding: '6px 10px', fontSize: 12, color: '#666',
  background: '#fff', border: '1px solid #ddd', borderRadius: 6, cursor: 'pointer',
}
