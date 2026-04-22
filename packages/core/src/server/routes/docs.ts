/**
 * /api/docs/* — serve user-facing documentation markdown files so the UI
 * can render them inside a help modal (no need for users to leave the app).
 *
 * Lookup order for each doc file:
 *   1. process.env.LEANAI_DOCS_DIR       (admin override)
 *   2. <cwd>/docs                        (dev: running from repo root)
 *   3. <app-root>/docs                   (prod: /opt/lean-ai/docs on bare-metal)
 *   4. <app-root>/../docs                (bundled alongside dist/)
 *
 * We only serve an explicit whitelist of filenames — never arbitrary paths.
 */
import { Router, type Request, type Response } from 'express'
import fs from 'fs'
import path from 'path'

const router = Router()

/** Whitelist of docs exposed to the UI. Order = display order in the help modal. */
const DOCS: Array<{ id: string; title: string; file: string; description?: string }> = [
  {
    id: 'user-guide',
    title: '使用说明',
    file: 'USER_GUIDE.md',
    description: '从第一次启动到完整走完诊断/图表/报告流程',
  },
  {
    id: 'deployment',
    title: '部署指南',
    file: 'DEPLOYMENT.md',
    description: '云端 / 企业私有化部署（Docker + systemd）',
  },
]

function candidateDirs(): string[] {
  const dirs: string[] = []
  if (process.env.LEANAI_DOCS_DIR) dirs.push(path.resolve(process.env.LEANAI_DOCS_DIR))
  dirs.push(path.resolve(process.cwd(), 'docs'))
  // __dirname at runtime: .../packages/core/dist/server/routes → repo layout
  dirs.push(path.resolve(__dirname, '..', '..', '..', 'docs'))
  dirs.push(path.resolve(__dirname, '..', '..', '..', '..', 'docs'))
  return Array.from(new Set(dirs))
}

function findDoc(filename: string): string | null {
  for (const dir of candidateDirs()) {
    const p = path.join(dir, filename)
    if (fs.existsSync(p)) return p
  }
  return null
}

/** GET /api/docs — list available docs with availability flag */
router.get('/', (_req: Request, res: Response) => {
  const list = DOCS.map(d => ({
    id: d.id,
    title: d.title,
    description: d.description,
    available: !!findDoc(d.file),
  }))
  res.json({ docs: list })
})

/** GET /api/docs/:id — return raw markdown content */
router.get('/:id', (req: Request, res: Response) => {
  const doc = DOCS.find(d => d.id === req.params.id)
  if (!doc) {
    return res.status(404).json({ error: '文档不存在' })
  }
  const filePath = findDoc(doc.file)
  if (!filePath) {
    return res.status(404).json({
      error: `找不到文档文件 ${doc.file}。请确认 docs/ 目录已随程序一起部署；或设置环境变量 LEANAI_DOCS_DIR 指向文档目录。`,
    })
  }
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    res.json({ id: doc.id, title: doc.title, content })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: msg })
  }
})

export default router
