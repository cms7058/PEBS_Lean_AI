/**
 * Claude provider (Anthropic SDK) — full tool-calling support.
 *
 * Anthropic's message format is the reference format for our internal
 * LLMContentBlock layout, so conversion here is nearly identity.
 */
import Anthropic from '@anthropic-ai/sdk'
import type {
  ILLMProvider,
  StreamOptions,
  StreamEvent,
  LLMMessage,
  LLMContentBlock,
  ToolSchema,
} from './base'

export class ClaudeProvider implements ILLMProvider {
  readonly providerId = 'claude'
  readonly supportsTools = true
  private client: Anthropic

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey })
  }

  async *stream(options: StreamOptions): AsyncGenerator<StreamEvent> {
    const { model, messages, systemPrompt, maxTokens = 4096, temperature = 0.7, tools } = options

    const anthropicMessages = messages
      .filter(m => m.role !== 'system')
      .map(toAnthropicMessage)

    const anthropicTools = tools && tools.length > 0 ? tools.map(toAnthropicTool) : undefined

    try {
      const stream = await this.client.messages.stream({
        model,
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages: anthropicMessages,
        ...(anthropicTools ? { tools: anthropicTools } : {}),
      })

      // Tool-use blocks stream their input JSON as partial deltas; we reassemble them
      // keyed by content_block index.
      const toolBuffers = new Map<number, { id: string; name: string; json: string }>()

      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          const block = event.content_block
          if (block.type === 'tool_use') {
            toolBuffers.set(event.index, { id: block.id, name: block.name, json: '' })
            yield { type: 'tool_use_start', id: block.id, name: block.name }
          }
        } else if (event.type === 'content_block_delta') {
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
            yield { type: 'stop', reason: normalizeStopReason(stopReason) }
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      yield { type: 'error', message: msg }
    }
  }
}

// ---- Conversion helpers ---------------------------------------------------

/**
 * Convert our LLMMessage into the Anthropic MessageParam format. String content
 * passes through; block content maps 1:1 with minor field renames (toolUseId
 * → tool_use_id).
 */
export function toAnthropicMessage(m: LLMMessage): Anthropic.MessageParam {
  if (m.role === 'system') {
    // Defensive — caller should strip system messages before reaching here.
    throw new Error('system role should be passed via top-level `system` param, not messages[]')
  }
  if (typeof m.content === 'string') {
    return { role: m.role, content: m.content }
  }
  const blocks: Anthropic.ContentBlockParam[] = m.content.map(toAnthropicBlock)
  return { role: m.role, content: blocks }
}

function toAnthropicBlock(block: LLMContentBlock): Anthropic.ContentBlockParam {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text }
    case 'tool_use':
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input }
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: block.toolUseId,
        content: block.content,
        ...(block.isError ? { is_error: true } : {}),
      }
  }
}

export function toAnthropicTool(tool: ToolSchema): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
  }
}

function normalizeStopReason(reason: string): StreamEvent extends { type: 'stop'; reason: infer R } ? R : string {
  // Anthropic: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | null
  return reason as never
}
