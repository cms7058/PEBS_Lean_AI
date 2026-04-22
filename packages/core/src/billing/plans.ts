/**
 * 订阅计划定义 — 单一事实源（Plans, Quotas, Pricing）
 *
 * 三个档位：
 *   free        免费试用（14 天，功能受限）
 *   personal    个人用户（无期限订阅，功能完整）
 *   enterprise  企业用户（无期限 + 多席位 + 无上限 + API/优先支持）
 *
 * 组合维度：
 *   1. 技能插件：允许启用的 Skill 包名列表（或通配 '*'）
 *   2. 知识库：最大条目数 / 最大文档数 / 单文件最大字节
 *   3. 时间/用量：试用期天数、每月对话消息、每月工具调用、每月新增 KB 条目
 */

export type PlanId = 'free' | 'personal' | 'enterprise'

export interface PlanLimits {
  /** 允许启用的 skill 包名；'*' 表示全部允许 */
  skills: string[] | '*'
  /** 知识库最大条目总数（含种子/用户/文件/客户）；null = 无限制 */
  kbMaxEntries: number | null
  /** 知识库最大文档数；null = 无限制 */
  kbMaxDocuments: number | null
  /** 单文件最大字节数 */
  kbMaxFileBytes: number
  /** 每月对话消息数；null = 无限制 */
  chatMessagesPerMonth: number | null
  /** 每月工具（Skill tool）调用数；null = 无限制 */
  toolCallsPerMonth: number | null
  /** 每月新增 KB 条目数（包含文件切片）；null = 无限制 */
  kbWritesPerMonth: number | null
  /** 试用期天数；null = 无试用（已付费/企业） */
  trialDays: number | null
  /** 允许的最大席位数（企业版） */
  seats: number
}

export interface PlanPricing {
  /** 以分计价（避免浮点问题）；null = 免费；企业席位价 */
  monthlyCents: number | null
  yearlyCents: number | null
  currency: 'CNY' | 'USD'
}

export interface PlanDefinition {
  id: PlanId
  name: string
  tagline: string
  /** 列表展示用特性（中文）；✓ 表示支持，× 表示不支持 */
  highlights: string[]
  limits: PlanLimits
  pricing: PlanPricing
  /** 展示用的「按需列表」：每个维度的描述性说明（用于订阅页面） */
  features: {
    label: string
    value: string
    muted?: boolean
  }[]
}

