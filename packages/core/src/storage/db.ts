import Database from 'better-sqlite3'
import path from 'path'
import { getDataDir } from '../config/manager'

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (_db) return _db
  const dbPath = path.join(getDataDir(), 'lean-ai.db')
  _db = new Database(dbPath)
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')
  migrate(_db)
  return _db
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL DEFAULT '新对话',
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role            TEXT NOT NULL,
      content         TEXT NOT NULL,
      created_at      INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);

    CREATE TABLE IF NOT EXISTS skill_data (
      skill_name  TEXT NOT NULL,
      key         TEXT NOT NULL,
      value       TEXT NOT NULL,
      updated_at  INTEGER NOT NULL,
      PRIMARY KEY (skill_name, key)
    );

    CREATE TABLE IF NOT EXISTS knowledge_documents (
      id          TEXT PRIMARY KEY,
      filename    TEXT NOT NULL,
      file_path   TEXT NOT NULL,
      file_type   TEXT NOT NULL,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      status      TEXT NOT NULL DEFAULT 'pending',
      uploaded_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS diagnosis_sessions (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      stage           TEXT NOT NULL DEFAULT 'INIT',
      problem_type    TEXT,
      data            TEXT NOT NULL DEFAULT '{}',
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    );

    -- Multi-tenant / auth tables ------------------------------------------
    -- tenants: workspace = billing unit. Every user belongs to exactly one.
    CREATE TABLE IF NOT EXISTS tenants (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'active',  -- active | suspended
      plan          TEXT NOT NULL DEFAULT 'free',    -- free|personal|enterprise
      expires_at    INTEGER,                         -- nullable = no expiry
      seats         INTEGER NOT NULL DEFAULT 1,
      license_key   TEXT,
      notes         TEXT,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );

    -- users: password-based account. role ∈ {admin, user}.
    -- admin = platform administrator, can access /api/admin/*.
    CREATE TABLE IF NOT EXISTS users (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      username        TEXT NOT NULL UNIQUE,
      email           TEXT UNIQUE,
      display_name    TEXT,
      password_hash   TEXT NOT NULL,
      role            TEXT NOT NULL DEFAULT 'user',     -- admin | user
      status          TEXT NOT NULL DEFAULT 'active',   -- active | disabled
      created_at      INTEGER NOT NULL,
      last_login_at   INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

    -- sessions: opaque 32-byte token stored as hex. Server-side revocable.
    CREATE TABLE IF NOT EXISTS sessions (
      token         TEXT PRIMARY KEY,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at    INTEGER NOT NULL,
      expires_at    INTEGER NOT NULL,
      last_used_at  INTEGER NOT NULL,
      user_agent    TEXT,
      ip            TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  `)

  // Add scoping columns to existing tables. ALTER TABLE ADD COLUMN is idempotent
  // if we catch "duplicate column" errors. better-sqlite3 throws synchronously.
  const addColumn = (sql: string) => {
    try { db.exec(sql) } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!/duplicate column/i.test(msg)) throw err
    }
  }
  addColumn(`ALTER TABLE conversations       ADD COLUMN user_id   INTEGER`)
  addColumn(`ALTER TABLE conversations       ADD COLUMN tenant_id INTEGER`)
  addColumn(`ALTER TABLE knowledge_documents ADD COLUMN tenant_id INTEGER`)
  addColumn(`ALTER TABLE knowledge_documents ADD COLUMN user_id   INTEGER`)
  // Billing tables may not exist yet on cold DB (created by ensureBillingSchema
  // later). Wrap in try/catch so migrate() stays resilient either way.
  try { addColumn(`ALTER TABLE usage_events    ADD COLUMN tenant_id INTEGER`) } catch {}
  try { addColumn(`ALTER TABLE billing_periods ADD COLUMN tenant_id INTEGER`) } catch {}

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversations_user   ON conversations(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_conversations_tenant ON conversations(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_kb_docs_tenant       ON knowledge_documents(tenant_id);
  `)

  // kb_entries may not exist yet (created lazily by the knowledge skill).
  // When it does exist (post-upgrade), backfill tenant_id.
  try {
    addColumn(`ALTER TABLE kb_entries ADD COLUMN tenant_id INTEGER`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_kb_entries_tenant ON kb_entries(tenant_id);`)
  } catch { /* table does not exist yet — will be created with tenant_id column later via ensureKbSchema */ }

  // Seed the default tenant on first boot so the app has something to own
  // unscoped legacy rows. Tenant id 1 is reserved for this default.
  const hasDefault = db.prepare('SELECT 1 FROM tenants WHERE id = 1').get()
  if (!hasDefault) {
    const now = Date.now()
    db.prepare(`
      INSERT INTO tenants (id, name, status, plan, expires_at, seats, license_key, notes, created_at, updated_at)
      VALUES (1, '默认租户', 'active', 'free', ?, 1, NULL, '系统默认租户，用于未分配的遗留数据', ?, ?)
    `).run(now + 14 * 24 * 60 * 60 * 1000, now, now)
  }

  // Backfill legacy rows (created before multi-tenant migration) to tenant 1.
  db.exec(`
    UPDATE conversations       SET tenant_id = 1 WHERE tenant_id IS NULL;
    UPDATE knowledge_documents SET tenant_id = 1 WHERE tenant_id IS NULL;
  `)
  try { db.exec(`UPDATE kb_entries SET tenant_id = 1 WHERE tenant_id IS NULL;`) } catch { /* table may not exist */ }

  // Payment orders — user-initiated subscription purchases. The admin
  // confirms receipt of a manual payment (WeChat Pay / Alipay QR), which
  // triggers license issuance + tenant.plan upgrade.
  //   status:  pending  → paid  → active  (or canceled / expired)
  //   method:  wechat | alipay | bank | manual
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_orders (
      id             TEXT PRIMARY KEY,
      tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
      plan           TEXT NOT NULL,
      cycle          TEXT NOT NULL,
      amount_cents   INTEGER NOT NULL,
      currency       TEXT NOT NULL DEFAULT 'CNY',
      status         TEXT NOT NULL DEFAULT 'pending',
      method         TEXT,
      license_key    TEXT,
      notes          TEXT,
      created_at     INTEGER NOT NULL,
      paid_at        INTEGER,
      confirmed_at   INTEGER,
      confirmed_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      expires_at     INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_payment_orders_tenant ON payment_orders(tenant_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status);
  `)
}

export interface ConversationRow {
  id: string
  title: string
  created_at: number
  updated_at: number
}

export interface MessageRow {
  id: string
  conversation_id: string
  role: string
  content: string
  created_at: number
}

// ---- Conversation helpers ----
//
// All helpers accept an optional owner `{ userId, tenantId }`. When provided,
// writes stamp the ownership columns and reads enforce ownership. When omitted
// (legacy callers, tests, admin cleanup) they behave globally.

export interface Owner {
  userId?: number
  tenantId?: number
}

export function createConversation(id: string, title = '新对话', owner: Owner = {}): ConversationRow {
  const now = Date.now()
  getDb().prepare(
    'INSERT INTO conversations (id, title, created_at, updated_at, user_id, tenant_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, title, now, now, owner.userId ?? null, owner.tenantId ?? null)
  return { id, title, created_at: now, updated_at: now }
}

export function getConversations(owner: Owner = {}): ConversationRow[] {
  // Owner filter: prefer userId, fall back to tenantId. Passing neither returns all.
  if (owner.userId !== undefined) {
    return getDb().prepare(
      'SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC'
    ).all(owner.userId) as ConversationRow[]
  }
  if (owner.tenantId !== undefined) {
    return getDb().prepare(
      'SELECT * FROM conversations WHERE tenant_id = ? ORDER BY updated_at DESC'
    ).all(owner.tenantId) as ConversationRow[]
  }
  return getDb().prepare(
    'SELECT * FROM conversations ORDER BY updated_at DESC'
  ).all() as ConversationRow[]
}

export function getConversation(id: string, owner: Owner = {}): ConversationRow | undefined {
  const row = getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(id) as
    (ConversationRow & { user_id?: number | null; tenant_id?: number | null }) | undefined
  if (!row) return undefined
  if (owner.userId !== undefined && row.user_id !== owner.userId) return undefined
  if (owner.tenantId !== undefined && row.tenant_id !== owner.tenantId) return undefined
  return row
}

export function updateConversationTitle(id: string, title: string): void {
  getDb().prepare(
    'UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?'
  ).run(title, Date.now(), id)
}

export function touchConversation(id: string): void {
  getDb().prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(Date.now(), id)
}

export function deleteConversation(id: string, owner: Owner = {}): void {
  // Re-check ownership before delete so a scoped caller never deletes another
  // user's row even via crafted id.
  if (owner.userId !== undefined || owner.tenantId !== undefined) {
    const existing = getConversation(id, owner)
    if (!existing) return
  }
  getDb().prepare('DELETE FROM conversations WHERE id = ?').run(id)
}

// ---- Message helpers ----

export function insertMessage(msg: Omit<MessageRow, 'created_at'>): MessageRow {
  const now = Date.now()
  getDb().prepare(
    'INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(msg.id, msg.conversation_id, msg.role, msg.content, now)
  return { ...msg, created_at: now }
}

export function getMessages(conversationId: string): MessageRow[] {
  return getDb().prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
  ).all(conversationId) as MessageRow[]
}

export function clearMessages(conversationId: string): void {
  getDb().prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId)
}
