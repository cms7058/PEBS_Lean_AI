/**
 * 阿米巴动态智能体接入（LeanAI 作为「法/环」子工具）。
 *
 * 接入闭环：阿米巴「工具接入」页生成连接器令牌 → 跳到本系统 `/register` →
 * 落地页 POST /api/amiba/connect 落库 → 回调阿米巴 /api/connectors/hello 上报能力。
 *
 * 数据回填：把 LeanAI 的诊断产出（diagnosis_sessions）映射成阿米巴的 WasteItem
 * （法/环 维度浪费项，带 improvementRef 指向 8D/改善方案）+ 一个「诊断会话数」指标，
 * POST 到阿米巴 /api/ingest，喂 5M1E 画像与成本归因主线。
 */
import { Router, type Request, type Response } from 'express'
import { getDb } from '../../storage/db'
import { upsertInviteAccount } from '../../auth/users'
import { createSession } from '../../auth/sessions'
import { buildSessionCookie } from '../../auth/middleware'

const router = Router()

// 本工具会话有效期（与账号登录一致，30 天）
const LAUNCH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

const LEAN_VERSION = '1.0.0'
const LEAN_CAPABILITIES = ['流程三性诊断', 'VSM 价值流', '鱼骨/Pareto 根因', '8D/DMAIC 报告', 'RAG 知识库']
// 本系统对外可达地址，供阿米巴反向下发改进任务回调（Phase 3c）。
const LEAN_PUBLIC_URL = process.env.LEANAI_PUBLIC_URL || `http://localhost:${process.env.PORT || 3741}`

interface ConnectorRow {
  id: number
  enterprise_id: string
  source: string
  amiba_endpoint: string
  amiba_token: string
  label: string | null
  capabilities: string | null
  connected_at: number
  last_hello_at: number | null
  hello_ok: number
  hello_error: string | null
  last_sync_at: number | null
  last_sync_summary: string | null
  active: number
}

