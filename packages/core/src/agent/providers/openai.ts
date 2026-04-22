/**
 * OpenAI provider — full tool-calling support.
 *
 * Also the base class for OpenAI-compatible providers (DeepSeek, Qianwen,
 * Ollama, MiniMax pay-as-you-go) via subclasses that set a different baseURL.
 *
 * Conversion notes:
 *   - Our assistant turns with tool_use blocks → OpenAI's `tool_calls` array
 *     on the assistant message.
 *   - Our tool_result blocks → OpenAI's separate `{role: 'tool'}` messages
 *     (one per tool_use_id). OpenAI requires these to appear immediately
 *     after the assistant message containing the matching tool_calls.
 *   - OpenAI streams tool-call arguments as `delta.tool_calls[].function.arguments`
 *     chunks; we reassemble them keyed by choice index before emitting our
 *     `tool_use` event.
 */
import OpenAI from 'openai'
import type {
  ILLMProvider,
  StreamOptions,
  StreamEvent,
  LLMMessage,
  LLMContentBlock,
  ToolSchema,
} from './base'

export class OpenAIProvider implements ILLMProvider {
  readonly providerId: string = 'openai'
  readonly supportsTools = true
  protected client: OpenAI

  constructor(apiKey: string, baseURL?: string) {
    this.client = new OpenAI({ apiKey, baseURL })
  }

  async *stream(options: StreamOptions): AsyncGenerator<StreamEvent> {
    const { model, messages, systemPrompt, maxTokens = 4096, temperature = 0.7, tools } = options

    const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = []
    if (systemPrompt) {
      openaiMessages.push({ role: 'system', content: systemPrompt })
    }
    for (const m of messages) {
      if (m.role === 'system') continue
      openaiMessages.push(...toOpenAIMessages(m))
    }

    const openaiTools = tools && tools.length > 0 ? tools.map(toOpenAITool) : undefined

    try {
      const stream = await this.client.chat.completions.create({
        model,
        messages: openaiMessages,
        max_tokens: maxTokens,
        temperature,
        stream: true,
        ...(openaiTools ? { tools: openaiTools, tool_choice: 'auto' } : {}),
      })

      // OpenAI streams tool_calls in chunks; we accumulate by index.
      interface ToolBuf { id: string; name: string; args: string; started: boolean }
      const toolBufs = new Map<number, ToolBuf>()

      let finishReason = ''

      for await (const chunk of stream) {
        const choice = chunk.choices[0]
        if (!choice) continue

        const delta = choice.delta

        // Streaming text.
        if (delta?.content) {
          yield { type: 'text_delta', delta: delta.content }
        }

        // Streaming tool calls — fragments come in sequentially.
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index
            let buf = toolBufs.get(idx)
            if (!buf) {
              buf = { id: tc.id ?? '', name: tc.function?.name ?? '', args: '', started: false }
              toolBufs.set(idx, buf)
            }
            if (tc.id && !buf.id) buf.id = tc.id
            if (tc.function?.name && !buf.name) buf.name = tc.function.name
            // Emit tool_use_start once we have both id and name.
            if (!buf.started && buf.id && buf.name) {
              buf.started = true
              yield { type: 'tool_use_start', id: buf.id, name: buf.name }
            }
            if (tc.function?.arguments) buf.args += tc.function.arguments
          }
        }

        if (choice.finish_reason) {
          finishReason = choice.finish_reason
        }
      }

      // Stream finished — emit final tool_use events (full input) and stop.
      for (const buf of toolBufs.values()) {
        let input: Record<string, unknown> = {}
        if (buf.args.trim()) {
          try { input = JSON.parse(buf.args) as Record<string, unknown> }
          catch { /* leave empty on parse failure */ }
        }
        if (buf.id && buf.name) {
          yield { type: 'tool_use', id: buf.id, name: buf.name, input }
        }
      }

      yield { type: 'stop', reason: normalizeStopReason(finishReason) }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      yield { type: 'error', message: msg }
    }
  }
}

// ---- Conversion helpers ---------------------------------------------------

/**
 * Convert one of our LLMMessages into one-or-more OpenAI ChatCompletionMessageParam
 * entries. Tool-result blocks fan out into separate `{role:'tool'}` messages.
 */
export function toOpenAIMessages(m: LLMMessage): OpenAI.Chat.ChatCompletionMessageParam[] {
  if (m.role === 'system') {
    return [{ role: 'system', content: typeof m.content === 'string' ? m.content : stringifyBlocks(m.content) }]
  }

  // Simple string content.
  if (typeof m.content === 'string') {
    if (m.role === 'assistant') return [{ role: 'assistant', content: m.content }]
    return [{ role: 'user', content: m.content }]
  }

  const blocks = m.content

  // Tool results can only appear in user-role messages in our internal schema,
  // but OpenAI expects them as separate `tool` role messages.
  if (m.role === 'user') {
    const result: OpenAI.Chat.ChatCompletionMessageParam[] = []
    let pendingText = ''
    for (const block of blocks) {
      if (block.type === 'text') {
        pendingText += (pendingText ? '\n' : '') + block.text
      } else if (block.type === 'tool_result') {
        if (pendingText) {
          result.push({ role: 'user', content: pendingText })
          pendingText = ''
        }
        result.push({
          role: 'tool',
          tool_call_id: block.toolUseId,
          content: block.isError ? `[Error] ${block.content}` : block.content,
        })
      }
      // tool_use doesn't appear in user messages; ignore defensively.
    }
    if (pendingText) result.push({ role: 'user', content: pendingText })
    return result
  }

  // Assistant message: merge text blocks into `content` and tool_use blocks into `tool_calls`.
  let text = ''
  const toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = []
  for (const block of blocks) {
    if (block.type === 'text') {
      text += (text ? '\n' : '') + block.text
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
      })
    }
  }
  const msg: OpenAI.Chat.ChatCompletionAssistantMessageParam = { role: 'assistant' }
  if (text) msg.content = text
  if (toolCalls.length > 0) msg.tool_calls = toolCalls
  // OpenAI requires at least one of content or tool_calls — if both are empty, send empty string.
  if (!msg.content && (!msg.tool_calls || msg.tool_calls.length === 0)) {
    msg.content = ''
  }
  return [msg]
}

function stringifyBlocks(blocks: LLMContentBlock[]): string {
  return blocks.map(b => {
    if (b.type === 'text') return b.text
    if (b.type === 'tool_use') return `[tool:${b.name}] ${JSON.stringify(b.input)}`
    return `[tool_result:${b.toolUseId}] ${b.content}`
  }).join('\n')
}

export function toOpenAITool(tool: ToolSchema): OpenAI.Chat.ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }
}

function normalizeStopReason(reason: string): string {
  // OpenAI: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call'
  // Normalize to our union so the Agent can branch uniformly.
  if (reason === 'tool_calls') return 'tool_use'
  if (reason === 'stop') return 'end_turn'
  if (reason === 'length') return 'max_tokens'
  return reason || 'end_turn'
}
