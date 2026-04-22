import chalk from 'chalk'
import open from 'open'
import { startServer } from '../../server/index'
import { loadConfig, ensureDataDir } from '../../config/manager'

export interface StartOptions {
  port?: number
  noOpen?: boolean
}

export async function startCommand(options: StartOptions = {}): Promise<void> {
  ensureDataDir()
  const config = loadConfig()

  // Env vars override config file (useful for Docker / systemd / CI):
  //   LEANAI_PORT    — listen port (default 3741)
  //   LEANAI_HOST    — bind address (set 0.0.0.0 in containers)
  //   LEANAI_NO_OPEN — any truthy value disables auto-browser (for headless)
  const envPort = process.env.LEANAI_PORT ? parseInt(process.env.LEANAI_PORT, 10) : undefined
  const envHost = process.env.LEANAI_HOST
  const envNoOpen = !!process.env.LEANAI_NO_OPEN

  const port = options.port ?? (envPort && !Number.isNaN(envPort) ? envPort : config.server.port)
  const host = envHost ?? config.server.host
  const openBrowser = options.noOpen || envNoOpen ? false : config.server.openBrowser

  console.log(chalk.cyan('\n  🏭 LeanAI — 精益生产 AI 智能体\n'))

  try {
    const server = await startServer({ port, host })
    const url = `http://${server.host}:${server.port}`

    console.log(`  ${chalk.green('✓')} 服务已启动: ${chalk.underline(url)}`)
    console.log(`  ${chalk.gray('按 Ctrl+C 停止')}\n`)

    if (openBrowser) {
      setTimeout(() => open(url), 500)
    }

    // Graceful shutdown
    const shutdown = () => {
      console.log(chalk.yellow('\n  正在关闭...'))
      server.close()
      process.exit(0)
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)

    // Keep alive
    await new Promise(() => {/* runs until signal */})
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(chalk.red(`  ✗ 启动失败: ${msg}`))
    process.exit(1)
  }
}
