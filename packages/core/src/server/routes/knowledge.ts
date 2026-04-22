/**
 * /api/knowledge/* — Knowledge base management API (tenant-scoped).
 *
 * Every document and entry is stamped with the caller's tenant_id on write and
 * filtered by the caller's tenant on read. Seed / user / file / customer
 * source categories still work within a tenant's view.
 */
import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import crypto from 'crypto'
import { getDb } from '../../storage/db'
import {
  ingestFile,
  listDocuments,
  deleteDocument,
  detectExt,
} from '../knowledge-ingest'
import { checkKbUpload, checkKbEntryAdd, recordUsage, getSubscription } from '../../billing/manager'
import { getPlanCapabilities } from '../../billing/capabilities'
import { requireAuth } from '../../auth/middleware'

/**
 * Write-side guard — refuses if the tenant's plan has knowledgeImport=false.
 * Admin overrides take effect via the plan capabilities matrix.
 */
function requireKnowledgeImport(req: Request, res: Response): boolean {
  const caps = getPlanCapabilities(getSubscription(req.auth!.tenant.id).plan)
  if (!caps.knowledgeImport) {
    res.status(403).json({
      error: '当前订阅方案未开通「数据导入」功能，请联系管理员或升级方案。',
      code: 'CAPABILITY_DISABLED',
      capability: 'knowledgeImport',
    })
    return false
  }
  return true
}

const router = Router()

router.use(requireAuth)

// In-memory upload (max 25 MB) — we immediately write to disk inside ingestFile.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
})

// ---- Files -----------------------------------------------------------------

// POST /api/knowledge/upload — multipart; field name "file"
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  if (!requireKnowledgeImport(req, res)) return
  const file = req.file
  if (!file) { res.status(400).json({ error: '缺少文件（字段名应为 file）' }); return }
  if (!detectExt(file.originalname)) {
    res.status(400).json({ error: `不支持的文件类型：${file.originalname}（仅支持 .pdf/.docx/.xlsx/.md/.txt）` })
    return
  }
  const tid = req.auth!.tenant.id
  const uid = req.auth!.user.id

  const q = checkKbUpload(file.size, tid)
  if (!q.allowed) {
    res.status(402).json({ error: q.reason, quota: q, upgradeRequired: true })
    return
  }
  try {
    let filename = file.originalname
    try { filename = Buffer.from(file.originalname, 'latin1').toString('utf-8') } catch {}

    const result = await ingestFile(getDb(), filename, file.buffer, { userId: uid, tenantId: tid })
    if (result.status === 'error') {
      res.status(400).json(result)
      return
    }
    try { recordUsage(tid, 'kb_upload', result.docId, { bytes: file.size }) } catch {}
    res.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: `ingest 失败：${msg}` })
  }
})

// GET /api/knowledge/documents — list uploaded files (for this tenant)
router.get('/documents', (req: Request, res: Response) => {
  try {
    res.json(listDocuments(getDb(), { tenantId: req.auth!.tenant.id }))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: msg })
  }
})

// DELETE /api/knowledge/documents/:id
router.delete('/documents/:id', (req: Request, res: Response) => {
  try {
    const ok = deleteDocument(getDb(), String(req.params.id), { tenantId: req.auth!.tenant.id })
    if (!ok) { res.status(404).json({ error: '文档不存在' }); return }
    res.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: msg })
  }
})

// ---- KB entries ------------------------------------------------------------

interface KbEntryRow {
  id: string
  title: string
  source: string
  tags: string
  content: string
  created_at: number
  tenant_id: number | null
}

