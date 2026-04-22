/**
 * @lean-ai/skill-charts
 *
 * 4 类精益常用图表的 SVG 生成器（自包含，不依赖任何外部 JS 库）：
 *   - chart_fishbone — 鱼骨图（5M1E 根因分析）
 *   - chart_pareto   — 柏拉图（频次降序 + 累计 % 折线）
 *   - chart_vsm      — 价值流图（工序框 + 库存三角 + 时间线）
 *   - chart_boxplot  — 箱型图（按组的四分位 / 须 / 离群点）
 *
 * 设计原则：
 *   - 由 LLM 提供结构化数据，本地纯 JS 计算坐标 + 拼 SVG 字符串
 *   - 输入校验失败返回 isError，让 LLM 看到原因后修正
 *   - 返回 artifact { type: 'svg', data: '<svg>...</svg>', mimeType: 'image/svg+xml' }
 *
 * 数据导入（xls/xlsx/csv）：
 *   用户可在聊天输入栏点击"数据"按钮上传 .xls/.xlsx/.csv 文件。前端会把解析后
 *   的表头、行数与前 20 行 CSV 预览作为一段文本插入到下一条消息中；LLM 读到
 *   CSV 后自行将列映射到 items / groups / processes 等结构，再调用本技能对应
 *   的工具生成图表。无需在工具 schema 里单独声明文件参数。
 */

// ---- SVG 工具 --------------------------------------------------------------

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function svgWrap(width, height, body, title) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `width="100%" style="max-width:${width}px;height:auto;background:#fff;font-family:'PingFang SC','Microsoft YaHei',sans-serif;">` +
    (title ? `<title>${esc(title)}</title>` : '') +
    body +
    `</svg>`
  )
}

// ---- 1. 鱼骨图（Fishbone）--------------------------------------------------

const FISHBONE_DEFAULT_CATEGORIES = ['人', '机', '料', '法', '环', '测']

function buildFishbone(input) {
  const problem = String(input.problem || '问题').trim()
  const branches = Array.isArray(input.branches) ? input.branches : []

  // 校验：每个 branch 必须有 category + causes[]
  if (branches.length === 0) {
    return { error: 'branches 不能为空。每个 branch 需 { category, causes: [string,...] }。' }
  }

  const W = 880, H = 460
  const spineY = H / 2
  const spineX1 = 80, spineX2 = W - 200
  const headX = W - 195, headY = spineY - 30, headW = 180, headH = 60

  const lines = []
  // 主脊
  lines.push(`<line x1="${spineX1}" y1="${spineY}" x2="${spineX2}" y2="${spineY}" stroke="#333" stroke-width="2"/>`)
  // 箭头三角
  lines.push(`<polygon points="${spineX2},${spineY - 8} ${spineX2 + 14},${spineY} ${spineX2},${spineY + 8}" fill="#333"/>`)
  // 问题框
  lines.push(`<rect x="${headX}" y="${headY}" width="${headW}" height="${headH}" rx="6" fill="#fef3c7" stroke="#d97706" stroke-width="1.5"/>`)
  // 问题文字（自动换行：每行最多 14 字符）
  const headTexts = wrapCJK(problem, 14, 2)
  headTexts.forEach((t, i) => {
    lines.push(
      `<text x="${headX + headW / 2}" y="${headY + 22 + i * 18}" text-anchor="middle" font-size="13" fill="#92400e" font-weight="600">${esc(t)}</text>`
    )
  })

  // 分支：上下交错，从 spine 起以 ±28° 倾斜
  const angle = 28 * Math.PI / 180
  const branchLen = 180
  const usable = branches.slice(0, 8) // 最多 8 条

  const upper = usable.filter((_, i) => i % 2 === 0)
  const lower = usable.filter((_, i) => i % 2 === 1)
  const upperCount = upper.length
  const lowerCount = lower.length
  const segWidth = (spineX2 - spineX1 - 60) / Math.max(upperCount, lowerCount, 1)

  function drawBranch(branch, idx, isUpper) {
    const baseX = spineX1 + 60 + idx * segWidth + segWidth / 2
    const dx = Math.sin(angle) * branchLen
    const dy = Math.cos(angle) * branchLen
    const endX = baseX - dx
    const endY = isUpper ? spineY - dy : spineY + dy
    const color = colorFor(idx, isUpper)
    // 分支线
    lines.push(`<line x1="${baseX}" y1="${spineY}" x2="${endX}" y2="${endY}" stroke="${color}" stroke-width="2"/>`)
    // 类别标签
    const labelY = isUpper ? endY - 6 : endY + 18
    lines.push(`<rect x="${endX - 20}" y="${labelY - 14}" width="40" height="20" rx="3" fill="${color}" />`)
    lines.push(`<text x="${endX}" y="${labelY}" text-anchor="middle" font-size="13" fill="#fff" font-weight="600">${esc(branch.category || '?')}</text>`)

    // 子原因（小刺）：沿主分支均匀分布
    const causes = Array.isArray(branch.causes) ? branch.causes.slice(0, 4) : []
    causes.forEach((c, i) => {
      const t = (i + 1) / (causes.length + 1)
      const px = baseX + (endX - baseX) * t
      const py = spineY + (endY - spineY) * t
      const subLen = 60
      const subDx = subLen
      const subEndX = px - subDx
      const subEndY = py
      lines.push(`<line x1="${px}" y1="${py}" x2="${subEndX}" y2="${subEndY}" stroke="${color}" stroke-width="1" opacity="0.7"/>`)
      lines.push(
        `<text x="${subEndX - 4}" y="${subEndY + 4}" text-anchor="end" font-size="11" fill="#444">${esc(c)}</text>`
      )
    })
  }

  upper.forEach((b, i) => drawBranch(b, i, true))
  lower.forEach((b, i) => drawBranch(b, i, false))

  // 标题
  lines.unshift(`<text x="${W / 2}" y="22" text-anchor="middle" font-size="15" font-weight="600" fill="#222">鱼骨图（5M1E 根因分析）</text>`)

  return { svg: svgWrap(W, H, lines.join(''), '鱼骨图') }
}

const PALETTE = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c', '#0891b2', '#be185d', '#65a30d']

function colorFor(idx, isUpper) {
  return PALETTE[(idx * 2 + (isUpper ? 0 : 1)) % PALETTE.length]
}

