import chalk from 'chalk'
import open from 'open'
import { loadConfig } from '../../config/manager'
import { PROVIDER_AUTH, PROVIDER_NAMES } from '../../config/schema'
import { getOAuthToken, revokeOAuthToken, OAUTH_PROVIDERS } from '../../auth/oauth'
import type { ProviderID } from '../../config/schema'

export function authStatusCommand(): void {
  const config = loadConfig()
  const keys = config.apiKeys

  console.log(chalk.cyan('\n  LeanAI — 模型认证状态\n'))

  const rows: { provider: string; status: string; method: string }[] = []

  for (const [id, authConfig] of Object.entries(PROVIDER_AUTH)) {
    const pid = id as ProviderID
    const oauthToken = getOAuthToken(pid)
    const hasApiKey = (() => {
      if (pid === 'wenxin') return !!(keys.wenxin.apiKey && keys.wenxin.secretKey)
      if (pid === 'ollama') return true
      return !!(keys[pid as keyof typeof keys] as string)
    })()

    let status: string
    let method: string

    if (oauthToken) {
      status = chalk.green('✓ OAuth 已连接')
      method = 'OAuth'
    } else if (hasApiKey) {
      status = chalk.green('✓ API Key 已配置')
      method = 'API Key'
    } else {
      status = chalk.gray('✗ 未配置')
      method = authConfig.method === 'oauth' ? 'OAuth' : 'API Key'
    }

    rows.push({ provider: `  ${PROVIDER_NAMES[pid]}`, status, method })
  }

  const maxLen = Math.max(...rows.map(r => r.provider.length))
  for (const row of rows) {
    console.log(`${row.provider.padEnd(maxLen + 2)} ${row.status}`)
  }
  console.log()
}

export async function authLoginCommand(provider: string, opts: { open?: boolean } = {}): Promise<void> {
  const pid = provider as ProviderID
  const authConfig = PROVIDER_AUTH[pid]

  if (!authConfig) {
    console.error(chalk.red(`  ✗ 未知的 Provider: ${provider}`))
    process.exit(1)
  }

  const name = PROVIDER_NAMES[pid] ?? provider

  // OAuth2 flow
  if (OAUTH_PROVIDERS[pid]) {
    console.log(chalk.cyan(`\n  正在启动 ${name} OAuth 授权流程...\n`))
    console.log(chalk.gray('  请在浏览器中完成授权，然后返回此处'))
    console.log(chalk.gray('  授权完成后 token 将自动保存\n'))

    // The full OAuth flow requires the server to be running for the callback.
    // When running as a standalone CLI command (not within a running server),
    // we start a temporary HTTP server just for the callback.
    const config = loadConfig()
    const { startOAuthFlow, saveOAuthToken } = await import('../../auth/oauth')
    const { startServer } = await import('../../server/index')

    let closeServer: (() => void) | undefined
    if (opts.open !== false) {
      const srv = await startServer({ port: config.server.port, host: config.server.host }).catch(() => null)
      if (srv) closeServer = srv.close
    }

    const { authUrl, tokenPromise } = startOAuthFlow(pid, config.server.port)
    console.log(`  授权 URL: ${chalk.underline(authUrl)}\n`)
    await open(authUrl)

    try {
      const token = await tokenPromise
      saveOAuthToken(pid, token)
      console.log(chalk.green(`  ✓ ${name} OAuth 授权成功！`))
    } catch (err: unknown) {
      console.error(chalk.red(`  ✗ 授权失败: ${err instanceof Error ? err.message : err}`))
    } finally {
      closeServer?.()
    }
    return
  }

  // API Key — show link to get key
  console.log(chalk.cyan(`\n  ${name} 使用 API Key 认证\n`))
  if (authConfig.apiKeyUrl) {
    console.log(`  获取 API Key: ${chalk.underline(authConfig.apiKeyUrl)}`)
    console.log(chalk.gray(`\n  配置命令:`))
    console.log(chalk.white(`    lean-ai config set apiKeys.${pid} <your-api-key>\n`))
    if (opts.open !== false) {
      await open(authConfig.apiKeyUrl)
      console.log(chalk.gray('  (已在浏览器中打开)'))
    }
  }
  if (authConfig.hint) {
    console.log(chalk.gray(`\n  提示: ${authConfig.hint}\n`))
  }
}

export function authLogoutCommand(provider: string): void {
  const pid = provider as ProviderID
  const name = PROVIDER_NAMES[pid] ?? provider

  if (!getOAuthToken(pid)) {
    console.log(chalk.yellow(`  ${name} 没有已保存的 OAuth Token`))
    return
  }

  revokeOAuthToken(pid)
  console.log(chalk.green(`  ✓ 已移除 ${name} OAuth Token`))
}
