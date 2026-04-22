import type { ILLMProvider } from './base'
import { ClaudeProvider } from './claude'
import { OpenAIProvider } from './openai'
import { DeepSeekProvider, QianwenProvider, OllamaProvider } from './openai-compat'
import { WenxinProvider } from './wenxin'
import { MiniMaxProvider } from './minimax'
import { MiniMaxPlanProvider } from './minimax-plan'
import type { AppConfig, ProviderID } from '../../config/schema'
import { getOAuthToken } from '../../auth/oauth'

export { ClaudeProvider, OpenAIProvider, DeepSeekProvider, QianwenProvider, OllamaProvider, WenxinProvider, MiniMaxProvider, MiniMaxPlanProvider }
export type { ILLMProvider } from './base'
export type { LLMMessage, StreamOptions, StreamEvent } from './base'

export function createProvider(config: AppConfig): ILLMProvider {
  const { provider } = config.llm
  const keys = config.apiKeys

  switch (provider as ProviderID) {
    case 'claude':
      if (!keys.claude) throw new Error('Claude API key 未配置。运行: lean-ai config set apiKeys.claude <key>\n获取 Key: https://console.anthropic.com/settings/keys')
      return new ClaudeProvider(keys.claude)

    case 'openai':
      if (!keys.openai) throw new Error('OpenAI API key 未配置。运行: lean-ai config set apiKeys.openai <key>\n获取 Key: https://platform.openai.com/api-keys')
      return new OpenAIProvider(keys.openai)

    case 'deepseek':
      if (!keys.deepseek) throw new Error('DeepSeek API key 未配置。运行: lean-ai config set apiKeys.deepseek <key>\n获取 Key: https://platform.deepseek.com/api_keys')
      return new DeepSeekProvider(keys.deepseek)

    case 'qianwen':
      if (!keys.qianwen) throw new Error('通义千问 API key 未配置。运行: lean-ai config set apiKeys.qianwen <key>\n获取 Key: https://dashscope.console.aliyun.com/apiKey')
      return new QianwenProvider(keys.qianwen)

    case 'minimax': {
      // Check for OAuth token first, fall back to API key
      const oauthToken = getOAuthToken('minimax')
      const apiKey = oauthToken ?? keys.minimax
      if (!apiKey) throw new Error('MiniMax API key 未配置。\n方式一: lean-ai config set apiKeys.minimax <key>\n获取 Key: https://platform.minimaxi.com/user-center/basic-information/interface-key')
      return new MiniMaxProvider(apiKey)
    }

    case 'minimaxPlan': {
      if (!keys.minimaxPlan) throw new Error('MiniMax Token Plan Key 未配置。\n此 Key 专属于 Token Plan 订阅用户，与按量付费 Key 不通用。\n获取: https://platform.minimaxi.com/user-center/basic-information/interface-key')
      return new MiniMaxPlanProvider(keys.minimaxPlan)
    }

    case 'wenxin':
      if (!keys.wenxin.apiKey || !keys.wenxin.secretKey) throw new Error('文心一言凭证未配置。\n运行:\n  lean-ai config set apiKeys.wenxin.apiKey <key>\n  lean-ai config set apiKeys.wenxin.secretKey <secret>')
      return new WenxinProvider(keys.wenxin.apiKey, keys.wenxin.secretKey)

    case 'ollama':
      return new OllamaProvider(keys.ollama.baseUrl)

    default:
      throw new Error(`未知的 Provider: ${provider}`)
  }
}