/** 简单中英文按显示宽度换行（中文按 1 占位，英文按 ~0.6 占位） */
function wrapCJK(text, maxCharsPerLine, maxLines) {
  const lines = []
  let cur = ''
  let curW = 0
  for (const ch of String(text)) {
    const w = /[\u4e00-\u9fff]/.test(ch) ? 1 : 0.6
    if (curW + w > maxCharsPerLine) {
      lines.push(cur)
      cur = ch
      curW = w
      if (lines.length === maxLines - 1) {
        // 最后一行，截断剩余
        cur = ch
        for (let i = 0; i < text.length; i++) {/* skip */}
        break
      }
    } else {
      cur += ch
      curW += w
    }
  }
  if (cur) lines.push(cur)
  return lines.slice(0, maxLines)
}

// ---- 2. 柏拉图（Pareto）---------------------------------------------------

function buildPareto(input) {
  const title = String(input.title || 'Pareto 分析')
  const yLabel = String(input.yLabel || '频次')
  const items = Array.isArray(input.items) ? input.items : []
  if (items.length === 0) return { error: 'items 不能为空。' }

  // 校验 + 清洗
  const data = items
    .map(it => ({ category: String(it.category || ''), count: Number(it.count) }))
    .filter(it => it.category && Number.isFinite(it.count) && it.count >= 0)
    .sort((a, b) => b.count - a.count)
  if (data.length === 0) return { error: 'items 中没有有效数据。每项需 { category: string, count: number }。' }

  const total = data.reduce((s, d) => s + d.count, 0)
  let cum = 0
  data.forEach(d => { cum += d.count; d.cumPct = total > 0 ? cum / total : 0 })

  const W = 760, H = 440
  const padL = 60, padR = 60, padT = 50, padB = 90
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const maxCount = Math.max(...data.map(d => d.count), 1)
  const barGap = 6
  const barW = (plotW - barGap * (data.length - 1)) / data.length

  const body = []
  body.push(`<text x="${W / 2}" y="22" text-anchor="middle" font-size="15" font-weight="600" fill="#222">${esc(title)}</text>`)

  // Y 轴（左：频次）
  const yTicks = 5
  for (let i = 0; i <= yTicks; i++) {
    const y = padT + plotH - (i / yTicks) * plotH
    const v = Math.round((i / yTicks) * maxCount)
    body.push(`<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#eee" stroke-width="1"/>`)
    body.push(`<text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#888">${v}</text>`)
  }
  body.push(`<text x="20" y="${padT - 8}" font-size="11" fill="#666">${esc(yLabel)}</text>`)

  // Y 轴（右：累计 %）
  for (let i = 0; i <= yTicks; i++) {
    const y = padT + plotH - (i / yTicks) * plotH
    const v = Math.round((i / yTicks) * 100)
    body.push(`<text x="${W - padR + 6}" y="${y + 4}" text-anchor="start" font-size="10" fill="#888">${v}%</text>`)
  }
  body.push(`<text x="${W - padR - 4}" y="${padT - 8}" text-anchor="end" font-size="11" fill="#666">累计 %</text>`)

  // 80% 参考线
  const y80 = padT + plotH - 0.8 * plotH
  body.push(`<line x1="${padL}" y1="${y80}" x2="${W - padR}" y2="${y80}" stroke="#dc2626" stroke-width="1" stroke-dasharray="4,3" opacity="0.6"/>`)
  body.push(`<text x="${W - padR - 4}" y="${y80 - 3}" text-anchor="end" font-size="10" fill="#dc2626">80%</text>`)

  // 柱状条
  data.forEach((d, i) => {
    const x = padL + i * (barW + barGap)
    const h = (d.count / maxCount) * plotH
    const y = padT + plotH - h
    const fill = d.cumPct <= 0.8 ? '#2563eb' : '#94a3b8'
    body.push(`<rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${fill}" />`)
    body.push(`<text x="${x + barW / 2}" y="${y - 4}" text-anchor="middle" font-size="10" fill="#333">${d.count}</text>`)
    // X 轴标签（旋转 -25°）
    const lx = x + barW / 2
    const ly = padT + plotH + 14
    body.push(`<text x="${lx}" y="${ly}" text-anchor="end" font-size="11" fill="#555" transform="rotate(-25,${lx},${ly})">${esc(d.category)}</text>`)
  })

  // 累计折线
  const linePts = data.map((d, i) => {
    const x = padL + i * (barW + barGap) + barW / 2
    const y = padT + plotH - d.cumPct * plotH
    return `${x},${y}`
  }).join(' ')
  body.push(`<polyline points="${linePts}" fill="none" stroke="#dc2626" stroke-width="2"/>`)
  data.forEach((d, i) => {
    const x = padL + i * (barW + barGap) + barW / 2
    const y = padT + plotH - d.cumPct * plotH
    body.push(`<circle cx="${x}" cy="${y}" r="3.5" fill="#fff" stroke="#dc2626" stroke-width="2"/>`)
    body.push(`<text x="${x + 6}" y="${y - 4}" font-size="10" fill="#dc2626">${Math.round(d.cumPct * 100)}%</text>`)
  })

  // 边框
  body.push(`<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="#333" stroke-width="1"/>`)
  body.push(`<line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="#333" stroke-width="1"/>`)

  return { svg: svgWrap(W, H, body.join(''), title) }
}

// ---- 3. 价值流图（VSM）- Lean Enterprise Institute 标准三区布局 -----------
//
// 参考：LEI 经典 VSM（Current State Map）
//   · 信息流区（Information flows）：客户↔生产管制↔供应商（虚线框）
//   · 物料流区（Material flows）：卡车 → 工序（含操作员）→ 库存三角 → 卡车
//   · 交期阶梯（Lead time ladder）：阶梯折线显示 库存天数（上沿）/ 加工时间（下沿）
// 总览框右下：Production Lead Time / Processing Time

