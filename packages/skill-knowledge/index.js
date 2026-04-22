/**
 * @lean-ai/skill-knowledge
 *
 * 精益知识库技能：
 *   - 内置 10 篇核心精益方法论文档（onActivate 时幂等播种到 SQLite）
 *   - LLM 通过 kb_search 检索相关条目；kb_list 浏览；kb_add 让用户/LLM 沉淀新知识
 *
 * 检索策略（MVP）：
 *   - CJK 双字符 bigram + ASCII 词袋分词
 *   - 标题命中权重 ×3，正文命中权重 ×1
 *   - 提取首个命中位置 ±100 字符的 snippet 作为预览
 *   - 全表加载后内存打分（适合 <1000 文档；上规模再换 FTS5/向量）
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

// ---- 数据库 schema ----------------------------------------------------------

const TABLE_SQL = `
CREATE TABLE IF NOT EXISTS kb_entries (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'user',
  tags        TEXT NOT NULL DEFAULT '[]',
  content     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kb_entries_source ON kb_entries(source);
CREATE INDEX IF NOT EXISTS idx_kb_entries_created ON kb_entries(created_at DESC);
`

function ensureSchema(db) {
  db.exec(TABLE_SQL)
}

// ---- 分词与检索打分 --------------------------------------------------------

/**
 * 把任意中英文文本切成 token 集合：
 *   - 英文/数字：连续字母数字片段（≥2 字符）小写化后入袋
 *   - 中文：从每段连续 CJK 字符中取所有 bigram；单字段也保留单字
 */
function tokenize(text) {
  if (!text) return new Set()
  const lower = String(text).toLowerCase()
  const tokens = new Set()

  // ASCII 词
  const wordRe = /[a-z0-9]+/g
  let m
  while ((m = wordRe.exec(lower)) !== null) {
    if (m[0].length >= 2) tokens.add(m[0])
  }

  // CJK 段
  const cjkSegRe = /[\u4e00-\u9fff]+/g
  while ((m = cjkSegRe.exec(lower)) !== null) {
    const seg = m[0]
    if (seg.length === 1) {
      tokens.add(seg)
    } else {
      for (let i = 0; i < seg.length - 1; i++) {
        tokens.add(seg.slice(i, i + 2))
      }
    }
  }

  return tokens
}

function scoreEntry(qTokens, entry) {
  if (qTokens.size === 0) return 0
  const titleSet = tokenize(entry.title)
  const tagSet = tokenize(entry.tags) // tags 是 JSON 字符串，分词后也算 title 级权重
  const bodySet = tokenize(entry.content)
  let score = 0
  for (const t of qTokens) {
    if (titleSet.has(t)) score += 3
    else if (tagSet.has(t)) score += 2
    else if (bodySet.has(t)) score += 1
  }
  return score
}

/**
 * 提取首个命中位置 ±100 字符的预览 snippet。
 * 命中查找用原始字符串 indexOf（对中文同样适用）。
 */
function makeSnippet(content, queryRaw, len = 100) {
  if (!content) return ''
  const norm = content.replace(/\s+/g, ' ').trim()
  if (!queryRaw) return norm.slice(0, len * 2) + (norm.length > len * 2 ? '…' : '')

  // 切出查询里的关键片段（去标点、留 2-6 字汉字段或英文词）
  const candidates = []
  const cjkRe = /[\u4e00-\u9fff]{2,}/g
  let m
  while ((m = cjkRe.exec(queryRaw)) !== null) candidates.push(m[0])
  const enRe = /[a-zA-Z][a-zA-Z0-9]+/g
  while ((m = enRe.exec(queryRaw)) !== null) candidates.push(m[0])

  let bestPos = -1
  for (const c of candidates) {
    const p = norm.toLowerCase().indexOf(c.toLowerCase())
    if (p >= 0 && (bestPos < 0 || p < bestPos)) {
      bestPos = p
    }
  }
  if (bestPos < 0) {
    return norm.slice(0, len * 2) + (norm.length > len * 2 ? '…' : '')
  }
  const start = Math.max(0, bestPos - len)
  const end = Math.min(norm.length, bestPos + len)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < norm.length ? '…' : ''
  return `${prefix}${norm.slice(start, end)}${suffix}`
}

// ---- DB 助手 ---------------------------------------------------------------

function rowToEntry(row) {
  let tags = []
  try {
    tags = JSON.parse(row.tags || '[]')
    if (!Array.isArray(tags)) tags = []
  } catch { tags = [] }
  return {
    id: row.id,
    title: row.title,
    source: row.source,
    tags,
    content: row.content,
    created_at: row.created_at,
  }
}

function listAllEntries(db) {
  const rows = db.prepare('SELECT * FROM kb_entries ORDER BY created_at DESC').all()
  return rows.map(rowToEntry)
}

function insertEntry(db, entry) {
  db.prepare(
    'INSERT OR REPLACE INTO kb_entries (id, title, source, tags, content, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    entry.id,
    entry.title,
    entry.source || 'user',
    JSON.stringify(entry.tags || []),
    entry.content,
    entry.created_at || Date.now(),
  )
}

