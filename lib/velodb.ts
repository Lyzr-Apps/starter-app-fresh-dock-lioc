/**
 * VeloDB Client Utility (Server-Side Only)
 *
 * VeloDB is built on Apache Doris and exposes a MySQL-compatible HTTP API.
 * This client uses the Doris HTTP Statement Execution API:
 *   POST http://<fe_host>:<http_port>/api/query/<database>
 *
 * Authentication: HTTP Basic Auth (username:password)
 *
 * Environment Variables Required:
 *   VELODB_HOST       - VeloDB FE host (e.g., "your-cluster.velodb.io")
 *   VELODB_HTTP_PORT  - HTTP port (default: 8030)
 *   VELODB_USER       - Database user (default: "root")
 *   VELODB_PASSWORD   - Database password (default: "")
 *   VELODB_DATABASE   - Database name (default: "notekeeper")
 *
 * @example
 * ```ts
 * import { veloQuery, veloExecute, ensureNotesTable } from '@/lib/velodb'
 *
 * await ensureNotesTable()
 * const notes = await veloQuery('SELECT * FROM notes ORDER BY updated_at DESC')
 * await veloExecute("INSERT INTO notes (id, title, content) VALUES ('abc', 'Hello', 'World')")
 * ```
 */

// ---- Configuration ----
function getConfig() {
  return {
    host: process.env.VELODB_HOST || '',
    port: process.env.VELODB_HTTP_PORT || '8030',
    user: process.env.VELODB_USER || 'root',
    password: process.env.VELODB_PASSWORD || '',
    database: process.env.VELODB_DATABASE || 'notekeeper',
  }
}

function getBaseUrl(): string {
  const { host, port, database } = getConfig()
  if (!host) throw new Error('VELODB_HOST environment variable is not configured')
  const protocol = host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https'
  return `${protocol}://${host}:${port}/api/query/${database}`
}

function getAuthHeader(): string {
  const { user, password } = getConfig()
  return 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64')
}

// ---- Types ----
export interface VeloDBResponse {
  msg: string
  code: number
  data: {
    type: string
    data?: any[][]
    meta?: { name: string; type: string }[]
    status?: any
    time?: number
  }
}

export interface NoteRow {
  id: string
  title: string
  content: string
  created_at: string
  updated_at: string
}

// ---- Core Query Functions ----

/**
 * Execute a SQL query against VeloDB and return the raw response
 */
export async function veloQueryRaw(sql: string): Promise<VeloDBResponse> {
  const url = getBaseUrl()
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': getAuthHeader(),
    },
    body: JSON.stringify({ stmt: sql }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`VeloDB HTTP ${response.status}: ${text}`)
  }

  const result: VeloDBResponse = await response.json()

  if (result.code !== 0) {
    throw new Error(`VeloDB query error: ${result.msg}`)
  }

  return result
}

/**
 * Execute a SELECT query and return rows as typed objects
 */
export async function veloQuery<T = Record<string, any>>(sql: string): Promise<T[]> {
  const result = await veloQueryRaw(sql)

  const meta = result.data?.meta || []
  const rows = result.data?.data || []

  return rows.map((row) => {
    const obj: Record<string, any> = {}
    meta.forEach((col, idx) => {
      obj[col.name] = row[idx]
    })
    return obj as T
  })
}

/**
 * Execute a non-SELECT SQL statement (INSERT, UPDATE, DELETE, CREATE)
 */
export async function veloExecute(sql: string): Promise<{ success: boolean; msg: string }> {
  const result = await veloQueryRaw(sql)
  return { success: result.code === 0, msg: result.msg }
}

// ---- SQL Escape ----

/**
 * Escape a string value for safe SQL insertion (prevent SQL injection)
 */
export function escapeSQL(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\x00/g, '\\0')
    .replace(/\x1a/g, '\\Z')
}

// ---- Notes Table Operations ----

/**
 * Create the notes table if it doesn't exist
 */
export async function ensureNotesTable(): Promise<void> {
  const sql = `
    CREATE TABLE IF NOT EXISTS notes (
      id VARCHAR(128) NOT NULL,
      title VARCHAR(1024) NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    DUPLICATE KEY(id)
    DISTRIBUTED BY HASH(id) BUCKETS 1
    PROPERTIES (
      "replication_allocation" = "tag.location.default: 1"
    )
  `
  await veloExecute(sql)
}

/**
 * Get all notes, ordered by most recently updated first
 */
export async function getAllNotes(): Promise<NoteRow[]> {
  return veloQuery<NoteRow>('SELECT id, title, content, created_at, updated_at FROM notes ORDER BY updated_at DESC')
}

/**
 * Get a single note by ID
 */
export async function getNoteById(id: string): Promise<NoteRow | null> {
  const rows = await veloQuery<NoteRow>(
    `SELECT id, title, content, created_at, updated_at FROM notes WHERE id = '${escapeSQL(id)}' LIMIT 1`
  )
  return rows.length > 0 ? rows[0] : null
}

/**
 * Create a new note
 */
export async function createNote(note: { id: string; title: string; content: string }): Promise<void> {
  const now = new Date().toISOString().replace('T', ' ').replace('Z', '').substring(0, 19)
  const sql = `INSERT INTO notes (id, title, content, created_at, updated_at) VALUES ('${escapeSQL(note.id)}', '${escapeSQL(note.title)}', '${escapeSQL(note.content)}', '${now}', '${now}')`
  await veloExecute(sql)
}

/**
 * Update an existing note (VeloDB/Doris uses INSERT to update in DUPLICATE KEY model)
 */
export async function updateNote(note: { id: string; title: string; content: string; created_at?: string }): Promise<void> {
  // In Doris DUPLICATE KEY model, we delete old and insert new
  await veloExecute(`DELETE FROM notes WHERE id = '${escapeSQL(note.id)}'`)
  const now = new Date().toISOString().replace('T', ' ').replace('Z', '').substring(0, 19)
  const createdAt = note.created_at
    ? note.created_at.replace('T', ' ').replace('Z', '').substring(0, 19)
    : now
  const sql = `INSERT INTO notes (id, title, content, created_at, updated_at) VALUES ('${escapeSQL(note.id)}', '${escapeSQL(note.title)}', '${escapeSQL(note.content)}', '${createdAt}', '${now}')`
  await veloExecute(sql)
}

/**
 * Delete a note by ID
 */
export async function deleteNote(id: string): Promise<void> {
  await veloExecute(`DELETE FROM notes WHERE id = '${escapeSQL(id)}'`)
}

/**
 * Search notes by title or content
 */
export async function searchNotes(query: string): Promise<NoteRow[]> {
  const escaped = escapeSQL(query)
  return veloQuery<NoteRow>(
    `SELECT id, title, content, created_at, updated_at FROM notes WHERE title LIKE '%${escaped}%' OR content LIKE '%${escaped}%' ORDER BY updated_at DESC`
  )
}

/**
 * Check if VeloDB connection is configured and reachable
 */
export async function isVeloDBAvailable(): Promise<boolean> {
  try {
    const { host } = getConfig()
    if (!host) return false
    await veloQueryRaw('SELECT 1')
    return true
  } catch {
    return false
  }
}
