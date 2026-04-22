/**
 * @lean-ai/skill-diagnosis
 *
 * 精益诊断技能：把一次诊断会话拆分为 6 个阶段的状态机，每一阶段对应一个工具。
 * LLM 读每个工具的返回文本决定下一步调用什么工具、或向用户追问什么问题。
 *
 *   INIT → CLASSIFY → PROBE → ANALYZE → CONFIRM → SOLUTION
 *                                              ↑
 *                                  （用户确认根因后进入 SOLUTION）
 *
 * 会话状态以 JSON 存在 skill_data 表中（key: "sess:<convId>"），跨工具调用保持。
 */

const STAGES = {
  INIT: 'INIT',
  CLASSIFY: 'CLASSIFY',
  PROBE: 'PROBE',
  ANALYZE: 'ANALYZE',
  CONFIRM: 'CONFIRM',
  SOLUTION: 'SOLUTION',
}

const STAGE_ORDER = [STAGES.INIT, STAGES.CLASSIFY, STAGES.PROBE, STAGES.ANALYZE, STAGES.CONFIRM, STAGES.SOLUTION]

// ---- 会话存取 ---------------------------------------------------------------

function sessionKey(convId) {
  return `sess:${convId}`
}

function getSession(ctx) {
  return ctx.data.getJSON(sessionKey(ctx.conversationId)) || { stage: STAGES.INIT }
}

function saveSession(ctx, session) {
  ctx.data.setJSON(sessionKey(ctx.conversationId), session)
}

function stageLabel(stage) {
  const map = {
    INIT: '起始', CLASSIFY: '分类', PROBE: '探查',
    ANALYZE: '分析', CONFIRM: '确认', SOLUTION: '方案',
  }
  return map[stage] || stage
}

function stageBadge(current) {
  return STAGE_ORDER.map(s => {
    const isCurrent = s === current
    const idx = STAGE_ORDER.indexOf(s)
    const currentIdx = STAGE_ORDER.indexOf(current)
    const done = idx < currentIdx
    const mark = done ? '✓' : isCurrent ? '●' : '○'
    return `${mark} ${stageLabel(s)}`
  }).join('  →  ')
}

// ---- 4 类问题的探查模板 ------------------------------------------------------

const PROBE_TEMPLATES = {
  efficiency: {
    label: '效率问题',
    focus: '节拍时间 / OEE / 设备停机 / 产能瓶颈',
    questions: [
      { key: 'takt_time', prompt: '当前节拍时间（Takt Time）是多少秒/件？客户需求节拍多少秒/件？' },
      { key: 'cycle_time', prompt: '各工序循环时间（Cycle Time）分别是多少？哪一工序最长？' },
      { key: 'oee', prompt: 'OEE 综合效率多少？其中可用率 / 性能 / 质量各多少？' },
      { key: 'bottleneck_station', prompt: '瓶颈工序在哪里？停机主要发生在哪些环节？' },
      { key: 'downtime_reasons', prompt: '非计划停机的 Top 3 原因是什么？每天合计停机时长？' },
      { key: 'changeover', prompt: '换型时间是多少？每天换型频次？' },
    ],
  },
  quality: {
    label: '质量问题',
    focus: '良品率 / 返工率 / 客户投诉 / SPC',
    questions: [
      { key: 'defect_rate', prompt: '目标良品率 vs 实际良品率分别是多少？' },
      { key: 'top_defects', prompt: 'Top 3 缺陷模式是什么？占比各多少？' },
      { key: 'defect_location', prompt: '缺陷主要出现在哪个工序 / 哪条线 / 哪个班次？' },
      { key: 'rework_rate', prompt: '返工率多少？返工主要发生在哪？' },
      { key: 'customer_complaints', prompt: '近 3 个月客户投诉次数？主要投诉内容？' },
      { key: 'cpk', prompt: '关键 CTQ 特性的 Cpk 值是多少？是否有 SPC 监控？' },
    ],
  },
  inventory: {
    label: '库存问题',
    focus: '积压 / 周转率 / WIP / VSM',
    questions: [
      { key: 'inventory_value', prompt: '原材料 / WIP / 成品 三类库存金额与占比各多少？' },
      { key: 'turnover', prompt: '库存周转率是多少？行业标杆值是多少？' },
      { key: 'dio', prompt: '库存周转天数（DIO）是多少？' },
      { key: 'wip_bottleneck', prompt: '在制品主要堆积在哪个工序前？数量多少？' },
      { key: 'slow_moving', prompt: '呆滞料金额占比多少？最老的料龄多久？' },
      { key: 'forecast_accuracy', prompt: '需求预测准确度多少？拉动 vs 推动？' },
    ],
  },
  delivery: {
    label: '交期问题',
    focus: '准交率 / 计划准确度 / 插单 / 均衡生产',
    questions: [
      { key: 'on_time_rate', prompt: '订单准交率（OTD）当前 vs 目标分别多少？' },
      { key: 'lead_time', prompt: '制造周期（Manufacturing Lead Time）是多少天？客户承诺交期多少天？' },
      { key: 'plan_accuracy', prompt: '排产计划 vs 实际达成的偏差率是多少？' },
      { key: 'rush_orders', prompt: '插单 / 改单的频次和占比？' },
      { key: 'queue_time', prompt: '订单在系统中排队等待的时间占总周期多少？' },
      { key: 'delay_reasons', prompt: '延期订单的 Top 3 原因（缺料 / 设备 / 质量 / 计划 / 人员）？' },
    ],
  },
}

