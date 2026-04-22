/**
 * `lean-ai admin ...` — local administration CLI.
 *
 * Subcommands:
 *   admin create <username>       — create a platform admin user (+ tenant)
 *   admin promote <username>      — promote an existing user to platform admin
 *   admin reset-password <user>   — reset a user's password (prompted)
 *   admin list-users              — list all users
 *   admin list-tenants            — list all tenants
 *
 * These talk directly to the SQLite DB (no HTTP). Useful for:
 *   - Bootstrapping the first admin before the UI is reachable.
 *   - Recovering from a forgotten password without a running server.
 */
import readline from 'readline'
import chalk from 'chalk'
import {
  createUser, findUserByUsername, listUsers, listTenants,
  getTenant, createTenant, updateUser, updateUserPassword, toSafeUser,
} from '../../auth/users'

async function prompt(question: string, opts: { hidden?: boolean } = {}): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  if (opts.hidden) {
    // Hide password echo. Node's readline doesn't expose it directly — we mute stdout.
    const stdout = process.stdout as NodeJS.WriteStream & { _writeToOutput?: (s: string) => void }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(rl as any)._writeToOutput = function (s: string) {
      if (s.includes(question)) stdout.write(s)
      else stdout.write('*')
    }
  }
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close()
      if (opts.hidden) process.stdout.write('\n')
      resolve(answer.trim())
    })
  })
}

export async function adminCreateCommand(username: string, opts: {
  email?: string; tenant?: string; password?: string;
}): Promise<void> {
  if (findUserByUsername(username)) {
    console.error(chalk.red(`✗ 用户名 "${username}" 已存在。使用 "lean-ai admin promote" 将其升级为管理员。`))
    process.exit(1)
  }
  const password = opts.password || await prompt(`请输入新管理员 ${username} 的密码（至少 6 位）: `, { hidden: true })
  if (password.length < 6) {
    console.error(chalk.red('✗ 密码至少需要 6 位字符。'))
    process.exit(1)
  }
  const email = opts.email || await prompt('邮箱（可留空，回车跳过）: ')
  const tenantName = opts.tenant || `${username} 管理员工作区`

  // Create a dedicated admin tenant (enterprise plan, no expiry).
  const tenant = createTenant({
    name: tenantName, plan: 'enterprise', expiresAt: null, seats: 10,
    notes: '平台管理员工作区',
  })
  const user = createUser({
    tenantId: tenant.id,
    username,
    password,
    email: email || null,
    displayName: username,
    role: 'admin',
  })
  console.log(chalk.green(`✓ 管理员创建成功`))
  console.log(`  用户名:   ${user.username}`)
  console.log(`  邮箱:     ${user.email ?? '(未填)'}`)
  console.log(`  工作区:   ${tenant.name} (id=${tenant.id})`)
  console.log(`  访问方式: 启动 lean-ai，在登录页使用以上账号登录，右上角「管理后台」进入管理界面。`)
}

export async function adminPromoteCommand(username: string): Promise<void> {
  const user = findUserByUsername(username)
  if (!user) {
    console.error(chalk.red(`✗ 用户 "${username}" 不存在`))
    process.exit(1)
  }
  if (user.role === 'admin') {
    console.log(chalk.yellow(`用户 "${username}" 已经是管理员，无需操作。`))
    return
  }
  updateUser(user.id, { role: 'admin' })
  console.log(chalk.green(`✓ 用户 "${username}" 已升级为平台管理员`))
}

export async function adminResetPasswordCommand(username: string): Promise<void> {
  const user = findUserByUsername(username)
  if (!user) {
    console.error(chalk.red(`✗ 用户 "${username}" 不存在`))
    process.exit(1)
  }
  const password = await prompt(`请输入用户 ${username} 的新密码（至少 6 位）: `, { hidden: true })
  if (password.length < 6) {
    console.error(chalk.red('✗ 密码至少需要 6 位字符。'))
    process.exit(1)
  }
  updateUserPassword(user.id, password)
  console.log(chalk.green(`✓ 用户 "${username}" 的密码已重置`))
}

export function adminListUsersCommand(): void {
  const users = listUsers()
  if (users.length === 0) { console.log('（无用户）'); return }
  console.log(chalk.bold('用户列表:'))
  for (const u of users) {
    const t = getTenant(u.tenant_id)
    const roleBadge = u.role === 'admin' ? chalk.magenta('[ADMIN]') : '       '
    const statusBadge = u.status === 'active' ? chalk.green('●') : chalk.red('●')
    console.log(`  ${statusBadge} ${roleBadge} ${chalk.bold(u.username.padEnd(20))} ${u.email ?? '-'}  →  ${t?.name ?? '?'}`)
    void toSafeUser(u)
  }
}

export function adminListTenantsCommand(): void {
  const tenants = listTenants()
  if (tenants.length === 0) { console.log('（无租户）'); return }
  console.log(chalk.bold('租户列表:'))
  for (const t of tenants) {
    const users = listUsers({ tenantId: t.id }).length
    const exp = t.expires_at ? new Date(t.expires_at).toISOString().slice(0, 10) : '不限'
    const statusBadge = t.status === 'active' ? chalk.green('●') : chalk.red('●')
    console.log(`  ${statusBadge} id=${String(t.id).padEnd(3)} ${chalk.bold(t.name.padEnd(24))} plan=${t.plan.padEnd(10)} 到期=${exp}  用户=${users}`)
  }
}
