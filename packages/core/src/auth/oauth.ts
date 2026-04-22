/**
 * OAuth2 PKCE browser-based authentication flow.
 *
 * Flow:
 *  1. lean-ai auth login <provider>
 *  2. Generate code_verifier + code_challenge (PKCE S256)
 *  3. Open browser to provider's auth URL
 *  4. Wait for redirect to http://localhost:3741/api/auth/oauth/callback?code=...
 *  5. Exchange code for access token
 *  6. Save token to ~/.lean-ai/config.json oauthTokens.<provider>
 */
import crypto from 'crypto'
import https from 'https'
import http from 'http'
import { loadConfig, saveConfig } from '../config/manager'
import { AppConfigSchema } from '../config/schema'
import type { ProviderID } from '../config/schema'

// ---- PKCE helpers ----

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url')
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

function generateState(): string {
  return crypto.randomBytes(16).toString('hex')
}

// ---- In-flight OAuth state (shared with callback route) ----

interface PendingAuth {
  provider: ProviderID
  codeVerifier: string
  state: string
  resolve: (token: string) => void
  reject: (err: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

let pending: PendingAuth | null = null

export function getPendingAuth(): PendingAuth | null {
  return pending
}

export function clearPendingAuth(): void {
  pending = null
}

// ---- OAuth provider configs ----

export interface OAuthProviderConfig {
  authUrl: string
  tokenUrl: string
  clientId: string
  scopes: string[]
  /** Whether to extract token from URL fragment (implicit) vs code exchange (PKCE) */
  implicit?: boolean
}

export const OAUTH_PROVIDERS: Partial<Record<ProviderID, OAuthProviderConfig>> = {
  // Future: add providers with real OAuth support here
  // minimax example (if they add OAuth in future):
  // minimax: {
  //   authUrl: 'https://account.minimaxi.com/oauth/authorize',
  //   tokenUrl: 'https://account.minimaxi.com/oauth/token',
  //   clientId: 'lean-ai-client',
  //   scopes: ['api'],
  // },
}

// ---- Main OAuth flow ----

/**
 * Start OAuth2 PKCE flow for the given provider.
 * Returns the authorization URL to open in the browser.
 * The caller should wait for the token via the returned promise.
 */
export function startOAuthFlow(
  provider: ProviderID,
  callbackPort: number
): { authUrl: string; tokenPromise: Promise<string> } {
  const config = OAUTH_PROVIDERS[provider]
  if (!config) {
    throw new Error(`Provider "${provider}" does not support OAuth login. Use API key instead.`)
  }

  const verifier = generateCodeVerifier()
  const challenge = generateCodeChallenge(verifier)
  const state = generateState()
  const redirectUri = `http://127.0.0.1:${callbackPort}/api/auth/oauth/callback`

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: redirectUri,
    scope: config.scopes.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })

  const authUrl = `${config.authUrl}?${params.toString()}`

  const tokenPromise = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending = null
      reject(new Error('OAuth timeout: no response within 5 minutes'))
    }, 5 * 60 * 1000)

    pending = { provider, codeVerifier: verifier, state, resolve, reject, timeout }
  })

  return { authUrl, tokenPromise }
}

/**
 * Exchange authorization code for access token.
 * Called by the /api/auth/oauth/callback route.
 */
export async function exchangeCodeForToken(
  provider: ProviderID,
  code: string,
  codeVerifier: string,
  callbackPort: number
): Promise<string> {
  const config = OAUTH_PROVIDERS[provider]
  if (!config) throw new Error(`No OAuth config for ${provider}`)

  const redirectUri = `http://127.0.0.1:${callbackPort}/api/auth/oauth/callback`
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: config.clientId,
    code_verifier: codeVerifier,
  }).toString()

  const token = await postJson(config.tokenUrl, body)
  return (token as { access_token: string }).access_token
}

/** Save OAuth token to config */
export function saveOAuthToken(provider: ProviderID, accessToken: string, expiresIn?: number): void {
  const config = loadConfig()
  const tokens = config.oauthTokens ?? {}
  tokens[provider] = {
    accessToken,
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
    scope: OAUTH_PROVIDERS[provider]?.scopes.join(' '),
  }
  const parsed = AppConfigSchema.parse({ ...config, oauthTokens: tokens })
  saveConfig(parsed)
}

/** Get stored OAuth token for a provider */
export function getOAuthToken(provider: ProviderID): string | null {
  const config = loadConfig()
  const entry = config.oauthTokens?.[provider]
  if (!entry) return null
  if (entry.expiresAt && Date.now() > entry.expiresAt) return null // expired
  return entry.accessToken
}

/** Remove OAuth token for a provider */
export function revokeOAuthToken(provider: ProviderID): void {
  const config = loadConfig()
  const tokens = { ...config.oauthTokens }
  delete tokens[provider]
  const parsed = AppConfigSchema.parse({ ...config, oauthTokens: tokens })
  saveConfig(parsed)
}

// ---- HTTP helper ----

function postJson(url: string, body: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http
    const req = lib.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch (e) { reject(e) } })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}
