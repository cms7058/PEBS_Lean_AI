/**
 * MiniMax provider — uses OpenAI-compatible API endpoint.
 * Models: MiniMax-Text-01, abab6.5s-chat, etc.
 */
import { OpenAIProvider } from './openai'

const MINIMAX_BASE_URL = 'https://api.minimaxi.com/v1'

export class MiniMaxProvider extends OpenAIProvider {
  override readonly providerId = 'minimax'

  constructor(apiKey: string) {
    super(apiKey, MINIMAX_BASE_URL)
  }
}
