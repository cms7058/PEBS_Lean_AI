/**
 * Knowledge ingestion — parses uploaded files (PDF/DOCX/XLSX/MD/TXT)
 * and stores them as searchable rows in the `kb_entries` table.
 *
 * Design:
 *   - Every uploaded file creates ONE row in `knowledge_documents` (metadata).
 *   - The file is chunked (~1200 chars, paragraph-aware) and each chunk becomes
 *     one row in `kb_entries` with source = "file:<docId>" and a back-ref in tags.
 *   - This way the existing `kb_search` tool transparently finds file content
 *     without needing any schema change on the skill side.
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type Database from 'better-sqlite3'

// Lazy-load heavy parsers so startup stays fast.
let _pdfParse: any
let _mammoth: any
let _xlsx: any

async function parsePdf(buf: Buffer): Promise<string> {
  if (!_pdfParse) _pdfParse = (await import('pdf-parse')).default
  const res = await _pdfParse(buf)
  return String(res.text || '')
}

async function parseDocx(buf: Buffer): Promise<string> {
  if (!_mammoth) _mammoth = await import('mammoth')
  const res = await _mammoth.extractRawText({ buffer: buf })
  return String(res.value || '')
}

async function parseXlsx(buf: Buffer): Promise<string> {
  if (!_xlsx) _xlsx = await import('xlsx')
  const wb = _xlsx.read(buf, { type: 'buffer' })
  const sheets: string[] = []
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    const csv = _xlsx.utils.sheet_to_csv(ws)
    if (csv.trim()) sheets.push(`## ${name}\n${csv}`)
  }
  return sheets.join('\n\n')
}

function parseText(buf: Buffer): string {
  return buf.toString('utf-8')
}

export type SupportedExt = 'pdf' | 'docx' | 'xlsx' | 'md' | 'txt'

export function detectExt(filename: string): SupportedExt | null {
  const ext = path.extname(filename).toLowerCase().replace('.', '')
  if (['pdf', 'docx', 'xlsx', 'md', 'txt'].includes(ext)) return ext as SupportedExt
  // .doc / .xls legacy formats not supported — ask user to resave as .docx/.xlsx
  return null
}

export async function extractText(filename: string, buf: Buffer): Promise<string> {
  const ext = detectExt(filename)
  if (!ext) throw new Error(`不支持的文件类型: ${path.extname(filename)}（支持 .pdf/.docx/.xlsx/.md/.txt）`)
  try {
    if (ext === 'pdf') return await parsePdf(buf)
    if (ext === 'docx') return await parseDocx(buf)
    if (ext === 'xlsx') return await parseXlsx(buf)
    return parseText(buf)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`解析 ${ext.toUpperCase()} 失败：${msg}`)
  }
}

/**
 * Paragraph-aware chunking. Targets ~1200 chars per chunk to balance
 * retrieval granularity vs semantic coherence. Never splits mid-paragraph
 * unless a single paragraph exceeds 2× target (then hard-wrap).
 */
export function chunkText(text: string, targetChars = 1200): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!normalized) return []

  const paragraphs = normalized.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
  const chunks: string[] = []
  let buf = ''
  for (const p of paragraphs) {
    if (p.length > targetChars * 2) {
      // Hard-wrap oversized paragraph
      if (buf) { chunks.push(buf); buf = '' }
      for (let i = 0; i < p.length; i += targetChars) {
        chunks.push(p.slice(i, i + targetChars))
      }
      continue
    }
    if (buf && buf.length + p.length + 2 > targetChars) {
      chunks.push(buf); buf = ''
    }
    buf = buf ? buf + '\n\n' + p : p
  }
  if (buf) chunks.push(buf)
  return chunks
}

export interface IngestResult {
  docId: string
  chunkCount: number
  totalChars: number
  status: 'ready' | 'error'
  error?: string
}

const UPLOADS_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.lean-ai', 'uploads')

function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true })
}

