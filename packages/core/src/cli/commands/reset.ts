import chalk from 'chalk'
import fs from 'fs'
import path from 'path'
import { getDataDir } from '../../config/manager'
import { getDb } from '../../storage/db'

export function resetCommand(options: { hard?: boolean } = {}): void {
  if (options.hard) {
    console.log(chalk.yellow('  ⚠️  硬重置：将删除所有数据（对话历史、知识库、向量数据库）'))
    const dataDir = getDataDir()
    // Close DB first
    try { getDb().close() } catch { /* ignore */ }
    // Remove data files but keep config
    const toRemove = ['lean-ai.db', 'vector', 'uploads', 'exports']
    for (const item of toRemove) {
      const p = path.join(dataDir, item)
      if (fs.existsSync(p)) {
        fs.rmSync(p, { recursive: true, force: true })
        console.log(chalk.gray(`  已删除: ${p}`))
      }
    }
    console.log(chalk.green('  ✓ 硬重置完成'))
  } else {
    // Soft reset: clear conversation history only
    const db = getDb()
    db.exec('DELETE FROM messages; DELETE FROM conversations;')
    console.log(chalk.green('  ✓ 对话历史已清除（API Key 和配置保留）'))
    console.log(chalk.gray('  提示: 使用 --hard 同时清除知识库和向量数据'))
  }
}
