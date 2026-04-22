/**
 * Skill loader — takes a DiscoveredSkill, `require()`s its main entry, and
 * validates the exported ISkill shape. Errors are isolated per-skill: a
 * broken plugin produces a LoadedSkill with `ok: false` but does not crash
 * the core or prevent other skills from loading.
 */
import path from 'path'
import fs from 'fs'
import { getDb } from '../storage/db'
import { loadConfig, saveConfig } from '../config/manager'
import { discoverSkills, ensureSkillDataDir, type DiscoveredSkill } from './discovery'
import type {
  ISkill,
  LoadedSkill,
  SkillContext,
  SkillDataStore,
  SkillConfigAccessor,
  SkillToolDefinition,
} from './types'

/** Load every discovered skill, returning both good and broken entries. */
export function loadAllSkills(): LoadedSkill[] {
  return discoverSkills().map(loadOneSkill)
}

export function loadOneSkill(discovered: DiscoveredSkill): LoadedSkill {
  try {
    if (!fs.existsSync(discovered.mainFile)) {
      return {
        ok: false,
        packageName: discovered.packageName,
        packageDir: discovered.packageDir,
        error: `入口文件不存在: ${path.relative(discovered.packageDir, discovered.mainFile)}`,
      }
    }

    // Invalidate cache so `pnpm dev` watchers and `lean-ai skill install` pick up updates
    // on the next scan without a full process restart.
    invalidateRequireCache(discovered.mainFile)

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod: unknown = require(discovered.mainFile)
    const raw = extractDefault(mod)
    const validation = validateSkill(raw, discovered.packageName)
    if (!validation.ok) {
      return {
        ok: false,
        packageName: discovered.packageName,
        packageDir: discovered.packageDir,
        error: validation.error,
      }
    }

    return { ok: true, skill: validation.skill, packageDir: discovered.packageDir }
  } catch (err: unknown) {
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err)
    return {
      ok: false,
      packageName: discovered.packageName,
      packageDir: discovered.packageDir,
      error: msg,
    }
  }
}

function extractDefault(mod: unknown): unknown {
  if (mod && typeof mod === 'object' && 'default' in (mod as Record<string, unknown>)) {
    return (mod as Record<string, unknown>).default
  }
  return mod
}

interface ValidationOk { ok: true; skill: ISkill }
interface ValidationErr { ok: false; error: string }

function validateSkill(raw: unknown, expectedName: string): ValidationOk | ValidationErr {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: '导出的不是对象。请确保 default export 是 ISkill 对象。' }
  }
  const s = raw as Record<string, unknown>

  if (typeof s.packageName !== 'string') return { ok: false, error: '缺少 packageName 字段' }
  if (s.packageName !== expectedName) {
    return { ok: false, error: `packageName 不匹配：清单声明为 "${expectedName}"，导出对象声明为 "${s.packageName}"` }
  }
  if (typeof s.displayName !== 'string') return { ok: false, error: '缺少 displayName 字段' }
  if (typeof s.description !== 'string') return { ok: false, error: '缺少 description 字段' }
  if (typeof s.version !== 'string') return { ok: false, error: '缺少 version 字段' }
  if (!Array.isArray(s.tools)) return { ok: false, error: 'tools 必须是数组' }

  const seen = new Set<string>()
  for (let i = 0; i < s.tools.length; i++) {
    const t = s.tools[i] as Record<string, unknown>
    if (!t || typeof t !== 'object') return { ok: false, error: `tools[${i}] 不是对象` }
    if (typeof t.name !== 'string') return { ok: false, error: `tools[${i}].name 必须是字符串` }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(t.name)) {
      return { ok: false, error: `tools[${i}].name "${t.name}" 非法 — 必须是合法标识符（字母/数字/下划线）` }
    }
    if (seen.has(t.name)) return { ok: false, error: `tool name "${t.name}" 在本 Skill 内重复` }
    seen.add(t.name)
    if (typeof t.description !== 'string') return { ok: false, error: `tools[${i}].description 必须是字符串` }
    if (!t.inputSchema || typeof t.inputSchema !== 'object') {
      return { ok: false, error: `tools[${i}].inputSchema 缺失或格式错误` }
    }
    if (typeof t.execute !== 'function') {
      return { ok: false, error: `tools[${i}].execute 必须是函数` }
    }
  }

  return { ok: true, skill: raw as ISkill }
}