function buildVSM(input) {
  const customer = input.customer || {}
  const supplier = input.supplier || {}
  const processes = Array.isArray(input.processes) ? input.processes : []
  if (processes.length === 0) {
    return {
      error:
        'processes 不能为空。每个 process 至少需 { name, ct }，可选 { co, uptime, shifts, secAvailable, operators, oee }。',
    }
  }

  // --- 库存约定 ---------------------------------------------------------
  // inventories[i] = processes[i] 与 processes[i+1] 之间。
  // 若 rawInventory 提供，则额外在第 1 道工序之前画一个三角（对应参考图中的
  //   "1783 件 / 6 days" 原材料库存）。
  const rawInv = input.rawInventory || null
  const inventories = Array.isArray(input.inventories) ? input.inventories.slice() : []
  while (inventories.length < processes.length - 1) inventories.push({ count: '—', days: 0 })

  // --- 布局参数（W 随工序数动态伸展）------------------------------------
  const N = processes.length
  const procW = 140
  const procTopH = 40   // 顶部工序名 + 操作员
  const procDataH = 90  // 下方数据框
  const procH = procTopH + procDataH

  // 两侧留出放置"工厂图标 + 卡车"
  const sideMargin = 110
  const minGap = 40
  // 预留：右侧总览框 260 + 间距 20；左侧原材料库存三角位置约 procW 宽
  const summaryReserve = 280
  const contentW = N * procW + (N - 1) * minGap + (rawInv ? procW : 0) + summaryReserve
  const W = Math.max(980, sideMargin * 2 + contentW)
  const H = 760

  // 三个纵向区域（顶 → 底）
  const infoZone = { x: 20, y: 15, w: W - 40, h: 150, color: '#84cc16', label: '信息流 Information flows' }
  const matZone  = { x: 20, y: 180, w: W - 40, h: 260, color: '#a855f7', label: '物料流 Material flows' }
  const ltZone   = { x: 20, y: 455, w: W - 40, h: 215, color: '#f97316', label: '交期阶梯 Lead time ladder' }

  // 工序布局（在物料流区内）
  const procY = matZone.y + 90
  // 预留右侧放总览框的宽度（Lead time ladder 区块右侧），这样工序分布也能避开该区域
  const summaryBoxW = 260
  const summaryRightMargin = 20
  const procXs = computeProcessXs(
    W,
    N,
    procW,
    sideMargin,
    rawInv ? procW + 20 : 0,
    summaryBoxW + summaryRightMargin,
  )

  const body = []

  // 标题
  body.push(
    `<text x="${W / 2}" y="12" text-anchor="middle" font-size="15" font-weight="700" fill="#111">` +
      `价值流图（VSM — Current State）` +
    `</text>`
  )

  // ========== 区域 1：信息流 ============================================
  body.push(dashZone(infoZone))

  // 供应商（左）/ 客户（右）/ 生产管制（中）
  const supplierBox = { x: infoZone.x + 40, y: infoZone.y + 30, w: 100, h: 70 }
  const customerBox = { x: infoZone.x + infoZone.w - 140, y: infoZone.y + 30, w: 100, h: 70 }
  const pcBox = { x: W / 2 - 80, y: infoZone.y + 20, w: 160, h: 55 }

  body.push(factoryIcon(supplierBox.x, supplierBox.y, supplierBox.w, supplierBox.h, supplier.name || '供应商'))
  body.push(factoryIcon(customerBox.x, customerBox.y, customerBox.w, customerBox.h, customer.name || '客户'))

  // 生产管制框（Production Control）
  body.push(
    `<rect x="${pcBox.x}" y="${pcBox.y}" width="${pcBox.w}" height="${pcBox.h}" ` +
      `fill="#fff" stroke="#333" stroke-width="1.2"/>`
  )
  body.push(
    `<text x="${pcBox.x + pcBox.w / 2}" y="${pcBox.y + 22}" text-anchor="middle" ` +
      `font-size="12" font-weight="600" fill="#333">生产管制</text>`
  )
  body.push(
    `<text x="${pcBox.x + pcBox.w / 2}" y="${pcBox.y + 40}" text-anchor="middle" ` +
      `font-size="10" fill="#666">Production Control</text>`
  )

  // 信息流箭头（订单流：客户 → PC → 供应商，方向"向左"）
  const infoY = pcBox.y + pcBox.h / 2
  // Customer → PC
  body.push(
    arrow(customerBox.x, infoY, pcBox.x + pcBox.w, infoY, '#555', false)
  )
  body.push(
    labelOnArrow((customerBox.x + pcBox.x + pcBox.w) / 2, infoY - 6,
      customer.orderFreq || customer.demand || '月度订单')
  )
  // PC → Supplier
  body.push(
    arrow(pcBox.x, infoY, supplierBox.x + supplierBox.w, infoY, '#555', false)
  )
  body.push(
    labelOnArrow((pcBox.x + supplierBox.x + supplierBox.w) / 2, infoY - 6,
      supplier.orderFreq || supplier.schedule || '周度订单')
  )

  // PC → 每道工序（信息流虚线向下）
  processes.forEach((_, i) => {
    const px = procXs[i] + procW / 2
    body.push(
      `<path d="M${pcBox.x + pcBox.w / 2} ${pcBox.y + pcBox.h} ` +
        `L${pcBox.x + pcBox.w / 2} ${infoZone.y + infoZone.h - 10} ` +
        `L${px} ${infoZone.y + infoZone.h - 10} ` +
        `L${px} ${matZone.y}" ` +
        `stroke="#888" stroke-width="0.8" stroke-dasharray="3,2" fill="none"/>`
    )
  })

  // ========== 区域 2：物料流 ============================================
  body.push(dashZone(matZone))

  // 卡车 — 入：供应商 → 物料流区；出：物料流区 → 客户
  const truckInX = matZone.x + 20
  const truckOutX = matZone.x + matZone.w - 70
  const truckY = procY + 10
  body.push(truckIcon(truckInX, truckY))
  body.push(
    `<text x="${truckInX + 25}" y="${truckY + 55}" text-anchor="middle" ` +
      `font-size="10" fill="#666">${esc(supplier.deliveryFreq || supplier.schedule || '每周')}</text>`
  )
  body.push(truckIcon(truckOutX, truckY))
  body.push(
    `<text x="${truckOutX + 25}" y="${truckY + 55}" text-anchor="middle" ` +
      `font-size="10" fill="#666">${esc(customer.shipFreq || customer.demand || '每日')}</text>`
  )

  // 大推动箭头：卡车-入 → 第一道工序；最后一道工序 → 卡车-出
  body.push(bigPushArrow(truckInX + 52, procY + procH / 2, procXs[0] - 4, procY + procH / 2))
  body.push(bigPushArrow(procXs[N - 1] + procW + 4, procY + procH / 2, truckOutX - 4, procY + procH / 2))

  // 原材料库存三角（在第一道工序左侧）
  if (rawInv) {
    const invX = procXs[0] - 60
    body.push(inventoryTriangle(invX, procY - 10, rawInv))
  }

  // 工序框（顶部：名 + 操作员 / 底部：数据）
  processes.forEach((p, i) => {
    const x = procXs[i]
    const y = procY
    // 外框
    body.push(
      `<rect x="${x}" y="${y}" width="${procW}" height="${procH}" fill="#fff" ` +
        `stroke="#333" stroke-width="1.2"/>`
    )
    // 顶部分隔线
    body.push(
      `<line x1="${x}" y1="${y + procTopH}" x2="${x + procW}" y2="${y + procTopH}" ` +
        `stroke="#333" stroke-width="0.8"/>`
    )
    // 工序名
    body.push(
      `<text x="${x + procW / 2}" y="${y + 18}" text-anchor="middle" ` +
        `font-size="12" font-weight="600" fill="#222">${esc(p.name || `工序${i + 1}`)}</text>`
    )
    // 操作员图标
    body.push(operatorIcon(x + procW / 2, y + procTopH - 8, p.operators || 1))

    // 数据表（2 列 × N 行）
    const rows = []
    if (p.ct != null) rows.push(['C/T', `${p.ct}${typeof p.ct === 'number' ? ' sec' : ''}`])
    if (p.co != null) rows.push(['C/O', String(p.co)])
    if (p.uptime != null) rows.push(['Uptime', formatPct(p.uptime)])
    else if (p.oee != null) rows.push(['OEE', formatPct(p.oee)])
    if (p.shifts != null) rows.push(['班次', `${p.shifts} Shifts`])
    if (p.secAvailable != null) rows.push(['可用', `${p.secAvailable} sec`])

    const rowH = Math.min(14, Math.floor((procDataH - 8) / Math.max(rows.length, 1)))
    const dataY = y + procTopH + 4
    rows.slice(0, 6).forEach((r, j) => {
      const ry = dataY + j * rowH + rowH - 3
      body.push(
        `<text x="${x + 6}" y="${ry}" font-size="10" fill="#555">${esc(r[0])}</text>`
      )
      body.push(
        `<text x="${x + procW - 6}" y="${ry}" text-anchor="end" ` +
          `font-size="10" fill="#222" font-weight="600">${esc(r[1])}</text>`
      )
    })
  })

  // 工序间：库存三角 + 推动条纹箭头
  for (let i = 0; i < N - 1; i++) {
    const x1 = procXs[i] + procW
    const x2 = procXs[i + 1]
    // 条纹推动箭头（下方中线）
    body.push(arrowStriped(x1 + 2, procY + procH / 2, x2 - 2, procY + procH / 2, '#444'))
    // 库存三角（上方）
    const midX = (x1 + x2) / 2
    body.push(inventoryTriangle(midX - 18, procY - 10, inventories[i]))
  }

  // ========== 区域 3：交期阶梯 =========================================
  body.push(dashZone(ltZone))

  const cts = processes.map(p => Number(p.ct) || 0)
  const invDays = inventories.map(inv => Number(inv && inv.days) || 0)
  // 若有原材料库存，加到 invDays 数组前面
  const ladderInv = rawInv ? [Number(rawInv.days) || 0, ...invDays] : invDays

  const totalLtDays = ladderInv.reduce((s, d) => s + d, 0)
  const totalVASec = cts.reduce((s, c) => s + c, 0)
  const ltDays = input.ltDays != null ? Number(input.ltDays) : totalLtDays + totalVASec / 86400
  const vaSec = input.vaSec != null ? Number(input.vaSec) : totalVASec
  const ratio = ltDays > 0 ? (vaSec / 86400) / ltDays : 0

  // 阶梯坐标：严格与 Material flow 的工序位置对齐
  //   · "下段"（processing / 谷）水平位置 = 工序框的 x 范围 [procXs[i], procXs[i]+procW]
  //   · "上段"（inventory / 峰）水平位置 = 相邻两工序之间的间隙，即库存三角所在位置
  //   · 若有 rawInventory：最左再加一段"上段"，对齐原材料库存三角下方
  const ladderTopY = ltZone.y + 40
  const ladderBotY = ltZone.y + 80

  const segments = []
  // 原材料库存"上段"（若有）：对齐第一道工序左侧的三角（三角默认画在 procXs[0]-60，size=30）
  if (rawInv) {
    const rawLeft = Math.max(ltZone.x + 10, procXs[0] - 80)
    segments.push({
      type: 'inv',
      x1: rawLeft,
      x2: procXs[0],
      label: `${invDays_safeDays(rawInv)} 天`,
    })
  }
  for (let i = 0; i < N; i++) {
    // 工序"下段"——严格对齐工序框左右边
    segments.push({
      type: 'proc',
      x1: procXs[i],
      x2: procXs[i] + procW,
      label: `${cts[i]} sec`,
    })
    if (i < N - 1) {
      // 工序间"上段"——严格对齐两工序之间的空隙（也就是库存三角所在处）
      segments.push({
        type: 'inv',
        x1: procXs[i] + procW,
        x2: procXs[i + 1],
        label: `${invDays[i]} 天`,
      })
    }
  }

  // 绘制阶梯：水平段 + 切换时的垂直连线
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]
    const y = s.type === 'inv' ? ladderTopY : ladderBotY
    // 水平段
    body.push(
      `<line x1="${s.x1}" y1="${y}" x2="${s.x2}" y2="${y}" ` +
        `stroke="#c2410c" stroke-width="1.6"/>`
    )
    // 垂直连接线（与前一段类型不同时）
    if (i > 0 && segments[i - 1].type !== s.type) {
      body.push(
        `<line x1="${s.x1}" y1="${ladderTopY}" x2="${s.x1}" y2="${ladderBotY}" ` +
          `stroke="#c2410c" stroke-width="1.6"/>`
      )
    }
    // 标签
    const labelY = s.type === 'inv' ? ladderTopY - 6 : ladderBotY + 14
    const labelColor = s.type === 'inv' ? '#b91c1c' : '#047857'
    body.push(
      `<text x="${(s.x1 + s.x2) / 2}" y="${labelY}" text-anchor="middle" ` +
        `font-size="10" fill="${labelColor}" font-weight="600">${esc(s.label)}</text>`
    )
  }

  // 总览框（放在阶梯下方右侧，不与 ladder 争夺横向空间）
  const sumW = summaryBoxW
  const sumX = ltZone.x + ltZone.w - sumW - 10
  const sumY = ladderBotY + 22
  body.push(
    `<rect x="${sumX}" y="${sumY}" width="${sumW}" height="85" ` +
      `fill="#fff" stroke="#333" stroke-width="1.2"/>`
  )
  body.push(
    `<text x="${sumX + 8}" y="${sumY + 20}" font-size="11" fill="#333">Production Lead Time</text>`
  )
  body.push(
    `<text x="${sumX + sumW - 8}" y="${sumY + 20}" text-anchor="end" ` +
      `font-size="13" font-weight="700" fill="#b91c1c">${ltDays.toFixed(2)} 天</text>`
  )
  body.push(
    `<line x1="${sumX + 8}" y1="${sumY + 32}" x2="${sumX + sumW - 8}" y2="${sumY + 32}" ` +
      `stroke="#ddd" stroke-width="0.8"/>`
  )
  body.push(
    `<text x="${sumX + 8}" y="${sumY + 50}" font-size="11" fill="#333">Processing Time</text>`
  )
  body.push(
    `<text x="${sumX + sumW - 8}" y="${sumY + 50}" text-anchor="end" ` +
      `font-size="13" font-weight="700" fill="#047857">${vaSec.toFixed(0)} sec</text>`
  )
  body.push(
    `<line x1="${sumX + 8}" y1="${sumY + 62}" x2="${sumX + sumW - 8}" y2="${sumY + 62}" ` +
      `stroke="#ddd" stroke-width="0.8"/>`
  )
  body.push(
    `<text x="${sumX + 8}" y="${sumY + 78}" font-size="11" fill="#333">VA Ratio</text>`
  )
  body.push(
    `<text x="${sumX + sumW - 8}" y="${sumY + 78}" text-anchor="end" font-size="12" ` +
      `font-weight="700" fill="${ratio < 0.05 ? '#b91c1c' : '#0369a1'}">${(ratio * 100).toFixed(3)}%</text>`
  )

  // 底部建议（放在 ltZone 下方）
  const noteY = Math.min(ltZone.y + ltZone.h + 15, H - 8)
  body.push(
    `<text x="${W / 2}" y="${noteY}" text-anchor="middle" font-size="11" fill="#555">` +
      `${ratio < 0.05 ? '⚠ VA Ratio < 5% — 流动改善潜力大，优先削减库存等待' : '✓ VA Ratio 处于健康区间'}` +
    `</text>`
  )

  return { svg: svgWrap(W, H, body.join(''), 'VSM') }
}

