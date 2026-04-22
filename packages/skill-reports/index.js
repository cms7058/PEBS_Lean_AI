/**
 * @lean-ai/skill-reports
 *
 * 4 类精益报告的 Word 生成器（Markdown 预览同步输出）：
 *   - report_8d            — 8D 问题解决报告（客户投诉、急性质量问题）
 *   - report_dmaic         — 六西格玛 DMAIC 报告（慢性变异、系统改善）
 *   - report_generic       — 自由结构综合报告（自定义章节）
 *   - report_lean_analysis — 精益问题分析综合报告（问题→分析→解决全过程，含图表/数据/文字）
 *
 * 设计原则：
 *   - 由 LLM 提供结构化数据，本地拼装 .docx + Markdown
 *   - 每次生成都会：
 *       1. 写入 ~/.lean-ai/exports/<slug>-<ts>.docx
 *       2. 在 SQLite `reports` 表登记元数据
 *       3. 返回 artifact { type: 'file', data: 'data:...;base64,...', filename }
 *          + content 里附 Markdown 预览供 LLM/UI 展示
 *   - 图表嵌入：v1 不做（docx 不支持 SVG 直渲；用户可在对话里单独导出 chart SVG）
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle,
  Header, Footer, PageNumber, LevelFormat, ImageRun,
} = require('docx')

// 图表渲染依赖（@napi-rs/canvas），如果加载失败就降级为"只有数据表"。
let __canvasModule = null
let __canvasLoadFailed = false
function loadCanvas() {
  if (__canvasModule) return __canvasModule
  if (__canvasLoadFailed) return null
  try {
    __canvasModule = require('@napi-rs/canvas')
  } catch (e) {
    __canvasLoadFailed = true
    return null
  }
  return __canvasModule
}

// ---------------------------------------------------------------------------
// 存储目录 / SQLite 表
// ---------------------------------------------------------------------------

function getExportsDir() {
  const dir = path.join(os.homedir(), '.lean-ai', 'exports')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function ensureSchema(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS reports (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      type       TEXT NOT NULL,             -- '8d' | 'dmaic' | 'generic' | 'lean-analysis'
      file_path  TEXT NOT NULL,
      file_size  INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `).run()
}

function slugify(s, max = 40) {
  const x = String(s || 'report')
    .replace(/[\s/\\:*?"<>|]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return x.slice(0, max) || 'report'
}

function persistReport(ctx, { type, title, buffer }) {
  ensureSchema(ctx.db)
  const dir = getExportsDir()
  const ts = Date.now()
  const id = `${type}-${ts}-${Math.random().toString(36).slice(2, 8)}`
  const filename = `${slugify(title)}-${ts}.docx`
  const fullPath = path.join(dir, filename)
  fs.writeFileSync(fullPath, buffer)
  ctx.db.prepare(
    'INSERT INTO reports (id, title, type, file_path, file_size, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, title, type, fullPath, buffer.length, ts)
  return { id, filename, fullPath, size: buffer.length }
}

// ---------------------------------------------------------------------------
// docx 辅助构件
// ---------------------------------------------------------------------------

const FONT = { default: '思源黑体', fallback: 'PingFang SC' }

function tr(text, opts = {}) {
  return new TextRun({ text: String(text == null ? '' : text), ...opts })
}

function para(text, opts = {}) {
  const { bold, italics, align, spacing, ...rest } = opts
  return new Paragraph({
    alignment: align,
    spacing: spacing ?? { after: 120 },
    children: [tr(text, { bold, italics, ...rest })],
  })
}

function heading(level, text) {
  const lvl = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
    4: HeadingLevel.HEADING_4,
  }[level] || HeadingLevel.HEADING_2
  return new Paragraph({
    heading: lvl,
    spacing: { before: 240, after: 120 },
    children: [tr(text, { bold: true })],
  })
}

function bulletPara(text) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 80 },
    children: [tr(text)],
  })
}

function cell(text, opts = {}) {
  const { bold, align, shading, width } = opts
  return new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: shading ? { fill: shading } : undefined,
    children: [
      new Paragraph({
        alignment: align,
        children: [tr(text, { bold })],
      }),
    ],
  })
}

/** 2-列 键值表（表头灰底 + 粗体）。 */
function kvTable(pairs) {
  const rows = pairs.filter(([, v]) => v != null && v !== '').map(([k, v]) =>
    new TableRow({
      children: [
        cell(k, { bold: true, shading: 'F3F4F6', width: 25 }),
        cell(fmtValue(v), { width: 75 }),
      ],
    })
  )
  if (rows.length === 0) return null
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
  })
}

/** 通用数据表（首行为粗体表头，灰底）。 */
function dataTable(columns, rows) {
  if (!columns || columns.length === 0 || !rows || rows.length === 0) return null
  const headerRow = new TableRow({
    tableHeader: true,
    children: columns.map(c => cell(c, { bold: true, shading: 'F3F4F6' })),
  })
  const bodyRows = rows.map(r =>
    new TableRow({
      children: columns.map((_, i) => cell(fmtValue(r[i]))),
    })
  )
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...bodyRows],
  })
}

function fmtValue(v) {
  if (v == null) return ''
  if (Array.isArray(v)) {
    return v.filter(x => x != null && x !== '').map(fmtValueItem).join('、')
  }
  if (typeof v === 'object') return fmtValueItem(v)
  return String(v)
}

/** 数组中单个元素的格式化：字符串/数字原样，对象取常见字段（name/role/title/desc/...）拼接。 */
function fmtValueItem(x) {
  if (x == null) return ''
  if (typeof x !== 'object') return String(x)
  // 对象优先抽取常见字段，避免 [object Object]
  const keys = ['name', 'title', 'role', 'label', 'action', 'cause', 'member', 'desc', 'description', 'text']
  const parts = []
  const name = x.name || x.title || x.label || x.member
  if (name) parts.push(String(name))
  const role = x.role
  if (role) parts.push(`（${role}）`)
  if (parts.length > 0) return parts.join('')
  // Fallback: 取前两个非对象字段
  const entries = Object.entries(x)
    .filter(([, v]) => v != null && v !== '' && typeof v !== 'object')
    .slice(0, 2)
  if (entries.length > 0) return entries.map(([k, v]) => `${k}=${v}`).join(', ')
  return JSON.stringify(x)
}

/** 把一段对象数组转成 dataTable：columns 由给定 keys 决定，空表返回 null。 */
function objectsToTable(list, spec) {
  if (!Array.isArray(list) || list.length === 0) return null
  const columns = spec.map(s => s.header)
  const rows = list.map(obj => spec.map(s => fmtValue(obj[s.key])))
  return dataTable(columns, rows)
}

// ---------------------------------------------------------------------------
// 图表渲染（PNG 图片，可直接嵌入 docx）
// ---------------------------------------------------------------------------

const CHART_FONT = '"PingFang SC","Songti SC","Noto Sans CJK SC","Microsoft YaHei",sans-serif'
const PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316']

function makeCanvas(width, height) {
  const C = loadCanvas()
  if (!C) return null
  const canvas = C.createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  return { canvas, ctx, width, height }
}

function chartTitle(ctx, text, x, y) {
  ctx.fillStyle = '#111827'
  ctx.font = 'bold 18px ' + CHART_FONT
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(text, x, y)
}