export async function ingestFile(
  db: Database.Database,
  filename: string,
  buf: Buffer,
  owner: { userId?: number; tenantId?: number } = {},
): Promise<IngestResult> {
  ensureUploadsDir()
  const ext = detectExt(filename)
  if (!ext) {
    return { docId: '', chunkCount: 0, totalChars: 0, status: 'error', error: '不支持的文件类型' }
  }

  // Persist original file so we can re-parse later if needed
  const ts = Date.now()
  const safeName = filename.replace(/[/\\?%*:|"<>]/g, '_')
  const savedName = `${ts}-${safeName}`
  const savedPath = path.join(UPLOADS_DIR, savedName)
  fs.writeFileSync(savedPath, buf)

  const docId = 'doc-' + ts.toString(36) + '-' + crypto.randomBytes(3).toString('hex')

  // Insert metadata row (status=pending → ready after chunks saved)
  db.prepare(
    `INSERT INTO knowledge_documents (id, filename, file_path, file_type, chunk_count, status, uploaded_at, user_id, tenant_id)
     VALUES (?, ?, ?, ?, 0, 'pending', ?, ?, ?)`,
  ).run(docId, filename, savedPath, ext, ts, owner.userId ?? null, owner.tenantId ?? null)

  try {
    const text = await extractText(filename, buf)
    const chunks = chunkText(text)
    if (chunks.length === 0) {
      db.prepare(`UPDATE knowledge_documents SET status='error' WHERE id=?`).run(docId)
      return { docId, chunkCount: 0, totalChars: 0, status: 'error', error: '文件内容为空或无法提取文字' }
    }

    // Ensure kb_entries exists (skill-knowledge owns the schema, but we need to
    // write before first search — so create the same shape if missing).
    db.exec(`
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
    // Idempotent add-column for pre-existing DBs without tenant_id.
    try { db.exec(`ALTER TABLE kb_entries ADD COLUMN tenant_id INTEGER`) } catch {}

    const insertEntry = db.prepare(
      `INSERT OR REPLACE INTO kb_entries (id, title, source, tags, content, created_at, tenant_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    const tx = db.transaction((items: Array<[string, string, string, string, string, number, number | null]>) => {
      for (const row of items) insertEntry.run(...row)
    })

    const baseTitle = path.basename(filename, path.extname(filename))
    const tags = JSON.stringify(['file', ext, baseTitle])
    const rows: Array<[string, string, string, string, string, number, number | null]> = chunks.map((c, i) => [
      `${docId}-c${i}`,
      chunks.length > 1 ? `${baseTitle} — 第 ${i + 1} 段` : baseTitle,
      `file:${docId}`,
      tags,
      c,
      ts + i,
      owner.tenantId ?? null,
    ])
    tx(rows)

    const totalChars = chunks.reduce((s, c) => s + c.length, 0)
    db.prepare(
      `UPDATE knowledge_documents SET chunk_count=?, status='ready' WHERE id=?`,
    ).run(chunks.length, docId)

    return { docId, chunkCount: chunks.length, totalChars, status: 'ready' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    db.prepare(`UPDATE knowledge_documents SET status='error' WHERE id=?`).run(docId)
    return { docId, chunkCount: 0, totalChars: 0, status: 'error', error: msg }
  }
}

export function listDocuments(db: Database.Database, owner: { tenantId?: number } = {}) {
  if (owner.tenantId !== undefined) {
    return db.prepare(
      `SELECT id, filename, file_type, chunk_count, status, uploaded_at
       FROM knowledge_documents WHERE tenant_id = ? ORDER BY uploaded_at DESC`,
    ).all(owner.tenantId) as Array<{
      id: string; filename: string; file_type: string;
      chunk_count: number; status: string; uploaded_at: number;
    }>
  }
  return db.prepare(
    `SELECT id, filename, file_type, chunk_count, status, uploaded_at
     FROM knowledge_documents ORDER BY uploaded_at DESC`,
  ).all() as Array<{
    id: string; filename: string; file_type: string;
    chunk_count: number; status: string; uploaded_at: number;
  }>
}

export function deleteDocument(
  db: Database.Database, docId: string, owner: { tenantId?: number } = {},
): boolean {
  const doc = db.prepare(
    `SELECT file_path, tenant_id FROM knowledge_documents WHERE id=?`
  ).get(docId) as { file_path: string; tenant_id: number | null } | undefined
  if (!doc) return false
  if (owner.tenantId !== undefined && doc.tenant_id !== owner.tenantId) return false
  // Delete chunks from kb_entries
  db.prepare(`DELETE FROM kb_entries WHERE source=?`).run(`file:${docId}`)
  // Delete the metadata row
  db.prepare(`DELETE FROM knowledge_documents WHERE id=?`).run(docId)
  // Best-effort delete of the saved file
  try { if (doc.file_path && fs.existsSync(doc.file_path)) fs.unlinkSync(doc.file_path) } catch {}
  return true
}