function ensureKbSchema() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS kb_entries (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      source      TEXT NOT NULL DEFAULT 'user',
      tags        TEXT NOT NULL DEFAULT '[]',
      content     TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      tenant_id   INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_kb_entries_source ON kb_entries(source);
    CREATE INDEX IF NOT EXISTS idx_kb_entries_created ON kb_entries(created_at DESC);
  `)
  try { getDb().exec(`ALTER TABLE kb_entries ADD COLUMN tenant_id INTEGER`) } catch {}
}

/**
 * Tenant entry filter helper: a tenant sees rows where tenant_id matches OR
 * tenant_id IS NULL (legacy/shared seed content). Seed content is shared
 * across all tenants so every workspace benefits from the curated library.
 */
function tenantFilterSql(alias = ''): string {
  const col = alias ? `${alias}.tenant_id` : 'tenant_id'
  return `(${col} = ? OR ${col} IS NULL)`
}

// GET /api/knowledge/entries?source=seed|user|file|customer|all
router.get('/entries', (req: Request, res: Response) => {
  ensureKbSchema()
  const source = String(req.query.source || 'all')
  const tid = req.auth!.tenant.id
  const db = getDb()
  let rows: KbEntryRow[]
  if (source === 'all') {
    rows = db.prepare(`
      SELECT id, title, source, tags, content, created_at, tenant_id
      FROM kb_entries WHERE ${tenantFilterSql()} ORDER BY created_at DESC
    `).all(tid) as KbEntryRow[]
  } else if (source === 'file') {
    rows = db.prepare(`
      SELECT id, title, source, tags, content, created_at, tenant_id
      FROM kb_entries WHERE source LIKE 'file:%' AND ${tenantFilterSql()} ORDER BY created_at DESC
    `).all(tid) as KbEntryRow[]
  } else if (source === 'customer') {
    rows = db.prepare(`
      SELECT id, title, source, tags, content, created_at, tenant_id
      FROM kb_entries WHERE source LIKE 'customer:%' AND ${tenantFilterSql()} ORDER BY created_at DESC
    `).all(tid) as KbEntryRow[]
  } else {
    rows = db.prepare(`
      SELECT id, title, source, tags, content, created_at, tenant_id
      FROM kb_entries WHERE source = ? AND ${tenantFilterSql()} ORDER BY created_at DESC
    `).all(source, tid) as KbEntryRow[]
  }
  res.json(rows.map(r => ({
    id: r.id,
    title: r.title,
    source: r.source,
    tags: safeTags(r.tags),
    length: r.content.length,
    created_at: r.created_at,
  })))
})

router.get('/entries/:id', (req: Request, res: Response) => {
  ensureKbSchema()
  const row = getDb().prepare(
    `SELECT id, title, source, tags, content, created_at, tenant_id FROM kb_entries
      WHERE id = ? AND ${tenantFilterSql()}`
  ).get(req.params.id, req.auth!.tenant.id) as KbEntryRow | undefined
  if (!row) { res.status(404).json({ error: '条目不存在' }); return }
  res.json({ ...row, tags: safeTags(row.tags) })
})

router.post('/entries', (req: Request, res: Response) => {
  if (!requireKnowledgeImport(req, res)) return
  ensureKbSchema()
  const { title, content, tags, source } = req.body || {}
  if (!title || typeof title !== 'string' || !content || typeof content !== 'string') {
    res.status(400).json({ error: 'title 与 content 必填' })
    return
  }
  const tid = req.auth!.tenant.id
  const q = checkKbEntryAdd(tid)
  if (!q.allowed) {
    res.status(402).json({ error: q.reason, quota: q, upgradeRequired: true })
    return
  }
  const db = getDb()
  const srcRaw = typeof source === 'string' && source.trim() ? source.trim() : 'user'
  const h = crypto.createHash('sha1').update(title + '|' + Date.now()).digest('hex').slice(0, 8)
  const id = `${srcRaw.includes(':') ? srcRaw.split(':')[0] : srcRaw}:${h}`
  const tagsJson = JSON.stringify(Array.isArray(tags) ? tags.map(String) : [])
  db.prepare(
    `INSERT INTO kb_entries (id, title, source, tags, content, created_at, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, title, srcRaw, tagsJson, content, Date.now(), tid)
  try { recordUsage(tid, 'kb_entry_add', id, { bytes: content.length }) } catch {}
  res.json({ id, title, source: srcRaw, tags: safeTags(tagsJson) })
})

router.delete('/entries/:id', (req: Request, res: Response) => {
  ensureKbSchema()
  const row = getDb().prepare(
    `SELECT source, tenant_id FROM kb_entries WHERE id = ? AND ${tenantFilterSql()}`
  ).get(req.params.id, req.auth!.tenant.id) as { source: string; tenant_id: number | null } | undefined
  if (!row) { res.status(404).json({ error: '条目不存在' }); return }
  // Seed entries are shared across tenants. Non-admins can't delete them.
  if (row.source === 'seed') {
    if (req.auth!.user.role !== 'admin') {
      res.status(403).json({ error: '内置种子条目受保护，仅管理员可删除' })
      return
    }
    if (req.query.force !== '1') {
      res.status(403).json({ error: '删除种子条目需附带 ?force=1' })
      return
    }
  }
  getDb().prepare(`DELETE FROM kb_entries WHERE id = ?`).run(req.params.id)
  res.json({ ok: true })
})

// GET /api/knowledge/stats — per-tenant stats (includes shared seed content)
router.get('/stats', (req: Request, res: Response) => {
  ensureKbSchema()
  const tid = req.auth!.tenant.id
  const db = getDb()
  const total = (db.prepare(
    `SELECT COUNT(*) AS n FROM kb_entries WHERE ${tenantFilterSql()}`
  ).get(tid) as { n: number }).n
  const bySource = db.prepare(`
    SELECT
      CASE
        WHEN source LIKE 'file:%' THEN 'file'
        WHEN source LIKE 'customer:%' THEN 'customer'
        ELSE source
      END AS bucket,
      COUNT(*) AS n
    FROM kb_entries WHERE ${tenantFilterSql()} GROUP BY bucket
  `).all(tid) as Array<{ bucket: string; n: number }>
  let docs = 0
  try {
    docs = (db.prepare(
      `SELECT COUNT(*) AS n FROM knowledge_documents WHERE tenant_id = ?`
    ).get(tid) as { n: number }).n
  } catch { /* */ }
  res.json({ entries: total, bySource, documents: docs })
})

function safeTags(raw: string): string[] {
  try {
    const arr = JSON.parse(raw || '[]')
    return Array.isArray(arr) ? arr.map(String) : []
  } catch { return [] }
}

export default router
