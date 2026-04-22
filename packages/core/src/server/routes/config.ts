import { Router, type Request, type Response, type NextFunction } from 'express'
import { loadConfig, saveConfig, getRedactedConfig, setConfigValue } from '../../config/manager'
import { AppConfigSchema, type ProviderID } from '../../config/schema'
import { testProvider } from '../../agent/index'
import { getPlanCapabilities } from '../../billing/capabilities'
import { getSubscription } from '../../billing/manager'

const router = Router()

/**
 * API-key write guard — platform admins can always write API keys (they're
 * managing the deployment); regular users need their plan's apiKeyConfig=true.
 */
function requireApiKeyConfig(req: Request, res: Response, next: NextFunction): void {
  if (req.auth?.user.role === 'admin') { next(); return }
  if (!req.auth) { res.status(401).json({ error: '未登录' }); return }
  const caps = getPlanCapabilities(getSubscription(req.auth.tenant.id).plan)
  if (!caps.apiKeyConfig) {
    res.status(403).json({
      error: '当前订阅方案未开通「API Key 配置」功能，请联系管理员或升级方案。',
      code: 'CAPABILITY_DISABLED',
      capability: 'apiKeyConfig',
    })
    return
  }
  next()
}

// GET /api/config — returns config with API keys redacted
router.get('/', (_req: Request, res: Response) => {
  const config = loadConfig()
  res.json(getRedactedConfig(config))
})

// PATCH /api/config — partial update (non-key fields only)
router.patch('/', (req: Request, res: Response) => {
  try {
    const config = loadConfig()
    const body = req.body as Record<string, unknown>
    // Only allow updating non-sensitive fields
    if (body.llm) Object.assign(config.llm, body.llm)
    if (body.server) Object.assign(config.server, body.server)
    if (body.ui) Object.assign(config.ui, body.ui)
    const parsed = AppConfigSchema.parse(config)
    saveConfig(parsed)
    res.json(getRedactedConfig(parsed))
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(400).json({ error: msg })
  }
})

// PUT /api/config/apikey/wenxin — special handling for wenxin two-field key (must be before :provider)
router.put('/apikey/wenxin', requireApiKeyConfig, (req: Request, res: Response) => {
  const { apiKey, secretKey } = req.body as { apiKey?: string; secretKey?: string }
  try {
    if (apiKey) setConfigValue('apiKeys.wenxin.apiKey', apiKey)
    if (secretKey) setConfigValue('apiKeys.wenxin.secretKey', secretKey)
    res.json({ ok: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(400).json({ error: msg })
  }
})

// PUT /api/config/apikey/:provider — write API key (separate secure endpoint)
router.put('/apikey/:provider', requireApiKeyConfig, (req: Request, res: Response) => {
  const { provider } = req.params
  const { value } = req.body as { value?: string }
  if (!value || !value.trim()) { res.status(400).json({ error: 'value is required' }); return }
  try {
    setConfigValue(`apiKeys.${provider}`, value.trim())
    res.json({ ok: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(400).json({ error: msg })
  }
})

// POST /api/config/test — test currently selected provider
router.post('/test', async (_req: Request, res: Response) => {
  const config = loadConfig()
  try {
    const result = await testProvider(config)
    res.json(result)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    res.json({ ok: false, error: msg })
  }
})

// POST /api/config/test/:provider — test a specific provider using its default model
router.post('/test/:provider', async (req: Request, res: Response) => {
  const provider = req.params.provider as ProviderID
  const config = loadConfig()
  try {
    const result = await testProvider(config, provider)
    res.json(result)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    res.json({ ok: false, error: msg })
  }
})

export default router