function entryExists(db, id) {
  return !!db.prepare('SELECT 1 FROM kb_entries WHERE id = ?').get(id)
}

function deleteEntry(db, id) {
  return db.prepare('DELETE FROM kb_entries WHERE id = ?').run(id).changes
}

// ---- 种子文档加载（onActivate 时幂等执行） --------------------------------

const FRONT_MATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/

function parseFrontMatter(raw) {
  const m = raw.match(FRONT_MATTER_RE)
  if (!m) return { meta: {}, body: raw }
  const metaBlock = m[1]
  const body = m[2].trim()
  const meta = {}
  // 极简 YAML：仅支持 key: value 与 key: [a, b, c]
  for (const line of metaBlock.split(/\r?\n/)) {
    const lm = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.+)$/)
    if (!lm) continue
    const key = lm[1]
    let val = lm[2].trim()
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val
        .slice(1, -1)
        .split(',')
        .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
    } else {
      val = val.replace(/^['"]|['"]$/g, '')
    }
    meta[key] = val
  }
  return { meta, body }
}

function loadSeeds(db, log) {
  const seedsDir = path.join(__dirname, 'seeds')
  if (!fs.existsSync(seedsDir)) {
    log && log('warn', `seeds 目录不存在: ${seedsDir}`)
    return { added: 0, skipped: 0 }
  }
  const files = fs.readdirSync(seedsDir).filter(f => f.endsWith('.md')).sort()
  let added = 0, skipped = 0
  for (const fname of files) {
    const id = `seed:${fname.replace(/\.md$/, '')}`
    if (entryExists(db, id)) { skipped++; continue }
    const raw = fs.readFileSync(path.join(seedsDir, fname), 'utf8')
    const { meta, body } = parseFrontMatter(raw)
    insertEntry(db, {
      id,
      title: meta.title || fname.replace(/\.md$/, ''),
      source: 'seed',
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      content: body,
      created_at: Date.now(),
    })
    added++
  }
  log && log('info', `知识库种子加载完成：新增 ${added} / 跳过 ${skipped}`)
  return { added, skipped }
}

// ---- 工具实现 ---------------------------------------------------------------