// -- VSM helpers -----------------------------------------------------------

function invDays_safeDays(inv) {
  const d = inv && Number(inv.days)
  return Number.isFinite(d) ? d : 0
}

function computeProcessXs(W, N, procW, sideMargin, rawOffset, rightReserve = 0) {
  const avail = W - sideMargin * 2 - rawOffset - rightReserve
  const gap = N > 1 ? (avail - N * procW) / (N - 1) : 0
  const xs = []
  for (let i = 0; i < N; i++) {
    xs.push(sideMargin + rawOffset + i * (procW + gap))
  }
  return xs
}

function dashZone(z) {
  return (
    `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" ` +
      `fill="none" stroke="${z.color}" stroke-width="1.2" stroke-dasharray="6,3"/>` +
    `<text x="${z.x + 12}" y="${z.y + 16}" font-size="11" font-weight="600" fill="${z.color}">` +
      `${esc(z.label)}</text>`
  )
}

function factoryIcon(x, y, w, h, label) {
  // "齿形屋顶"厂房：3 连齿
  const toothW = w / 3
  const roofH = 14
  const out = []
  // 屋顶齿
  const pts = []
  pts.push(`${x},${y + roofH}`)
  for (let i = 0; i < 3; i++) {
    const bx = x + i * toothW
    pts.push(`${bx + toothW / 2},${y}`)
    pts.push(`${bx + toothW},${y + roofH}`)
  }
  out.push(
    `<polyline points="${pts.join(' ')}" fill="none" stroke="#333" stroke-width="1.2"/>`
  )
  // 主体
  out.push(
    `<rect x="${x}" y="${y + roofH}" width="${w}" height="${h - roofH}" ` +
      `fill="#fff" stroke="#333" stroke-width="1.2"/>`
  )
  // 门
  const doorW = w / 5
  out.push(
    `<rect x="${x + w / 2 - doorW / 2}" y="${y + h - 18}" width="${doorW}" height="18" ` +
      `fill="#333"/>`
  )
  // 标签
  out.push(
    `<text x="${x + w / 2}" y="${y + h + 14}" text-anchor="middle" ` +
      `font-size="11" font-weight="600" fill="#333">${esc(label)}</text>`
  )
  return out.join('')
}

