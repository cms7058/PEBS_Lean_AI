/**
 * Skill discovery — scans `~/.lean-ai/skills/node_modules/` for packages
 * marked with `"leanAiSkill": true` in their `package.json`.
 *
 * Scoped packages (e.g. `@lean-ai/skill-diagnosis`) are supported.
 */
import fs from 'fs'
import path from 'path'
import { getDataDir } from '../config/manager'

export interface DiscoveredSkill {
  packageName: string
  packageDir: string
  mainFile: string
  version: string
  displayName: string
  description: string
}

/**
 * Returns the root directory where skill packages are installed.
 * We install with `npm install --prefix ~/.lean-ai/skills/` so packages land
 * under `~/.lean-ai/skills/node_modules/`.
 */
export function getSkillsRoot(): string {
  return path.join(getDataDir(), 'skills')
}

export function getSkillsNodeModules(): string {
  return path.join(getSkillsRoot(), 'node_modules')
}

/** Per-skill data dir (created on demand), separate from the npm install tree. */
export function getSkillDataDir(packageName: string): string {
  // Replace "@scope/name" with "scope__name" for safe filesystem use.
  const safe = packageName.replace(/^@/, '').replace(/\//g, '__')
  return path.join(getDataDir(), 'skills-data', safe)
}

export function ensureSkillDataDir(packageName: string): string {
  const dir = getSkillDataDir(packageName)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Scan the skill install tree. Non-throwing — returns an empty list if the
 * directory doesn't exist yet.
 */
export function discoverSkills(): DiscoveredSkill[] {
  const root = getSkillsNodeModules()
  if (!fs.existsSync(root)) return []

  const results: DiscoveredSkill[] = []
  for (const entry of readDirSafe(root)) {
    const entryPath = path.join(root, entry)
    if (!isDirectory(entryPath)) continue

    if (entry.startsWith('@')) {
      // Scoped: scan one level deeper.
      for (const scopedEntry of readDirSafe(entryPath)) {
        const scopedPath = path.join(entryPath, scopedEntry)
        if (!isDirectory(scopedPath)) continue
        const discovered = tryReadManifest(scopedPath)
        if (discovered) results.push(discovered)
      }
    } else if (entry !== '.bin' && !entry.startsWith('.')) {
      const discovered = tryReadManifest(entryPath)
      if (discovered) results.push(discovered)
    }
  }

  return results
}

function tryReadManifest(packageDir: string): DiscoveredSkill | null {
  const manifestPath = path.join(packageDir, 'package.json')
  if (!fs.existsSync(manifestPath)) return null

  let raw: string
  try {
    raw = fs.readFileSync(manifestPath, 'utf-8')
  } catch {
    return null
  }

  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }

  // Only skills opt in with the `leanAiSkill` flag (or `lean-ai-skill`, allow either spelling).
  const optIn = pkg.leanAiSkill === true || pkg['lean-ai-skill'] === true
  if (!optIn) return null

  const packageName = typeof pkg.name === 'string' ? pkg.name : null
  if (!packageName) return null

  const mainRel = typeof pkg.main === 'string' ? pkg.main : 'index.js'
  const mainFile = path.join(packageDir, mainRel)

  return {
    packageName,
    packageDir,
    mainFile,
    version: typeof pkg.version === 'string' ? pkg.version : '0.0.0',
    displayName:
      typeof pkg.leanAiDisplayName === 'string' ? pkg.leanAiDisplayName :
      typeof pkg.displayName === 'string' ? pkg.displayName :
      packageName,
    description: typeof pkg.description === 'string' ? pkg.description : '',
  }
}

function readDirSafe(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}