function ensureSchema(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS amiba_connectors (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      enterprise_id    TEXT NOT NULL,
      source           TEXT NOT NULL DEFAULT 'lean',
      amiba_endpoint   TEXT NOT NULL,
      amiba_token      TEXT NOT NULL,
      label            TEXT,
      capabilities     TEXT,
      connected_at     INTEGER NOT NULL,
      last_hello_at    INTEGER,
      hello_ok         INTEGER NOT NULL DEFAULT 0,
      hello_error      TEXT,
      last_sync_at     INTEGER,
      last_sync_summary TEXT,
      active           INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS amiba_product_bindings (
      product_id    TEXT PRIMARY KEY,
      enterprise_id TEXT NOT NULL,
      part_no       TEXT,
      product_name  TEXT,
      created_at    INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS amiba_projects (
      id              TEXT PRIMARY KEY,
      enterprise_id   TEXT NOT NULL,
      enterprise_name TEXT,
      product_id      TEXT NOT NULL,
      part_no         TEXT,
      product_name    TEXT,
      amiba_endpoint  TEXT NOT NULL,
      connector_token TEXT,
      labor_rate      REAL NOT NULL DEFAULT 60,
      created_by      TEXT,
      started_at      INTEGER NOT NULL,
      submitted_at    INTEGER,
      status          TEXT NOT NULL DEFAULT 'active',
      report_json     TEXT
    );
    CREATE TABLE IF NOT EXISTS amiba_tasks (
      id               TEXT PRIMARY KEY,
      project_id       TEXT NOT NULL,
      assignee_username TEXT NOT NULL,
      assignee_display TEXT,
      scope            TEXT,
      status           TEXT NOT NULL DEFAULT 'todo',
      active_seconds   INTEGER NOT NULL DEFAULT 0,
      running_since    INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_amiba_tasks_project ON amiba_tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_amiba_projects_product ON amiba_projects(product_id);
  `)
}

interface BindingRow {
  product_id: string
  enterprise_id: string
  part_no: string | null
  product_name: string | null
  created_at: number
}

const LEAN_LABOR_RATE = Number(process.env.LEANAI_LABOR_RATE || 60) // ¥/h
const LEAN_SCOPES = ['流程三性诊断', 'VSM 价值流梳理', '鱼骨/Pareto 根因', '8D/DMAIC 对策', '改善验证与标准化']

interface ProjectRow {
  id: string; enterprise_id: string; enterprise_name: string | null
  product_id: string; part_no: string | null; product_name: string | null
  amiba_endpoint: string; connector_token: string | null; labor_rate: number
  created_by: string | null; started_at: number; submitted_at: number | null
  status: string; report_json: string | null
}
interface TaskRow {
  id: string; project_id: string; assignee_username: string; assignee_display: string | null
  scope: string | null; status: string; active_seconds: number; running_since: number | null
}

function nowSec(): number { return Math.floor(Date.now() / 1000) }
function taskElapsed(t: TaskRow): number {
  return t.active_seconds + (t.running_since ? Math.max(0, nowSec() - t.running_since) : 0)
}
function projectDict(p: ProjectRow): Record<string, unknown> {
  const tasks = getDb().prepare('SELECT * FROM amiba_tasks WHERE project_id = ?').all(p.id) as TaskRow[]
  const total = tasks.reduce((s, t) => s + taskElapsed(t), 0)
  return {
    id: p.id, enterpriseId: p.enterprise_id, enterpriseName: p.enterprise_name,
    productId: p.product_id, partNo: p.part_no, productName: p.product_name,
    laborRate: p.labor_rate, startedAt: p.started_at, submittedAt: p.submitted_at, status: p.status,
    totalSeconds: total, manHours: Math.round((total / 3600) * 100) / 100,
    laborCost: Math.round((total / 3600) * p.labor_rate * 100) / 100,
    report: p.report_json ? JSON.parse(p.report_json) : null,
    tasks: tasks.map((t) => ({
      id: t.id, assigneeUsername: t.assignee_username, assigneeDisplay: t.assignee_display,
      scope: t.scope, status: t.status, running: t.running_since != null, elapsedSeconds: taskElapsed(t),
    })),
  }
}

// 按产品建/复用诊断计时项目（多人任务来自阿米巴 team）
function ensureProject(input: {
  enterpriseId: string; enterpriseName?: string; productId: string; partNo?: string; productName?: string
  amibaEndpoint: string; connectorToken?: string; createdBy?: string
  team: { username: string; displayName?: string }[]
}): Record<string, unknown> {
  const db = getDb()
  const existing = db
    .prepare("SELECT * FROM amiba_projects WHERE product_id = ? AND status = 'active' ORDER BY started_at DESC LIMIT 1")
    .get(input.productId) as ProjectRow | undefined
  if (existing) return projectDict(existing)

  const id = 'lean_proj_' + Math.random().toString(36).slice(2, 10)
  db.prepare(
    `INSERT INTO amiba_projects
      (id, enterprise_id, enterprise_name, product_id, part_no, product_name, amiba_endpoint, connector_token, labor_rate, created_by, started_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
  ).run(id, input.enterpriseId, input.enterpriseName || null, input.productId, input.partNo || null,
        input.productName || null, input.amibaEndpoint, input.connectorToken || null, LEAN_LABOR_RATE,
        input.createdBy || null, nowSec())

  const team = input.team.length ? input.team : [{ username: input.createdBy || 'me' }]
  const solo = team.length === 1 // 单人（从接入直接进工具）：进入即自动开始计时
  const ins = db.prepare(
    `INSERT INTO amiba_tasks (id, project_id, assignee_username, assignee_display, scope, status, active_seconds, running_since)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
  )
  team.forEach((m, i) => {
    ins.run('task_' + Math.random().toString(36).slice(2, 8), id, m.username, m.displayName || m.username,
            team.length > 1 ? LEAN_SCOPES[i % LEAN_SCOPES.length] : '整体精益诊断',
            solo ? 'doing' : 'todo', solo ? nowSec() : null)
  })
  return projectDict(db.prepare('SELECT * FROM amiba_projects WHERE id = ?').get(id) as ProjectRow)
}

function activeConnector(): ConnectorRow | undefined {
  ensureSchema()
  return getDb()
    .prepare('SELECT * FROM amiba_connectors WHERE active = 1 ORDER BY connected_at DESC LIMIT 1')
    .get() as ConnectorRow | undefined
}

function statusDict(c: ConnectorRow | undefined): Record<string, unknown> {
  if (!c) return { connected: false }
  return {
    connected: true,
    enterprise_id: c.enterprise_id,
    source: c.source,
    amiba_endpoint: c.amiba_endpoint,
    label: c.label,
    capabilities: c.capabilities ? JSON.parse(c.capabilities) : [],
    connected_at: new Date(c.connected_at).toISOString(),
    last_hello_at: c.last_hello_at ? new Date(c.last_hello_at).toISOString() : null,
    hello_ok: !!c.hello_ok,
    hello_error: c.hello_error,
    last_sync_at: c.last_sync_at ? new Date(c.last_sync_at).toISOString() : null,
    last_sync_summary: c.last_sync_summary,
  }
}

async function sayHello(c: ConnectorRow): Promise<{ ok: boolean; error: string | null }> {
  const url = c.amiba_endpoint.replace(/\/+$/, '') + '/api/connectors/hello'
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.amiba_token}` },
      body: JSON.stringify({ version: LEAN_VERSION, capabilities: JSON.parse(c.capabilities || '[]'), inboundUrl: LEAN_PUBLIC_URL }),
      signal: AbortSignal.timeout(10000),
    })
    if (resp.ok) return { ok: true, error: null }
    let detail = ''
    try { detail = ((await resp.json()) as { error?: string }).error || '' } catch { detail = '' }
    return { ok: false, error: `hello 失败 HTTP ${resp.status}: ${detail}` }
  } catch (e) {
    return { ok: false, error: `无法连接阿米巴：${(e as Error).message}` }
  }
}

