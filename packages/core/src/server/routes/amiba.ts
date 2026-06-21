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

const router = Router()

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
  `)
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
