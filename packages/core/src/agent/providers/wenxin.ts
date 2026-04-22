/**
 * 文心一言 (Wenxin ERNIE) provider
 * Uses Baidu's OAuth2 access token + SSE chat completions API.
 */
import https from 'https'
import http from 'http'
import type { ILLMProvider, StreamOptions, StreamEvent } from './base'

const TOKEN_URL = 'https://aip.baidubce.com/oauth/2.0/token'

const MODEL_ENDPOINTS: Record<string, string> = {
  'ernie-4.0-turbo-8k': 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-4.0-turbo-8k',
  'ernie-3.5-8k': 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-3.5-8k',
}

interface TokenCache {
  token: string
  expiresAt: number
}

export class WenxinProvider implements ILLMProvider {
  readonly providerId = 'wenxin'
  /**
   * Wenxin's chat completions API as wired here doesn't expose function calling,
   * so we silently ignore `options.tools`. The Agent checks this flag and will
   * not send the skill toolset to Wenxin turns.
   */
  readonly supportsTools = false
  private apiKey: string
  private secretKey: string
  private tokenCache: TokenCache | null = null

  constructor(apiKey: string, secretKey: string) {
    this.apiKey = apiKey
    this.secretKey = secretKey
  }

  private async getAccessToken(): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt) {
      return this.tokenCache.token
    }
    const url = `${TOKEN_URL}?grant_type=client_credentials&client_id=${this.apiKey}&client_secret=${this.secretKey}`
    const data = await fetchJson(url)
    const token = data.access_token as string
    // Cache for 29 days (token is valid 30 days)
    this.tokenCache = { token, expiresAt: Date.now() + 29 * 24 * 3600 * 1000 }
    return token
  }

  async *stream(options: StreamOptions): AsyncGenerator<StreamEvent> {
    const { model = 'ernie-4.0-turbo-8k', messages, systemPrompt } = options
    const endpoint = MODEL_ENDPOINTS[model] ?? MODEL_ENDPOINTS['ernie-4.0-turbo-8k']

    let accessToken: string
    try {
      accessToken = await this.getAccessToken()
    } catch (err) {
      yield { type: 'error', message: `Wenxin auth failed: ${err}` }
      return
    }

    // Wenxin doesn't support tool use — collapse any tool_use/tool_result
    // blocks into plain text so history stays coherent across provider switches.
    const wenxinMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role, content: flattenToText(m.content) }))

    const body = JSON.stringify({
      messages: wenxinMessages,
      system: systemPrompt,
      stream: true,
    })

    const apiUrl = `${endpoint}?access_token=${accessToken}`

    try {
      yield* streamWenxinRequest(apiUrl, body)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      yield { type: 'error', message: `Wenxin error: ${msg}` }
    }
  }
}

async function* streamWenxinRequest(url: string, body: string): AsyncGenerator<StreamEvent> {
  yield* await new Promise<AsyncGenerator<StreamEvent>>((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http
    const req = lib.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      resolve(parseSSEStream(res))
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function* parseSSEStream(stream: NodeJS.ReadableStream): AsyncGenerator<StreamEvent> {
  let buffer = ''
  for await (const chunk of stream) {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') { yield { type: 'stop', reason: 'end_turn' }; return }
      try {
        const json = JSON.parse(data)
        const text: string = json?.result ?? ''
        if (text) yield { type: 'text_delta', delta: text }
        if (json?.is_end) yield { type: 'stop', reason: 'end_turn' }
      } catch { /* ignore malformed lines */ }
    }
  }
}

function flattenToText(content: string | Array<{ type: string; text?: string; content?: string; input?: unknown; name?: string }>): string {
  if (typeof content === 'string') return content
  return content.map(b => {
    if (b.type === 'text') return b.text ?? ''
    if (b.type === 'tool_use') return `[调用工具 ${b.name}] ${JSON.stringify(b.input ?? {})}`
    if (b.type === 'tool_result') return `[工具结果] ${b.content ?? ''}`
    return ''
  }).filter(Boolean).join('\n')
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch (e) { reject(e) } })
    }).on('error', reject)
  })
}