// 调阿米巴 /api/platform-auth/verify 核验平台令牌（apk_，登录凭证）。
async function verifyPlatform(
  amibaEndpoint: string, username: string, token: string, tool: string,
): Promise<{ valid: boolean; reason?: string; displayName?: string }> {
  const url = amibaEndpoint.replace(/\/+$/, '') + '/api/platform-auth/verify'
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, token, tool }),
      signal: AbortSignal.timeout(10000),
    })
    return (await resp.json()) as { valid: boolean; reason?: string; displayName?: string }
  } catch (e) {
    return { valid: false, reason: `无法连接阿米巴平台：${(e as Error).message}` }
  }
}

// 演示数据：首次接入时若无诊断会话，种入 3 条典型「法/环」诊断，便于回填演示。
function seedDemoDiagnosesIfEmpty(): void {
  const db = getDb()
  const n = (db.prepare('SELECT COUNT(*) AS c FROM diagnosis_sessions').get() as { c: number }).c
  if (n > 0) return
  const now = Date.now()
  const demos = [
    { factor: 'method', threeProps: 'rationality', title: '商机报价流程不合理：人工 Excel 估价、口径不统一', annualCost: 86000, costAccount: '销售费用' },
    { factor: 'method', threeProps: 'completeness', title: '订单评审缺标准检查项：交期承诺无产能校验', annualCost: 64000, costAccount: '管理费用' },
    { factor: 'environment', threeProps: 'correctness', title: '质量记录靠人工台账：现场环境数据缺失、追溯困难', annualCost: 52000, costAccount: '制造费用' },
  ]
  const stmt = db.prepare(
    `INSERT INTO diagnosis_sessions (id, conversation_id, stage, problem_type, data, created_at, updated_at)
     VALUES (?, ?, 'REPORT', ?, ?, ?, ?)`,
  )
  demos.forEach((d, i) => {
    stmt.run(`demo_diag_${i}`, `demo_conv_${i}`, d.factor, JSON.stringify(d), now, now)
  })
}

