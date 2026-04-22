/**
 * OpenAI-Compatible provider — covers DeepSeek, 通义千问 (Qianwen), Ollama, etc.
 * All these providers expose an OpenAI-compatible /chat/completions endpoint.
 */
import { OpenAIProvider } from './openai'

const PROVIDER_BASE_URLS: Record<string, string> = {
  deepseek: 'https://api.deepseek.com/v1',
  qianwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  // Ollama baseURL is configured by the user (defaults to http://localhost:11434/v1)
}

export class DeepSeekProvider extends OpenAIProvider {
  override readonly providerId = 'deepseek'
  constructor(apiKey: string) {
    super(apiKey, PROVIDER_BASE_URLS.deepseek)
  }
}

export class QianwenProvider extends OpenAIProvider {
  override readonly providerId = 'qianwen'
  constructor(apiKey: string) {
    super(apiKey, PROVIDER_BASE_URLS.qianwen)
  }
}

export class OllamaProvider extends OpenAIProvider {
  override readonly providerId = 'ollama'
  constructor(baseUrl: string) {
    // Ollama's OpenAI-compat endpoint lives at <baseUrl>/v1
    const normalizedBase = baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl.replace(/\/$/, '')}/v1`
    super('ollama', normalizedBase)
  }
}
