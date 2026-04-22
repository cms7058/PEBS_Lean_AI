import { v4 as uuid } from 'uuid'
import { createProvider } from './providers/index'
import type { ILLMProvider, LLMMessage, LLMContentBlock, LLMToolUseBlock, ToolSchema } from './providers/base'
import { loadConfig } from '../config/manager'
import { PROVIDER_MODELS, PROVIDER_NAMES, type ProviderID, type AppConfig } from '../config/schema'
import {
  createConversation,
  getConversation,
  getMessages,
  insertMessage,
  touchConversation,
  updateConversationTitle,
  type MessageRow,
} from '../storage/db'
import { buildToolRegistry, type ToolRegistry, type RegisteredTool } from '../skills/registry'
import type { SkillArtifact } from '../skills/types'
import { checkToolCall, recordUsage } from '../billing/manager'

/**
 * Build the system prompt. The trailing section advertises available skills
 * and their tools so the LLM knows what it can do. Keeping this dynamic (vs
 * baked into config) means newly installed skills are visible immediately.
 */
function buildSystemPrompt(provider: string, model: string, tools: RegisteredTool[]): string {
  const providerName = PROVIDER_NAMES[provider as ProviderID] ?? provider
  const base = `你是 LeanAI，一位专业的精益生产顾问 AI 智能体。你帮助制造业企业通过系统化的精益方法识别问题、分析根因、制定改善方案。

## 运行信息（用户询问时必须如实回答）
- 当前底层模型：${model}
- 所属服务商：${providerName}（${provider}）
- 当用户问"你是什么模型"、"用的哪个模型"之类问题时，直接回答上述模型名与服务商；不要声称自己是 Claude / GPT / 通用助手等其他身份。

## 你的专业领域
- 精益生产（Lean Manufacturing）与丰田生产方式（TPS）
- 8大浪费识别与消除：过量生产、等待、运输、过度加工、库存、动作、缺陷、未发挥的人才潜力
- 效率问题：节拍时间、OEE、SMED、TPM
- 质量问题：8D、SPC、Cpk、防错（Poka-yoke）
- 库存问题：VSM、拉动系统、看板
- 交期问题：DMAIC、APS、均衡生产（Heijunka）

## 对话风格
- 用中文回答，简洁专业
- 主动引导用户提供关键数据
- 给出具体可操作的建议，而非泛泛而谈
- 在适当时机主动询问是否需要生成图表或报告`

  if (tools.length === 0) {
    return base + '\n\n## 当前可用技能\n（未安装任何技能插件。可通过 `lean-ai skill install <包名>` 扩展能力。）'
  }

  // Group tools by skill so the prompt stays readable when many skills are loaded.
  const bySkill = new Map<string, { displayName: string; tools: RegisteredTool[] }>()
  for (const t of tools) {
    const entry = bySkill.get(t.skillPackageName)
    if (entry) entry.tools.push(t)
    else bySkill.set(t.skillPackageName, { displayName: t.skillDisplayName, tools: [t] })
  }
  const skillBlocks = Array.from(bySkill.values()).map(g => {
    const lines = g.tools.map(t => `  - \`${t.name}\`: ${t.description}`).join('\n')
    return `### ${g.displayName}\n${lines}`
  }).join('\n\n')

  return base + `\n\n## 当前可用工具
你可以调用以下工具来协助用户完成复杂任务。根据用户的问题自主决定是否调用、调用哪些、以什么顺序调用。工具结果会自动反馈给你，你在看到结果后继续对话。

${skillBlocks}`
}

// ---- Public streaming event shape (consumed by /api/chat SSE) --------------

export type ChatStreamEvent =
  | { type: 'text'; delta: string; conversationId?: string }
  | { type: 'tool_start'; id: string; toolName: string; skill: string }
  | { type: 'tool_input'; id: string; toolName: string; input: Record<string, unknown> }
  | { type: 'tool_result'; id: string; content: string; isError?: boolean; artifact?: SkillArtifact }
  | { type: 'done'; conversationId?: string }
  | { type: 'error'; message: string }