interface LeanWaste {
  factor: string
  threeProps?: string
  description: string
  annualCost: number
  costAccount: string
  improvementRef?: string
  source: string
}

function computeWaste(): { wasteItems: LeanWaste[]; sessionCount: number } {
  const db = getDb()
  const rows = db
    .prepare('SELECT id, problem_type, data FROM diagnosis_sessions')
    .all() as { id: string; problem_type: string | null; data: string }[]
  const wasteItems: LeanWaste[] = []
  for (const r of rows) {
    let d: { factor?: string; threeProps?: string; title?: string; annualCost?: number; costAccount?: string } = {}
    try { d = JSON.parse(r.data || '{}') } catch { d = {} }
    const factor = d.factor || (r.problem_type === 'environment' ? 'environment' : 'method')
    wasteItems.push({
      factor,
      threeProps: d.threeProps,
      description: d.title || '流程诊断发现的待改进项',
      annualCost: Number(d.annualCost) || 30000,
      costAccount: d.costAccount || '制造费用',
      improvementRef: `lean:diagnosis/${r.id}`,
      source: 'lean',
    })
  }
  return { wasteItems, sessionCount: rows.length }
}

async function syncToAmiba(c: ConnectorRow): Promise<Record<string, unknown>> {
  seedDemoDiagnosesIfEmpty()
  const { wasteItems, sessionCount } = computeWaste()
  const base = c.amiba_endpoint.replace(/\/+$/, '')
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${c.amiba_token}` }
  const now = new Date().toISOString()

  const envelope = {
    source: 'lean',
    batchId: 'lean-auto',
    wasteItems: wasteItems.map((w) => ({ ...w, attributionRule: 'Lean 三性诊断', })),
    metrics: [
      {
        factor: 'method',
        key: 'lean_diag_sessions',
        label: 'Lean 诊断会话数',
        value: sessionCount,
        unit: '个',
        source: 'lean',
        capturedAt: now,
      },
    ],
  }

  try {
    const resp = await fetch(base + '/api/ingest', {
      method: 'POST',
      headers,
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(10000),
    })
    const body = (await resp.json().catch(() => ({}))) as { wasteItems?: number; metrics?: number; error?: string }
    if (!resp.ok) return { ok: false, error: body.error || `回填失败 HTTP ${resp.status}` }
    const summary = `浪费项 ${body.wasteItems ?? wasteItems.length} 项 · 诊断会话 ${sessionCount} 个`
    getDb()
      .prepare('UPDATE amiba_connectors SET last_sync_at = ?, last_sync_summary = ? WHERE id = ?')
      .run(Date.now(), summary, c.id)
    return { ok: true, wasteItems: body.wasteItems ?? wasteItems.length, sessionCount, summary }
  } catch (e) {
    return { ok: false, error: `回填失败：${(e as Error).message}` }
  }
}

// POST /api/amiba/connect
router.post('/connect', async (req: Request, res: Response) => {
  ensureSchema()
  const { amiba_endpoint, amiba_token, enterprise_id, source, label } = req.body as Record<string, string>
  if (!amiba_endpoint || !amiba_token || !enterprise_id) {
    res.status(400).json({ error: '缺少 amiba_endpoint / amiba_token / enterprise_id' })
    return
  }
  const db = getDb()
  db.prepare('UPDATE amiba_connectors SET active = 0 WHERE active = 1').run()
  const info = db
    .prepare(
      `INSERT INTO amiba_connectors
        (enterprise_id, source, amiba_endpoint, amiba_token, label, capabilities, connected_at, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(
      enterprise_id,
      source || 'lean',
      amiba_endpoint,
      amiba_token,
      label || null,
      JSON.stringify(LEAN_CAPABILITIES),
      Date.now(),
    )
  let c = db.prepare('SELECT * FROM amiba_connectors WHERE id = ?').get(info.lastInsertRowid) as ConnectorRow

  const hello = await sayHello(c)
  db.prepare('UPDATE amiba_connectors SET hello_ok = ?, hello_error = ?, last_hello_at = ? WHERE id = ?')
    .run(hello.ok ? 1 : 0, hello.error, Date.now(), c.id)
  c = db.prepare('SELECT * FROM amiba_connectors WHERE id = ?').get(c.id) as ConnectorRow

  let sync: Record<string, unknown> | null = null
  if (hello.ok) {
    sync = await syncToAmiba(c)
    c = db.prepare('SELECT * FROM amiba_connectors WHERE id = ?').get(c.id) as ConnectorRow
  }
  res.json({ ok: hello.ok, sync, ...statusDict(c) })
})

