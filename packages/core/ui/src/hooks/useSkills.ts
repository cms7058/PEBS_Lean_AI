import { useCallback, useEffect, useState } from 'react'
import { api, type SkillEntry } from '../lib/api'

/**
 * Skills list + mutations.
 *
 * `loading` reflects the initial fetch; `busy` reflects an in-flight
 * install/remove/toggle so the UI can disable buttons & show a spinner.
 */
export function useSkills() {
  const [skills, setSkills] = useState<SkillEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null) // pkgName or 'install'
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const { skills } = await api.getSkills()
      setSkills(skills)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  const toggle = useCallback(async (pkg: string, enabled: boolean) => {
    setBusy(pkg)
    setError(null)
    try {
      await api.toggleSkill(pkg, enabled)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }, [reload])

  const install = useCallback(async (spec: string) => {
    setBusy('install')
    setError(null)
    try {
      const r = await api.installSkill(spec)
      if (!r.ok) setError(r.error ?? '安装失败')
      await reload()
      return r
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return { ok: false as const, error: String(err) }
    } finally {
      setBusy(null)
    }
  }, [reload])

  const remove = useCallback(async (pkg: string) => {
    setBusy(pkg)
    setError(null)
    try {
      await api.removeSkill(pkg)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }, [reload])

  return { skills, loading, busy, error, reload, toggle, install, remove, setError }
}
