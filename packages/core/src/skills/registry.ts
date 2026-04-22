/**
 * ToolRegistry — the aggregation point between the loaded Skill plugins and
 * the agent loop. The agent asks the registry for:
 *   1. The list of tool *definitions* to send to the LLM.
 *   2. A dispatcher that executes a tool call by name.
 *
 * The registry is re-built on demand (per chat turn) rather than kept long-
 * lived in memory so that `lean-ai skill install` mid-session picks up the
 * new skill on the next message without a server restart.
 */
import { loadAllSkills, createSkillContext, isSkillDisabled } from './loader'
import { ensureSkillDataDir } from './discovery'
import { getDb } from '../storage/db'
import { loadConfig, saveConfig } from '../config/manager'
import type {
  ISkill,
  LoadedSkill,
  SkillContext,
  SkillToolDefinition,
  SkillToolResult,
} from './types'

/**
 * Track which skills have already had their lifecycle hooks run in this
 * process, so we don't redundantly re-activate them on every chat turn.
 * Keyed by `${packageName}@${version}` so a re-installed skill picks up
 * onActivate again.
 */
const activatedKeys = new Set<string>()

export interface RegisteredTool {
  /** Globally-unique tool name (skill prefix prevents collisions). */
  name: string
  /** Original tool name as declared by the skill. */
  localName: string
  /** Owning skill package name. */
  skillPackageName: string
  /** Human-readable label. */
  skillDisplayName: string
  description: string
  inputSchema: SkillToolDefinition['inputSchema']
}

export interface ToolRegistrySnapshot {
  tools: RegisteredTool[]
  /** Skills that loaded successfully. */
  enabled: Array<{ packageName: string; displayName: string; version: string; toolCount: number }>
  /** Skills discovered on disk but currently disabled in config. */
  disabled: Array<{ packageName: string; displayName: string; version: string; toolCount: number }>
  /** Skills that failed to load. */
  broken: Array<{ packageName: string; error: string }>
}

export interface ToolRegistry {
  snapshot: ToolRegistrySnapshot
  /** Dispatch a tool call by its registered (globally-unique) name. */
  dispatch(
    toolName: string,
    input: Record<string, unknown>,
    conversationId: string,
  ): Promise<SkillToolResult>
}

/**
 * Build a fresh registry. The returned object is cheap to discard; call this
 * at the start of each agent turn to pick up on-disk changes.
 */
export function buildToolRegistry(): ToolRegistry {
  const loaded: LoadedSkill[] = loadAllSkills()

  const enabled: Array<{ packageName: string; displayName: string; version: string; toolCount: number }> = []
  const disabled: Array<{ packageName: string; displayName: string; version: string; toolCount: number }> = []
  const broken: Array<{ packageName: string; error: string }> = []

  // Map registered tool name -> { skill, localTool }
  const byName = new Map<string, { skill: ISkill; tool: SkillToolDefinition }>()
  const tools: RegisteredTool[] = []

  for (const entry of loaded) {
    if (!entry.ok) {
      broken.push({ packageName: entry.packageName, error: entry.error })
      continue
    }
    const skill = entry.skill
    const meta = {
      packageName: skill.packageName,
      displayName: skill.displayName,
      version: skill.version,
      toolCount: skill.tools.length,
    }
    if (isSkillDisabled(skill.packageName)) {
      disabled.push(meta)
      continue
    }
    enabled.push(meta)

    // Fire onActivate once per (package@version) per process. Best-effort —
    // failures are logged but don't block the tools from registering.
    activateOnce(skill)

    const prefix = makePrefix(skill.packageName)
    for (const tool of skill.tools) {
      const registeredName = uniqueName(prefix, tool.name, byName)
      byName.set(registeredName, { skill, tool })
      tools.push({
        name: registeredName,
        localName: tool.name,
        skillPackageName: skill.packageName,
        skillDisplayName: skill.displayName,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })
    }
  }

  return {
    snapshot: { tools, enabled, disabled, broken },
    async dispatch(toolName, input, conversationId) {
      const entry = byName.get(toolName)
      if (!entry) {
        return {
          content: `未知工具：${toolName}。请检查工具是否已启用。`,
          isError: true,
        }
      }
      const ctx = createSkillContext(entry.skill, conversationId)
      try {
        return await entry.tool.execute(input ?? {}, ctx)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        ctx.log('error', `tool "${entry.tool.name}" threw: ${msg}`)
        return { content: `工具执行失败：${msg}`, isError: true }
      }
    },
  }
}