// GET /api/amiba/status
router.get('/status', (_req: Request, res: Response) => {
  res.json(statusDict(activeConnector()))
})

// POST /api/amiba/sync
router.post('/sync', async (_req: Request, res: Response) => {
  const c = activeConnector()
  if (!c) { res.status(404).json({ error: '尚未接入阿米巴' }); return }
  res.json(await syncToAmiba(c))
})

// ---- 阿米巴「平台令牌登录 + 按产品建项目 + 产品级回填」（BOM 同款）----
//
// 用户从阿米巴「产品工作台」点「LeanAI」→ 带 平台令牌(apk_)+产品 跳到本系统
// /amiba/launch；本系统核验平台令牌、按产品建/绑诊断项目、铸本工具会话(Cookie)，
// 并用连接器令牌(amk_) 把该产品的法/环改善快照回填到阿米巴产品。

// 铸本工具会话：把阿米巴平台用户映射成 LeanAI 账号并下发会话 Cookie（平台令牌已核验即凭证）
function mintSessionCookie(res: Response, username: string, enterpriseId: string): void {
  const { user } = upsertInviteAccount({
    email: username.includes('@') ? username : `${username}@amiba.local`,
    inviteCode: `amiba-${enterpriseId || 'ent'}`,
  })
  const session = createSession({ userId: user.id, ttlMs: LAUNCH_SESSION_TTL_MS })
  res.setHeader('Set-Cookie', buildSessionCookie(session.token, LAUNCH_SESSION_TTL_MS))
}

// POST /api/amiba/platform-login — 仅核验平台令牌 + 建会话（供 /register 自动登录用，无产品）
router.post('/platform-login', async (req: Request, res: Response) => {
  ensureSchema()
  const { amiba_endpoint, platform_token, username, tool, enterprise_id } = req.body as Record<string, string>
  if (!amiba_endpoint || !platform_token || !username) {
    res.status(400).json({ error: '缺少 amiba_endpoint / platform_token / username' }); return
  }
  const verify = await verifyPlatform(amiba_endpoint, username, platform_token, tool || 'lean')
  if (!verify.valid) { res.status(401).json({ error: verify.reason || '平台令牌核验失败' }); return }
  mintSessionCookie(res, username, enterprise_id || '')
  res.json({ ok: true, username, displayName: verify.displayName || username })
})