function truckIcon(x, y) {
  // 简化卡车：货箱 + 车头 + 两轮
  return (
    // 货箱
    `<rect x="${x}" y="${y}" width="30" height="22" fill="#fff" stroke="#333" stroke-width="1"/>` +
    // 车头
    `<polygon points="${x + 30},${y + 6} ${x + 42},${y + 6} ${x + 48},${y + 14} ${x + 48},${y + 22} ${x + 30},${y + 22}" ` +
      `fill="#fff" stroke="#333" stroke-width="1"/>` +
    // 窗
    `<rect x="${x + 32}" y="${y + 8}" width="8" height="6" fill="#cbd5e1" stroke="#333" stroke-width="0.6"/>` +
    // 轮
    `<circle cx="${x + 8}" cy="${y + 24}" r="4" fill="#333"/>` +
    `<circle cx="${x + 40}" cy="${y + 24}" r="4" fill="#333"/>`
  )
}

function operatorIcon(cx, cy, count) {
  // 半圆 + 短横，LEI 经典操作员符号
  const out = []
  out.push(
    `<path d="M${cx - 6} ${cy} Q${cx} ${cy - 10} ${cx + 6} ${cy}" ` +
      `fill="none" stroke="#333" stroke-width="1.2"/>`
  )
  out.push(`<circle cx="${cx}" cy="${cy - 7}" r="2.5" fill="#333"/>`)
  if (count && count > 1) {
    out.push(
      `<text x="${cx + 10}" y="${cy + 2}" font-size="9" fill="#555">×${count}</text>`
    )
  }
  return out.join('')
}

