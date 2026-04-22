/**
 * Plan capabilities — feature flags controlling what each subscription plan is
 * allowed to do.  Complements `PlanDefinition.limits` (quantitative caps) with
 * boolean feature switches the admin can toggle per plan.
 *
 * Dimensions:
 *   - knowledgeImport   — allow uploading documents / adding KB entries
 *   - apiKeyConfig      — allow configuring LLM provider API keys (SettingsModal)
 *   - pages.*           — allow the sidebar nav buttons for knowledge / skills /
 *                         pricing / usage.  MVP default = all off; admin can
 *                         flip them on per plan.
 *   - skillAllowlist    — which skill packages are usable by this plan
 *                         ('*' = all).  Defaults come from plans.ts limits.skills,
 *                         but admin overrides in config.json take precedence.
 *
 * Overrides are stored under `config.planCapabilities` in ~/.lean-ai/config.json.
 * Missing keys fall through to defaults.
 */
import { PLANS, type PlanId } from './plans'
import { loadConfig, saveConfig } from '../config/manager'

export interface PageCapabilities {
  knowledge: boolean
  skills: boolean
  pricing: boolean
  usage: boolean
  admin: boolean       // 管理后台入口（只对 admin 角色实际可见，plan 粒度再叠一层开关）
}

export interface PlanCapabilities {
  knowledgeImport: boolean
  apiKeyConfig: boolean
  pages: PageCapabilities
  skillAllowlist: string[] | '*'
}

/**
 * MVP defaults — per the product requirement, all page jumps are closed by
 * default; the admin explicitly opens them for each plan.
 *
 * Data import / API-key config are also conservatively closed for free, open
 * for paid plans.  skillAllowlist mirrors plans.ts limits.skills.
 */
export const DEFAULT_PLAN_CAPABILITIES: Record<PlanId, PlanCapabilities> = {
  free: {
    knowledgeImport: false,
    apiKeyConfig: false,
    pages: { knowledge: false, skills: false, pricing: true, usage: true, admin: false },
    skillAllowlist: PLANS.free.limits.skills,
  },
  personal: {
    knowledgeImport: false,
    apiKeyConfig: false,
    pages: { knowledge: false, skills: false, pricing: true, usage: true, admin: false },
    skillAllowlist: PLANS.personal.limits.skills,
  },
  enterprise: {
    knowledgeImport: false,
    apiKeyConfig: false,
    pages: { knowledge: false, skills: false, pricing: true, usage: true, admin: true },
    skillAllowlist: PLANS.enterprise.limits.skills,
  },
}

type PartialCapsOverride = Partial<{
  knowledgeImport: boolean
  apiKeyConfig: boolean
  pages: Partial<PageCapabilities>
  skillAllowlist: string[] | '*'
}>

type StoredOverrides = Partial<Record<PlanId, PartialCapsOverride>>

function mergeCaps(defaults: PlanCapabilities, override?: PartialCapsOverride): PlanCapabilities {
  if (!override) return defaults
  return {
    knowledgeImport: override.knowledgeImport ?? defaults.knowledgeImport,
    apiKeyConfig: override.apiKeyConfig ?? defaults.apiKeyConfig,
    pages: { ...defaults.pages, ...(override.pages ?? {}) },
    skillAllowlist: override.skillAllowlist ?? defaults.skillAllowlist,
  }
}

/** Read stored admin overrides from config.json. */
function readOverrides(): StoredOverrides {
  const cfg = loadConfig()
  return (cfg.planCapabilities ?? {}) as StoredOverrides
}

/** Persist a full capability set for one plan (merges onto existing stored overrides). */
export function setPlanCapabilities(plan: PlanId, caps: PartialCapsOverride): void {
  const cfg = loadConfig()
  const current = (cfg.planCapabilities ?? {}) as StoredOverrides
  const next: StoredOverrides = { ...current }
  next[plan] = {
    ...(next[plan] ?? {}),
    ...caps,
    pages: { ...(next[plan]?.pages ?? {}), ...(caps.pages ?? {}) },
  }
  saveConfig({ ...cfg, planCapabilities: next as typeof cfg.planCapabilities })
}

/** Effective capabilities for a plan (defaults + admin overrides). */
export function getPlanCapabilities(plan: PlanId): PlanCapabilities {
  const overrides = readOverrides()
  return mergeCaps(DEFAULT_PLAN_CAPABILITIES[plan], overrides[plan])
}

/** Capability matrix for all plans (used by admin editor). */
export function getAllPlanCapabilities(): Record<PlanId, PlanCapabilities> {
  return {
    free: getPlanCapabilities('free'),
    personal: getPlanCapabilities('personal'),
    enterprise: getPlanCapabilities('enterprise'),
  }
}

/** Convenience: is a specific skill enabled for a plan? */
export function isSkillAllowedForPlan(plan: PlanId, skillPackage: string): boolean {
  const caps = getPlanCapabilities(plan)
  return caps.skillAllowlist === '*' || caps.skillAllowlist.includes(skillPackage)
}