/** 帕累托图：柱 + 累计折线 + 80% 参考线 */
function renderParetoChart(items, titleText) {
  const cv = makeCanvas(880, 460)
  if (!cv) return null
  const { ctx, width, height } = cv
  const data = (items || []).slice().sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
  if (data.length === 0) return null
  const total = data.reduce((s, x) => s + Number(x.count || 0), 0) || 1

  chartTitle(ctx, titleText || '帕累托分析', width / 2, 14)

  const ml = 60, mr = 60, mt = 50, mb = 80
  const plotW = width - ml - mr
  const plotH = height - mt - mb
  const maxV = Math.max(...data.map(d => Number(d.count || 0)))

  // 坐标轴
  ctx.strokeStyle = '#9ca3af'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(ml, mt); ctx.lineTo(ml, mt + plotH); ctx.lineTo(ml + plotW, mt + plotH)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(ml + plotW, mt); ctx.lineTo(ml + plotW, mt + plotH)
  ctx.stroke()

  // 左轴刻度（数量）
  ctx.fillStyle = '#374151'
  ctx.font = '11px ' + CHART_FONT
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let i = 0; i <= 5; i++) {
    const v = Math.round(maxV * i / 5)
    const y = mt + plotH - (plotH * i / 5)
    ctx.fillText(String(v), ml - 6, y)
    ctx.strokeStyle = '#f3f4f6'
    ctx.beginPath(); ctx.moveTo(ml, y); ctx.lineTo(ml + plotW, y); ctx.stroke()
  }
  // 右轴刻度（百分比）
  ctx.textAlign = 'left'
  for (let i = 0; i <= 5; i++) {
    const pct = i * 20
    const y = mt + plotH - (plotH * i / 5)
    ctx.fillStyle = '#374151'
    ctx.fillText(pct + '%', ml + plotW + 6, y)
  }

  // 柱
  const barW = plotW / data.length * 0.7
  const gap = plotW / data.length * 0.3
  data.forEach((d, i) => {
    const v = Number(d.count || 0)
    const h = plotH * v / maxV
    const x = ml + i * (barW + gap) + gap / 2
    const y = mt + plotH - h
    ctx.fillStyle = PALETTE[0]
    ctx.fillRect(x, y, barW, h)
    // 数值
    ctx.fillStyle = '#111827'
    ctx.font = '11px ' + CHART_FONT
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillText(String(v), x + barW / 2, y - 4)
    // 类别标签（可能要旋转）
    ctx.save()
    ctx.translate(x + barW / 2, mt + plotH + 8)
    if (String(d.category || '').length > 4) ctx.rotate(Math.PI / 8)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.font = '12px ' + CHART_FONT
    ctx.fillText(String(d.category || ''), 0, 0)
    ctx.restore()
  })

  // 累计折线
  let cum = 0
  const pts = data.map(d => {
    cum += Number(d.count || 0)
    return cum / total
  })
  ctx.strokeStyle = PALETTE[3]
  ctx.lineWidth = 2
  ctx.beginPath()
  data.forEach((_, i) => {
    const x = ml + i * (barW + gap) + gap / 2 + barW / 2
    const y = mt + plotH - plotH * pts[i]
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
  })
  ctx.stroke()
  data.forEach((_, i) => {
    const x = ml + i * (barW + gap) + gap / 2 + barW / 2
    const y = mt + plotH - plotH * pts[i]
    ctx.fillStyle = PALETTE[3]
    ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#111827'
    ctx.font = '10px ' + CHART_FONT
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillText((pts[i] * 100).toFixed(0) + '%', x, y - 6)
  })

  // 80% 参考线
  const y80 = mt + plotH - plotH * 0.8
  ctx.strokeStyle = '#f59e0b'
  ctx.setLineDash([6, 4])
  ctx.beginPath(); ctx.moveTo(ml, y80); ctx.lineTo(ml + plotW, y80); ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = '#f59e0b'
  ctx.font = '11px ' + CHART_FONT
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillText('80% 线', ml + 4, y80 - 2)

  // 图例
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.font = '12px ' + CHART_FONT
  ctx.fillStyle = PALETTE[0]; ctx.fillRect(ml, height - 24, 14, 12)
  ctx.fillStyle = '#374151'; ctx.fillText('数量', ml + 18, height - 18)
  ctx.strokeStyle = PALETTE[3]; ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(ml + 80, height - 18); ctx.lineTo(ml + 104, height - 18); ctx.stroke()
  ctx.fillStyle = '#374151'; ctx.fillText('累计占比', ml + 110, height - 18)

  return cv.canvas.toBuffer('image/png')
}

/** 趋势折线图 */
function renderTrendChart(series, metric, unit) {
  const cv = makeCanvas(880, 400)
  if (!cv) return null
  const { ctx, width, height } = cv
  const data = series || []
  if (data.length === 0) return null

  chartTitle(ctx, `${metric || '趋势'} 走势${unit ? '（' + unit + '）' : ''}`, width / 2, 14)

  const ml = 60, mr = 30, mt = 50, mb = 70
  const plotW = width - ml - mr
  const plotH = height - mt - mb
  const values = data.map(p => Number(p.value || 0))
  const minV = Math.min(...values)
  const maxV = Math.max(...values)
  const range = Math.max(maxV - minV, 1e-9)
  const padV = range * 0.1
  const lo = minV - padV
  const hi = maxV + padV

  // 坐标轴
  ctx.strokeStyle = '#9ca3af'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(ml, mt); ctx.lineTo(ml, mt + plotH); ctx.lineTo(ml + plotW, mt + plotH)
  ctx.stroke()

  // 刻度
  ctx.fillStyle = '#374151'
  ctx.font = '11px ' + CHART_FONT
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let i = 0; i <= 5; i++) {
    const v = lo + (hi - lo) * i / 5
    const y = mt + plotH - (plotH * i / 5)
    ctx.fillText(v.toFixed(1), ml - 6, y)
    ctx.strokeStyle = '#f3f4f6'
    ctx.beginPath(); ctx.moveTo(ml, y); ctx.lineTo(ml + plotW, y); ctx.stroke()
  }

  const xOf = i => ml + plotW * (data.length === 1 ? 0.5 : i / (data.length - 1))
  const yOf = v => mt + plotH - plotH * ((v - lo) / (hi - lo))

  // 填充
  ctx.fillStyle = 'rgba(59,130,246,0.15)'
  ctx.beginPath()
  ctx.moveTo(xOf(0), mt + plotH)
  data.forEach((p, i) => ctx.lineTo(xOf(i), yOf(Number(p.value || 0))))
  ctx.lineTo(xOf(data.length - 1), mt + plotH)
  ctx.closePath()
  ctx.fill()

  // 折线
  ctx.strokeStyle = PALETTE[0]
  ctx.lineWidth = 2.5
  ctx.beginPath()
  data.forEach((p, i) => {
    const x = xOf(i); const y = yOf(Number(p.value || 0))
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
  })
  ctx.stroke()

  // 点 + 值标签 + X 轴标签
  data.forEach((p, i) => {
    const x = xOf(i); const y = yOf(Number(p.value || 0))
    ctx.fillStyle = PALETTE[0]
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#111827'
    ctx.font = '11px ' + CHART_FONT
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillText(String(p.value), x, y - 8)
    // X 标签
    ctx.textBaseline = 'top'
    ctx.font = '11px ' + CHART_FONT
    ctx.fillStyle = '#374151'
    ctx.fillText(String(p.time || ''), x, mt + plotH + 8)
    if (p.note) {
      ctx.fillStyle = PALETTE[3]
      ctx.font = '10px ' + CHART_FONT
      ctx.fillText(String(p.note), x, mt + plotH + 24)
    }
  })

  return cv.canvas.toBuffer('image/png')
}

