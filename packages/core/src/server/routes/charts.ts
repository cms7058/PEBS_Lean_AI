/**
 * /api/charts/* — Chart-related helpers.
 *
 * Currently exposes only `POST /parse-data`, which accepts a multipart upload
 * of .xls / .xlsx / .csv and returns parsed rows so the UI can inject the data
 * into the chat as a text snippet. Any existing chart tool (pareto, boxplot,
 * fishbone, vsm) can then act on the data without the skill needing file I/O.
 */
import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import path from 'path'

const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB — way more than enough for chart data
})

let _xlsx: typeof import('xlsx') | null = null
async function getXlsx() {
  if (!_xlsx) _xlsx = await import('xlsx')
  return _xlsx
}

// ---- parse-data ------------------------------------------------------------

interface ParsedSheet {
  name: string
  headers: string[]
  rows: (string | number | boolean | null)[][]
  rowCount: number
  preview: string // CSV text of first ~20 rows, for the LLM to read
}

router.post('/parse-data', upload.single('file'), async (req: Request, res: Response) => {
  const file = req.file
  if (!file) { res.status(400).json({ error: '缺少文件（字段名应为 file）' }); return }

  // Decode filename — multer returns latin1-encoded UTF-8 for multipart.
  let filename = file.originalname
  try { filename = Buffer.from(file.originalname, 'latin1').toString('utf-8') } catch {}

  const ext = path.extname(filename).toLowerCase().replace('.', '')
  if (!['xls', 'xlsx', 'csv', 'tsv'].includes(ext)) {
    res.status(400).json({ error: `不支持的文件类型：${filename}（支持 .xls/.xlsx/.csv/.tsv）` })
    return
  }

  try {
    const xlsx = await getXlsx()
    const wb = ext === 'csv' || ext === 'tsv'
      ? xlsx.read(file.buffer.toString('utf-8'), { type: 'string' })
      : xlsx.read(file.buffer, { type: 'buffer' })

    const sheets: ParsedSheet[] = []
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name]
      if (!ws) continue
      // aoa (array-of-arrays) keeps column structure intact
      const aoa = xlsx.utils.sheet_to_json(ws, { header: 1, blankrows: false, raw: true }) as unknown[][]
      if (aoa.length === 0) continue
      const headers = (aoa[0] || []).map((h, i) =>
        h == null || h === '' ? `col${i + 1}` : String(h).trim(),
      )
      const rawRows = aoa.slice(1).filter(r => r.some(c => c !== null && c !== undefined && c !== ''))
      const rows: ParsedSheet['rows'] = rawRows.map(r => {
        const out: (string | number | boolean | null)[] = []
        for (let i = 0; i < headers.length; i++) {
          const v = r[i]
          if (v == null || v === '') out.push(null)
          else if (typeof v === 'number' || typeof v === 'boolean') out.push(v)
          else out.push(String(v))
        }
        return out
      })
      // Build CSV preview — keep it small so the LLM can consume it fully.
      const previewCap = 20
      const previewRows = rows.slice(0, previewCap)
      const preview = [
        headers.map(csvEscape).join(','),
        ...previewRows.map(r => r.map(v => csvEscape(v == null ? '' : String(v))).join(',')),
      ].join('\n')
      sheets.push({ name, headers, rows, rowCount: rows.length, preview })
    }

    if (sheets.length === 0) {
      res.status(400).json({ error: '文件为空或不包含可解析的数据表。' })
      return
    }

    res.json({
      filename,
      bytes: file.size,
      sheets: sheets.map(s => ({
        name: s.name,
        headers: s.headers,
        rowCount: s.rowCount,
        preview: s.preview,
        // Return full rows only if small (<= 500 rows) — otherwise client asks for chart sampling.
        rows: s.rowCount <= 500 ? s.rows : undefined,
      })),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(400).json({ error: `解析失败：${msg}` })
  }
})

function csvEscape(s: string): string {
  if (s == null) return ''
  const str = String(s)
  if (/[,"\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

export default router
