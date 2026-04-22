import { Router, type Request, type Response } from 'express'
import { PROVIDER_MODELS, PROVIDER_NAMES, PROVIDER_AUTH } from '../../config/schema'
import { loadConfig } from '../../config/manager'
import { getOAuthToken, OAUTH_PROVIDERS } from '../../auth/oauth'
import type { ProviderID } from '../../config/schema'

const router = Router()

// GET /api/models
router.get('/', (_req: Request, res: Response) => {
  const config = loadConfig()
  const keys = config.apiKeys

  const providers = Object.entries(PROVIDER_MODELS).map(([id, models]) => {
    const pid = id as ProviderID
    const authConfig = PROVIDER_AUTH[pid]
    const oauthConnected = !!getOAuthToken(pid)
    const apiKeyConfigured = isConfigured(pid, keys)

    return {
      id,
      name: PROVIDER_NAMES[pid],
      models: pid === 'ollama' ? [config.apiKeys.ollama.model || 'custom'] : models,
      configured: oauthConnected || apiKeyConfigured,
      oauthConnected,
      supportsOAuth: !!OAUTH_PROVIDERS[pid],
      authMethod: authConfig?.method,
      apiKeyUrl: authConfig?.apiKeyUrl,
      hint: authConfig?.hint,
      selected: config.llm.provider === id,
      selectedModel: config.llm.provider === id ? config.llm.model : undefined,
    }
  })

  res.json({
    providers,
    current: { provider: config.llm.provider, model: config.llm.model },
  })
})

function isConfigured(id: ProviderID, keys: ReturnType<typeof loadConfig>['apiKeys']): boolean {
  switch (id) {
    case 'claude':       return !!keys.claude
    case 'openai':       return !!keys.openai
    case 'deepseek':     return !!keys.deepseek
    case 'qianwen':      return !!keys.qianwen
    case 'minimax':      return !!keys.minimax
    case 'minimaxPlan':  return !!keys.minimaxPlan
    case 'wenxin':       return !!(keys.wenxin.apiKey && keys.wenxin.secretKey)
    case 'ollama':       return true
    default:             return false
  }
}

export default router
