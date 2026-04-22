import chalk from 'chalk'
import { loadConfig, getConfigValue, setConfigValue } from '../../config/manager'

export function configGetCommand(keyPath?: string): void {
  const config = loadConfig()
  if (!keyPath) {
    // Print full config (safe: no raw API keys in output)
    const safe = JSON.parse(JSON.stringify(config)) as Record<string, unknown>
    const keys = safe.apiKeys as Record<string, unknown>
    for (const k of Object.keys(keys)) {
      if (k === 'wenxin') {
        const w = keys[k] as Record<string, unknown>
        if (w.apiKey) w.apiKey = '***'
        if (w.secretKey) w.secretKey = '***'
      } else if (k !== 'ollama' && keys[k]) {
        keys[k] = '***'
      }
    }
    console.log(JSON.stringify(safe, null, 2))
  } else {
    const value = getConfigValue(keyPath)
    if (value === undefined) {
      console.log(chalk.yellow(`  Key "${keyPath}" not found`))
    } else {
      console.log(JSON.stringify(value))
    }
  }
}

export function configSetCommand(keyPath: string, value: string): void {
  try {
    setConfigValue(keyPath, value)
    console.log(chalk.green(`  ✓ ${keyPath} = ${keyPath.toLowerCase().includes('key') || keyPath.toLowerCase().includes('secret') ? '***' : value}`))
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(chalk.red(`  ✗ ${msg}`))
    process.exit(1)
  }
}