/** 鱼骨图：中心主干 + 6 大分枝（5M1E） */
function renderFishboneChart(fb) {
  const cv = makeCanvas(960, 560)
  if (!cv) return null
  const { ctx, width, height } = cv

  const branches = [
    { label: '人 (Man)', causes: fb.man, side: 'top', angle: -Math.PI / 5 },
    { label: '机 (Machine)', causes: fb.machine, side: 'top', angle: -Math.PI / 5 },
    { label: '料 (Material)', causes: fb.material, side: 'top', angle: -Math.PI / 5 },
    { label: '法 (Method)', causes: fb.method, side: 'bottom', angle: Math.PI / 5 },
    { label: '环 (Environment)', causes: fb.environment, side: 'bottom', angle: Math.PI / 5 },
    { label: '测 (Measurement)', causes: fb.measurement, side: 'bottom', angle: Math.PI / 5 },
  ]

  const midY = height / 2
  const leftX = 60
  const rightX = width - 80

  // 标题
  chartTitle(ctx, '鱼骨图 · 5M1E 根因展开', width / 2, 10)

  // 主干（鱼身）
  ctx.strokeStyle = '#1f2937'
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.moveTo(leftX, midY); ctx.lineTo(rightX - 30, midY)
  ctx.stroke()

  // 鱼头（中心问题框）
  const headW = 220, headH = 60
  const headX = rightX - headW, headY = midY - headH / 2
  ctx.fillStyle = '#fef3c7'
  ctx.strokeStyle = '#d97706'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(headX - 30, midY)
  ctx.lineTo(headX, headY)
  ctx.lineTo(headX + headW, headY)
  ctx.lineTo(headX + headW, headY + headH)
  ctx.lineTo(headX, headY + headH)
  ctx.closePath()
  ctx.fill(); ctx.stroke()
  ctx.fillStyle = '#92400e'
  ctx.font = 'bold 14px ' + CHART_FONT
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  const problemText = truncate(fb.problem || '核心问题', 14)
  ctx.fillText(problemText, headX + headW / 2, midY)

  // 分支
  const topCount = 3, botCount = 3
  const usableW = rightX - leftX - 80
  const spacing = usableW / (topCount + 1)
  branches.forEach((br, idx) => {
    const isTop = br.side === 'top'
    const slot = isTop ? idx : (idx - 3)
    const anchorX = leftX + spacing * (slot + 1)
    const branchEndX = anchorX - (isTop ? 90 : -90)   // length 90px slanted
    const branchEndY = isTop ? midY - 150 : midY + 150

    ctx.strokeStyle = '#374151'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(anchorX, midY)
    ctx.lineTo(branchEndX, branchEndY)
    ctx.stroke()

    // 分枝标签
    ctx.fillStyle = PALETTE[idx % PALETTE.length]
    ctx.font = 'bold 13px ' + CHART_FONT
    ctx.textAlign = isTop ? 'right' : 'right'
    ctx.textBaseline = isTop ? 'bottom' : 'top'
    ctx.fillText(br.label, branchEndX - 4, branchEndY + (isTop ? -4 : 4))

    // 子枝（原因）
    const causes = normalizeCauses(br.causes)
    const limit = Math.min(causes.length, 4)
    for (let i = 0; i < limit; i++) {
      const t = (i + 1) / (limit + 1)
      const onBranchX = anchorX + (branchEndX - anchorX) * t
      const onBranchY = midY + (branchEndY - midY) * t
      const subLen = 55
      const subEndX = onBranchX + (isTop ? -subLen : -subLen)
      const subEndY = onBranchY + 0  // horizontal subs
      ctx.strokeStyle = '#9ca3af'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(onBranchX, onBranchY)
      ctx.lineTo(subEndX, subEndY)
      ctx.stroke()
      ctx.fillStyle = '#374151'
      ctx.font = '11px ' + CHART_FONT
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillText(truncate(causes[i], 10), subEndX - 2, subEndY)
    }
  })

  return cv.canvas.toBuffer('image/png')
}

function normalizeCauses(c) {
  if (c == null) return []
  const arr = Array.isArray(c) ? c : [c]
  return arr
    .map(x => typeof x === 'object' ? (x.cause || x.text || JSON.stringify(x)) : String(x))
    .filter(Boolean)
}

function truncate(s, n) {
  const str = String(s || '')
  return str.length > n ? str.slice(0, n - 1) + '…' : str
}

/** KPI 改善对比：每个 KPI 显示"改善前 / 改善后 / 目标"三根柱 */
function renderKpiCompareChart(kpis) {
  const cv = makeCanvas(880, 440)
  if (!cv) return null
  const { ctx, width, height } = cv
  const items = (kpis || []).filter(k => k && k.name)
  if (items.length === 0) return null

  chartTitle(ctx, 'KPI 改善对比（改善前 / 改善后 / 目标）', width / 2, 14)

  const ml = 60, mr = 30, mt = 50, mb = 80
  const plotW = width - ml - mr
  const plotH = height - mt - mb
  const groupW = plotW / items.length
  const barGap = 10
  const barW = (groupW - barGap * 4) / 3

  // 归一化：每组找到最大值作为该组柱高比例基准，并显示真实数字
  items.forEach((k, i) => {
    const values = [parseFloat(k.baseline), parseFloat(k.after), parseFloat(k.target)]
      .map(v => isFinite(v) ? v : 0)
    const maxV = Math.max(...values, 1e-9)
    const labels = ['改善前', '改善后', '目标']
    const colors = [PALETTE[3], PALETTE[1], PALETTE[0]]
    const rawStrings = [k.baseline, k.after, k.target]
    values.forEach((v, j) => {
      const h = plotH * (v / maxV) * 0.85
      const x = ml + i * groupW + barGap + j * (barW + barGap)
      const y = mt + plotH - h
      ctx.fillStyle = colors[j]
      ctx.fillRect(x, y, barW, h)
      // 值
      ctx.fillStyle = '#111827'
      ctx.font = '11px ' + CHART_FONT
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'
      ctx.fillText(String(rawStrings[j] != null ? rawStrings[j] : v), x + barW / 2, y - 4)
      // 类别
      if (i === 0) {
        // legend placed under chart
      }
      // 柱底标签（第一个组才显示）
      if (i === 0) {
        ctx.fillStyle = '#6b7280'
        ctx.font = '10px ' + CHART_FONT
        ctx.textAlign = 'center'; ctx.textBaseline = 'top'
        ctx.fillText(labels[j], x + barW / 2, mt + plotH + 24)
      }
    })
    // KPI 名
    ctx.fillStyle = '#111827'
    ctx.font = 'bold 12px ' + CHART_FONT
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'
    const unitLabel = k.unit ? `（${k.unit}）` : ''
    ctx.fillText(String(k.name) + unitLabel, ml + i * groupW + groupW / 2, mt + plotH + 6)
  })

  // 轴
  ctx.strokeStyle = '#9ca3af'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(ml, mt); ctx.lineTo(ml, mt + plotH); ctx.lineTo(ml + plotW, mt + plotH)
  ctx.stroke()

  // 图例（右上角）
  const legendY = mt - 26
  const legendItems = [['改善前', PALETTE[3]], ['改善后', PALETTE[1]], ['目标', PALETTE[0]]]
  let lx = ml + plotW - 260
  legendItems.forEach(([txt, color]) => {
    ctx.fillStyle = color
    ctx.fillRect(lx, legendY, 14, 12)
    ctx.fillStyle = '#374151'
    ctx.font = '12px ' + CHART_FONT
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
    ctx.fillText(txt, lx + 18, legendY + 6)
    lx += 80
  })

  return cv.canvas.toBuffer('image/png')
}

/** 把 PNG buffer 包装成居中段落（docx 图片）。宽度默认 600px。 */
function imageParagraph(buffer, opts = {}) {
  const width = opts.width || 600
  const height = opts.height || Math.round(width * (opts.ratio || 0.55))
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 120 },
    children: [
      new ImageRun({
        type: 'png',
        data: buffer,
        transformation: { width, height },
      }),
    ],
  })
}

function footerBlock() {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          tr('第 '),
          new TextRun({ children: [PageNumber.CURRENT] }),
          tr(' / '),
          new TextRun({ children: [PageNumber.TOTAL_PAGES] }),
          tr(' 页 · LeanAI 精益生产智能体生成'),
        ],
      }),
    ],
  })
}

/** 统一的 Document 构造：设置默认字体 + 段落间距 + 页脚。 */
function makeDocument(sections) {
  return new Document({
    creator: 'LeanAI',
    styles: {
      default: {
        document: {
          run: { font: FONT.default, size: 22 },
          paragraph: { spacing: { after: 120 } },
        },
        heading1: { run: { font: FONT.default, size: 32, bold: true }, paragraph: { spacing: { before: 240, after: 120 } } },
        heading2: { run: { font: FONT.default, size: 26, bold: true }, paragraph: { spacing: { before: 200, after: 100 } } },
        heading3: { run: { font: FONT.default, size: 24, bold: true }, paragraph: { spacing: { before: 160, after: 80 } } },
        heading4: { run: { font: FONT.default, size: 22, bold: true }, paragraph: { spacing: { before: 120, after: 60 } } },
      },
    },
    sections: [
      {
        properties: {},
        footers: { default: footerBlock() },
        children: sections,
      },
    ],
  })
}