function inventoryTriangle(x, y, inv) {
  // y 是三角底部中心附近；triangle 向上指
  const size = 30
  const cx = x + size / 2
  const cy = y + size / 2
  const pts =
    `${cx - size / 2},${cy + size / 2} ${cx + size / 2},${cy + size / 2} ${cx},${cy - size / 2}`
  const out = []
  out.push(
    `<polygon points="${pts}" fill="#fde68a" stroke="#b45309" stroke-width="1.2"/>`
  )
  out.push(
    `<text x="${cx}" y="${cy + 2}" text-anchor="middle" ` +
      `font-size="9" font-weight="700" fill="#92400e">I</text>`
  )
  const count = inv && (inv.count != null ? String(inv.count) : '—')
  const days = inv && inv.days != null ? `${inv.days} 天` : ''
  out.push(
    `<text x="${cx}" y="${cy + size / 2 + 12}" text-anchor="middle" ` +
      `font-size="9" fill="#555">${esc(count)}</text>`
  )
  if (days) {
    out.push(
      `<text x="${cx}" y="${cy + size / 2 + 23}" text-anchor="middle" ` +
        `font-size="9" fill="#888">${esc(days)}</text>`
    )
  }
  return out.join('')
}

function labelOnArrow(x, y, text) {
  return (
    `<text x="${x}" y="${y}" text-anchor="middle" font-size="10" fill="#444">` +
      `${esc(text)}</text>`
  )
}

function bigPushArrow(x1, y, x2, y2) {
  // 粗大推动块箭头（水平、右指）
  const h = 22
  const tipLen = 14
  const bodyW = Math.max(20, x2 - x1 - tipLen)
  if (x2 < x1) return ''
  const sx = x1
  const ex = x1 + bodyW
  const ty = y - h / 2
  const by = y + h / 2
  const tipX = ex + tipLen
  const pts =
    `${sx},${ty} ${ex},${ty} ${ex},${ty - 5} ${tipX},${y} ${ex},${by + 5} ${ex},${by} ${sx},${by}`
  return `<polygon points="${pts}" fill="#fff" stroke="#333" stroke-width="1.2"/>`
}

function box(x, y, w, h, title, lines, fill, stroke) {
  const out = []
  out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`)
  out.push(`<text x="${x + w / 2}" y="${y + 18}" text-anchor="middle" font-size="12" fill="${stroke}" font-weight="600">${esc(title)}</text>`)
  lines.forEach((l, i) => {
    out.push(`<text x="${x + w / 2}" y="${y + 36 + i * 14}" text-anchor="middle" font-size="10" fill="#333">${esc(l)}</text>`)
  })
  return out.join('')
}

function arrow(x1, y1, x2, y2, color, dashed) {
  const dash = dashed ? 'stroke-dasharray="3,2"' : ''
  return (
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.2" ${dash}/>` +
    `<polygon points="${x2},${y2 - 5} ${x2 + 8},${y2} ${x2},${y2 + 5}" fill="${color}"/>`
  )
}

function arrowStriped(x1, y1, x2, y2, color) {
  // 条纹箭头（推动）
  const segs = []
  const len = x2 - x1
  const stripes = Math.max(2, Math.floor(len / 8))
  for (let i = 0; i < stripes; i++) {
    const sx = x1 + (i / stripes) * len
    const ex = x1 + ((i + 0.5) / stripes) * len
    segs.push(`<line x1="${sx}" y1="${y1}" x2="${ex}" y2="${y2}" stroke="${color}" stroke-width="1.5"/>`)
  }
  segs.push(`<polygon points="${x2 - 6},${y2 - 5} ${x2},${y2} ${x2 - 6},${y2 + 5}" fill="${color}"/>`)
  return segs.join('')
}

function formatPct(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  if (n <= 1) return `${(n * 100).toFixed(0)}%`
  return `${n.toFixed(0)}%`
}

// ---- 4. 箱型图（Boxplot）-------------------------------------------------

function quartiles(arr) {
  const sorted = arr.filter(v => Number.isFinite(v)).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const pick = (p) => {
    const idx = (sorted.length - 1) * p
    const lo = Math.floor(idx), hi = Math.ceil(idx)
    if (lo === hi) return sorted[lo]
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
  }
  const q1 = pick(0.25), q2 = pick(0.5), q3 = pick(0.75)
  const iqr = q3 - q1
  const loFence = q1 - 1.5 * iqr
  const hiFence = q3 + 1.5 * iqr
  const inliers = sorted.filter(v => v >= loFence && v <= hiFence)
  const outliers = sorted.filter(v => v < loFence || v > hiFence)
  return {
    q1, q2, q3,
    min: inliers.length ? inliers[0] : sorted[0],
    max: inliers.length ? inliers[inliers.length - 1] : sorted[sorted.length - 1],
    outliers,
    n: sorted.length,
    mean: sorted.reduce((s, v) => s + v, 0) / sorted.length,
  }
}

