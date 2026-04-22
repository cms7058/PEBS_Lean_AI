/**
 * Public surface of the skills subsystem. Skill package authors should import
 * types from `@lean-ai/core/skills` (resolved via package.json exports) rather
 * than reaching into individual files.
 */
export type {
  ISkill,
  SkillToolDefinition,
  SkillToolResult,
  SkillArtifact,
  SkillContext,
  SkillDataStore,
  SkillConfigAccessor,
  JSONSchemaObject,
  LoadedSkill,
} from './types'

export { discoverSkills, getSkillsRoot, getSkillsNodeModules, getSkillDataDir } from './discovery'
export { loadAllSkills, loadOneSkill, isSkillDisabled, setSkillEnabled } from './loader'
export { installSkill, removeSkill, listInstalledSkills, isInstalled } from './manager'
export { buildToolRegistry, type ToolRegistry, type RegisteredTool, type ToolRegistrySnapshot } from './registry'