// ---------------------------------------------------------------------------
// Markdown 预览
// ---------------------------------------------------------------------------

class MD {
  constructor() { this.lines = [] }
  push(s) { this.lines.push(s) }
  h(level, text) { this.lines.push('#'.repeat(level) + ' ' + text); this.lines.push('') }
  p(text) { this.lines.push(text); this.lines.push('') }
  kv(pairs) {
    const rows = pairs.filter(([, v]) => v != null && v !== '')
    if (rows.length === 0) return
    this.lines.push('| 项目 | 内容 |', '|---|---|')
    rows.forEach(([k, v]) => this.lines.push(`| **${k}** | ${mdInlineFmt(v)} |`))
    this.lines.push('')
  }
  table(columns, rows) {
    if (!columns || !rows || rows.length === 0) return
    this.lines.push('| ' + columns.join(' | ') + ' |')
    this.lines.push('|' + columns.map(() => '---').join('|') + '|')
    rows.forEach(r => this.lines.push('| ' + r.map(mdInlineFmt).join(' | ') + ' |'))
    this.lines.push('')
  }
  bullets(items) {
    if (!Array.isArray(items) || items.length === 0) return
    items.forEach(x => this.lines.push('- ' + mdInlineFmt(x)))
    this.lines.push('')
  }
  text() { return this.lines.join('\n').trim() + '\n' }
}

function mdInlineFmt(v) {
  if (v == null) return ''
  if (Array.isArray(v)) {
    return v.filter(x => x != null && x !== '').map(fmtValueItem).join('、')
  }
  if (typeof v === 'object') return fmtValueItem(v)
  return String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

// ---------------------------------------------------------------------------
// 1. 8D 报告
// ---------------------------------------------------------------------------

function build8DParts(input) {
  const title = String(input.title || '8D 问题解决报告').trim()
  const reportNo = input.reportNo
  const meta = [
    ['报告编号', reportNo],
    ['编制日期', input.date || new Date().toISOString().slice(0, 10)],
    ['问题分类', input.category],
    ['客户/内部', input.customerOrInternal],
  ]

  // docx 节点
  const docx = []
  docx.push(new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [tr(title, { bold: true, size: 36 })] }))
  const metaTable = kvTable(meta)
  if (metaTable) docx.push(metaTable, para(''))

  // MD 预览
  const md = new MD()
  md.h(1, title)
  md.kv(meta)

  // --- D1 团队组建 ---
  pushStep(docx, md, 'D1', '团队组建', () => {
    const t = input.d1Team || {}
    const pairs = [
      ['组长', t.leader],
      ['成员', t.members],
      ['发起人 / Sponsor', t.sponsor],
      ['说明', t.note],
    ]
    return { kv: pairs }
  })

  // --- D2 问题描述 ---
  pushStep(docx, md, 'D2', '问题描述（5W2H）', () => {
    const p = input.d2Problem || {}
    const pairs = [
      ['问题陈述（What）', p.description],
      ['影响客户（Who）', p.customer],
      ['发生时间（When）', p.occurredDate],
      ['发生地点（Where）', p.location],
      ['发生频次（How many）', p.frequency],
      ['影响程度（How big）', p.impact],
      ['为什么重要（Why）', p.why],
    ]
    return { kv: pairs }
  })

  // --- D3 临时遏制措施 ---
  pushStep(docx, md, 'D3', '临时遏制措施', () => {
    const list = input.d3Containment || []
    return {
      table: objectsSpec(list, [
        { key: 'action', header: '遏制行动' },
        { key: 'owner', header: '责任人' },
        { key: 'due', header: '截止' },
        { key: 'status', header: '状态' },
      ]),
    }
  })

  // --- D4 根本原因 ---
  pushStep(docx, md, 'D4', '根本原因分析', () => {
    const list = input.d4RootCause || []
    const method = input.d4Method
    const pre = method ? para(`分析方法：${method}`, { italics: true }) : null
    return {
      pre,
      table: objectsSpec(list, [
        { key: 'cause', header: '根因' },
        { key: 'evidence', header: '证据 / 数据' },
        { key: 'mechanism', header: '发生机理' },
      ]),
    }
  })

  // --- D5 永久对策 ---
  pushStep(docx, md, 'D5', '永久对策选择', () => {
    const list = input.d5PermanentActions || []
    return {
      table: objectsSpec(list, [
        { key: 'action', header: '对策' },
        { key: 'targetCause', header: '针对根因' },
        { key: 'owner', header: '责任人' },
        { key: 'expectedResult', header: '预期效果' },
        { key: 'verifyMethod', header: '验证方式' },
      ]),
    }
  })

  // --- D6 实施与验证 ---
  pushStep(docx, md, 'D6', '实施与效果验证', () => {
    const list = input.d6Implement || []
    return {
      table: objectsSpec(list, [
        { key: 'action', header: '实施内容' },
        { key: 'owner', header: '责任人' },
        { key: 'date', header: '完成日期' },
        { key: 'verification', header: '验证方式' },
        { key: 'result', header: '验证结果' },
      ]),
    }
  })

  // --- D7 防止再发 ---
  pushStep(docx, md, 'D7', '防止再发 / 系统化', () => {
    const list = input.d7Prevent || []
    return {
      table: objectsSpec(list, [
        { key: 'lesson', header: '经验 / 改进项' },
        { key: 'horizontal', header: '横向展开' },
        { key: 'processUpdate', header: '文件 / 流程更新' },
      ]),
    }
  })

  // --- D8 团队表彰与结案 ---
  pushStep(docx, md, 'D8', '团队表彰与结案', () => {
    const d = input.d8Recognition || {}
    const pairs = [
      ['结案日期', d.closeDate],
      ['表彰说明', d.note],
      ['团队贡献', d.team],
    ]
    return { kv: pairs }
  })

  return { title, docx, md: md.text() }
}

/**
 * 统一渲染每一步：标题 + kv/pre/table，同步把相同内容写入 MD。
 */
function pushStep(docx, md, code, name, fn) {
  const block = fn() || {}
  const fullHead = `${code} — ${name}`
  docx.push(heading(2, fullHead))
  md.h(2, fullHead)

  if (block.pre) {
    docx.push(block.pre)
    md.p(getText(block.pre))
  }

  if (block.image && block.image.buffer) {
    docx.push(imageParagraph(block.image.buffer, {
      width: block.image.width,
      height: block.image.height,
    }))
    md.p(`_［图：${block.image.mdAlt || '附图'}，已嵌入 Word 文档，Markdown 预览中不显示］_`)
  }

  if (block.kv) {
    const t = kvTable(block.kv)
    if (t) {
      docx.push(t, para(''))
      md.kv(block.kv)
    } else {
      docx.push(para('— 暂无 —', { italics: true }))
      md.p('_— 暂无 —_')
    }
  }

  if (block.table) {
    if (block.table) {
      docx.push(block.table.docx, para(''))
      md.table(block.table.columns, block.table.rows)
      if (!block.table.hasData) {
        // objectsSpec returns empty table placeholder
      }
    }
  }

  if (block.bullets) {
    block.bullets.forEach(x => docx.push(bulletPara(x)))
    md.bullets(block.bullets)
  }
}

function getText(p) {
  // best-effort text extraction from a Paragraph (for MD mirror)
  try {
    const runs = p.options && p.options.children ? p.options.children : p.children || []
    return runs.map(r => (r.options && r.options.text) || '').join('')
  } catch {
    return ''
  }
}

/** objects → { docx: Table, columns, rows, hasData }。空列表返回"— 暂无 —"占位段。 */
function objectsSpec(list, spec) {
  if (!Array.isArray(list) || list.length === 0) {
    return {
      docx: para('— 暂无 —', { italics: true }),
      columns: spec.map(s => s.header),
      rows: [],
      hasData: false,
    }
  }
  const columns = spec.map(s => s.header)
  const rows = list.map(obj => spec.map(s => fmtValue(obj[s.key])))
  return { docx: dataTable(columns, rows), columns, rows, hasData: true }
}

