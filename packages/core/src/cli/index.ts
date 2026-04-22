import { Command } from 'commander'
import { startCommand } from './commands/start'
import { configGetCommand, configSetCommand } from './commands/config'
import { skillInstallCommand, skillRemoveCommand, skillListCommand } from './commands/skill'
import { resetCommand } from './commands/reset'
import { authStatusCommand, authLoginCommand, authLogoutCommand } from './commands/auth'
import {
  adminCreateCommand, adminPromoteCommand, adminResetPasswordCommand,
  adminListUsersCommand, adminListTenantsCommand,
} from './commands/admin'

const program = new Command()

program
  .name('lean-ai')
  .description('LeanAI — 精益生产 AI 智能体')
  .version('1.0.0')

// Default command: start server
program
  .command('start', { isDefault: true })
  .description('启动 LeanAI 服务并打开浏览器')
  .option('-p, --port <number>', '端口号', (v) => parseInt(v))
  .option('--no-open', '不自动打开浏览器')
  .action(async (opts: { port?: number; open: boolean }) => {
    await startCommand({ port: opts.port, noOpen: !opts.open })
  })

// Config commands
const configCmd = program
  .command('config')
  .description('查看或修改配置')

configCmd
  .command('get [key]')
  .description('获取配置值（不传 key 则显示全部）')
  .action((key?: string) => configGetCommand(key))

configCmd
  .command('set <key> <value>')
  .description('设置配置值')
  .addHelpText('after', `
示例:
  lean-ai config set apiKeys.claude sk-ant-xxx
  lean-ai config set apiKeys.openai sk-xxx
  lean-ai config set llm.provider claude
  lean-ai config set llm.model claude-sonnet-4-6
  lean-ai config set server.port 3742`)
  .action((key: string, value: string) => configSetCommand(key, value))

// Skill commands
const skillCmd = program
  .command('skill')
  .description('管理 Skill 插件')

skillCmd
  .command('install <package>')
  .description('安装 Skill 插件（支持 npm 包名 / 本地路径 / git / 压缩包）')
  .addHelpText('after', `
示例:
  lean-ai skill install @lean-ai/skill-diagnosis
  lean-ai skill install ./packages/skill-diagnosis
  lean-ai skill install github:someone/my-skill`)
  .action(async (pkg: string) => { await skillInstallCommand(pkg) })

skillCmd
  .command('remove <package>')
  .description('移除 Skill 插件')
  .action(async (pkg: string) => { await skillRemoveCommand(pkg) })

skillCmd
  .command('list')
  .description('列出所有已安装的 Skill 插件')
  .action(() => skillListCommand())

// Auth commands
const authCmd = program
  .command('auth')
  .description('管理模型认证')

authCmd
  .command('status')
  .description('查看所有模型认证状态')
  .action(() => authStatusCommand())

authCmd
  .command('login <provider>')
  .description('配置模型认证（打开获取 Key 的页面或启动 OAuth 授权）')
  .option('--no-open', '不自动打开浏览器')
  .action((provider: string, opts: { open: boolean }) => authLoginCommand(provider, { open: opts.open }))

authCmd
  .command('logout <provider>')
  .description('移除已保存的 OAuth Token')
  .action((provider: string) => authLogoutCommand(provider))

// Admin commands (user / tenant management via CLI — useful for bootstrapping
// the first admin before the UI is reachable, or for password recovery).
const adminCmd = program
  .command('admin')
  .description('管理用户与租户（平台管理员操作）')

adminCmd
  .command('create <username>')
  .description('创建一个平台管理员账号（会为其创建独立的管理员工作区）')
  .option('-e, --email <email>', '邮箱')
  .option('-t, --tenant <name>', '工作区名称')
  .option('-p, --password <password>', '密码（不传则交互式输入）')
  .action(async (username: string, opts: { email?: string; tenant?: string; password?: string }) => {
    await adminCreateCommand(username, opts)
  })

adminCmd
  .command('promote <username>')
  .description('将已有用户升级为平台管理员')
  .action(async (username: string) => { await adminPromoteCommand(username) })

adminCmd
  .command('reset-password <username>')
  .description('重置指定用户的密码')
  .action(async (username: string) => { await adminResetPasswordCommand(username) })

adminCmd
  .command('list-users')
  .description('列出全部用户')
  .action(() => adminListUsersCommand())

adminCmd
  .command('list-tenants')
  .description('列出全部租户/工作区')
  .action(() => adminListTenantsCommand())

// Reset command
program
  .command('reset')
  .description('清除对话历史')
  .option('--hard', '同时清除知识库和向量数据库')
  .action((opts: { hard?: boolean }) => resetCommand(opts))

program.parseAsync(process.argv).catch(err => {
  console.error(err)
  process.exit(1)
})
