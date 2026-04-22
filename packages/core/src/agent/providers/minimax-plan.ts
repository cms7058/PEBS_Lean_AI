/**
 * MiniMax Token Plan provider.
 *
 * Token Plan is MiniMax's subscription tier; it exposes an Anthropic-compatible
 * endpoint at https://api.minimaxi.com/anthropic and uses a key that is
 * distinct from the pay-as-you-go API key.
 *
 * Supported models: MiniMax-M2.7, MiniMax-M2.7-highspeed, MiniMax-M2.5(-highspeed),
 * MiniMax-M2.1(-highspeed), MiniMax-M2.
 *
 * Since the endpoint is Anthropic-compatible we reuse the Anthropic SDK and
 * the Claude provider's block-conversion helpers.
 *
 * Docs: https://platform.minimaxi.com/docs/token-plan/intro
 */
import Anthropic from '@anthropic-ai/sdk'
import type { ILLMProvider, StreamOptions, StreamEvent } from './base'
import { toAnthropicMessage, toAnthropicTool } from './claude'

const MINIMAX_ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic'

export class MiniMaxPlanProvider implements ILLMProvider {
  readonly providerId = 'minimaxPlan'
  readonly supportsTools = true
  private client: Anthropic

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, baseURL: MINIMAX_ANTHROPIC_BASE_URL })
  }

  async *stream(options: StreamOptions): AsyncGenerator<StreamEvent> {
    const { model, messages, systemPrompt, maxTokens = 4096, temperature = 0.7, tools } = options

    // Token Plan docs: temperature must be in (0, 1], we clamp defensively.
    const clampedTemp = Math.min(Math.max(temperature, 0.01), 1)

    const anthropicMessages = messages
      .filter(m => m.role !== 'system')
      .map(toAnthropicMessage)

    const anthropicTools = tools && tools.length > 0 ? tools.map(toAnthropicTool) : undefined

    try {
      const stream = await this.client.messages.stream({
        model,
        max_tokens: maxTokens,
        temperature: clampedTemp,
        system: systemPrompt,
        messages: anthropicMessages,
        ...(anthropicTools ? { tools: anthropicTools } : {}),
      })

      const toolBuffers = new Map<number, { id: string; name: string; json: string }>()

      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          const block = event.content_block
          if (block.type === 'tool_use') {
            toolBuffers.set(event.index, { id: block.id, name: block.name, json: '' })
            yield { type: 'tool_use_start', id: block.id, name: block.name }
          }
        } else if (event.type === 'content_block_delta') {
          // MiniMax-M2.7 also emits `thinking_delta` (chain-of-thought) blocks;
          // we forward only final-answer text and tool-use inputs.
          if (event.delta.type === 'text_delta') {
            yield { type: 'text_delta', delta: event.delta.text }
          } else if (event.delta.type === 'input_json_delta') {
            const buf = toolBuffers.get(event.index)
            if (buf) buf.json += event.delta.partial_json
          }
        } else if (event.type === 'content_block_stop') {
          const buf = toolBuffers.get(event.index)
          if (buf) {
            let input: Record<string, unknown> = {}
            if (buf.json.trim()) {
              try { input = JSON.parse(buf.json) as Record<string, unknown> }
              catch { /* leave as empty object on parse failure */ }
            }
            yield { type: 'tool_use', id: buf.id, name: buf.name, input }
            toolBuffers.delete(event.index)
          }
        } else if (event.type === 'message_delta') {
          const stopReason = event.delta.stop_reason
          if (stopReason) {
            yield { type: 'stop', reason: stopReason }
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      yield { type: 'error', message: msg }
    }
  }
}
