import fs from 'fs'
import path from 'path'
import os from 'os'
import { AppConfigSchema, type AppConfig, type ProviderID } from './schema'

// Data directory resolution:
// - Production / Docker: set LEANAI_DATA_DIR=/data to use a mounted volume
// - Default: ~/.lean-ai (user-local install, same as Claude Code style)
// All subdirs (vector/, skills/, uploads/, exports/, logs/) are created under this root.
const DATA_DIR = process.env.LEANAI_DATA_DIR
  ? path.resolve(process.env.LEANAI_DATA_DIR)
  : path.join(os.homedir(), '.lean-ai')
const CONFIG_FILE = path.join(DATA_DIR, 'config.json')

export function getDataDir(): string {
  return DATA_DIR
}

export function getConfigFile(): string {
  return CONFIG_FILE
}

export function ensureDataDir(): void {
  const dirs = [
    DATA_DIR,
    path.join(DATA_DIR, 'vector'),
    path.join(DATA_DIR, 'skills'),
    path.join(DATA_DIR, 'skills', 'node_modules'),
    path.join(DATA_DIR, 'uploads'),
    path.join(DATA_DIR, 'exports'),
    path.join(DATA_DIR, 'logs'),
  ]
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }
}

export function loadConfig(): AppConfig {
  ensureDataDir()
  if (!fs.existsSync(CONFIG_FILE)) {
    const defaultConfig = AppConfigSchema.parse({})
    saveConfig(defaultConfig)
    return defaultConfig
  }
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
    return AppConfigSchema.parse(raw)
  } catch {
    console.warn('Config file corrupted, using defaults')
    return AppConfigSchema.parse({})
  }
}

export function saveConfig(config: AppConfig): void {
  ensureDataDir()
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 })
}

export function setConfigValue(keyPath: string, value: string): void {
  const config = loadConfig()
  const parts = keyPath.split('.')
  let current: Record<string, unknown> = config as unknown as Record<string, unknown>
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof current[parts[i]] !== 'object' || current[parts[i]] === null) {
      current[parts[i]] = {}
    }
    current = current[parts[i]] as Record<string, unknown>
  }
  const lastKey = parts[parts.length - 1]
  // Auto-convert types
  if (value === 'true') current[lastKey] = true
  else if (value === 'false') current[lastKey] = false
  else if (!isNaN(Number(value)) && value.trim() !== '') current[lastKey] = Number(value)
  else current[lastKey] = value

  const parsed = AppConfigSchema.parse(config)
  saveConfig(parsed)
}

export function getConfigValue(keyPath: string): unknown {
  const config = loadConfig()
  const parts = keyPath.split('.')
  let current: unknown = config
  for (const part of parts) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

export function setApiKey(provider: ProviderID, value: string): void {
  if (provider === 'wenxin') {
    throw new Error('Wenxin requires apiKey and secretKey. Use: lean-ai config set apiKeys.wenxin.apiKey <key>')
  }
  if (provider === 'ollama') {
    throw new Error('Ollama does not use API keys. Configure with: lean-ai config set apiKeys.ollama.baseUrl <url>')
  }
  setConfigValue(`apiKeys.${provider}`, value)
}

/** Returns config with API keys redacted for safe exposure to UI */
export function getRedactedConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    apiKeys: {
      claude: config.apiKeys.claude ? '***' : '',
      openai: config.apiKeys.openai ? '***' : '',
      deepseek: config.apiKeys.deepseek ? '***' : '',
      qianwen: config.apiKeys.qianwen ? '***' : '',
      minimax: config.apiKeys.minimax ? '***' : '',
      minimaxPlan: config.apiKeys.minimaxPlan ? '***' : '',
      wenxin: {
        apiKey: config.apiKeys.wenxin.apiKey ? '***' : '',
        secretKey: config.apiKeys.wenxin.secretKey ? '***' : '',
      },
      ollama: config.apiKeys.ollama,
    },
  }
}