// ---------------------------------------------------------------------------
// 2. DMAIC 报告
// ---------------------------------------------------------------------------

function buildDmaicParts(input) {
  const title = String(input.title || 'DMAIC 六西格玛项目报告').trim()
  const meta = [
    ['报告编号', input.reportNo],
    ['编制日期', input.date || new Date().toISOString().slice(0, 10)],
    ['项目负责人', input.owner],
    ['带状级别', input.belt],
    ['预期收益', input.expectedBenefit],
  ]

  const docx = []
  docx.push(new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [tr(title, { bold: true, size: 36 })] }))
  const mt = kvTable(meta)
  if (mt) docx.push(mt, para(''))

  const md = new MD()
  md.h(1, title)
  md.kv(meta)

  pushStep(docx, md, 'D', 'Define（定义）', () => {
    const d = input.define || {}
    return {
      kv: [
        ['问题陈述', d.problem],
        ['项目目标', d.goals],
        ['范围（In / Out）', d.scope],
        ['团队', d.team],
        ['CTQ 关键质量特性', d.ctq],
        ['项目章程', d.charter],
      ],
    }
  })

  pushStep(docx, md, 'M', 'Measure（测量）', () => {
    const m = input.measure || {}
    return {
      kv: [
        ['基线性能（Baseline）', m.baseline],
        ['关键指标 Y', m.metrics],
        ['过程能力 Cpk / Ppk', m.capability],
        ['测量系统分析（MSA）', m.msa],
        ['数据收集计划', m.dataPlan],
      ],
    }
  })

  pushStep(docx, md, 'A', 'Analyze（分析）', () => {
    const a = input.analyze || {}
    const list = a.rootCauses || []
    return {
      kv: [['使用工具', a.tools]],
      table: objectsSpec(list, [
        { key: 'cause', header: '关键 X' },
        { key: 'evidence', header: '数据 / 检验' },
        { key: 'test', header: '显著性' },
      ]),
    }
  })

  pushStep(docx, md, 'I', 'Improve（改善）', () => {
    const i = input.improve || {}
    const list = i.actions || []
    return {
      kv: [
        ['改善思路', i.approach],
        ['试点方案（Pilot）', i.pilot],
        ['风险识别（FMEA）', i.fmea],
      ],
      table: objectsSpec(list, [
        { key: 'action', header: '改善行动' },
        { key: 'owner', header: '责任人' },
        { key: 'date', header: '实施日期' },
        { key: 'result', header: '效果验证' },
      ]),
    }
  })

  pushStep(docx, md, 'C', 'Control（控制）', () => {
    const c = input.control || {}
    const list = c.plan || []
    return {
      kv: [
        ['移交对象', c.handoff],
        ['后续监控', c.followup],
      ],
      table: objectsSpec(list, [
        { key: 'metric', header: '监控指标' },
        { key: 'spec', header: '规格 / 目标' },
        { key: 'frequency', header: '频率' },
        { key: 'owner', header: '责任人' },
        { key: 'response', header: '超规响应' },
      ]),
    }
  })

  // 收益总结
  if (input.summary) {
    docx.push(heading(2, '收益总结'))
    md.h(2, '收益总结')
    docx.push(para(input.summary))
    md.p(input.summary)
  }

  return { title, docx, md: md.text() }
}

// ---------------------------------------------------------------------------
// 3. 通用报告
// ---------------------------------------------------------------------------

function buildGenericParts(input) {
  const title = String(input.title || '精益改善报告').trim()
  const docx = []
  docx.push(new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [tr(title, { bold: true, size: 36 })] }))

  const meta = [
    ['作者', input.author],
    ['日期', input.date || new Date().toISOString().slice(0, 10)],
    ['摘要', input.summary],
  ]
  const mt = kvTable(meta)
  if (mt) docx.push(mt, para(''))

  const md = new MD()
  md.h(1, title)
  md.kv(meta)

  const sections = Array.isArray(input.sections) ? input.sections : []
  if (sections.length === 0) return { title, docx, md: md.text() }

  sections.forEach(sec => {
    const level = Math.max(1, Math.min(4, Number(sec.level) || 2))
    const h = String(sec.heading || '(未命名章节)')
    docx.push(heading(level, h))
    md.h(level, h)

    if (sec.body) {
      // split by blank lines → paragraphs
      String(sec.body).split(/\n{2,}/).map(s => s.trim()).filter(Boolean).forEach(pTxt => {
        docx.push(para(pTxt))
        md.p(pTxt)
      })
    }

    if (Array.isArray(sec.list) && sec.list.length > 0) {
      sec.list.forEach(x => docx.push(bulletPara(String(x))))
      md.bullets(sec.list)
    }

    if (sec.table && Array.isArray(sec.table.columns) && Array.isArray(sec.table.rows) && sec.table.rows.length > 0) {
      const t = dataTable(sec.table.columns, sec.table.rows)
      if (t) docx.push(t, para(''))
      md.table(sec.table.columns, sec.table.rows)
    }
  })

  return { title, docx, md: md.text() }
}

// ---------------------------------------------------------------------------
// 4. 精益问题分析综合报告（问题→分析→解决全过程）
// ---------------------------------------------------------------------------

/**
 * 将"问题诊断 + 根因分析 + 对策方案"全过程整合为一份可交付的综合报告。
 *
 * 设计原则：
 *   - 每章以"叙述文字 + 数据表格 + 图表数据表"三件套展示，不依赖图片嵌入
 *   - 图表（帕累托/趋势/鱼骨/对比）以"数据表 + 说明文字"形式呈现，UI 端可另行渲染
 *   - 未填章节会显示"— 暂无 —"，不会硬报错
 */