const MB = 1024 * 1024

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    name: '免费试用',
    tagline: '14 天无门槛体验核心精益诊断能力',
    highlights: [
      '2 个核心技能（知识库 + 图表）',
      '知识库 50 条 / 5 份文档',
      '每月 100 条对话 · 200 次工具调用',
      '试用期 14 天',
    ],
    limits: {
      skills: ['@lean-ai/skill-knowledge', '@lean-ai/skill-charts'],
      kbMaxEntries: 50,
      kbMaxDocuments: 5,
      kbMaxFileBytes: 5 * MB,
      chatMessagesPerMonth: 100,
      toolCallsPerMonth: 200,
      kbWritesPerMonth: 30,
      trialDays: 14,
      seats: 1,
    },
    pricing: { monthlyCents: 0, yearlyCents: 0, currency: 'CNY' },
    features: [
      { label: '可用技能', value: '知识库 · 图表生成（2 / 4）' },
      { label: '知识库条目', value: '最多 50 条' },
      { label: '上传文档', value: '最多 5 份 · 单文件 ≤ 5 MB' },
      { label: '月对话量', value: '100 条消息' },
      { label: '月工具调用', value: '200 次' },
      { label: '试用期', value: '14 天' },
      { label: '报告导出', value: '×', muted: true },
      { label: '诊断技能', value: '×', muted: true },
      { label: '技术支持', value: '社区支持', muted: true },
    ],
  },

  personal: {
    id: 'personal',
    name: '个人订阅',
    tagline: '精益顾问 / 改善工程师的日常工作台',
    highlights: [
      '全部 4 个技能（诊断 / 图表 / 报告 / 知识库）',
      '知识库 500 条 / 50 份文档 / 单文件 25 MB',
      '每月 2000 条对话 · 5000 次工具调用',
      '邮件技术支持',
    ],
    limits: {
      skills: '*',
      kbMaxEntries: 500,
      kbMaxDocuments: 50,
      kbMaxFileBytes: 25 * MB,
      chatMessagesPerMonth: 2000,
      toolCallsPerMonth: 5000,
      kbWritesPerMonth: 500,
      trialDays: null,
      seats: 1,
    },
    pricing: { monthlyCents: 4900, yearlyCents: 49900, currency: 'CNY' },
    features: [
      { label: '可用技能', value: '全部 4 个（诊断/图表/报告/知识库）' },
      { label: '知识库条目', value: '最多 500 条' },
      { label: '上传文档', value: '最多 50 份 · 单文件 ≤ 25 MB' },
      { label: '月对话量', value: '2000 条消息' },
      { label: '月工具调用', value: '5000 次' },
      { label: '报告导出', value: '✓（8D / DMAIC / 通用）' },
      { label: '图表生成', value: '✓（VSM / 鱼骨 / 帕累托 / 箱线）' },
      { label: '席位', value: '1 个' },
      { label: '技术支持', value: '邮件支持（48h 响应）' },
    ],
  },

  enterprise: {
    id: 'enterprise',
    name: '企业订阅',
    tagline: '多车间 / 多工厂团队的标准作业平台',
    highlights: [
      '所有功能无上限',
      '无限知识库 / 单文件 100 MB',
      '多席位（默认 10 起，可扩展）',
      '专属客户经理 + API 接入',
    ],
    limits: {
      skills: '*',
      kbMaxEntries: null,
      kbMaxDocuments: null,
      kbMaxFileBytes: 100 * MB,
      chatMessagesPerMonth: null,
      toolCallsPerMonth: null,
      kbWritesPerMonth: null,
      trialDays: null,
      seats: 10,
    },
    pricing: { monthlyCents: 39900, yearlyCents: 399900, currency: 'CNY' },
    features: [
      { label: '可用技能', value: '全部 · 含定制技能开发' },
      { label: '知识库条目', value: '无限' },
      { label: '上传文档', value: '无限 · 单文件 ≤ 100 MB' },
      { label: '月对话量', value: '无限' },
      { label: '月工具调用', value: '无限' },
      { label: '席位', value: '10 个起（每席 ¥399/月）' },
      { label: 'API 访问', value: '✓ REST + Webhook' },
      { label: 'SSO 单点登录', value: '✓' },
      { label: '技术支持', value: '专属客户经理（2h 响应）' },
      { label: '部署方式', value: '云端 / 私有化部署' },
    ],
  },
}

/** 单位换算工具 */
export function formatCents(cents: number | null, currency = 'CNY'): string {
  if (cents == null) return '—'
  if (cents === 0) return '免费'
  const symbol = currency === 'CNY' ? '¥' : '$'
  return `${symbol}${(cents / 100).toFixed(0)}`
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

export function formatLimit(n: number | null, unit = ''): string {
  if (n == null) return '无限'
  return `${n.toLocaleString('zh-CN')}${unit}`
}

/** 简化的许可证密钥校验（脱机本地方案）：
 *    期望格式 LEANAI-<PLAN>-<EXPIRES_YYYYMMDD>-<HASH8>
 *    其中 HASH8 = sha1(plan + expires + SECRET).slice(0, 8).toUpperCase()
 *  SECRET 从环境变量 LEANAI_LICENSE_SECRET 读取；未配置则允许任何格式正确的 key。
 *  这不是强加密（本地部署无法阻止破解），而是提供一个「可控的激活流程」。
 */
export const LICENSE_FORMAT_RE = /^LEANAI-(PERSONAL|ENTERPRISE)-(\d{8})-([A-Z0-9]{8})$/
