/**
 * Skill package manager — wraps `npm install|uninstall` with the skills dir
 * as the prefix. `npm install --prefix ~/.lean-ai/skills/ <pkg>` places the
 * package under `~/.lean-ai/skills/node_modules/<pkg>/`, which discovery.ts
 * then scans.
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { getSkillsRoot, getSkillsNodeModules, discoverSkills } from './discovery'

export interface InstallResult {
  ok: boolean
  packageName: string
  stdout: string
  stderr: string
  durationMs: number
}

/**
 * Ensure `~/.lean-ai/skills/package.json` exists (npm requires it under --prefix).
 * This is a private install tree, not a published package.
 */
function ensureSkillsTree(): void {
  const root = getSkillsRoot()
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true })
  const pkgJson = path.join(root, 'package.json')
  if (!fs.existsSync(pkgJson)) {
    fs.writeFileSync(pkgJson, JSON.stringify({
      name: 'lean-ai-skills-root',
      version: '0.0.0',
      private: true,
      description: 'LeanAI skills install tree (managed by `lean-ai skill install`).',
    }, null, 2))
  }
}

/**
 * Install a skill package. Accepts anything npm accepts:
 *  - registry:   "@lean-ai/skill-diagnosis"  or "@lean-ai/skill-diagnosis@1.2.3"
 *  - local path: "/abs/path/to/skill" or "./relative"
 *  - tarball:    "https://example.com/skill.tgz"
 *  - git:        "github:user/repo"
 */
export async function installSkill(pkgSpec: string): Promise<InstallResult> {
  ensureSkillsTree()
  const started = Date.now()
  const { code, stdout, stderr } = await runNpm(['install', '--prefix', getSkillsRoot(), '--no-audit', '--no-fund', pkgSpec])
  const durationMs = Date.now() - started

  // npm doesn't return the canonical installed name, so resolve it by scanning
  // what landed in node_modules. We match by best guess: if the spec contains
  // a name (scoped or bare), use it; otherwise return the first new package.
  const packageName = inferPackageName(pkgSpec)
  return { ok: code === 0, packageName, stdout, stderr, durationMs }
}

export async function removeSkill(packageName: string): Promise<InstallResult> {
  ensureSkillsTree()
  const started = Date.now()
  const { code, stdout, stderr } = await runNpm(['uninstall', '--prefix', getSkillsRoot(), packageName])
  return { ok: code === 0, packageName, stdout, stderr, durationMs: Date.now() - started }
}

export function listInstalledSkills(): Array<{
  packageName: string
  version: string
  displayName: string
  description: string
  packageDir: string
}> {
  return discoverSkills().map(s => ({
    packageName: s.packageName,
    version: s.version,
    displayName: s.displayName,
    description: s.description,
    packageDir: s.packageDir,
  }))
}

/** True if the given package exists in the skills install tree (regardless of leanAiSkill flag). */
export function isInstalled(packageName: string): boolean {
  const dir = path.join(getSkillsNodeModules(), ...packageName.split('/'))
  return fs.existsSync(path.join(dir, 'package.json'))
}

function inferPackageName(spec: string): string {
  // If the spec looks like a registry name (@scope/name[@version] or name[@version]), take the name portion.
  const m = spec.match(/^(@[^/]+\/[^@]+|[^@][^@]*)/)
  if (m) return m[1]
  return spec
}

interface NpmResult { code: number; stdout: string; stderr: string }

function runNpm(args: string[]): Promise<NpmResult> {
  return new Promise(resolve => {
    const child = spawn('npm', args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => { stdout += d.toString() })
    child.stderr.on('data', d => { stderr += d.toString() })
    child.on('error', err => resolve({ code: -1, stdout, stderr: stderr + '\n' + err.message }))
    child.on('close', code => resolve({ code: code ?? -1, stdout, stderr }))
  })
}