function invalidateRequireCache(entryPath: string): void {
  const resolved = (() => {
    try { return require.resolve(entryPath) } catch { return entryPath }
  })()
  const pkgDir = path.dirname(resolved)
  for (const key of Object.keys(require.cache)) {
    // Drop every cached file that lives in the same skill package directory.
    if (key.startsWith(pkgDir + path.sep) || key === resolved) {
      delete require.cache[key]
    }
  }
}

// ---- Context construction ---------------------------------------------------

export function createSkillContext(
  skill: ISkill,
  conversationId: string,
): SkillContext {
  return {
    conversationId,
    db: getDb(),
    data: createDataStore(skill.packageName),
    dataDir: ensureSkillDataDir(skill.packageName),
    config: createConfigAccessor(skill.packageName),
    log: (level, msg, meta) => {
      const tag = `[skill:${skill.packageName}]`
      const line = meta ? `${tag} ${msg} ${JSON.stringify(meta)}` : `${tag} ${msg}`
      if (level === 'error') console.error(line)
      else if (level === 'warn') console.warn(line)
      else console.log(line)
    },
  }
}

function createDataStore(skillName: string): SkillDataStore {
  const db = getDb()
  const get = db.prepare('SELECT value FROM skill_data WHERE skill_name = ? AND key = ?')
  const upsert = db.prepare(
    'INSERT INTO skill_data (skill_name, key, value, updated_at) VALUES (?, ?, ?, ?) ' +
    'ON CONFLICT(skill_name, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
  )
  const del = db.prepare('DELETE FROM skill_data WHERE skill_name = ? AND key = ?')
  return {
    get(key) {
      const row = get.get(skillName, key) as { value: string } | undefined
      return row?.value
    },
    set(key, value) { upsert.run(skillName, key, value, Date.now()) },
    delete(key) { del.run(skillName, key) },
    getJSON<T = unknown>(key: string): T | undefined {
      const raw = (get.get(skillName, key) as { value: string } | undefined)?.value
      if (raw === undefined) return undefined
      try { return JSON.parse(raw) as T } catch { return undefined }
    },
    setJSON(key, value) { upsert.run(skillName, key, JSON.stringify(value), Date.now()) },
  }
}

function createConfigAccessor(skillName: string): SkillConfigAccessor {
  return {
    get<T = unknown>(key?: string): T | undefined {
      const cfg = loadConfig()
      const bag = cfg.skills.configs[skillName]
      if (!bag || typeof bag !== 'object') return undefined
      if (!key) return bag as T
      return (bag as Record<string, unknown>)[key] as T
    },
    set(key, value) {
      const cfg = loadConfig()
      const current = (cfg.skills.configs[skillName] ?? {}) as Record<string, unknown>
      current[key] = value
      cfg.skills.configs[skillName] = current
      saveConfig(cfg)
    },
  }
}

// ---- Enabled/disabled ------------------------------------------------------

export function isSkillDisabled(packageName: string): boolean {
  return loadConfig().skills.disabled.includes(packageName)
}

export function setSkillEnabled(packageName: string, enabled: boolean): void {
  const cfg = loadConfig()
  const disabled = new Set(cfg.skills.disabled)
  if (enabled) disabled.delete(packageName)
  else disabled.add(packageName)
  cfg.skills.disabled = Array.from(disabled)
  saveConfig(cfg)
}

// Re-export for callers that only want the type.
export type { SkillToolDefinition }