// POST /api/amiba/launch — 平台令牌登录：核验 → 建会话 → 按产品建/复用诊断计时项目
router.post('/launch', async (req: Request, res: Response) => {
  ensureSchema()
  const {
    amiba_endpoint, platform_token, username, tool,
    enterprise_id, enterprise_name, product_id, part_no, product_name, connector_token, team,
  } = req.body as Record<string, string>
  if (!amiba_endpoint || !platform_token || !username || !product_id) {
    res.status(400).json({ error: '缺少 amiba_endpoint / platform_token / username / product_id' })
    return
  }
  const verify = await verifyPlatform(amiba_endpoint, username, platform_token, tool || 'lean')
  if (!verify.valid) { res.status(401).json({ error: verify.reason || '平台令牌核验失败' }); return }

  const db = getDb()
  // 连接器配置：launch 自带连接器令牌即可回填（无需先走 /register）
  let c = activeConnector()
  if (connector_token && (!c || c.amiba_token !== connector_token)) {
    db.prepare('UPDATE amiba_connectors SET active = 0 WHERE active = 1').run()
    const info = db
      .prepare(
        `INSERT INTO amiba_connectors
          (enterprise_id, source, amiba_endpoint, amiba_token, capabilities, connected_at, hello_ok, active)
         VALUES (?, ?, ?, ?, ?, ?, 1, 1)`,
      )
      .run(enterprise_id || '', tool || 'lean', amiba_endpoint, connector_token, JSON.stringify(LEAN_CAPABILITIES), Date.now())
    c = db.prepare('SELECT * FROM amiba_connectors WHERE id = ?').get(info.lastInsertRowid) as ConnectorRow
  }

  // 产品绑定（KPI 回填用）
  db.prepare(
    `INSERT OR REPLACE INTO amiba_product_bindings (product_id, enterprise_id, part_no, product_name, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(product_id, enterprise_id || '', part_no || '', product_name || '', Date.now())

  // 铸会话 + 建/复用诊断计时项目
  mintSessionCookie(res, username, enterprise_id || '')
  let teamArr: { username: string; displayName?: string }[] = []
  try { teamArr = team ? JSON.parse(team) : [] } catch { teamArr = [] }
  if (teamArr.length === 0) teamArr = [{ username, displayName: verify.displayName || username }]
  const project = ensureProject({
    enterpriseId: enterprise_id || '', enterpriseName: enterprise_name, productId: product_id,
    partNo: part_no, productName: product_name, amibaEndpoint: amiba_endpoint,
    connectorToken: connector_token || c?.amiba_token, createdBy: username, team: teamArr,
  })
  res.json({ ok: true, projectId: project.id, productId: product_id, productName: product_name || '' })
})

// ---- 计时项目：读取 / 任务计时 / 提交回传 ----

router.get('/projects/:id', (req: Request, res: Response) => {
  ensureSchema()
  const p = getDb().prepare('SELECT * FROM amiba_projects WHERE id = ?').get(req.params.id) as ProjectRow | undefined
  if (!p) { res.status(404).json({ error: '项目不存在' }); return }
  res.json(projectDict(p))
})

router.post('/projects/:id/tasks/:taskId/:action', (req: Request, res: Response) => {
  ensureSchema()
  const action = String(req.params.action)
  if (!['start', 'stop', 'done'].includes(action)) { res.status(400).json({ error: '未知操作' }); return }
  const db = getDb()
  const p = db.prepare('SELECT * FROM amiba_projects WHERE id = ?').get(req.params.id) as ProjectRow | undefined
  if (!p) { res.status(404).json({ error: '项目不存在' }); return }
  const t = db.prepare('SELECT * FROM amiba_tasks WHERE id = ? AND project_id = ?')
    .get(req.params.taskId, req.params.id) as TaskRow | undefined
  if (!t) { res.status(404).json({ error: '任务不存在' }); return }
  if (action === 'start') {
    if (!t.running_since) db.prepare("UPDATE amiba_tasks SET running_since = ?, status = 'doing' WHERE id = ?").run(nowSec(), t.id)
  } else if (action === 'stop') {
    if (t.running_since) db.prepare('UPDATE amiba_tasks SET active_seconds = ?, running_since = NULL WHERE id = ?')
      .run(taskElapsed(t), t.id)
  } else if (action === 'done') {
    db.prepare("UPDATE amiba_tasks SET active_seconds = ?, running_since = NULL, status = 'done' WHERE id = ?")
      .run(taskElapsed(t), t.id)
  }
  res.json(projectDict(p))
})

router.post('/projects/:id/submit', async (req: Request, res: Response) => {
  ensureSchema()
  const db = getDb()
  const p = db.prepare('SELECT * FROM amiba_projects WHERE id = ?').get(req.params.id) as ProjectRow | undefined
  if (!p) { res.status(404).json({ error: '项目不存在' }); return }
  if (p.status === 'submitted') { res.json(projectDict(p)); return }

  const tasks = db.prepare('SELECT * FROM amiba_tasks WHERE project_id = ?').all(p.id) as TaskRow[]
  const members: { username: string; seconds: number }[] = []
  let total = 0
  for (const t of tasks) {
    const secs = taskElapsed(t)
    db.prepare('UPDATE amiba_tasks SET active_seconds = ?, running_since = NULL WHERE id = ?').run(secs, t.id)
    total += secs
    members.push({ username: t.assignee_username, seconds: secs })
  }
  const manHours = Math.round((total / 3600) * 100) / 100
  const laborCost = Math.round(manHours * p.labor_rate * 100) / 100

  let reportOk = false, reportErr: string | null = null
  if (p.amiba_endpoint && p.connector_token && p.product_id) {
    try {
      const resp = await fetch(p.amiba_endpoint.replace(/\/+$/, '') + '/api/ingest/manhours', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.connector_token}` },
        body: JSON.stringify({
          productId: p.product_id, manHours, laborCost, members,
          summary: `精益诊断/改善工时 ${manHours}h · 人工成本 ¥${Math.round(laborCost).toLocaleString('zh-CN')}`,
        }),
        signal: AbortSignal.timeout(12000),
      })
      reportOk = resp.ok
      if (!resp.ok) reportErr = `HTTP ${resp.status}`
    } catch (e) { reportErr = (e as Error).message }
  } else {
    reportErr = '缺少连接器令牌/产品，未回传'
  }

  const report = { ok: reportOk, error: reportErr, manHours, laborCost }
  db.prepare("UPDATE amiba_projects SET status = 'submitted', submitted_at = ?, report_json = ? WHERE id = ?")
    .run(nowSec(), JSON.stringify(report), p.id)
  res.json(projectDict(db.prepare('SELECT * FROM amiba_projects WHERE id = ?').get(p.id) as ProjectRow))
})