function buildLeanAnalysisParts(input) {
  const title = String(input.title || '精益问题分析报告').trim()
  const meta = [
    ['报告编号', input.reportNo],
    ['编制日期', input.date || new Date().toISOString().slice(0, 10)],
    ['编制人 / 团队', input.owner],
    ['所属部门 / 车间', input.department],
    ['问题类型', input.category],
    ['报告版本', input.version || 'v1.0'],
  ]

  const docx = []
  docx.push(new Paragraph({
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
    children: [tr(title, { bold: true, size: 36 })],
  }))
  const mt = kvTable(meta)
  if (mt) docx.push(mt, para(''))

  const md = new MD()
  md.h(1, title)
  md.kv(meta)

  // --- 摘要 ---
  if (input.summary) {
    docx.push(heading(2, '执行摘要'))
    md.h(2, '执行摘要')
    String(input.summary).split(/\n{2,}/).map(s => s.trim()).filter(Boolean).forEach(p => {
      docx.push(para(p))
      md.p(p)
    })
  }

  // --- 1. 问题描述 ---
  pushStep(docx, md, '1', '问题描述', () => {
    const p = input.problem || {}
    return {
      kv: [
        ['问题陈述', p.description],
        ['问题分类', p.category || input.category],
        ['发生场景（Where）', p.location],
        ['发生时间（When）', p.occurredAt],
        ['客户 / 影响对象', p.customer],
        ['业务影响', p.impact],
        ['紧急程度', p.urgency],
      ],
    }
  })

  // --- 2. 现状数据 / 基线 ---
  pushStep(docx, md, '2', '现状数据与基线', () => {
    const c = input.current || {}
    const list = c.metrics || []
    const block = {
      kv: [
        ['数据采集窗口', c.window],
        ['样本量', c.sampleSize],
        ['基线总体评价', c.assessment],
      ],
      table: objectsSpec(list, [
        { key: 'name', header: '指标' },
        { key: 'baseline', header: '基线值' },
        { key: 'target', header: '目标值' },
        { key: 'gap', header: '差距' },
        { key: 'unit', header: '单位' },
      ]),
    }
    return block
  })

  // --- 3. 帕累托分析 ---
  if (input.pareto && Array.isArray(input.pareto.items) && input.pareto.items.length > 0) {
    pushStep(docx, md, '3', '帕累托分析（问题分类分布）', () => {
      const p = input.pareto || {}
      const items = (p.items || []).slice().sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
      const total = items.reduce((s, x) => s + Number(x.count || 0), 0) || 1
      let cum = 0
      const rows = items.map(it => {
        const c = Number(it.count || 0)
        cum += c
        const pct = (c / total * 100).toFixed(1) + '%'
        const cumPct = (cum / total * 100).toFixed(1) + '%'
        return [it.category, c, pct, cumPct]
      })
      const paretoPng = renderParetoChart(items, p.title)
      return {
        pre: p.title ? para(`图表主题：${p.title}`, { italics: true }) : null,
        image: paretoPng ? { buffer: paretoPng, width: 640, height: 336, mdAlt: '帕累托图' } : null,
        table: {
          docx: dataTable(['问题类别', '数量', '占比', '累计占比'], rows),
          columns: ['问题类别', '数量', '占比', '累计占比'],
          rows,
          hasData: true,
        },
        bullets: p.top80 ? [`关键少数（累计 ≈ 80%）：${p.top80}`] : null,
      }
    })
  }

  // --- 4. 鱼骨图根因分析（5M1E） ---
  if (input.fishbone && typeof input.fishbone === 'object') {
    pushStep(docx, md, '4', '鱼骨图 / 5M1E 根因展开', () => {
      const fb = input.fishbone || {}
      const branches = [
        ['人（Man）', fb.man],
        ['机（Machine）', fb.machine],
        ['料（Material）', fb.material],
        ['法（Method）', fb.method],
        ['环（Environment）', fb.environment],
        ['测（Measurement）', fb.measurement],
      ]
      const rows = []
      for (const [branch, causes] of branches) {
        const arr = Array.isArray(causes) ? causes : (causes ? [causes] : [])
        arr.forEach((c, i) => {
          rows.push([i === 0 ? branch : '', typeof c === 'object' ? (c.cause || c.text || JSON.stringify(c)) : String(c)])
        })
        if (arr.length === 0) rows.push([branch, '—'])
      }
      const fishPng = renderFishboneChart(fb)
      return {
        pre: fb.problem ? para(`中心问题：${fb.problem}`, { italics: true }) : null,
        image: fishPng ? { buffer: fishPng, width: 680, height: 396, mdAlt: '鱼骨图' } : null,
        table: {
          docx: dataTable(['分类', '潜在原因'], rows),
          columns: ['分类', '潜在原因'],
          rows,
          hasData: true,
        },
      }
    })
  }

  // --- 5. 5 Why 追问 ---
  if (Array.isArray(input.fiveWhys) && input.fiveWhys.length > 0) {
    pushStep(docx, md, '5', '5 Why 连续追问', () => {
      const list = input.fiveWhys
      return {
        table: objectsSpec(list, [
          { key: 'level', header: '层级' },
          { key: 'question', header: '为什么？' },
          { key: 'answer', header: '答 / 依据' },
        ]),
      }
    })
  }

  // --- 6. 根因确认 ---
  pushStep(docx, md, '6', '根本原因确认', () => {
    const list = input.rootCauses || []
    return {
      pre: input.rootCauseMethod ? para(`验证方法：${input.rootCauseMethod}`, { italics: true }) : null,
      table: objectsSpec(list, [
        { key: 'cause', header: '根因' },
        { key: 'evidence', header: '证据 / 数据' },
        { key: 'mechanism', header: '发生机理' },
        { key: 'weight', header: '权重 / 贡献度' },
      ]),
    }
  })

  // --- 7. 趋势数据（现状 / 历史） ---
  if (input.trend && Array.isArray(input.trend.series) && input.trend.series.length > 0) {
    pushStep(docx, md, '7', '趋势数据分析', () => {
      const t = input.trend || {}
      const rows = (t.series || []).map(p => [p.time, p.value, p.note || ''])
      const trendPng = renderTrendChart(t.series, t.metric, t.unit)
      return {
        pre: t.metric ? para(`指标：${t.metric}${t.unit ? '（' + t.unit + '）' : ''}`, { italics: true }) : null,
        image: trendPng ? { buffer: trendPng, width: 640, height: 292, mdAlt: '趋势图' } : null,
        table: {
          docx: dataTable(['时间', '数值', '备注'], rows),
          columns: ['时间', '数值', '备注'],
          rows,
          hasData: true,
        },
        bullets: t.observation ? [`观察结论：${t.observation}`] : null,
      }
    })
  }

  // --- 8. 对策方案 ---
  pushStep(docx, md, '8', '对策方案（含优先级 / ROI）', () => {
    const list = input.solutions || []
    return {
      pre: input.solutionStrategy ? para(`改善思路：${input.solutionStrategy}`) : null,
      table: objectsSpec(list, [
        { key: 'action', header: '对策' },
        { key: 'targetCause', header: '针对根因' },
        { key: 'type', header: '类型' },
        { key: 'cost', header: '成本' },
        { key: 'benefit', header: '预期收益' },
        { key: 'priority', header: '优先级' },
      ]),
    }
  })

  // --- 9. 实施计划 ---
  pushStep(docx, md, '9', '实施计划（时间节点）', () => {
    const list = input.plan || []
    return {
      table: objectsSpec(list, [
        { key: 'phase', header: '阶段' },
        { key: 'action', header: '工作项' },
        { key: 'owner', header: '责任人' },
        { key: 'start', header: '开始' },
        { key: 'end', header: '完成' },
        { key: 'deliverable', header: '交付物' },
      ]),
    }
  })

  // --- 10. 效果验证 / 改善对比 ---
  pushStep(docx, md, '10', '效果验证与改善对比', () => {
    const v = input.verification || {}
    const list = v.kpis || []
    const kpiPng = list.length > 0 ? renderKpiCompareChart(list) : null
    return {
      kv: [
        ['验证周期', v.window],
        ['验证方式', v.method],
        ['综合评价', v.assessment],
      ],
      image: kpiPng ? { buffer: kpiPng, width: 640, height: 320, mdAlt: 'KPI 改善对比图' } : null,
      table: objectsSpec(list, [
        { key: 'name', header: 'KPI' },
        { key: 'baseline', header: '改善前' },
        { key: 'after', header: '改善后' },
        { key: 'target', header: '目标' },
        { key: 'delta', header: '改善幅度' },
        { key: 'unit', header: '单位' },
      ]),
    }
  })

  // --- 11. 标准化与横向展开 ---
  if (input.standardize || (Array.isArray(input.lessons) && input.lessons.length > 0)) {
    pushStep(docx, md, '11', '标准化 / 横向展开 / 经验教训', () => {
      const s = input.standardize || {}
      return {
        kv: [
          ['文件 / 流程更新', s.docsUpdated],
          ['培训 / 宣贯', s.training],
          ['横向展开对象', s.horizontalRollout],
          ['固化监控指标', s.monitoring],
        ],
        bullets: Array.isArray(input.lessons) ? input.lessons : null,
      }
    })
  }

  // --- 结论 ---
  if (input.conclusion) {
    docx.push(heading(2, '结论'))
    md.h(2, '结论')
    String(input.conclusion).split(/\n{2,}/).map(s => s.trim()).filter(Boolean).forEach(p => {
      docx.push(para(p))
      md.p(p)
    })
  }

  return { title, docx, md: md.text() }
}

// ---------------------------------------------------------------------------
// 公共：从 parts → Buffer + artifact
// ---------------------------------------------------------------------------

