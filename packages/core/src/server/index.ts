import express from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import net from 'net'
import chatRouter from './routes/chat'
import historyRouter from './routes/history'
import configRouter from './routes/config'
import modelsRouter from './routes/models'
import authRouter from './routes/auth'
import accountRouter from './routes/account'
import adminRouter from './routes/admin'
import skillsRouter from './routes/skills'
import knowledgeRouter from './routes/knowledge'
import chartsRouter from './routes/charts'
import billingRouter from './routes/billing'
import docsRouter from './routes/docs'
import { ensureBillingSchema } from '../billing/manager'
import { attachAuth } from '../auth/middleware'
import { getDb } from '../storage/db'

export interface ServerOptions {
  port?: number
  host?: string
}

export interface StartedServer {
  port: number
  host: string
  close: () => void
}

export async function startServer(options: ServerOptions = {}): Promise<StartedServer> {
  const host = options.host ?? '127.0.0.1'
  let port = options.port ?? 3741

  // Find available port
  port = await findAvailablePort(port, host)

  const app = express()

  // Middleware
  // CORS origin:
  //   - Default: same-origin (tight, matches local single-user install)
  //   - Set LEANAI_CORS_ORIGIN to open up (e.g. "*" for trusted internal nets,
  //     or a comma-separated list of allowed origins for multi-host deploys)
  const corsEnv = process.env.LEANAI_CORS_ORIGIN
  const corsOrigin = corsEnv
    ? (corsEnv === '*' ? true : corsEnv.split(',').map(s => s.trim()).filter(Boolean))
    : `http://${host}:${port}`
  app.use(cors({ origin: corsOrigin, credentials: true }))
  app.use(express.json({ limit: '10mb' }))
  app.use(express.urlencoded({ extended: true }))

  // Ensure DB is initialized (runs migrations on first getDb() call) so that
  // auth middleware can safely look up sessions on the very first request.
  try { getDb() } catch (err) { console.error('getDb init:', err) }

  // Attach auth context globally (non-blocking). Individual routers decide
  // whether to require it via requireAuth / requireAdmin.
  app.use(attachAuth)

  // API routes
  app.use('/api/chat', chatRouter)
  app.use('/api/conversations', historyRouter)
  app.use('/api/config', configRouter)
  app.use('/api/models', modelsRouter)
  app.use('/api/auth', authRouter)          // LLM provider OAuth
  app.use('/api/account', accountRouter)    // User login/register/logout/me
  app.use('/api/admin', adminRouter)        // Platform admin (users/tenants/usage)
  app.use('/api/skills', skillsRouter)
  app.use('/api/knowledge', knowledgeRouter)
  app.use('/api/charts', chartsRouter)
  app.use('/api/billing', billingRouter)
  app.use('/api/docs', docsRouter)

  // Ensure billing tables exist and default subscription row is seeded.
  try { ensureBillingSchema() } catch (err) {
    // Non-fatal: server still runs; billing endpoints will retry on first hit.
    console.error('ensureBillingSchema:', err)
  }

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', version: '1.0.0' })
  })

  // Serve React UI static files.
  //
  // Cache policy is critical: if the browser caches index.html, users keep
  // loading the old JS bundle hash even after we rebuild the UI (symptom:
  // new skills' new artifact types fall through to the "unknown" renderer).
  //   - /assets/*  — hashed filenames, immutable, can be cached forever
  //   - everything else (including index.html) — must revalidate each load
  const uiDir = path.join(__dirname, '..', 'ui')
  if (fs.existsSync(uiDir)) {
    app.use(express.static(uiDir, {
      etag: true,
      lastModified: true,
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          // Vite emits content-hashed filenames; safe to cache long-term.
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        } else {
          // index.html / favicon / etc — always revalidate so UI updates land.
          res.setHeader('Cache-Control', 'no-cache, must-revalidate')
        }
      },
    }))
    // SPA fallback — same no-cache policy as index.html
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate')
      res.sendFile(path.join(uiDir, 'index.html'))
    })
  } else {
    // Dev fallback: redirect to Vite dev server
    app.get('*', (_req, res) => {
      res.send(`
        <html><body style="font-family:sans-serif;padding:2rem;">
          <h2>LeanAI</h2>
          <p>API server running on port ${port}.</p>
          <p>For development UI, run: <code>pnpm dev:ui</code></p>
          <p>API health: <a href="/api/health">/api/health</a></p>
        </body></html>
      `)
    })
  }

  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      resolve({
        port,
        host,
        close: () => server.close(),
      })
    })
    server.on('error', reject)
  })
}

async function findAvailablePort(startPort: number, host: string): Promise<number> {
  for (let port = startPort; port <= startPort + 10; port++) {
    if (await isPortFree(port, host)) return port
  }
  throw new Error(`No available ports found in range ${startPort}-${startPort + 10}`)
}

function isPortFree(port: number, host: string): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => { server.close(); resolve(true) })
    server.listen(port, host)
  })
}