// POST /api/amiba/report — 把该产品的法/环改善快照回填到阿米巴产品
router.post('/report', async (req: Request, res: Response) => {
  ensureSchema()
  const { productId } = req.body as Record<string, string>
  if (!productId) { res.status(400).json({ error: '缺少 productId' }); return }
  const c = activeConnector()
  if (!c) { res.status(404).json({ error: '尚未接入阿米巴' }); return }
  const binding = getDb()
    .prepare('SELECT * FROM amiba_product_bindings WHERE product_id = ?')
    .get(productId) as BindingRow | undefined
  if (!binding) { res.status(404).json({ error: '该产品未在 LeanAI 建立诊断项目' }); return }

  seedDemoDiagnosesIfEmpty()
  const { wasteItems, sessionCount } = computeWaste()
  const improvementHours = wasteItems.length * 16 // 改善投入工时估算（8D/DMAIC 约 16h/项）
  const metrics = [
    { label: '法/环浪费项', value: wasteItems.length, unit: '项' },
    { label: '诊断会话数', value: sessionCount, unit: '个' },
  ]
  const summary = `法/环浪费项 ${wasteItems.length} 项 · 诊断会话 ${sessionCount} 个`
  const body = { productId, manHours: improvementHours, summary, metrics }

  const base = c.amiba_endpoint.replace(/\/+$/, '')
  try {
    const resp = await fetch(base + '/api/ingest/manhours', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.amiba_token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    })
    const respBody = (await resp.json().catch(() => ({}))) as { error?: string }
    if (!resp.ok) { res.json({ ok: false, error: respBody.error || `回填失败 HTTP ${resp.status}` }); return }
    getDb()
      .prepare('UPDATE amiba_connectors SET last_sync_at = ?, last_sync_summary = ? WHERE id = ?')
      .run(Date.now(), `产品 ${binding.product_name || productId}：${summary}`, c.id)
    res.json({ ok: true, sent: body, summary })
  } catch (e) {
    res.json({ ok: false, error: `回填失败：${(e as Error).message}` })
  }
})

