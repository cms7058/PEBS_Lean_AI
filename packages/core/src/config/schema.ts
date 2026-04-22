import { z } from 'zod'

export const WenxinConfigSchema = z.object({
  apiKey: z.string().default(''),
  secretKey: z.string().default(''),
})

export const OllamaConfigSchema = z.object({
  baseUrl: z.string().default('http://localhost:11434'),
  model: z.string().default('qwen2.5:7b'),
})

export const ApiKeysSchema = z.object({
  claude: z.string().default(''),
  openai: z.string().default(''),
  deepseek: z.string().default(''),
  qianwen: z.string().default(''),
  minimax: z.string().default(''),
  minimaxPlan: z.string().default(''),
  wenxin: WenxinConfigSchema.default({}),
  ollama: OllamaConfigSchema.default({}),
})

/** OAuth tokens stored after browser-based login */
export const OAuthTokensSchema = z.record(z.string(), z.object({
  accessToken: z.string(),
  expiresAt: z.number().optional(),
  scope: z.string().optional(),
})).default({})

export const LLMConfigSchema = z.object({
  provider: z.enum(['claude', 'openai', 'deepseek', 'qianwen', 'minimax', 'minimaxPlan', 'wenxin', 'ollama']).default('claude'),
  model: z.string().default('claude-sonnet-4-6'),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().int().positive().default(4096),
})

export const ServerConfigSchema = z.object({
  port: z.number().int().default(3741),
  openBrowser: z.boolean().default(true),
  host: z.string().default('127.0.0.1'),
})

export const SkillsConfigSchema = z.object({
  disabled: z.array(z.string()).default([]),
  configs: z.record(z.string(), z.unknown()).default({}),
})

export const UIConfigSchema = z.object({
  language: z.enum(['zh', 'en']).default('zh'),
  theme: z.enum(['light', 'dark']).default('light'),
})

/**
 * Per-plan capability overrides. Deliberately loose typing so we don't have to
 * mirror the canonical shape here — the billing/capabilities.ts module owns
 * the structure + defaults.
 */
export const PlanCapabilitiesOverrideSchema = z.record(
  z.enum(['free', 'personal', 'enterprise']),
  z.object({
    knowledgeImport: z.boolean().optional(),
    apiKeyConfig: z.boolean().optional(),
    pages: z.object({
      knowledge: z.boolean().optional(),
      skills: z.boolean().optional(),
      pricing: z.boolean().optional(),
      usage: z.boolean().optional(),
      admin: z.boolean().optional(),
    }).partial().optional(),
    skillAllowlist: z.union([z.array(z.string()), z.literal('*')]).optional(),
  }).partial(),
).default({})

/** Admin-configured payment gateway (QR image URL per plan/method). */
export const PaymentGatewaySchema = z.object({
  wechatQrUrl: z.string().default(''),
  alipayQrUrl: z.string().default(''),
  bankAccount: z.string().default(''),
  contactPhone: z.string().default(''),
  contactEmail: z.string().default(''),
  instructions: z.string().default('扫码付款后请将付款截图发送给客服，客服核实后会在 1 个工作日内激活您的订阅。'),
})

export const AppConfigSchema = z.object({
  version: z.number().int().default(1),
  llm: LLMConfigSchema.default({}),
  apiKeys: ApiKeysSchema.default({}),
  oauthTokens: OAuthTokensSchema,
  server: ServerConfigSchema.default({}),
  skills: SkillsConfigSchema.default({}),
  ui: UIConfigSchema.default({}),
  planCapabilities: PlanCapabilitiesOverrideSchema,
  paymentGateway: PaymentGatewaySchema.default({}),
})

export type AppConfig = z.infer<typeof AppConfigSchema>
export type LLMConfig = z.infer<typeof LLMConfigSchema>
export type ApiKeys = z.infer<typeof ApiKeysSchema>
export type ProviderID = AppConfig['llm']['provider']

export const PROVIDER_MODELS: Record<ProviderID, string[]> = {
  claude:       ['claude-opus-4-5', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  openai:       ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
  deepseek:     ['deepseek-chat', 'deepseek-reasoner'],
  qianwen:      ['qwen-max', 'qwen-plus', 'qwen-turbo'],
  minimax:      ['MiniMax-M1', 'MiniMax-Text-01', 'abab6.5s-chat', 'abab5.5s-chat'],
  minimaxPlan:  ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M2.5', 'MiniMax-M2.5-highspeed', 'MiniMax-M2.1', 'MiniMax-M2.1-highspeed', 'MiniMax-M2'],
  wenxin:       ['ernie-4.0-turbo-8k', 'ernie-3.5-8k'],
  ollama:       ['custom'],
}

export const PROVIDER_NAMES: Record<ProviderID, string> = {
  claude:       'Claude (Anthropic)',
  openai:       'OpenAI GPT',
  deepseek:     'DeepSeek',
  qianwen:      '通义千问 (Qianwen)',
  minimax:      'MiniMax (按量付费)',
  minimaxPlan:  'MiniMax Token Plan (M2.7)',
  wenxin:       '文心一言 (Wenxin)',
  ollama:       'Ollama (本地)',
}

/** Auth method for each provider */
export type AuthMethod = 'apikey' | 'oauth' | 'two_field' | 'url_only'

export interface ProviderAuthConfig {
  method: AuthMethod
  /** Link to obtain API key (for apikey method) */
  apiKeyUrl?: string
  /** OAuth2 authorization URL (for oauth method) */
  oauthAuthUrl?: string
  /** OAuth2 token endpoint */
  oauthTokenUrl?: string
  /** OAuth2 client ID */
  oauthClientId?: string
  /** OAuth2 scopes */
  oauthScopes?: string[]
  /** Display hint shown in settings */
  hint?: string
}

export const PROVIDER_AUTH: Record<ProviderID, ProviderAuthConfig> = {
  claude: {
    method: 'apikey',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    hint: '从 Anthropic Console 获取 API Key',
  },
  openai: {
    method: 'apikey',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    hint: '从 OpenAI Platform 获取 API Key',
  },
  deepseek: {
    method: 'apikey',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    hint: '从 DeepSeek Platform 获取 API Key',
  },
  qianwen: {
    method: 'apikey',
    apiKeyUrl: 'https://dashscope.console.aliyun.com/apiKey',
    hint: '从阿里云 DashScope 获取 API Key',
  },
  minimax: {
    method: 'apikey',
    apiKeyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    hint: '按量付费 API Key，用于 MiniMax-M1 / Text-01 / abab 系列',
  },
  minimaxPlan: {
    method: 'apikey',
    apiKeyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    hint: 'Token Plan 订阅专属 Key（非按量付费），用于 MiniMax-M2.7 及 M2 系列',
  },
  wenxin: {
    method: 'two_field',
    apiKeyUrl: 'https://console.bce.baidu.com/iam/#/iam/accesslist',
    hint: '需要填写 API Key 和 Secret Key（百度智能云）',
  },
  ollama: {
    method: 'url_only',
    hint: '输入 Ollama 服务地址（默认 http://localhost:11434）',
  },
}