/**
 * Run a skill's onActivate hook at most once per (packageName@version) per process.
 * The hook receives a context without conversationId (it's process-level, not
 * per-turn). Failures are logged and swallowed — they must not break tool
 * registration for this or other skills.
 */
function activateOnce(skill: ISkill): void {
  const key = `${skill.packageName}@${skill.version}`
  if (activatedKeys.has(key)) return
  activatedKeys.add(key)

  if (typeof skill.onActivate !== 'function') return

  // Build a process-level context (no conversationId; reuse loader helpers via a
  // synthetic conversation id internally — simpler to just construct directly).
  const ctx: Omit<SkillContext, 'conversationId'> = {
    db: getDb(),
    data: {
      get: (k) => {
        const row = getDb().prepare('SELECT value FROM skill_data WHERE skill_name = ? AND key = ?')
          .get(skill.packageName, k) as { value: string } | undefined
        return row?.value
      },
      set: (k, v) => {
        getDb().prepare(
          'INSERT INTO skill_data (skill_name, key, value, updated_at) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT(skill_name, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
        ).run(skill.packageName, k, v, Date.now())
      },
      delete: (k) => { getDb().prepare('DELETE FROM skill_data WHERE skill_name = ? AND key = ?').run(skill.packageName, k) },
      getJSON: (k) => {
        const row = getDb().prepare('SELECT value FROM skill_data WHERE skill_name = ? AND key = ?')
          .get(skill.packageName, k) as { value: string } | undefined
        if (!row) return undefined
        try { return JSON.parse(row.value) } catch { return undefined }
      },
      setJSON: (k, v) => {
        getDb().prepare(
          'INSERT INTO skill_data (skill_name, key, value, updated_at) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT(skill_name, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
        ).run(skill.packageName, k, JSON.stringify(v), Date.now())
      },
    },
    dataDir: ensureSkillDataDir(skill.packageName),
    config: {
      get: <T = unknown>(k?: string): T | undefined => {
        const cfg = loadConfig()
        const bag = cfg.skills.configs[skill.packageName]
        if (!bag || typeof bag !== 'object') return undefined
        if (!k) return bag as T
        return (bag as Record<string, unknown>)[k] as T
      },
      set: (k, v) => {
        const cfg = loadConfig()
        const current = (cfg.skills.configs[skill.packageName] ?? {}) as Record<string, unknown>
        current[k] = v
        cfg.skills.configs[skill.packageName] = current
        saveConfig(cfg)
      },
    },
    log: (level, msg, meta) => {
      const tag = `[skill:${skill.packageName}]`
      const line = meta ? `${tag} ${msg} ${JSON.stringify(meta)}` : `${tag} ${msg}`
      if (level === 'error') console.error(line)
      else if (level === 'warn') console.warn(line)
      else console.log(line)
    },
  }

  // Fire-and-forget; don't await (registry is sync). The hook should be
  // idempotent and complete quickly. Promise rejections are swallowed.
  Promise.resolve()
    .then(() => skill.onActivate?.(ctx))
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[skill:${skill.packageName}] onActivate threw: ${msg}`)
    })
}

/**
 * Derive a short LLM-friendly prefix from a package name.
 *   "@lean-ai/skill-diagnosis" -> "diag"
 *   "skill-charts"             -> "charts"
 * Falls back to the sanitized full name if nothing sensible can be extracted.
 */
function makePrefix(packageName: string): string {
  // Strip scope and leading "skill-".
  const stripped = packageName.replace(/^@[^/]+\//, '').replace(/^skill-/, '')
  // Shorten well-known prefixes to keep tool names concise.
  const short = stripped.replace(/^diagnosis$/, 'diag')
    .replace(/^knowledge$/, 'kb')
    .replace(/^charts$/, 'chart')
    .replace(/^reports$/, 'report')
  return short.replace(/[^a-zA-Z0-9_]/g, '_')
}

function uniqueName(
  prefix: string,
  local: string,
  taken: Map<string, unknown>,
): string {
  // If the local name already starts with the prefix, don't double-prefix.
  const base = local.startsWith(prefix + '_') || local === prefix
    ? local
    : `${prefix}_${local}`
  if (!taken.has(base)) return base
  // Collision — append a suffix. Shouldn't happen in practice but keeps invariants.
  let i = 2
  while (taken.has(`${base}_${i}`)) i++
  return `${base}_${i}`
}
