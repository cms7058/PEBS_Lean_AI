const BASE = '/api'

export class ApiError extends Error {
  action?: string
  status: number

  constructor(message: string, action: string | undefined, status: number) {
    super(message)
    this.name = 'ApiError'
    this.action = action
    this.status = status
  }
}

export async function fetchJSON<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',  // send the session cookie
    ...options,
  })
  const contentType = res.headers.get('content-type') ?? ''
  const isJson = contentType.includes('application/json')

  if (!res.ok) {
    if (isJson) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      const body = err as { error?: string; message?: string; action?: string }
      throw new ApiError(body.error || body.message || res.statusText, body.action, res.status)
    }
    // Non-JSON error response — usually the SPA fallback returning index.html
    // because the route is missing. Surface a clearer message than a raw JSON
    // parse error so users know to restart / rebuild the server.
    throw new Error(`接口 ${path} 返回 ${res.status}（非 JSON 响应，可能是后端未挂载该路由或未重新构建；请重启服务）`)
  }

  if (!isJson) {
    // Happened in real life: user accessed UI via Vite dev server while the
    // backend (different port) was an older build without the new route.
    // Backend's SPA fallback returned index.html and res.json() blew up.
    throw new Error(`接口 ${path} 返回 HTML（非 JSON），多半是后端构建版本过旧未加载该路由；请 pnpm --filter @lean-ai/core build && 重启服务`)
  }

  return res.json() as Promise<T>
}

