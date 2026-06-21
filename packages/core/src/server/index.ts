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
import amibaRouter from './routes/amiba'
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

// 阿米巴接入落地页（自包含 HTML，读 URL 参数 → POST /api/amiba/connect → 显示状态）。
const LEAN_REGISTER_HTML = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LeanAI · 接入阿米巴</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
    background:linear-gradient(160deg,#1c1207,#2a1d0c);color:#fde68a;
    font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
  .card{width:100%;max-width:520px;background:#170f06;border:1px solid #3a2a12;border-radius:16px;
    padding:28px;box-shadow:0 24px 60px rgba(0,0,0,.5)}
  .brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px;color:#fbbf24}
  .cube{width:18px;height:18px;border-radius:5px;background:linear-gradient(135deg,#fbbf24,#f59e0b)}
  h1{margin:18px 0 6px;font-size:20px;color:#fef3c7}
  p{margin:0;font-size:13px;line-height:1.6;color:#d6b772}
  .row{display:flex;justify-content:space-between;gap:12px;font-size:13px;padding:7px 0;border-bottom:1px solid #2a1d0c}
  .k{color:#b08a4a}.v{color:#fde68a;font-family:ui-monospace,monospace;word-break:break-all;text-align:right}
  .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
  .chip{font-size:11px;padding:3px 9px;border-radius:999px;background:#2a1d0c;color:#fcd34d;border:1px solid #533a14}
  .ok{margin-top:16px;padding:12px 14px;border-radius:10px;background:#0c2a1d;border:1px solid #14532d;color:#6ee7b7;font-size:13px}
  .err{margin-top:16px;padding:12px 14px;border-radius:10px;background:#2a0c0c;border:1px solid #531414;color:#fca5a5;font-size:13px}
  .sync{margin-top:14px;padding:12px 14px;border-radius:10px;background:#1c1207;border:1px solid #3a2a12}
  .btnrow{display:flex;gap:10px;margin-top:20px}
  a.btn,button.btn{flex:1;text-align:center;padding:10px 16px;border-radius:10px;font-size:13px;font-weight:600;
    cursor:pointer;border:none;text-decoration:none;display:inline-block}
  .primary{background:#f59e0b;color:#1c1207}.ghost{background:transparent;color:#d6b772;border:1px solid #3a2a12}
</style></head><body><div class="card">
  <div class="brand"><span class="cube"></span><span>PEBS LeanAI</span>
    <span style="color:#7c5a2a;font-weight:400">·</span><span style="color:#b08a4a;font-weight:400;font-size:13px">接入阿米巴动态智能体</span></div>
  <div id="content"><h1>正在接入…</h1><p>正在向阿米巴登记 LeanAI 的能力，请稍候。</p></div>
  <div class="btnrow"><a class="btn ghost" href="/">进入 LeanAI</a><a id="back" class="btn primary" style="display:none">返回阿米巴</a></div>
</div>
<script>
(async function(){
  var q=new URLSearchParams(location.search);
  var p={amiba_endpoint:q.get('amiba_endpoint')||'',amiba_token:q.get('amiba_token')||'',
    enterprise_id:q.get('enterprise_id')||'',source:q.get('source')||'lean'};
  var content=document.getElementById('content');
  var back=document.getElementById('back');
  if(p.amiba_endpoint){back.style.display='inline-block';back.href=p.amiba_endpoint;}
  function esc(s){return String(s==null?'':s).replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c]});}
  if(!p.amiba_endpoint||!p.amiba_token||!p.enterprise_id){
    content.innerHTML='<h1>缺少接入参数</h1><p>此页应由阿米巴「工具接入」点击「接入并跳转」自动打开（携带令牌与企业信息）。</p>';return;}
  try{
    var r=await fetch('/api/amiba/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});
    var d=await r.json();
    if(!r.ok){throw new Error(d.error||d.detail||'接入失败');}
    var caps=(d.capabilities||[]).map(function(c){return '<span class="chip">'+esc(c)+'</span>';}).join('');
    var sync=d.sync&&d.sync.ok?'<div class="sync"><div style="font-size:12px;color:#b08a4a;margin-bottom:6px">浪费项回填阿米巴</div><div style="font-size:12.5px;color:#fcd34d">'+esc(d.sync.summary||'')+'</div></div>':'';
    content.innerHTML='<h1>'+(d.hello_ok?'接入成功 ✓':'接入未完成')+'</h1>'+
      '<p>'+(d.hello_ok?'LeanAI 已登记到阿米巴，法/环 维度的诊断浪费项已回填到对应节点。':'接入信息已保存，但回连阿米巴校验未通过。')+'</p>'+
      '<div style="margin-top:16px">'+
      '<div class="row"><span class="k">服务企业 ID</span><span class="v">'+esc(d.enterprise_id)+'</span></div>'+
      '<div class="row"><span class="k">阿米巴地址</span><span class="v">'+esc(d.amiba_endpoint)+'</span></div>'+
      '<div class="row"><span class="k">能力上报</span><span class="v">'+(d.hello_ok?'已确认':'待确认')+'</span></div>'+
      '<div class="chips">'+caps+'</div></div>'+sync+
      (d.hello_ok?'<div class="ok">能力已上报阿米巴，接入闭环完成。</div>':'<div class="err">'+esc(d.hello_error||'')+'</div>');
  }catch(e){content.innerHTML='<h1>接入未完成</h1><div class="err">'+esc(e.message)+'</div>';}
})();
</script></body></html>`

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
  app.use('/api/amiba', amibaRouter)

  // Ensure billing tables exist and default subscription row is seeded.
  try { ensureBillingSchema() } catch (err) {
    // Non-fatal: server still runs; billing endpoints will retry on first hit.
    console.error('ensureBillingSchema:', err)
  }

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', version: '1.0.0' })
  })

  // 阿米巴接入落地页（服务端渲染，自包含，不依赖 React 路由）。
  // 阿米巴「工具接入」跳转到这里，携带 amiba_endpoint/amiba_token/enterprise_id/source。
  app.get('/register', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, must-revalidate')
    res.send(LEAN_REGISTER_HTML)
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