function renderProbeTemplate(type) {
  const tpl = PROBE_TEMPLATES[type]
  if (!tpl) return null
  const lines = tpl.questions.map((q, i) => `${i + 1}. **${q.prompt}**`).join('\n')
  return `## ${tpl.label}探查清单\n\n**关注维度**: ${tpl.focus}\n\n${lines}\n\n请引导用户逐项提供数据，无法提供的标注"未知"。收齐后调用 \`diag_probe\` 提交。`
}

// ---- 工具实现 ---------------------------------------------------------------

const tools = [
  {
    name: 'start',
    description: '启动精益诊断。当用户首次描述一个生产问题（产能/质量/库存/交期相关）时调用。会记录初始问题描述并进入分类阶段。input.problem 传入用户的问题原文。',
    inputSchema: {
      type: 'object',
      properties: {
        problem: {
          type: 'string',
          description: '用户描述的问题原文（保留关键数据和上下文）',
        },
      },
      required: ['problem'],
    },
    async execute(input, ctx) {
      const problem = String(input.problem || '').trim()
      if (!problem) {
        return { content: '问题描述为空。请先获取用户的问题描述再调用本工具。', isError: true }
      }

      const session = {
        stage: STAGES.CLASSIFY,
        problem,
        startedAt: Date.now(),
      }
      saveSession(ctx, session)
      ctx.log('info', `诊断会话已启动: "${problem.slice(0, 50)}..."`)

      const content = `诊断会话已启动。

**当前阶段**：CLASSIFY（分类）
**问题记录**：${problem}

下一步：根据用户问题判断属于以下哪一类（若信息不足可简要追问一句），然后调用 \`diag_classify\` 传入 type。

- **efficiency**（效率）：节拍超标、OEE 低、产能不足、停机多
- **quality**（质量）：良品率低、返工率高、客户投诉
- **inventory**（库存）：积压、周转慢、WIP 过多
- **delivery**（交期）：延迟、准交率低、插单频繁`

      return {
        content,
        artifact: {
          type: 'markdown',
          data: `### 🩺 诊断流程\n\n${stageBadge(STAGES.CLASSIFY)}\n\n**原始问题**\n> ${problem}`,
        },
      }
    },
  },

  {
    name: 'classify',
    description: '对问题进行分类并进入探查阶段。input.type 取值：efficiency / quality / inventory / delivery。调用后会返回该类问题的探查清单，你应该据此向用户收集具体数据。',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['efficiency', 'quality', 'inventory', 'delivery'],
          description: '问题分类',
        },
        reasoning: {
          type: 'string',
          description: '分类依据（可选，简短说明为什么归入该类）',
        },
      },
      required: ['type'],
    },
    async execute(input, ctx) {
      const type = input.type
      const session = getSession(ctx)

      if (!session.problem) {
        return { content: '尚未启动诊断会话。请先调用 diag_start 记录问题描述。', isError: true }
      }
      if (!PROBE_TEMPLATES[type]) {
        return { content: `未知分类: ${type}。支持: efficiency / quality / inventory / delivery。`, isError: true }
      }

      session.stage = STAGES.PROBE
      session.type = type
      if (input.reasoning) session.classifyReasoning = String(input.reasoning)
      saveSession(ctx, session)

      const tpl = PROBE_TEMPLATES[type]
      const template = renderProbeTemplate(type)

      const content = `已分类为「${tpl.label}」。

**当前阶段**：PROBE（探查）

接下来请按照下方清单向用户逐项询问（建议一次问 2–3 项避免轰炸）。**收集到足够数据后调用 \`diag_probe\`** 提交汇总。

${template}`

      return {
        content,
        artifact: {
          type: 'markdown',
          data: `### 🩺 诊断流程\n\n${stageBadge(STAGES.PROBE)}\n\n**分类结果**：${tpl.label}（${tpl.focus}）${input.reasoning ? `\n\n**依据**：${input.reasoning}` : ''}`,
        },
      }
    },
  },

  {
    name: 'probe',
    description: '提交从用户处收集到的探查数据。input.data 是一个对象，key 对应探查清单中的 key（如 takt_time、defect_rate），value 是用户的回答字符串（缺失的项可省略或填"未知"）。提交后进入分析阶段。',
    inputSchema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description: '收集到的数据，key 对应探查清单项，value 为用户回答（字符串）',
          additionalProperties: true,
        },
        summary: {
          type: 'string',
          description: '对收集到的数据的一段中文总结（便于下游分析）',
        },
      },
      required: ['data'],
    },
    async execute(input, ctx) {
      const session = getSession(ctx)
      if (!session.type) {
        return { content: '尚未分类。请先调用 diag_classify 指定问题类型。', isError: true }
      }

      const data = input.data || {}
      const tpl = PROBE_TEMPLATES[session.type]
      const filled = Object.keys(data).filter(k => {
        const v = data[k]
        return v != null && String(v).trim() !== '' && String(v).trim() !== '未知'
      })
      const coverage = filled.length / tpl.questions.length

      session.stage = STAGES.ANALYZE
      session.probeData = data
      if (input.summary) session.probeSummary = String(input.summary)
      saveSession(ctx, session)

      // 形成一个可供 UI 展示 / LLM 复读的表格
      const rows = tpl.questions.map(q => {
        const ans = data[q.key]
        return [q.prompt, ans == null || String(ans).trim() === '' ? '（未收集）' : String(ans)]
      })

      const warning = coverage < 0.5
        ? '\n\n⚠️ **数据覆盖率偏低**（<50%），分析置信度可能受限。若用户方便请补充关键指标。'
        : ''

      const content = `探查数据已记录（覆盖率 ${Math.round(coverage * 100)}%）。

**当前阶段**：ANALYZE（分析）${warning}

下一步：调用 \`diag_analyze\` 触发根因分析。分析将基于已记录的问题描述 + 分类 + 探查数据综合输出（5 Why / 鱼骨图角度）。`

      return {
        content,
        artifact: {
          type: 'table',
          data: {
            columns: ['探查项', '用户回答'],
            rows,
          },
        },
      }
    },
  },

  {
    name: 'analyze',
    description: '基于已收集的问题描述、分类、探查数据执行根因分析。使用前必须已调用过 diag_probe。本工具由 LLM 给出根因列表，工具负责结构化存档并转入确认阶段。input.root_causes 是一个数组，每项包含 cause / evidence / confidence。',
    inputSchema: {
      type: 'object',
      properties: {
        root_causes: {
          type: 'array',
          description: '根因列表（按置信度降序）',
          items: {
            type: 'object',
            properties: {
              cause: { type: 'string', description: '根因简述' },
              category: {
                type: 'string',
                enum: ['人', '机', '料', '法', '环', '测'],
                description: '鱼骨图分类（5M1E）',
              },
              evidence: { type: 'string', description: '支撑该根因的探查数据或事实' },
              confidence: {
                type: 'string',
                enum: ['高', '中', '低'],
                description: '置信度',
              },
            },
            required: ['cause', 'evidence', 'confidence'],
          },
        },
        hypothesis: {
          type: 'string',
          description: '一句话总结（如："效率问题主要由 XX 工序换型时间过长 + YY 设备 OEE 低双重导致"）',
        },
      },
      required: ['root_causes'],
    },
    async execute(input, ctx) {
      const session = getSession(ctx)
      if (!session.probeData) {
        return { content: '尚无探查数据。请先调用 diag_probe 提交探查数据。', isError: true }
      }

      const causes = Array.isArray(input.root_causes) ? input.root_causes : []
      if (causes.length === 0) {
        return { content: 'root_causes 不能为空。请至少给出 1 条根因。', isError: true }
      }

      session.stage = STAGES.CONFIRM
      session.analysis = {
        causes,
        hypothesis: input.hypothesis || '',
        at: Date.now(),
      }
      saveSession(ctx, session)

      const rows = causes.map((c, i) => [
        `${i + 1}`,
        c.cause || '',
        c.category || '—',
        c.confidence || '中',
        c.evidence || '',
      ])

      const content = `根因分析已记录（${causes.length} 条）。

**当前阶段**：CONFIRM（确认）
${input.hypothesis ? `\n**核心假设**：${input.hypothesis}\n` : ''}

下一步：将分析结果呈现给用户确认。用户确认（或调整）后，调用 \`diag_solve\` 生成改善方案；你可以在 confirmed 参数中传入被用户确认的根因 id 列表。`

      return {
        content,
        artifact: {
          type: 'table',
          data: {
            columns: ['#', '根因', '5M1E', '置信度', '证据'],
            rows,
          },
        },
      }
    },
  },

  {
    name: 'solve',
    description: '基于用户确认的根因生成改善方案（优先级 / 责任 / 预期效果）。应在用户确认根因后调用。input.actions 是一个数组，每项包含 title / target_cause / priority / owner / expected_impact / due_in_days。',
    inputSchema: {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          description: '改善动作清单（按优先级降序）',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: '动作标题（动词开头）' },
              target_cause: { type: 'string', description: '针对的根因' },
              priority: {
                type: 'string',
                enum: ['高', '中', '低'],
                description: '优先级',
              },
              owner: { type: 'string', description: '建议责任方（部门/角色）' },
              expected_impact: { type: 'string', description: '预期量化效果' },
              due_in_days: { type: 'number', description: '建议完成天数' },
              tools: {
                type: 'array',
                description: '推荐使用的精益工具（如 SMED/TPM/5S/Kanban 等）',
                items: { type: 'string' },
              },
            },
            required: ['title', 'priority'],
          },
        },
        summary: {
          type: 'string',
          description: '方案整体总结（1–2 段）',
        },
      },
      required: ['actions'],
    },
    async execute(input, ctx) {
      const session = getSession(ctx)
      if (!session.analysis) {
        return { content: '尚无分析结果。请先调用 diag_analyze 得出根因。', isError: true }
      }

      const actions = Array.isArray(input.actions) ? input.actions : []
      if (actions.length === 0) {
        return { content: 'actions 不能为空。请至少给出 1 条改善动作。', isError: true }
      }

      session.stage = STAGES.SOLUTION
      session.solution = {
        actions,
        summary: input.summary || '',
        at: Date.now(),
      }
      session.completedAt = Date.now()
      saveSession(ctx, session)

      const rows = actions.map((a, i) => [
        `${i + 1}`,
        a.title || '',
        a.priority || '中',
        a.target_cause || '—',
        a.owner || '—',
        a.due_in_days != null ? `${a.due_in_days} 天` : '—',
        a.expected_impact || '—',
        (a.tools || []).join(', ') || '—',
      ])

      const content = `改善方案已生成（共 ${actions.length} 项动作）。

**当前阶段**：SOLUTION（方案）— 诊断流程完成 ✅
${input.summary ? `\n**方案摘要**：${input.summary}\n` : ''}

建议下一步：与用户确认方案优先级、责任人、时间表。如需导出 8D / DMAIC 报告，可提示用户（后续 skill-reports 会支持）。`

      return {
        content,
        artifact: {
          type: 'table',
          data: {
            columns: ['#', '动作', '优先级', '针对根因', '责任方', '周期', '预期效果', '精益工具'],
            rows,
          },
        },
      }
    },
  },
]

module.exports = {
  default: {
    packageName: '@lean-ai/skill-diagnosis',
    displayName: '精益诊断',
    description: '6 阶段状态机驱动的系统化精益诊断（分类 → 探查 → 分析 → 方案）',
    version: '1.0.0',
    tools,
  },
}
