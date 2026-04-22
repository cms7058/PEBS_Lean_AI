/**
 * /api/skills — list installed skills, toggle enable/disable, install/remove.
 *
 * The list endpoint is used by the UI sidebar; install/remove are exposed for
 * convenience so the user can manage skills from the web UI without opening a
 * terminal. They run `npm install` underneath and can take seconds — the UI
 * should show a spinner.
 */
import { Router, type Request, type Response } from 'express'
import { loadAllSkills, setSkillEnabled, isSkillDisabled } from '../../skills/loader'
import { installSkill, removeSkill } from '../../skills/manager'
import { checkSkillAllowed } from '../../billing/manager'

const router = Router()

/**
 * GET /api/skills
 * Returns all discovered skills (good + broken) with enabled/disabled state.
 */
router.get('/', (_req: Request, res: Response) => {
  const loaded = loadAllSkills()
  const skills = loaded.map(entry => {
    if (entry.ok) {
      const allowed = checkSkillAllowed(entry.skill.packageName)
      return {
        ok: true,
        packageName: entry.skill.packageName,
        displayName: entry.skill.displayName,
        description: entry.skill.description,
        version: entry.skill.version,
        enabled: !isSkillDisabled(entry.skill.packageName) && allowed.allowed,
        locked: !allowed.allowed,
        lockReason: allowed.allowed ? undefined : allowed.reason,
        tools: entry.skill.tools.map(t => ({
          name: t.name,
          description: t.description,
        })),
      }
    }
    return {
      ok: false,
      packageName: entry.packageName,
      error: entry.error,
      packageDir: entry.packageDir,
    }
  })
  res.json({ skills })
})

/**
 * POST /api/skills/:packageName/toggle
 * Body: { enabled: boolean }
 */
router.post('/:packageName/toggle', (req: Request, res: Response) => {
  const { enabled } = req.body as { enabled?: boolean }
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'body.enabled must be boolean' })
    return
  }
  // Decode URL-encoded package name (scoped packages have a '/' in them).
  const packageName = decodeURIComponent(req.params.packageName as string)
  // Only enforce quota when enabling; disabling is always allowed.
  if (enabled) {
    const q = checkSkillAllowed(packageName)
    if (!q.allowed) {
      res.status(402).json({ error: q.reason, upgradeRequired: true })
      return
    }
  }
  setSkillEnabled(packageName, enabled)
  res.json({ ok: true, packageName, enabled })
})

/**
 * POST /api/skills/install
 * Body: { packageSpec: string }
 */
router.post('/install', async (req: Request, res: Response) => {
  const { packageSpec } = req.body as { packageSpec?: string }
  if (!packageSpec || typeof packageSpec !== 'string') {
    res.status(400).json({ error: 'body.packageSpec is required' })
    return
  }
  const result = await installSkill(packageSpec)
  if (!result.ok) {
    res.status(500).json({ ok: false, error: result.stderr.trim() || 'npm install failed', durationMs: result.durationMs })
    return
  }
  res.json({ ok: true, packageName: result.packageName, durationMs: result.durationMs })
})

/**
 * DELETE /api/skills/:packageName
 */
router.delete('/:packageName', async (req: Request, res: Response) => {
  const packageName = decodeURIComponent(req.params.packageName as string)
  const result = await removeSkill(packageName)
  if (!result.ok) {
    res.status(500).json({ ok: false, error: result.stderr.trim() || 'npm uninstall failed' })
    return
  }
  res.json({ ok: true, packageName })
})

export default router
