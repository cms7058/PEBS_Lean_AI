import { Router, type Request, type Response } from 'express'
import open from 'open'
import {
  startOAuthFlow,
  exchangeCodeForToken,
  saveOAuthToken,
  revokeOAuthToken,
  getOAuthToken,
  getPendingAuth,
  clearPendingAuth,
  OAUTH_PROVIDERS,
} from '../../auth/oauth'
import { loadConfig } from '../../config/manager'
import { PROVIDER_AUTH, PROVIDER_NAMES } from '../../config/schema'
import type { ProviderID } from '../../config/schema'

const router = Router()

/**
 * GET /api/auth/status
 * Returns auth status for all providers
 */
router.get('/status', (_req: Request, res: Response) => {
  const config = loadConfig()
  const keys = config.apiKeys

  const status = Object.entries(PROVIDER_AUTH).map(([id, authConfig]) => {
    const pid = id as ProviderID
    const hasOAuth = !!getOAuthToken(pid)
    const hasApiKey = (() => {
      if (pid === 'wenxin') return !!(keys.wenxin.apiKey && keys.wenxin.secretKey)
      if (pid === 'ollama') return true
      return !!(keys[pid as keyof typeof keys] as string)
    })()

    // Providers with real OAuth2 endpoints (rare for LLM APIs).
    const supportsOAuth = !!OAUTH_PROVIDERS[pid]
    // "Browser login" = open the provider's API-key page in a tab + guided paste.
    // Applies to any apikey-style provider that exposes a key-management URL.
    const supportsBrowserLogin =
      !supportsOAuth && authConfig.method === 'apikey' && !!authConfig.apiKeyUrl

    return {
      provider: id,
      name: PROVIDER_NAMES[pid],
      authMethod: authConfig.method,
      configured: hasOAuth || hasApiKey,
      oauthConnected: hasOAuth,
      apiKeySet: hasApiKey,
      apiKeyUrl: authConfig.apiKeyUrl,
      hint: authConfig.hint,
      supportsOAuth,
      supportsBrowserLogin,
    }
  })

  res.json(status)
})

/**
 * POST /api/auth/oauth/start
 * Body: { provider: ProviderID }
 * Starts OAuth flow: returns auth URL and opens browser
 */
router.post('/oauth/start', async (req: Request, res: Response) => {
  const { provider } = req.body as { provider?: string }
  if (!provider) { res.status(400).json({ error: 'provider is required' }); return }

  const config = loadConfig()
  const port = config.server.port

  try {
    const { authUrl, tokenPromise } = startOAuthFlow(provider as ProviderID, port)

    // Open browser
    open(authUrl).catch(() => { /* non-fatal */ })

    res.json({ ok: true, authUrl, message: '浏览器已打开，请在浏览器中完成授权...' })

    // Wait for token in background
    tokenPromise
      .then(token => {
        saveOAuthToken(provider as ProviderID, token)
        console.log(`  ✓ ${PROVIDER_NAMES[provider as ProviderID]} OAuth 授权成功`)
      })
      .catch(err => {
        console.error(`  ✗ OAuth 授权失败: ${err.message}`)
      })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(400).json({ error: msg })
  }
})

/**
 * GET /api/auth/oauth/callback
 * OAuth2 redirect callback (browser redirected here after auth)
 */
router.get('/oauth/callback', async (req: Request, res: Response) => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string }
  const auth = getPendingAuth()

  if (error) {
    clearPendingAuth()
    auth?.reject(new Error(`OAuth error: ${error}`))
    res.send(callbackHtml('授权失败', `错误: ${error}`, false))
    return
  }

  if (!code || !auth) {
    res.send(callbackHtml('授权失败', '未找到待处理的授权请求', false))
    return
  }

  if (auth.state !== state) {
    clearPendingAuth()
    auth.reject(new Error('OAuth state mismatch — possible CSRF attack'))
    res.send(callbackHtml('授权失败', 'State 不匹配，请重试', false))
    return
  }

  try {
    clearTimeout(auth.timeout)
    const config = loadConfig()
    const token = await exchangeCodeForToken(auth.provider, code, auth.codeVerifier, config.server.port)
    clearPendingAuth()
    auth.resolve(token)
    res.send(callbackHtml('授权成功', `${PROVIDER_NAMES[auth.provider]} 已成功连接！可以关闭此窗口。`, true))
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    clearPendingAuth()
    auth.reject(new Error(msg))
    res.send(callbackHtml('授权失败', `Token 交换失败: ${msg}`, false))
  }
})

/**
 * DELETE /api/auth/oauth/:provider
 * Revoke stored OAuth token
 */
router.delete('/oauth/:provider', (req: Request, res: Response) => {
  revokeOAuthToken(req.params.provider as ProviderID)
  res.json({ ok: true })
})

/**
 * POST /api/auth/browser-login/:provider
 * Opens the provider's API key management page in a new browser window.
 * Returns the URL so the UI can also offer a link. The user copies the key
 * from the provider's site and pastes it into the settings modal — this gives
 * the UX of a "login" without requiring real OAuth (which most LLM vendors
 * don't offer for API access).
 */
router.post('/browser-login/:provider', (req: Request, res: Response) => {
  const pid = req.params.provider as ProviderID
  const authConfig = PROVIDER_AUTH[pid]
  if (!authConfig?.apiKeyUrl) {
    res.status(400).json({ error: `Provider "${pid}" 没有配置凭证页面` })
    return
  }
  open(authConfig.apiKeyUrl).catch(() => { /* non-fatal */ })
  res.json({ ok: true, url: authConfig.apiKeyUrl })
})

// ---- Callback page HTML ----

function callbackHtml(title: string, message: string, success: boolean): string {
  const color = success ? '#22c55e' : '#ef4444'
  const icon = success ? '✓' : '✗'
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8"/>
  <title>LeanAI — ${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      background: #0f0f0f; font-family: -apple-system, BlinkMacSystemFont, sans-serif; color: #fff;
    }
    .card {
      text-align: center; padding: 3rem 4rem; background: #1a1a1a;
      border: 1px solid #2a2a2a; border-radius: 16px; max-width: 400px;
    }
    .icon { font-size: 3rem; color: ${color}; margin-bottom: 1rem; }
    h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.5rem; }
    p { color: #999; font-size: 0.9rem; line-height: 1.6; }
    .close-hint { margin-top: 1.5rem; font-size: 0.8rem; color: #555; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <p class="close-hint">可以关闭此窗口返回 LeanAI</p>
  </div>
  <script>if(${success}) setTimeout(() => window.close(), 2000)</script>
</body>
</html>`
}

export default router
