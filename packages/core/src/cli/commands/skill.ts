/**
 * `lean-ai skill install|remove|list` — real implementations backed by the
 * skills subsystem (npm install with --prefix ~/.lean-ai/skills/).
 */
import chalk from 'chalk'
import { installSkill, removeSkill, listInstalledSkills, isSkillDisabled } from '../../skills'
import { loadAllSkills } from '../../skills/loader'

export async function skillInstallCommand(packageSpec: string): Promise<void> {
  console.log(chalk.gray(`  正在安装 ${packageSpec}...`))
  const before = new Set(listInstalledSkills().map(s => s.packageName))
  const result = await installSkill(packageSpec)
  if (!result.ok) {
    console.log(chalk.red(`  ✗ 安装失败`))
    if (result.stderr.trim()) console.log(chalk.gray(result.stderr.trim().split('\n').map(l => '    ' + l).join('\n')))
    process.exitCode = 1
    return
  }
  console.log(chalk.green(`  ✓ 安装成功 (${(result.durationMs / 1000).toFixed(1)}s)`))
  // Post-install scan: the npm install may have resolved to a different package
  // name than the spec (local paths, tarballs, git). Use a before/after diff.
  const after = listInstalledSkills()
  const added = after.filter(s => !before.has(s.packageName))
  if (added.length === 0) {
    console.log(chalk.yellow(`  ⚠ 安装完成，但未检测到新的 Skill（请确认包的 package.json 含 "leanAiSkill": true）。`))
    return
  }
  for (const s of added) {
    console.log(chalk.gray(`    ${s.displayName} v${s.version}  (${s.packageName})`))
    if (s.description) console.log(chalk.gray(`    ${s.description}`))
  }
}

export async function skillRemoveCommand(packageName: string): Promise<void> {
  console.log(chalk.gray(`  正在移除 ${packageName}...`))
  const result = await removeSkill(packageName)
  if (result.ok) {
    console.log(chalk.green(`  ✓ 已移除 ${packageName}`))
  } else {
    console.log(chalk.red(`  ✗ 移除失败`))
    if (result.stderr.trim()) console.log(chalk.gray(result.stderr.trim().split('\n').map(l => '    ' + l).join('\n')))
    process.exitCode = 1
  }
}

export function skillListCommand(): void {
  const loaded = loadAllSkills()
  const good = loaded.filter((x): x is Extract<typeof x, { ok: true }> => x.ok)
  const broken = loaded.filter((x): x is Extract<typeof x, { ok: false }> => !x.ok)

  if (good.length === 0 && broken.length === 0) {
    console.log(chalk.gray('  （暂无已安装的 Skill）'))
    console.log()
    console.log(chalk.gray('  安装示例:'))
    console.log(chalk.gray('    lean-ai skill install @lean-ai/skill-diagnosis'))
    console.log(chalk.gray('    lean-ai skill install ./path/to/local-skill'))
    return
  }

  if (good.length > 0) {
    console.log(chalk.cyan('  已安装的 Skill:'))
    for (const entry of good) {
      const disabled = isSkillDisabled(entry.skill.packageName)
      const tag = disabled ? chalk.yellow('[已禁用]') : chalk.green('[已启用]')
      console.log(`  ${tag} ${chalk.bold(entry.skill.displayName)} ${chalk.gray(`(${entry.skill.packageName}@${entry.skill.version})`)}`)
      if (entry.skill.description) console.log(chalk.gray(`         ${entry.skill.description}`))
      console.log(chalk.gray(`         工具: ${entry.skill.tools.map(t => t.name).join(', ') || '（无）'}`))
    }
  }

  if (broken.length > 0) {
    console.log()
    console.log(chalk.red('  加载失败的 Skill:'))
    for (const entry of broken) {
      console.log(`  ${chalk.red('[损坏]')} ${entry.packageName}`)
      console.log(chalk.gray(`         ${entry.error.split('\n')[0]}`))
    }
  }
}