const tools = [
  {
    name: 'search',
    description:
      '在精益知识库中检索与查询相关的条目（包含内置精益方法论 + 用户自定义条目）。' +
      '当用户提问涉及精益概念、工具、方法论（VSM、SMED、TPM、5S、看板、8D、DMAIC、八大浪费 等），' +
      '或在生成诊断建议、改善方案前需要查阅原文时调用。' +
      '返回 Top N 条带预览片段的命中结果，便于你引用原文。',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '检索关键词（支持中英文混合，如 "SMED 换型时间" / "看板规则"）',
        },
        limit: {
          type: 'integer',
          description: '最多返回多少条命中（默认 5，最大 10）',
          minimum: 1,
          maximum: 10,
        },
      },
      required: ['query'],
    },
    async execute(input, ctx) {
      const query = String(input.query || '').trim()
      if (!query) {
        return { content: 'query 不能为空。', isError: true }
      }
      const limit = Math.min(Math.max(parseInt(input.limit, 10) || 5, 1), 10)

      ensureSchema(ctx.db)
      const all = listAllEntries(ctx.db)
      if (all.length === 0) {
        return {
          content: '知识库为空。可调用 kb_add 添加条目，或检查 onActivate 是否成功播种。',
          artifact: { type: 'markdown', data: '_知识库无内容_' },
        }
      }

      const qTokens = tokenize(query)
      const scored = all
        .map(e => ({ entry: e, score: scoreEntry(qTokens, e) }))
        .filter(r => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)

      if (scored.length === 0) {
        return {
          content: `未在知识库中找到与「${query}」相关的条目（共 ${all.length} 条）。可换关键词或调用 kb_list 浏览。`,
          artifact: { type: 'markdown', data: `### 🔍 知识库检索\n\n_未找到与「${query}」相关的条目_` },
        }
      }

      // 给 LLM 的文本：紧凑版，含 id/title/snippet/score
      const llmLines = scored.map((r, i) => {
        const snip = makeSnippet(r.entry.content, query, 80)
        const tagStr = r.entry.tags.length ? ` [${r.entry.tags.join(', ')}]` : ''
        return `[${i + 1}] (id=${r.entry.id}, score=${r.score})${tagStr}\n  标题：${r.entry.title}\n  片段：${snip}`
      })
      const llmContent =
        `知识库命中 ${scored.length} 条（共扫描 ${all.length}）：\n\n` +
        llmLines.join('\n\n') +
        `\n\n你可以引用上述片段。如需完整内容，可用 kb_get 工具或在 kb_search 中用更精准关键词。`

      // UI artifact：markdown 卡片
      const mdLines = scored.map((r, i) => {
        const snip = makeSnippet(r.entry.content, query, 120)
        const tagBadges = r.entry.tags.length
          ? ` ${r.entry.tags.map(t => `\`${t}\``).join(' ')}`
          : ''
        return `**${i + 1}. ${r.entry.title}**${tagBadges}  _(score: ${r.score})_\n\n> ${snip}`
      })
      const md = `### 🔍 「${query}」 — Top ${scored.length} 命中\n\n${mdLines.join('\n\n---\n\n')}`

      return {
        content: llmContent,
        artifact: { type: 'markdown', data: md },
      }
    },
  },

  {
    name: 'list',
    description:
      '列出知识库中的所有条目（仅返回标题、tag、来源、字数；不返回正文）。用于让用户/你了解可用知识范围，' +
      '或决定是否调用 kb_search 检索具体内容。可按 source 过滤（seed=内置 / user=用户添加）。',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          enum: ['seed', 'user', 'all'],
          description: '过滤来源（默认 all）',
        },
      },
    },
    async execute(input, ctx) {
      ensureSchema(ctx.db)
      const filter = input.source === 'seed' || input.source === 'user' ? input.source : 'all'
      const all = listAllEntries(ctx.db)
      const filtered = filter === 'all' ? all : all.filter(e => e.source === filter)

      if (filtered.length === 0) {
        return {
          content: filter === 'all'
            ? '知识库为空。'
            : `来源为 ${filter} 的条目数为 0。`,
          artifact: { type: 'markdown', data: '_知识库无内容_' },
        }
      }

      const rows = filtered.map(e => [
        e.id,
        e.title,
        e.source,
        e.tags.join(', ') || '—',
        `${e.content.length} 字`,
      ])

      const summary = `知识库共 ${all.length} 条；本次返回 ${filtered.length} 条（filter=${filter}）。`
      return {
        content:
          summary + '\n\n' +
          filtered.map((e, i) => `${i + 1}. [${e.source}] ${e.title} (id=${e.id}, ${e.content.length}字, tags=${e.tags.join('/') || '—'})`).join('\n'),
        artifact: {
          type: 'table',
          data: {
            columns: ['ID', '标题', '来源', '标签', '长度'],
            rows,
          },
        },
      }
    },
  },

  {
    name: 'add',
    description:
      '向知识库添加一条新条目。当用户希望沉淀某段经验/案例/标准，或你识别到对话中有值得复用的精益知识时调用。' +
      '会以 user: 前缀生成稳定 id（避免与 seed 冲突）。同 id 重复添加将覆盖。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '条目标题（建议简洁明确，如"焊接工序换型 SMED 案例"）' },
        content: { type: 'string', description: '正文（支持 markdown）' },
        tags: {
          type: 'array',
          description: '标签数组（如 ["案例", "焊接", "SMED"]）',
          items: { type: 'string' },
        },
        id: {
          type: 'string',
          description: '可选：自定义 id（留空则按标题哈希生成 user:xxxx 形式）',
        },
      },
      required: ['title', 'content'],
    },
    async execute(input, ctx) {
      const title = String(input.title || '').trim()
      const content = String(input.content || '').trim()
      if (!title || !content) {
        return { content: 'title 与 content 都不能为空。', isError: true }
      }
      const tags = Array.isArray(input.tags) ? input.tags.map(String) : []
      let id = String(input.id || '').trim()
      if (!id) {
        const h = crypto.createHash('sha1').update(title).digest('hex').slice(0, 8)
        id = `user:${h}`
      } else if (!id.startsWith('user:') && !id.startsWith('seed:')) {
        id = `user:${id}`
      }

      ensureSchema(ctx.db)
      const overwriting = entryExists(ctx.db, id)
      insertEntry(ctx.db, {
        id, title, source: id.startsWith('seed:') ? 'seed' : 'user',
        tags, content, created_at: Date.now(),
      })

      ctx.log('info', `知识库${overwriting ? '更新' : '新增'}条目：${id} - ${title}`)

      return {
        content:
          `已${overwriting ? '更新' : '新增'}知识库条目：\n` +
          `- id: ${id}\n- 标题：${title}\n- 标签：${tags.join(', ') || '（无）'}\n- 长度：${content.length} 字\n\n` +
          `可通过 kb_search 检索到该条目。`,
        artifact: {
          type: 'markdown',
          data:
            `### ${overwriting ? '✏️ 已更新' : '➕ 已新增'}知识库条目\n\n` +
            `**${title}**  \n_id: \`${id}\`  · ${content.length} 字_\n\n` +
            (tags.length ? `**标签**：${tags.map(t => `\`${t}\``).join(' ')}\n\n` : '') +
            `---\n\n${content.length > 400 ? content.slice(0, 400) + '…' : content}`,
        },
      }
    },
  },
]

// ---- Skill manifest --------------------------------------------------------

module.exports = {
  default: {
    packageName: '@lean-ai/skill-knowledge',
    displayName: '精益知识库',
    description: '精益方法论检索与沉淀（10 篇内置种子 + 用户自定义条目，支持中英文混合检索）',
    version: '1.0.0',
    tools,
    async onActivate(ctx) {
      ensureSchema(ctx.db)
      try {
        loadSeeds(ctx.db, ctx.log)
      } catch (e) {
        ctx.log('error', `知识库种子加载失败：${e && e.message ? e.message : String(e)}`)
      }
    },
  },
}