async function emitReport(ctx, type, parts) {
  const doc = makeDocument(parts.docx)
  const buffer = await Packer.toBuffer(doc)
  const saved = persistReport(ctx, { type, title: parts.title, buffer: Buffer.from(buffer) })
  const base64 = Buffer.from(buffer).toString('base64')
  const dataUrl =
    'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,' + base64

  const content =
    `已生成报告"${parts.title}"（${(saved.size / 1024).toFixed(1)} KB），存档路径：${saved.fullPath}\n\n` +
    `--- Markdown 预览 ---\n\n${parts.md}`

  return {
    content,
    artifact: {
      type: 'file',
      data: dataUrl,
      filename: saved.filename,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
  }
}

// ---------------------------------------------------------------------------
// Tool 定义
// ---------------------------------------------------------------------------

const tools = [
  {
    name: 'eight_d',
    description:
      '生成 8D 问题解决报告（Word + Markdown 预览）。适用于客户投诉、急性质量问题、短周期纠正（数天至数周）。' +
      '输入为 D1~D8 八个纪律阶段的结构化数据；未填阶段会标注为"— 暂无 —"。' +
      '每次调用会写入 ~/.lean-ai/exports/<slug>-<ts>.docx 并在 SQLite reports 表登记。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '报告标题（如"焊接合格率下降 8D 报告"）' },
        reportNo: { type: 'string', description: '报告编号（如"8D-2026-001"）' },
        date: { type: 'string', description: '编制日期 YYYY-MM-DD' },
        category: { type: 'string', description: '问题分类（如"质量 / 交期"）' },
        customerOrInternal: { type: 'string', description: '客户名或"内部问题"' },
        d1Team: {
          type: 'object',
          properties: {
            leader: { type: 'string', description: '组长' },
            members: { type: 'array', items: { type: 'string' }, description: '成员列表' },
            sponsor: { type: 'string', description: 'Sponsor / 高层支持' },
            note: { type: 'string' },
          },
        },
        d2Problem: {
          type: 'object',
          description: '5W2H 问题描述',
          properties: {
            description: { type: 'string' }, customer: { type: 'string' },
            occurredDate: { type: 'string' }, location: { type: 'string' },
            frequency: { type: 'string' }, impact: { type: 'string' }, why: { type: 'string' },
          },
        },
        d3Containment: {
          type: 'array', description: '临时遏制措施（保护客户）',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string' }, owner: { type: 'string' },
              due: { type: 'string' }, status: { type: 'string' },
            },
          },
        },
        d4Method: { type: 'string', description: '使用的根因分析方法（如"5 Why + 鱼骨"）' },
        d4RootCause: {
          type: 'array', description: '根本原因',
          items: {
            type: 'object',
            properties: {
              cause: { type: 'string' }, evidence: { type: 'string' }, mechanism: { type: 'string' },
            },
          },
        },
        d5PermanentActions: {
          type: 'array', description: '永久对策（未实施）',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string' }, targetCause: { type: 'string' }, owner: { type: 'string' },
              expectedResult: { type: 'string' }, verifyMethod: { type: 'string' },
            },
          },
        },
        d6Implement: {
          type: 'array', description: '实施记录 + 效果验证',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string' }, owner: { type: 'string' }, date: { type: 'string' },
              verification: { type: 'string' }, result: { type: 'string' },
            },
          },
        },
        d7Prevent: {
          type: 'array', description: '防止再发 / 系统化',
          items: {
            type: 'object',
            properties: {
              lesson: { type: 'string' }, horizontal: { type: 'string' }, processUpdate: { type: 'string' },
            },
          },
        },
        d8Recognition: {
          type: 'object',
          properties: {
            closeDate: { type: 'string' }, note: { type: 'string' },
            team: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      required: ['title'],
    },
    async execute(input, ctx) {
      try {
        const parts = build8DParts(input)
        return await emitReport(ctx, '8d', parts)
      } catch (err) {
        ctx.log('error', '8D 报告生成失败: ' + (err && err.message))
        return { content: '生成 8D 报告失败：' + (err && err.message), isError: true }
      }
    },
  },

  {
    name: 'dmaic',
    description:
      '生成 DMAIC 六西格玛项目报告（Word + Markdown 预览）。适用于慢性变异、数据驱动的中长期改善项目。' +
      '输入为 D/M/A/I/C 五个阶段的结构化数据 + 可选收益总结。' +
      '每次调用会写入 ~/.lean-ai/exports/ 并在 SQLite reports 表登记。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        reportNo: { type: 'string' },
        date: { type: 'string' },
        owner: { type: 'string', description: '项目负责人 / Black Belt' },
        belt: { type: 'string', description: '带状级别（YB/GB/BB/MBB）' },
        expectedBenefit: { type: 'string', description: '预期年度收益' },
        define: {
          type: 'object',
          properties: {
            problem: { type: 'string' }, goals: { type: 'string' }, scope: { type: 'string' },
            team: { type: 'string' }, ctq: { type: 'string' }, charter: { type: 'string' },
          },
        },
        measure: {
          type: 'object',
          properties: {
            baseline: { type: 'string' }, metrics: { type: 'string' },
            capability: { type: 'string' }, msa: { type: 'string' }, dataPlan: { type: 'string' },
          },
        },
        analyze: {
          type: 'object',
          properties: {
            tools: { type: 'string', description: '使用的分析工具（如"Pareto + 假设检验"）' },
            rootCauses: {
              type: 'array',
              items: {
                type: 'object',
                properties: { cause: { type: 'string' }, evidence: { type: 'string' }, test: { type: 'string' } },
              },
            },
          },
        },
        improve: {
          type: 'object',
          properties: {
            approach: { type: 'string' }, pilot: { type: 'string' }, fmea: { type: 'string' },
            actions: {
              type: 'array',
              items: {
                type: 'object',
                properties: { action: { type: 'string' }, owner: { type: 'string' }, date: { type: 'string' }, result: { type: 'string' } },
              },
            },
          },
        },
        control: {
          type: 'object',
          properties: {
            handoff: { type: 'string' }, followup: { type: 'string' },
            plan: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  metric: { type: 'string' }, spec: { type: 'string' }, frequency: { type: 'string' },
                  owner: { type: 'string' }, response: { type: 'string' },
                },
              },
            },
          },
        },
        summary: { type: 'string', description: '项目总结 / 收益' },
      },
      required: ['title'],
    },
    async execute(input, ctx) {
      try {
        const parts = buildDmaicParts(input)
        return await emitReport(ctx, 'dmaic', parts)
      } catch (err) {
        ctx.log('error', 'DMAIC 报告生成失败: ' + (err && err.message))
        return { content: '生成 DMAIC 报告失败：' + (err && err.message), isError: true }
      }
    },
  },

  {
    name: 'generic',
    description:
      '生成自由结构报告（Word + Markdown 预览）。当用户的报告不属于 8D 或 DMAIC（如综合诊断报告、改善总结、培训材料）时使用。' +
      '支持任意 sections：每节含 heading / level / body（markdown 段落）/ list / table。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        author: { type: 'string' },
        date: { type: 'string' },
        summary: { type: 'string', description: '一段式摘要（放在标题之后）' },
        sections: {
          type: 'array',
          description: '章节列表（按顺序渲染）',
          items: {
            type: 'object',
            properties: {
              heading: { type: 'string', description: '章节标题' },
              level: { type: 'number', description: '1=H1 / 2=H2 / 3=H3 / 4=H4，默认 2' },
              body: { type: 'string', description: '正文（多段用空行分隔）' },
              list: { type: 'array', items: { type: 'string' }, description: '无序列表项' },
              table: {
                type: 'object',
                properties: {
                  columns: { type: 'array', items: { type: 'string' } },
                  rows: { type: 'array', items: { type: 'array' } },
                },
              },
            },
            required: ['heading'],
          },
        },
      },
      required: ['title', 'sections'],
    },
    async execute(input, ctx) {
      try {
        const parts = buildGenericParts(input)
        return await emitReport(ctx, 'generic', parts)
      } catch (err) {
        ctx.log('error', '通用报告生成失败: ' + (err && err.message))
        return { content: '生成通用报告失败：' + (err && err.message), isError: true }
      }
    },
  },

  {
    name: 'lean_analysis',
    description:
      '生成【精益问题分析综合报告】（Word + Markdown 预览）。' +
      '把"问题描述 → 现状数据 → 帕累托分析 → 鱼骨图根因 → 5Why → 根因确认 → 趋势分析 → 对策方案 → 实施计划 → 效果验证 → 标准化/经验教训"整合为一份可交付的文件。' +
      '适用于用户要求"把整个诊断/分析/解决过程汇总成一份报告"的场景。' +
      '输入为结构化字段；任何缺失章节会以"— 暂无 —"占位，不会失败。' +
      '帕累托 / 趋势 / 鱼骨 等图表以"数据表 + 说明文字"形式呈现，前端如需可视化可另行调用 charts 技能。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '报告标题（如"焊接工段合格率下降分析报告"）' },
        reportNo: { type: 'string', description: '报告编号' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        owner: { type: 'string', description: '编制人 / 团队' },
        department: { type: 'string', description: '所属部门 / 车间' },
        category: { type: 'string', description: '问题类型：效率 / 质量 / 库存 / 交期 / 成本 / 安全' },
        version: { type: 'string', description: '报告版本号，默认 v1.0' },
        summary: { type: 'string', description: '执行摘要（可多段，用空行分隔）' },

        problem: {
          type: 'object',
          description: '问题描述（5W）',
          properties: {
            description: { type: 'string', description: '问题陈述' },
            category: { type: 'string' },
            location: { type: 'string', description: '发生场景 / 工位' },
            occurredAt: { type: 'string', description: '首次发生时间' },
            customer: { type: 'string', description: '客户 / 受影响对象' },
            impact: { type: 'string', description: '业务影响（数量 / 金额 / 客户投诉）' },
            urgency: { type: 'string' },
          },
        },

        current: {
          type: 'object',
          description: '现状数据与基线',
          properties: {
            window: { type: 'string', description: '数据采集窗口（如"2026-01~2026-03"）' },
            sampleSize: { type: 'string' },
            assessment: { type: 'string' },
            metrics: {
              type: 'array',
              description: '关键指标基线数据',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' }, baseline: { type: 'string' },
                  target: { type: 'string' }, gap: { type: 'string' }, unit: { type: 'string' },
                },
              },
            },
          },
        },

        pareto: {
          type: 'object',
          description: '帕累托分析：按问题分类统计数量，自动计算累计占比',
          properties: {
            title: { type: 'string' },
            top80: { type: 'string', description: '累计 80% 关注的关键类别' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: { category: { type: 'string' }, count: { type: 'number' } },
              },
            },
          },
        },

        fishbone: {
          type: 'object',
          description: '鱼骨图 / 5M1E 展开（每项可为字符串数组或 { cause } 对象数组）',
          properties: {
            problem: { type: 'string', description: '鱼头（中心问题）' },
            man: { type: 'array', items: { type: 'string' } },
            machine: { type: 'array', items: { type: 'string' } },
            material: { type: 'array', items: { type: 'string' } },
            method: { type: 'array', items: { type: 'string' } },
            environment: { type: 'array', items: { type: 'string' } },
            measurement: { type: 'array', items: { type: 'string' } },
          },
        },

        fiveWhys: {
          type: 'array',
          description: '5 Why 追问序列',
          items: {
            type: 'object',
            properties: {
              level: { type: 'string', description: 'Why 1 / Why 2 …' },
              question: { type: 'string' }, answer: { type: 'string' },
            },
          },
        },

        rootCauseMethod: { type: 'string', description: '根因验证方法（如"试验验证 + 假设检验"）' },
        rootCauses: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              cause: { type: 'string' }, evidence: { type: 'string' },
              mechanism: { type: 'string' }, weight: { type: 'string' },
            },
          },
        },

        trend: {
          type: 'object',
          description: '趋势数据（现状 / 历史 / 改善过程）',
          properties: {
            metric: { type: 'string' }, unit: { type: 'string' },
            observation: { type: 'string' },
            series: {
              type: 'array',
              items: {
                type: 'object',
                properties: { time: { type: 'string' }, value: { type: 'number' }, note: { type: 'string' } },
              },
            },
          },
        },

        solutionStrategy: { type: 'string', description: '总体改善思路' },
        solutions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string' }, targetCause: { type: 'string' },
              type: { type: 'string', description: '短期 / 中期 / 长期 / 永久' },
              cost: { type: 'string' }, benefit: { type: 'string' }, priority: { type: 'string' },
            },
          },
        },

        plan: {
          type: 'array',
          description: '实施计划里程碑',
          items: {
            type: 'object',
            properties: {
              phase: { type: 'string' }, action: { type: 'string' }, owner: { type: 'string' },
              start: { type: 'string' }, end: { type: 'string' }, deliverable: { type: 'string' },
            },
          },
        },

        verification: {
          type: 'object',
          description: '效果验证数据',
          properties: {
            window: { type: 'string' }, method: { type: 'string' }, assessment: { type: 'string' },
            kpis: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' }, baseline: { type: 'string' }, after: { type: 'string' },
                  target: { type: 'string' }, delta: { type: 'string' }, unit: { type: 'string' },
                },
              },
            },
          },
        },

        standardize: {
          type: 'object',
          properties: {
            docsUpdated: { type: 'string' }, training: { type: 'string' },
            horizontalRollout: { type: 'string' }, monitoring: { type: 'string' },
          },
        },
        lessons: { type: 'array', items: { type: 'string' }, description: '经验教训 / 复盘要点' },
        conclusion: { type: 'string', description: '结论段落（可多段）' },
      },
      required: ['title'],
    },
    async execute(input, ctx) {
      try {
        const parts = buildLeanAnalysisParts(input)
        return await emitReport(ctx, 'lean-analysis', parts)
      } catch (err) {
        ctx.log('error', '精益分析报告生成失败: ' + (err && err.message))
        return { content: '生成精益分析报告失败：' + (err && err.message), isError: true }
      }
    },
  },

  {
    name: 'list',
    description:
      '列出已生成的报告（按生成时间倒序）。当用户问"我之前生成过哪些报告"或想找回之前的报告路径时调用。' +
      '可按 type 过滤（8d / dmaic / generic / lean-analysis），可用 limit 限制数量（默认 20，上限 100）。' +
      '返回包括 id、标题、类型、文件大小、生成时间、绝对路径，便于用户直接打开或继续引用。',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['8d', 'dmaic', 'generic', 'lean-analysis'],
          description: '可选：仅返回某一类型的报告',
        },
        limit: { type: 'number', description: '返回数量上限（1–100，默认 20）' },
      },
    },
    async execute(input, ctx) {
      try {
        ensureSchema(ctx.db)
        const limit = Math.max(1, Math.min(100, Number(input.limit) || 20))
        const where = input.type ? 'WHERE type = ?' : ''
        const params = input.type ? [input.type, limit] : [limit]
        const rows = ctx.db.prepare(
          `SELECT id, type, title, file_path, file_size, created_at
           FROM reports ${where}
           ORDER BY created_at DESC
           LIMIT ?`
        ).all(...params)

        if (rows.length === 0) {
          const hint = input.type ? `（类型 = ${input.type}）` : ''
          return { content: `尚未生成任何报告${hint}。可调用 eight_d / dmaic / generic / lean_analysis 创建。` }
        }

        // Markdown 表 + 同结构 table artifact，便于 UI 渲染表格
        const columns = ['标题', '类型', '大小', '生成时间', '路径']
        const tableRows = rows.map(r => [
          r.title,
          r.type,
          (r.file_size / 1024).toFixed(1) + ' KB',
          new Date(r.created_at).toLocaleString('zh-CN', { hour12: false }),
          r.file_path,
        ])

        const md = new MD()
        md.h(2, `报告历史（共 ${rows.length} 份${input.type ? '，类型 = ' + input.type : ''}）`)
        md.table(columns, tableRows)

        return {
          content: md.text(),
          artifact: { type: 'table', data: { columns, rows: tableRows } },
        }
      } catch (err) {
        ctx.log('error', '列出报告失败: ' + (err && err.message))
        return { content: '列出报告失败：' + (err && err.message), isError: true }
      }
    },
  },
]

// ---------------------------------------------------------------------------
// Skill manifest
// ---------------------------------------------------------------------------

module.exports = {
  default: {
    packageName: '@lean-ai/skill-reports',
    displayName: '报告生成',
    description: '8D / DMAIC / 通用 / 精益问题分析综合报告的 Word 生成器（内置 Markdown 预览）',
    version: '1.0.0',
    tools,
    async onActivate(ctx) {
      ensureSchema(ctx.db)
      // 确保 exports 目录存在
      getExportsDir()
      ctx.log('info', 'skill-reports activated; exports dir = ' + getExportsDir())
    },
  },
}