// POST /api/amiba/resync — 仅重新上报能力
router.post('/resync', async (_req: Request, res: Response) => {
  const c = activeConnector()
  if (!c) { res.status(404).json({ error: '尚未接入阿米巴' }); return }
  const hello = await sayHello(c)
  getDb().prepare('UPDATE amiba_connectors SET hello_ok = ?, hello_error = ?, last_hello_at = ? WHERE id = ?')
    .run(hello.ok ? 1 : 0, hello.error, Date.now(), c.id)
  res.json({ ok: hello.ok, ...statusDict(activeConnector()) })
})

// DELETE /api/amiba/connect
router.delete('/connect', (_req: Request, res: Response) => {
  ensureSchema()
  const info = getDb().prepare('UPDATE amiba_connectors SET active = 0 WHERE active = 1').run()
  res.json({ ok: true, disconnected: info.changes })
})

// ---- Phase 3c · 反向下发：接收阿米巴下发的改进任务 ----

// 校验来访 Bearer 令牌：必须等于本系统已接入的连接器令牌（阿米巴与本工具的共享密钥）。
function authAmiba(req: Request): ConnectorRow | null {
  const m = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)
  if (!m) return null
  const c = activeConnector()
  return c && c.amiba_token === m[1].trim() ? c : null
}

const ACTION_LABEL: Record<string, string> = {
  run_8d: '8D 根因分析',
  dmaic: 'DMAIC 改进',
  vsm: 'VSM 价值流分析',
  review: '流程三性复核',
}

// POST /api/amiba/tasks — 受理一条改进任务：建 8D 工单（diagnosis_session）→ 回执 → 异步回调完成
router.post('/tasks', async (req: Request, res: Response) => {
  const conn = authAmiba(req)
  if (!conn) { res.status(401).json({ accepted: false, error: '无效或缺失的连接器令牌' }); return }

  const { taskId, nodeKey, nodeName, action, title, detail, callbackUrl } = req.body as Record<string, string>
  if (!taskId || !title) { res.status(400).json({ accepted: false, error: '缺少 taskId / title' }); return }

  const actionLabel = ACTION_LABEL[action] || '流程改进'
  const db = getDb()
  const now = Date.now()
  const sessionId = `amiba_${taskId}`
  db.prepare(
    `INSERT OR REPLACE INTO diagnosis_sessions (id, conversation_id, stage, problem_type, data, created_at, updated_at)
     VALUES (?, ?, 'INTAKE', ?, ?, ?, ?)`,
  ).run(
    sessionId,
    `amiba_${taskId}`,
    nodeKey || 'process',
    JSON.stringify({ amibaTaskId: taskId, type: action || 'run_8d', actionLabel, title, detail, nodeName, factor: 'method' }),
    now,
    now,
  )

  const resultUrl = `${LEAN_PUBLIC_URL.replace(/\/+$/, '')}/?diagnosis=${sessionId}`
  const summary = `已受理「${nodeName || nodeKey}」的${actionLabel}，创建 8D 工单 ${sessionId}（D0-D2 初稿）`
  res.json({ accepted: true, ref: sessionId, summary, status: 'accepted', resultUrl })

  // 异步回调：模拟 8D 初稿完成后向阿米巴回报「已完成」。延迟以避免与受理回执的写入竞争。
  if (callbackUrl) {
    setTimeout(() => {
      fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${conn.amiba_token}` },
        body: JSON.stringify({
          taskId,
          status: 'done',
          ref: sessionId,
          summary: `${actionLabel}已完成 D0-D4：根因已定位，临时措施+永久对策已拟定。`,
          resultUrl,
        }),
        signal: AbortSignal.timeout(10000),
      }).catch(() => {})
    }, 800)
  }
})

export default router