function buildBoxplot(input) {
  const title = String(input.title || '箱型图')
  const yLabel = String(input.yLabel || '数值')
  const groups = Array.isArray(input.groups) ? input.groups : []
  if (groups.length === 0) return { error: 'groups 不能为空。每组需 { label, values: number[] }。' }

  const stats = groups.map(g => ({
    label: String(g.label || ''),
    values: Array.isArray(g.values) ? g.values.map(Number) : [],
    q: quartiles(Array.isArray(g.values) ? g.values.map(Number) : []),
  })).filter(g => g.q)
  if (stats.length === 0) return { error: 'groups 中没有有效数据。values 必须是数字数组。' }

  // 总体 min/max（含 outliers）
  let yMin = Infinity, yMax = -Infinity
  stats.forEach(s => {
    yMin = Math.min(yMin, s.q.min, ...s.q.outliers, s.q.q1)
    yMax = Math.max(yMax, s.q.max, ...s.q.outliers, s.q.q3)
  })
  const span = yMax - yMin || 1
  const yLo = yMin - span * 0.08
  const yHi = yMax + span * 0.08

  const W = Math.max(560, 100 + stats.length * 130)
  const H = 460
  const padL = 60, padR = 30, padT = 50, padB = 70
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const yToPx = v => padT + plotH - ((v - yLo) / (yHi - yLo)) * plotH

  const body = []
  body.push(`<text x="${W / 2}" y="22" text-anchor="middle" font-size="15" font-weight="600" fill="#222">${esc(title)}</text>`)

  // Y 轴网格 + 刻度
  const yTicks = 6
  for (let i = 0; i <= yTicks; i++) {
    const v = yLo + (i / yTicks) * (yHi - yLo)
    const y = yToPx(v)
    body.push(`<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#eee" stroke-width="1"/>`)
    body.push(`<text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#888">${formatNum(v)}</text>`)
  }
  body.push(`<text x="20" y="${padT - 8}" font-size="11" fill="#666">${esc(yLabel)}</text>`)

  // 每组箱子
  const boxW = (plotW - 40) / stats.length
  stats.forEach((g, i) => {
    const cx = padL + 20 + boxW * (i + 0.5)
    const bw = Math.min(boxW * 0.5, 60)
    const q = g.q
    const yQ1 = yToPx(q.q1), yQ2 = yToPx(q.q2), yQ3 = yToPx(q.q3)
    const yMin = yToPx(q.min), yMax = yToPx(q.max)
    const color = PALETTE[i % PALETTE.length]
    // 须
    body.push(`<line x1="${cx}" y1="${yMax}" x2="${cx}" y2="${yMin}" stroke="${color}" stroke-width="1"/>`)
    body.push(`<line x1="${cx - bw / 4}" y1="${yMax}" x2="${cx + bw / 4}" y2="${yMax}" stroke="${color}" stroke-width="1.2"/>`)
    body.push(`<line x1="${cx - bw / 4}" y1="${yMin}" x2="${cx + bw / 4}" y2="${yMin}" stroke="${color}" stroke-width="1.2"/>`)
    // 箱
    body.push(`<rect x="${cx - bw / 2}" y="${yQ3}" width="${bw}" height="${yQ1 - yQ3}" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="1.5"/>`)
    // 中位数
    body.push(`<line x1="${cx - bw / 2}" y1="${yQ2}" x2="${cx + bw / 2}" y2="${yQ2}" stroke="${color}" stroke-width="2"/>`)
    // 离群点
    q.outliers.forEach(v => {
      body.push(`<circle cx="${cx}" cy="${yToPx(v)}" r="3" fill="none" stroke="${color}" stroke-width="1.2"/>`)
    })
    // 标签
    body.push(`<text x="${cx}" y="${padT + plotH + 16}" text-anchor="middle" font-size="11" fill="#333">${esc(g.label)}</text>`)
    body.push(`<text x="${cx}" y="${padT + plotH + 32}" text-anchor="middle" font-size="9" fill="#888">n=${q.n} · μ=${formatNum(q.mean)}</text>`)
  })

  // 边框
  body.push(`<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="#333"/>`)
  body.push(`<line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="#333"/>`)

  return { svg: svgWrap(W, H, body.join(''), title) }
}

function formatNum(n) {
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1000) return n.toFixed(0)
  if (Math.abs(n) >= 10) return n.toFixed(1)
  return n.toFixed(2)
}

// ---- 工具定义 --------------------------------------------------------------

