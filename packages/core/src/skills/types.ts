/**
 * Skill plugin interface definitions.
 *
 * A Skill is an npm package with `"leanAiSkill": true` in its `package.json`
 * that default-exports an `ISkill` object. At runtime the core discovers
 * skills in `~/.lean-ai/skills/node_modules/`, loads them, and registers
 * their tools with the agent so the LLM can call them via tool use.
 *
 * This file is the contract between the core and skill packages. Changing
 * it is a breaking change for the plugin ecosystem.
 */
import type Database from 'better-sqlite3'

/**
 * A minimal JSON Schema subset suitable for LLM tool input schemas.
 * We don't validate the full spec — LLM providers do their own validation.
 */
export interface JSONSchemaObject {
  type: 'object'
  properties?: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
  description?: string
  [key: string]: unknown
}

/**
 * Artifact attached to a tool result — rendered by the UI.
 * `content` is what the LLM reads; `artifact` is what the user sees.
 */
export interface SkillArtifact {
  /**
   * Rendering hint. Built-ins: 'drawio' | 'chartjs' | 'plotly' | 'table' | 'file' | 'markdown'.
   * Custom values are allowed — the UI falls back to a generic "unknown artifact" card.
   */
  type: string
  data: unknown
  /** Optional filename for downloadable artifacts. */
  filename?: string
  /** Optional MIME type (e.g. 'image/svg+xml'). */
  mimeType?: string
}

export interface SkillToolResult {
  /** Text returned to the LLM. Keep it concise — the model re-reads this on every turn. */
  content: string
  /** Rich payload rendered by the UI. Not sent to the LLM. */
  artifact?: SkillArtifact
  /** If true, framed as an error message to the LLM. */
  isError?: boolean
}

/** Per-skill KV accessor backed by the `skill_data` SQLite table. */
export interface SkillDataStore {
  get(key: string): string | undefined
  set(key: string, value: string): void
  delete(key: string): void
  /** Convenience: JSON-parsed getter / stringified setter. */
  getJSON<T = unknown>(key: string): T | undefined
  setJSON(key: string, value: unknown): void
}

/** Accessor for this skill's user-editable configuration (lives in config.skills.configs[pkg]). */
export interface SkillConfigAccessor {
  get<T = unknown>(key?: string): T | undefined
  set(key: string, value: unknown): void
}

/**
 * Runtime context passed to every tool `execute` call and to lifecycle hooks.
 * Skills should NOT store these on the module scope — they may differ between
 * reloads and the conversation/data handles are bound to the current request.
 */
export interface SkillContext {
  /** Current conversation id — for scoping diagnosis sessions etc. */
  conversationId: string
  /** Shared SQLite handle. Skills should create their own tables if needed. */
  db: Database.Database
  /** Per-skill KV store (backed by `skill_data` table, scoped by package name). */
  data: SkillDataStore
  /** Directory for skill-local files: `~/.lean-ai/skills-data/<package>/`. */
  dataDir: string
  /** Accessor for this skill's user-editable configuration. */
  config: SkillConfigAccessor
  /** Structured logger for the skill (writes to lean-ai.log with [skill:<name>] prefix). */
  log(level: 'info' | 'warn' | 'error', msg: string, meta?: Record<string, unknown>): void
}

export interface SkillToolDefinition {
  /** Unique tool name — the LLM invokes this. Recommended: snake_case, skill-scoped (e.g. "diag_start"). */
  name: string
  /** What the tool does — the LLM reads this to decide whether to call. */
  description: string
  /** JSON Schema for the tool's input parameters. */
  inputSchema: JSONSchemaObject
  /** Executes the tool. Called with validated input and a scoped context. */
  execute(input: Record<string, unknown>, context: SkillContext): Promise<SkillToolResult>
}

export interface ISkill {
  /** npm package name — must match the installed package. */
  packageName: string
  /** Short label shown in the UI. */
  displayName: string
  /** One-line description. */
  description: string
  /** Semver. */
  version: string
  /** Tools this skill contributes. */
  tools: SkillToolDefinition[]
  /** JSON Schema describing the skill's user-editable config (for auto-generated settings UI). */
  configSchema?: JSONSchemaObject
  /** Called once after `npm install`. Idempotent — may run on every start. */
  onInstall?(context: Omit<SkillContext, 'conversationId'>): Promise<void>
  /** Called on every core start when the skill is enabled. */
  onActivate?(context: Omit<SkillContext, 'conversationId'>): Promise<void>
}

/**
 * Result of loading a skill package — either the parsed manifest or an error
 * (loader never throws; it surfaces errors so the UI can display broken skills).
 */
export type LoadedSkill =
  | { ok: true; skill: ISkill; packageDir: string }
  | { ok: false; packageName: string; packageDir: string; error: string }