export interface ChatOptions {
  conversationId?: string
  message: string
  provider?: string
  model?: string
  /** Hard cap on tool-use iterations per user turn (safety net against loops). */
  maxIterations?: number
  /** Owner of the conversation; stamped on create, enforced on resume. */
  userId?: number
  tenantId?: number
}

const DEFAULT_MAX_ITERATIONS = 8

export async function* chat(options: ChatOptions): AsyncGenerator<ChatStreamEvent> {
  const config = loadConfig()

  if (options.provider) config.llm.provider = options.provider as typeof config.llm.provider
  if (options.model) config.llm.model = options.model

  // Resolve/create conversation. When a userId is supplied, ownership is
  // enforced on resume (unknown or foreign conversationId falls through to
  // "create new" so no cross-tenant read occurs).
  const owner = { userId: options.userId, tenantId: options.tenantId }
  let convId = options.conversationId
  if (!convId || !getConversation(convId, owner)) {
    convId = uuid()
    createConversation(convId, '新对话', owner)
    yield { type: 'text', delta: '', conversationId: convId }
  }

  // Persist user message.
  insertMessage({
    id: uuid(),
    conversation_id: convId,
    role: 'user',
    content: options.message,
  })

  // Load conversation history. DB stores only text turns — intermediate tool
  // blocks from prior turns are not persisted.
  const history: MessageRow[] = getMessages(convId)
  const turnMessages: LLMMessage[] = history.map(m => ({
    role: m.role as LLMMessage['role'],
    content: m.content,
  }))

  // Build tool registry for this turn (picks up newly-installed skills).
  const registry = buildToolRegistry()
  const registeredTools = registry.snapshot.tools

  // Create provider. Failures here (missing API key) bail out gracefully.
  let provider: ILLMProvider
  try {
    provider = createProvider(config)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    yield { type: 'error', message: msg }
    return
  }

  const toolsParam: ToolSchema[] | undefined =
    provider.supportsTools && registeredTools.length > 0
      ? registeredTools.map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }))
      : undefined

  const systemPrompt = buildSystemPrompt(config.llm.provider, config.llm.model, registeredTools)

  let fullVisibleResponse = ''
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS

  try {
    for (let iter = 0; iter < maxIterations; iter++) {
      // --- One round-trip with the LLM ---
      let stopReason = ''
      let turnText = ''
      const toolUses: LLMToolUseBlock[] = []

      for await (const event of provider.stream({
        model: config.llm.model,
        messages: turnMessages,
        systemPrompt,
        maxTokens: config.llm.maxTokens,
        temperature: config.llm.temperature,
        tools: toolsParam,
      })) {
        if (event.type === 'text_delta') {
          turnText += event.delta
          fullVisibleResponse += event.delta
          yield { type: 'text', delta: event.delta }
        } else if (event.type === 'tool_use_start') {
          const meta = registeredTools.find(t => t.name === event.name)
          yield {
            type: 'tool_start',
            id: event.id,
            toolName: event.name,
            skill: meta?.skillDisplayName ?? event.name,
          }
        } else if (event.type === 'tool_use') {
          toolUses.push({ type: 'tool_use', id: event.id, name: event.name, input: event.input })
          yield {
            type: 'tool_input',
            id: event.id,
            toolName: event.name,
            input: event.input,
          }
        } else if (event.type === 'error') {
          yield { type: 'error', message: event.message }
          return
        } else if (event.type === 'stop') {
          stopReason = event.reason
          // Don't break — SDK closes the iterator after stop, for-await ends naturally.
        }
      }

      // --- Attach this turn's assistant output to history ---
      if (turnText || toolUses.length > 0) {
        const assistantBlocks: LLMContentBlock[] = []
        if (turnText) assistantBlocks.push({ type: 'text', text: turnText })
        for (const tu of toolUses) assistantBlocks.push(tu)
        turnMessages.push({
          role: 'assistant',
          content: assistantBlocks.length === 1 && assistantBlocks[0].type === 'text'
            ? turnText
            : assistantBlocks,
        })
      }

      // --- Tool calls? Execute them and loop ---
      if (stopReason === 'tool_use' && toolUses.length > 0) {
        const toolResultBlocks: LLMContentBlock[] = []
        for (const tu of toolUses) {
          // Quota: skill allowed for current plan + monthly tool-call cap.
          // If blocked, synthesize an error tool_result so the LLM sees it and
          // can respond to the user politely instead of crashing the stream.
          const meta = registeredTools.find(t => t.name === tu.name)
          const skillPkg = meta?.skillPackageName ?? 'unknown'
          const q = checkToolCall(tu.name, skillPkg, options.tenantId)
          if (!q.allowed) {
            const blockedMsg = `[订阅限额] ${q.reason ?? '当前订阅不允许调用此工具。'}`
            toolResultBlocks.push({
              type: 'tool_result', toolUseId: tu.id, content: blockedMsg, isError: true,
            })
            yield {
              type: 'tool_result', id: tu.id, content: blockedMsg, isError: true,
            }
            continue
          }
          const result = await registry.dispatch(tu.name, tu.input, convId)
          const tid = options.tenantId
          if (tid !== undefined) {
            try { recordUsage(tid, 'tool_call', tu.name) } catch { /* non-fatal */ }
            if (tu.name === 'kb_search') { try { recordUsage(tid, 'kb_query', tu.name) } catch {} }
            if (tu.name === 'kb_add') { try { recordUsage(tid, 'kb_entry_add', tu.name) } catch {} }
          }
          toolResultBlocks.push({
            type: 'tool_result',
            toolUseId: tu.id,
            content: result.content,
            isError: result.isError,
          })
          yield {
            type: 'tool_result',
            id: tu.id,
            content: result.content,
            isError: result.isError,
            artifact: result.artifact,
          }
        }
        // OpenAI & Anthropic both expect tool results in a user-role message.
        turnMessages.push({ role: 'user', content: toolResultBlocks })
        continue
      }

      // Any other stop reason — we're done with this user turn.
      break
    }
  } finally {
    // Persist just the visible final text. Tool calls are re-derivable from
    // context if needed; persisting multi-block messages would require a
    // schema change that we're deferring past M2.
    if (fullVisibleResponse) {
      insertMessage({
        id: uuid(),
        conversation_id: convId,
        role: 'assistant',
        content: fullVisibleResponse,
      })
      touchConversation(convId)

      const conv = getConversation(convId, owner)
      if (conv && conv.title === '新对话') {
        const title = options.message.slice(0, 30).trim() || '新对话'
        updateConversationTitle(convId, title)
      }
    }
  }

  yield { type: 'done', conversationId: convId }
}

/**
 * Test provider connectivity. If `targetProvider` is given, test that provider
 * using its first default model (independent of currently selected llm.provider/model).
 * Returns { ok, error? } so callers can surface the reason on failure.
 */
export async function testProvider(
  config: AppConfig,
  targetProvider?: ProviderID,
): Promise<{ ok: boolean; error?: string }> {
  const testConfig: AppConfig = targetProvider
    ? {
      ...config,
      llm: {
        ...config.llm,
        provider: targetProvider,
        model: PROVIDER_MODELS[targetProvider]?.[0] ?? config.llm.model,
      },
    }
    : config

  try {
    const provider = createProvider(testConfig)
    const gen = provider.stream({
      model: testConfig.llm.model,
      messages: [{ role: 'user', content: 'Hi' }],
      maxTokens: 10,
    })
    const first = await gen.next()
    await gen.return(undefined)
    if (first.value?.type === 'error') {
      return { ok: false, error: first.value.message }
    }
    return { ok: true }
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// Re-export registry accessor for callers that want to inspect available tools.
export { buildToolRegistry }
export type { ToolRegistry }