const tools = [
  {
    name: 'fishbone',
    description:
      '生成 5M1E 鱼骨图（Ishikawa）SVG。当根因分析需要可视化、或诊断流程进入 ANALYZE/CONFIRM 阶段时调用。' +
      'input.problem 是问题陈述（鱼头），input.branches 是各类别 + 子原因清单。' +
      '常用类别：人 / 机 / 料 / 法 / 环 / 测（5M1E）。' +
      '若用户消息中已贴入上传的 xls/xlsx/csv 数据预览（CSV 代码块），请按类别汇总原因后调用本工具。',
    inputSchema: {
      type: 'object',
      properties: {
        problem: { type: 'string', description: '问题陈述（如"焊接节拍超标 30%"），将显示在鱼头框内' },
        branches: {
          type: 'array',
          description: '5M1E 类别下的根因分支（建议 4-6 条；每条 2-4 个子原因）',
          items: {
            type: 'object',
            properties: {
              category: {
                type: 'string',
                description: '类别（建议从 人/机/料/法/环/测 中选）',
              },
              causes: {
                type: 'array',
                description: '该类别下的子原因列表',
                items: { type: 'string' },
              },
            },
            required: ['category', 'causes'],
          },
        },
      },
      required: ['problem', 'branches'],
    },
    async execute(input) {
      const r = buildFishbone(input)
      if (r.error) return { content: r.error, isError: true }
      return {
        content:
          `已生成鱼骨图（5M1E），包含 ${input.branches.length} 个分支：` +
          input.branches.map(b => `${b.category}(${(b.causes || []).length})`).join(' / ') + '。',
        artifact: { type: 'svg', data: r.svg, mimeType: 'image/svg+xml' },
      }
    },
  },

  {
    name: 'pareto',
    description:
      '生成 Pareto 柏拉图（频次降序柱状 + 累计% 折线 + 80% 参考线）SVG。用于定位关键少数（如 Top 缺陷模式 / Top 停机原因 / Top 客户投诉类别）。' +
      'input.items 自动按 count 降序排序。' +
      '若用户消息中已贴入上传的 xls/xlsx/csv 数据预览（CSV 代码块），请将类别列与频次列映射到 items 调用本工具。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '图表标题（如"焊接缺陷 Pareto 分析"）' },
        yLabel: { type: 'string', description: 'Y 轴标签（默认"频次"）' },
        items: {
          type: 'array',
          description: '类别频次数据（自动按 count 降序）',
          items: {
            type: 'object',
            properties: {
              category: { type: 'string', description: '类别名称（如"焊枪故障"）' },
              count: { type: 'number', description: '频次/次数/金额，应 ≥ 0' },
            },
            required: ['category', 'count'],
          },
        },
      },
      required: ['items'],
    },
    async execute(input) {
      const r = buildPareto(input)
      if (r.error) return { content: r.error, isError: true }
      // 计算前 80% 关键少数
      const data = input.items.slice().sort((a, b) => b.count - a.count)
      const total = data.reduce((s, d) => s + d.count, 0)
      let cum = 0, keyN = 0
      for (let i = 0; i < data.length; i++) {
        cum += data[i].count
        keyN++
        if (cum / total >= 0.8) break
      }
      return {
        content:
          `已生成 Pareto 图，共 ${data.length} 个类别，总计 ${total}。` +
          `前 ${keyN} 项即覆盖 80% — 这是改善的关键少数。`,
        artifact: { type: 'svg', data: r.svg, mimeType: 'image/svg+xml' },
      }
    },
  },

  {
    name: 'vsm',
    description:
      '生成 Lean Enterprise Institute 标准价值流图（VSM, Current State Map）SVG。三区布局：' +
      '① 信息流区（客户 ↔ 生产管制 ↔ 供应商，订单流向）；' +
      '② 物料流区（卡车 → 工序框[含操作员图标]→ 库存三角 → 卡车，工序间条纹推动箭头）；' +
      '③ 交期阶梯（Lead Time Ladder：上沿=库存天数（峰，严格对齐相邻工序之间的库存三角）、下沿=加工秒数（谷，严格对齐对应工序框），右侧汇总 Production Lead Time / Processing Time / VA Ratio）。' +
      'input.processes 按从原材料到成品的顺序排列，input.inventories[i] 是 processes[i] 与 processes[i+1] 之间的库存（长度应 = processes.length - 1）。' +
      '可选 input.rawInventory 在第一道工序之前额外画一个原材料库存三角。' +
      '若用户消息中已贴入上传的 xls/xlsx/csv 数据预览（CSV 代码块，例如工序工艺时间表），请把 name/ct/co/uptime/operators 等映射到 processes 后调用本工具。',
    inputSchema: {
      type: 'object',
      properties: {
        customer: {
          type: 'object',
          description: '客户信息（画在信息流区右上）',
          properties: {
            name: { type: 'string', description: '客户名' },
            demand: { type: 'string', description: '需求节奏（如"480 件/天"）' },
            orderFreq: { type: 'string', description: '订单频次（如"月度订单"），作为 Customer→PC 箭头标签' },
            shipFreq: { type: 'string', description: '发货频次（如"每日"），作为出库卡车下方标签' },
          },
        },
        supplier: {
          type: 'object',
          description: '供应商信息（画在信息流区左上）',
          properties: {
            name: { type: 'string', description: '供应商名' },
            schedule: { type: 'string', description: '送货频次（如"每周一"）' },
            orderFreq: { type: 'string', description: '订单频次（如"周度订单"），作为 PC→Supplier 箭头标签' },
            deliveryFreq: { type: 'string', description: '交付频次（如"每周"），作为入库卡车下方标签' },
          },
        },
        processes: {
          type: 'array',
          description: '工序列表（按物料流向从左到右排序）',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '工序名（如"下料"/"焊接"/"装配"）' },
              ct: { type: 'number', description: 'Cycle Time 循环时间（秒）' },
              co: { type: 'string', description: 'Changeover 换型时间（如"15 min"）' },
              uptime: { type: 'number', description: '设备可用率（0-1 或 0-100），优先显示' },
              oee: { type: 'number', description: 'OEE 综合效率（0-1 或 0-100），当 uptime 缺失时显示' },
              shifts: { type: 'number', description: '班次数量（如 2 表示两班两运转）' },
              secAvailable: { type: 'number', description: '每日可用秒数（如 27000 sec）' },
              operators: { type: 'number', description: '工位人数（会在操作员图标旁显示 ×N）' },
            },
            required: ['name'],
          },
        },
        inventories: {
          type: 'array',
          description: '工序间库存（长度 = processes.length - 1；第 i 项在 processes[i] 与 processes[i+1] 之间）',
          items: {
            type: 'object',
            properties: {
              count: { type: 'string', description: '在制品数量（如"300 件"或"1202"）' },
              days: { type: 'number', description: '等效库存天数' },
            },
          },
        },
        rawInventory: {
          type: 'object',
          description: '可选：原材料库存（画在第一道工序之前）',
          properties: {
            count: { type: 'string' },
            days: { type: 'number' },
          },
        },
        ltDays: { type: 'number', description: '总制造周期（天）；不填则按 inventories.days 之和 + ct 估算' },
        vaSec: { type: 'number', description: '总增值时间（秒）；不填则按 processes.ct 求和' },
      },
      required: ['processes'],
    },
    async execute(input) {
      const r = buildVSM(input)
      if (r.error) return { content: r.error, isError: true }
      const procCount = input.processes.length
      return {
        content:
          `已生成 VSM 图（${procCount} 个工序）。` +
          `Lead Time = ${input.ltDays != null ? input.ltDays + ' 天' : '估算值'}，` +
          `VA Time = ${input.vaSec != null ? input.vaSec + ' 秒' : '估算值'}。`,
        artifact: { type: 'svg', data: r.svg, mimeType: 'image/svg+xml' },
      }
    },
  },

  {
    name: 'boxplot',
    description:
      '生成箱型图（Boxplot）SVG，每组显示 Q1/中位数/Q3 箱体 + 1.5×IQR 须 + 离群点。用于对比多组数据的中心趋势与离散程度（如三班次缺陷率分布、不同机台 Cpk 对比）。' +
      '若用户消息中已贴入上传的 xls/xlsx/csv 数据预览（CSV 代码块），请按"分组列"汇总样本值到对应 groups[].values 后调用本工具。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '图表标题' },
        yLabel: { type: 'string', description: 'Y 轴标签（如"缺陷率 %"）' },
        groups: {
          type: 'array',
          description: '分组数据',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: '组名（如"白班"/"机台 A"）' },
              values: {
                type: 'array',
                description: '该组的样本值（建议 5+ 个数据点）',
                items: { type: 'number' },
              },
            },
            required: ['label', 'values'],
          },
        },
      },
      required: ['groups'],
    },
    async execute(input) {
      const r = buildBoxplot(input)
      if (r.error) return { content: r.error, isError: true }
      const total = input.groups.reduce((s, g) => s + (Array.isArray(g.values) ? g.values.length : 0), 0)
      return {
        content: `已生成箱型图，共 ${input.groups.length} 组，总样本数 ${total}。`,
        artifact: { type: 'svg', data: r.svg, mimeType: 'image/svg+xml' },
      }
    },
  },
]

module.exports = {
  default: {
    packageName: '@lean-ai/skill-charts',
    displayName: '图表生成',
    description: '4 类精益常用图表（鱼骨 / Pareto / VSM / 箱型）的纯 SVG 生成器',
    version: '1.0.0',
    tools,
  },
}