export const api = {
  // Models
  getModels: () => fetchJSON<ModelsResponse>('/models'),

  // Config
  getConfig: () => fetchJSON<AppConfig>('/config'),
  patchConfig: (body: Partial<AppConfig>) =>
    fetchJSON<AppConfig>('/config', { method: 'PATCH', body: JSON.stringify(body) }),
  setApiKey: (provider: string, value: string) =>
    fetchJSON('/config/apikey/' + provider, { method: 'PUT', body: JSON.stringify({ value }) }),
  setWenxinKeys: (apiKey: string, secretKey: string) =>
    fetchJSON('/config/apikey/wenxin', { method: 'PUT', body: JSON.stringify({ apiKey, secretKey }) }),
  testConnection: () => fetchJSON<{ ok: boolean; error?: string }>('/config/test', { method: 'POST' }),
  testProvider: (provider: string) =>
    fetchJSON<{ ok: boolean; error?: string }>(`/config/test/${provider}`, { method: 'POST' }),

  // Conversations
  getConversations: () => fetchJSON<Conversation[]>('/conversations'),
  getConversation: (id: string) => fetchJSON<ConversationDetail>('/conversations/' + id),
  deleteConversation: (id: string) =>
    fetchJSON('/conversations/' + id, { method: 'DELETE' }),

  // Skills
  getSkills: () => fetchJSON<{ skills: SkillEntry[] }>('/skills'),
  toggleSkill: (packageName: string, enabled: boolean) =>
    fetchJSON<{ ok: boolean }>(
      `/skills/${encodeURIComponent(packageName)}/toggle`,
      { method: 'POST', body: JSON.stringify({ enabled }) },
    ),
  installSkill: (packageSpec: string) =>
    fetchJSON<{ ok: boolean; packageName?: string; durationMs?: number; error?: string }>(
      '/skills/install',
      { method: 'POST', body: JSON.stringify({ packageSpec }) },
    ),
  removeSkill: (packageName: string) =>
    fetchJSON<{ ok: boolean }>(
      `/skills/${encodeURIComponent(packageName)}`,
      { method: 'DELETE' },
    ),

  // Knowledge base
  getKbStats: () => fetchJSON<KbStats>('/knowledge/stats'),
  getKbDocuments: () => fetchJSON<KbDocument[]>('/knowledge/documents'),
  deleteKbDocument: (id: string) =>
    fetchJSON<{ ok: boolean }>('/knowledge/documents/' + encodeURIComponent(id), { method: 'DELETE' }),
  uploadKbFile: async (file: File): Promise<KbIngestResult> => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${BASE}/knowledge/upload`, { method: 'POST', body: form })
    const json = await res.json().catch(() => ({ error: res.statusText }))
    if (!res.ok) throw new Error((json as { error?: string }).error || res.statusText)
    return json as KbIngestResult
  },
  getKbEntries: (source?: string) =>
    fetchJSON<KbEntrySummary[]>(
      '/knowledge/entries' + (source ? `?source=${encodeURIComponent(source)}` : '')
    ),
  getKbEntry: (id: string) =>
    fetchJSON<KbEntryFull>('/knowledge/entries/' + encodeURIComponent(id)),
  addKbEntry: (body: { title: string; content: string; tags?: string[]; source?: string }) =>
    fetchJSON<KbEntrySummary>('/knowledge/entries', { method: 'POST', body: JSON.stringify(body) }),
  deleteKbEntry: (id: string, force = false) =>
    fetchJSON<{ ok: boolean }>(
      '/knowledge/entries/' + encodeURIComponent(id) + (force ? '?force=1' : ''),
      { method: 'DELETE' },
    ),

  // Charts — data file import
  parseChartData: async (file: File): Promise<ParsedChartData> => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${BASE}/charts/parse-data`, { method: 'POST', body: form })
    const json = await res.json().catch(() => ({ error: res.statusText }))
    if (!res.ok) throw new Error((json as { error?: string }).error || res.statusText)
    return json as ParsedChartData
  },

  // Help / documentation
  getDocs: () => fetchJSON<{ docs: DocEntry[] }>('/docs'),
  getDoc: (id: string) => fetchJSON<{ id: string; title: string; content: string }>('/docs/' + encodeURIComponent(id)),

  // Billing / subscription
  getPlans: () => fetchJSON<{ plans: PlanDefinition[] }>('/billing/plans'),
  getSubscriptionStatus: () => fetchJSON<SubscriptionStatus>('/billing/status'),
  getUsage: () => fetchJSON<UsageResponse>('/billing/usage'),
  getBillingHistory: () => fetchJSON<{ history: BillingPeriod[] }>('/billing/history'),
  activateLicense: (licenseKey: string, email?: string) =>
    fetchJSON<{ ok: boolean; subscription: Subscription; plan: PlanDefinition }>(
      '/billing/activate',
      { method: 'POST', body: JSON.stringify({ licenseKey, email }) },
    ),
  downgradeToFree: () =>
    fetchJSON<{ ok: boolean; subscription: Subscription; plan: PlanDefinition }>(
      '/billing/downgrade',
      { method: 'POST', body: JSON.stringify({}) },
    ),
  previewLicense: (plan: 'personal' | 'enterprise', expiresAt?: number) =>
    fetchJSON<{ licenseKey: string; expiresAt: number }>(
      '/billing/license/preview',
      { method: 'POST', body: JSON.stringify({ plan, expiresAt }) },
    ),

  // ---- User account (login / register / logout / me) ----
  accountConfig: () => fetchJSON<{ registrationAllowed: boolean }>('/account/config'),
  me: () => fetchJSON<MeResponse>('/account/me'),
  internalInviteLogin: (email: string, inviteCode: string) =>
    fetchJSON<MeResponse>('/account/internal-login',
      { method: 'POST', body: JSON.stringify({ email, invite_code: inviteCode }) }),
  login: (identifier: string, password: string) =>
    fetchJSON<MeResponse>('/account/login',
      { method: 'POST', body: JSON.stringify({ identifier, password }) }),
  register: (body: { username: string; password: string; email?: string; displayName?: string }) =>
    fetchJSON<MeResponse>('/account/register', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => fetchJSON<{ ok: true }>('/account/logout', { method: 'POST', body: JSON.stringify({}) }),
  changePassword: (oldPassword: string, newPassword: string) =>
    fetchJSON<{ ok: true }>('/account/password',
      { method: 'POST', body: JSON.stringify({ oldPassword, newPassword }) }),

  // ---- Admin console ----
  adminListTenants: () => fetchJSON<{ tenants: AdminTenant[] }>('/admin/tenants'),
  adminCreateTenant: (body: { name: string; plan?: PlanId; expiresAt?: number | null; seats?: number; notes?: string }) =>
    fetchJSON<{ tenant: AdminTenant }>('/admin/tenants', { method: 'POST', body: JSON.stringify(body) }),
  adminGetTenant: (id: number) =>
    fetchJSON<AdminTenantDetail>(`/admin/tenants/${id}`),
  adminUpdateTenant: (id: number, patch: Partial<AdminTenantPatch>) =>
    fetchJSON<{ tenant: AdminTenant }>(`/admin/tenants/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  adminDeleteTenant: (id: number) =>
    fetchJSON<{ ok: true }>(`/admin/tenants/${id}`, { method: 'DELETE' }),
  adminRenewTenant: (id: number, days: number) =>
    fetchJSON<{ tenant: AdminTenant }>(`/admin/tenants/${id}/renew`,
      { method: 'POST', body: JSON.stringify({ days }) }),
  adminActivateLicense: (id: number, licenseKey: string, email?: string) =>
    fetchJSON<{ ok: true }>(`/admin/tenants/${id}/license`,
      { method: 'POST', body: JSON.stringify({ licenseKey, email }) }),

  adminListUsers: (tenantId?: number) =>
    fetchJSON<{ users: AdminUser[] }>(`/admin/users${tenantId ? `?tenantId=${tenantId}` : ''}`),
  adminCreateUser: (body: { tenantId: number; username: string; password: string;
                             email?: string; displayName?: string; role?: 'admin' | 'user' }) =>
    fetchJSON<{ user: AdminUser }>('/admin/users', { method: 'POST', body: JSON.stringify(body) }),
  adminUpdateUser: (id: number, patch: Partial<{ email: string; display_name: string; role: 'admin' | 'user'; status: 'active' | 'disabled' }>) =>
    fetchJSON<{ user: AdminUser }>(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  adminResetUserPassword: (id: number, newPassword: string) =>
    fetchJSON<{ ok: true }>(`/admin/users/${id}/password`,
      { method: 'POST', body: JSON.stringify({ newPassword }) }),
  adminDeleteUser: (id: number) =>
    fetchJSON<{ ok: true }>(`/admin/users/${id}`, { method: 'DELETE' }),

  adminGetUsage: () => fetchJSON<{ tenants: AdminTenantUsage[] }>('/admin/usage'),
  adminListSkills: () => fetchJSON<{ skills: AdminSkill[] }>('/admin/skills'),
  adminToggleSkill: (pkg: string, enabled: boolean) =>
    fetchJSON<{ ok: true; enabled: boolean }>(`/admin/skills/${encodeURIComponent(pkg)}/toggle`,
      { method: 'POST', body: JSON.stringify({ enabled }) }),

  // ---- Admin: plan capabilities (feature-flag matrix) ----
  adminGetPlanCapabilities: () =>
    fetchJSON<PlanCapabilitiesResponse>('/admin/plan-capabilities'),
  adminUpdatePlanCapabilities: (plan: PlanId, patch: Partial<PlanCapabilities>) =>
    fetchJSON<{ ok: true; capabilities: PlanCapabilities }>(
      `/admin/plan-capabilities/${plan}`,
      { method: 'PUT', body: JSON.stringify(patch) },
    ),

  // ---- Admin: payment orders ----
  adminListPayments: (status?: PaymentStatus) =>
    fetchJSON<{ orders: AdminPaymentOrder[] }>(
      `/admin/payments${status ? `?status=${status}` : ''}`,
    ),
  adminConfirmPayment: (id: string, method?: 'wechat' | 'alipay' | 'bank' | 'manual') =>
    fetchJSON<{ ok: true; order: PaymentOrder }>(
      `/admin/payments/${encodeURIComponent(id)}/confirm`,
      { method: 'POST', body: JSON.stringify({ method }) },
    ),
  adminCancelPayment: (id: string, reason?: string) =>
    fetchJSON<{ ok: true; order: PaymentOrder }>(
      `/admin/payments/${encodeURIComponent(id)}/cancel`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    ),
  adminCreatePayment: (body: {
    tenantId: number; plan: PlanId; cycle: 'monthly' | 'yearly';
    method?: 'wechat' | 'alipay' | 'bank' | 'manual'; notes?: string
  }) => fetchJSON<{ order: PaymentOrder }>(
    '/admin/payments', { method: 'POST', body: JSON.stringify(body) },
  ),

  // ---- Admin: payment gateway config ----
  adminGetPaymentGateway: () =>
    fetchJSON<{ gateway: PaymentGateway }>('/admin/payment-gateway'),
  adminUpdatePaymentGateway: (patch: Partial<PaymentGateway>) =>
    fetchJSON<{ ok: true; gateway: PaymentGateway }>(
      '/admin/payment-gateway', { method: 'PUT', body: JSON.stringify(patch) },
    ),

  // ---- User-facing orders ----
  getPaymentInfo: () => fetchJSON<{ gateway: PaymentGateway }>('/billing/payment-info'),
  getPriceQuote: (plan: PlanId, cycle: 'monthly' | 'yearly') =>
    fetchJSON<{ plan: PlanId; cycle: string; amountCents: number; currency: string }>(
      `/billing/quote?plan=${plan}&cycle=${cycle}`,
    ),
  createOrder: (plan: PlanId, cycle: 'monthly' | 'yearly', method?: 'wechat' | 'alipay' | 'bank' | 'manual') =>
    fetchJSON<{ order: PaymentOrder; gateway: PaymentGateway }>(
      '/billing/orders', { method: 'POST', body: JSON.stringify({ plan, cycle, method }) },
    ),
  listMyOrders: () => fetchJSON<{ orders: PaymentOrder[] }>('/billing/orders'),
  getOrder: (id: string) =>
    fetchJSON<{ order: PaymentOrder }>(`/billing/orders/${encodeURIComponent(id)}`),
  cancelMyOrder: (id: string) =>
    fetchJSON<{ ok: true; order: PaymentOrder }>(
      `/billing/orders/${encodeURIComponent(id)}/cancel`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
}

// Types
export interface ModelsResponse {
  providers: Provider[]
  current: { provider: string; model: string }
}

export interface Provider {
  id: string
  name: string
  models: string[]
  configured: boolean
  oauthConnected: boolean
  supportsOAuth: boolean
  authMethod?: string
  apiKeyUrl?: string
  hint?: string
  selected: boolean
  selectedModel?: string
}

export interface AppConfig {
  llm: { provider: string; model: string; temperature: number; maxTokens: number }
  apiKeys: Record<string, unknown>
  server: { port: number; openBrowser: boolean }
  ui: { language: string; theme: string }
}

export interface Conversation {
  id: string
  title: string
  created_at: number
  updated_at: number
}

export interface Message {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: number
  /** Assistant-only: ordered text + tool segments captured during streaming. */
  parts?: MessagePart[]
}

/** A chunk of assistant output, either free text or a tool invocation. */
export type MessagePart = TextPart | ToolPart

export interface TextPart {
  kind: 'text'
  text: string
}

export interface ToolPart {
  kind: 'tool'
  id: string
  toolName: string
  skill: string
  status: 'running' | 'done' | 'error'
  input?: Record<string, unknown>
  result?: string
  isError?: boolean
  artifact?: SkillArtifact
}

export interface SkillArtifact {
  type: string
  data: unknown
  filename?: string
  mimeType?: string
}

export interface ConversationDetail extends Conversation {
  messages: Message[]
}

export interface KbStats {
  entries: number
  bySource: Array<{ bucket: string; n: number }>
  documents: number
}

export interface DocEntry {
  id: string
  title: string
  description?: string
  available: boolean
}

export interface ParsedChartData {
  filename: string
  bytes: number
  sheets: Array<{
    name: string
    headers: string[]
    rowCount: number
    preview: string
    rows?: (string | number | boolean | null)[][]
  }>
}

export interface KbDocument {
  id: string
  filename: string
  file_type: string
  chunk_count: number
  status: string
  uploaded_at: number
}

export interface KbIngestResult {
  docId: string
  chunkCount: number
  totalChars: number
  status: 'ready' | 'error'
  error?: string
}

export interface KbEntrySummary {
  id: string
  title: string
  source: string
  tags: string[]
  length?: number
  created_at: number
}

export interface KbEntryFull {
  id: string
  title: string
  source: string
  tags: string[]
  content: string
  created_at: number
}

export type SkillEntry =
  | {
      ok: true
      packageName: string
      displayName: string
      description: string
      version: string
      enabled: boolean
      locked?: boolean
      lockReason?: string
      tools: Array<{ name: string; description: string }>
    }
  | { ok: false; packageName: string; error: string; packageDir?: string }

// Billing / subscription
export type PlanId = 'free' | 'personal' | 'enterprise'

export interface PlanDefinition {
  id: PlanId
  name: string
  tagline: string
  highlights: string[]
  limits: {
    skills: string[] | '*'
    kbMaxEntries: number | null
    kbMaxDocuments: number | null
    kbMaxFileBytes: number
    chatMessagesPerMonth: number | null
    toolCallsPerMonth: number | null
    kbWritesPerMonth: number | null
    trialDays: number | null
    seats: number
  }
  pricing: { monthlyCents: number | null; yearlyCents: number | null; currency: 'CNY' | 'USD' }
  features: Array<{ label: string; value: string; muted?: boolean }>
}

export interface Subscription {
  plan: PlanId
  started_at: number
  expires_at: number | null
  billing_cycle: 'monthly' | 'yearly' | null
  license_key: string | null
  activated_email: string | null
  seats: number
  notes: string | null
}

export interface SubscriptionStatus {
  subscription: Subscription
  plan: PlanDefinition
  trialDaysRemaining: number | null
  trialExpired: boolean
}

export interface UsageResponse {
  snapshot: {
    plan: PlanId
    periodId: string
    chatMessages: number
    toolCalls: number
    kbEntryAdds: number
    kbUploads: number
    kbQueries: number
    kbEntriesTotal: number
    kbDocumentsTotal: number
  }
  limits: PlanDefinition['limits']
  percents: {
    chatMessages: number
    toolCalls: number
    kbWrites: number
    kbEntries: number
    kbDocuments: number
  }
}

// ---- User / auth / admin types ----

export interface SessionUser {
  id: number
  tenant_id: number
  username: string
  email: string | null
  display_name: string | null
  role: 'admin' | 'user'
  status: 'active' | 'disabled'
  created_at: number
  last_login_at: number | null
}

export interface SessionTenant {
  id: number
  name: string
  status: 'active' | 'suspended'
  plan: PlanId
  expires_at: number | null
  seats: number
  license_key: string | null
  notes: string | null
  created_at: number
  updated_at: number
}

export interface MeResponse {
  user: SessionUser
  tenant: SessionTenant
  registrationAllowed?: boolean
  capabilities?: PlanCapabilities
  subscription?: {
    plan: PlanId
    planName: string
    startedAt: number
    expiresAt: number | null
    daysRemaining: number | null
    expired: boolean
    seats: number
    licenseKey: string | null
    cycle: 'monthly' | 'yearly' | null
    paidCents: number
    paidOrders: number
    currency: string
  }
}

export interface AdminTenant extends SessionTenant {
  userCount?: number
  usage?: UsageResponse['snapshot']
  subscription?: {
    plan: PlanId
    expiresAt: number | null
    daysRemaining: number | null
    expired: boolean
    paidCents: number
    paidOrders: number
    currency: string
  }
}

export interface AdminTenantDetail {
  tenant: SessionTenant
  users: SessionUser[]
  usage: UsageResponse['snapshot']
  plan: PlanDefinition
  subscription: Subscription
}

export interface AdminTenantPatch {
  name: string
  status: 'active' | 'suspended'
  plan: PlanId
  expires_at: number | null
  seats: number
  license_key: string | null
  notes: string | null
}

export interface AdminUser extends SessionUser {
  tenantName?: string | null
}

export interface AdminTenantUsage {
  tenantId: number
  tenantName: string
  plan: PlanId
  status: 'active' | 'suspended'
  expiresAt: number | null
  usage: UsageResponse['snapshot']
  limits: PlanDefinition['limits']
}

export interface AdminSkill {
  packageName: string
  displayName: string
  description: string
  version: string
  toolCount: number
  enabled: boolean
}

export interface BillingPeriod {
  period: string
  plan: PlanId
  chat_messages: number
  tool_calls: number
  kb_entry_adds: number
  kb_uploads: number
  kb_queries: number
  amount_cents: number
  currency: string
  closed: number
  updated_at: number
}

// ---- Capabilities & payments ----

export interface PageCapabilities {
  knowledge: boolean
  skills: boolean
  pricing: boolean
  usage: boolean
  admin: boolean
}

export interface PlanCapabilities {
  knowledgeImport: boolean
  apiKeyConfig: boolean
  pages: PageCapabilities
  skillAllowlist: string[] | '*'
}

export interface PlanCapabilitiesResponse {
  plans: Array<{
    id: PlanId
    name: string
    description?: string
    pricing: { monthlyCents: number | null; yearlyCents: number | null; currency: string }
    limits: PlanDefinition['limits']
  }>
  capabilities: Record<PlanId, PlanCapabilities>
}

export type PaymentStatus = 'pending' | 'paid' | 'canceled' | 'expired'

export interface PaymentOrder {
  id: string
  tenant_id: number
  user_id: number | null
  plan: PlanId
  cycle: 'monthly' | 'yearly'
  amount_cents: number
  currency: string
  status: PaymentStatus
  method: 'wechat' | 'alipay' | 'bank' | 'manual' | null
  license_key: string | null
  notes: string | null
  created_at: number
  paid_at: number | null
  confirmed_at: number | null
  confirmed_by: number | null
  expires_at: number | null
}

export interface AdminPaymentOrder extends PaymentOrder {
  tenantName?: string | null
  userName?: string | null
}

export interface PaymentGateway {
  wechatQrUrl?: string
  alipayQrUrl?: string
  bankAccount?: string
  contactPhone?: string
  contactEmail?: string
  instructions?: string
}
