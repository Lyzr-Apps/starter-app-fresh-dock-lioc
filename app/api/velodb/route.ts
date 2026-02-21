import { NextRequest, NextResponse } from 'next/server'
import {
  isVeloDBAvailable,
  ensureNotesTable,
  getAllNotes,
  getNoteById,
  createNote,
  updateNote,
  deleteNote,
  searchNotes,
} from '@/lib/velodb'

/**
 * GET /api/velodb
 *
 * Query parameters:
 *   ?action=list              — List all notes
 *   ?action=get&id=<noteId>   — Get a single note
 *   ?action=search&q=<query>  — Search notes
 *   ?action=status            — Check VeloDB connection status
 *   ?action=init              — Initialize the notes table
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action') || 'list'

    if (action === 'status') {
      const available = await isVeloDBAvailable()
      return NextResponse.json({
        success: true,
        connected: available,
        message: available
          ? 'VeloDB connection is active'
          : 'VeloDB is not configured or unreachable. Set VELODB_HOST, VELODB_USER, VELODB_PASSWORD in .env',
      })
    }

    if (action === 'init') {
      await ensureNotesTable()
      return NextResponse.json({ success: true, message: 'Notes table created or already exists' })
    }

    if (action === 'get') {
      const id = searchParams.get('id')
      if (!id) {
        return NextResponse.json(
          { success: false, error: 'Missing id parameter' },
          { status: 400 }
        )
      }
      const note = await getNoteById(id)
      if (!note) {
        return NextResponse.json(
          { success: false, error: 'Note not found' },
          { status: 404 }
        )
      }
      return NextResponse.json({ success: true, note })
    }

    if (action === 'search') {
      const q = searchParams.get('q') || ''
      const notes = await searchNotes(q)
      return NextResponse.json({ success: true, notes })
    }

    // Default: list all notes
    const notes = await getAllNotes()
    return NextResponse.json({ success: true, notes })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { success: false, error: msg },
      { status: 500 }
    )
  }
}

/**
 * POST /api/velodb
 *
 * Body JSON:
 *   { action: "create", note: { id, title, content } }
 *   { action: "update", note: { id, title, content, created_at? } }
 *   { action: "delete", id: "<noteId>" }
 *   { action: "sync", notes: Note[] }  — Bulk sync from localStorage
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action } = body

    if (action === 'create') {
      const { note } = body
      if (!note?.id || !note?.title) {
        return NextResponse.json(
          { success: false, error: 'note.id and note.title are required' },
          { status: 400 }
        )
      }
      await createNote({
        id: note.id,
        title: note.title || 'Untitled',
        content: note.content || '',
      })
      return NextResponse.json({ success: true, message: 'Note created', id: note.id })
    }

    if (action === 'update') {
      const { note } = body
      if (!note?.id) {
        return NextResponse.json(
          { success: false, error: 'note.id is required' },
          { status: 400 }
        )
      }
      await updateNote({
        id: note.id,
        title: note.title || 'Untitled',
        content: note.content || '',
        created_at: note.created_at || note.createdAt,
      })
      return NextResponse.json({ success: true, message: 'Note updated', id: note.id })
    }

    if (action === 'delete') {
      const { id } = body
      if (!id) {
        return NextResponse.json(
          { success: false, error: 'id is required' },
          { status: 400 }
        )
      }
      await deleteNote(id)
      return NextResponse.json({ success: true, message: 'Note deleted', id })
    }

    if (action === 'sync') {
      const { notes } = body
      if (!Array.isArray(notes)) {
        return NextResponse.json(
          { success: false, error: 'notes array is required' },
          { status: 400 }
        )
      }
      // Ensure table exists
      await ensureNotesTable()
      // Insert all notes (skip samples)
      let synced = 0
      for (const note of notes) {
        if (note.id?.startsWith('sample-')) continue
        try {
          await updateNote({
            id: note.id,
            title: note.title || 'Untitled',
            content: note.content || '',
            created_at: note.created_at || note.createdAt,
          })
          synced++
        } catch {
          // Skip individual failures during sync
        }
      }
      return NextResponse.json({
        success: true,
        message: `Synced ${synced} of ${notes.length} notes`,
        synced,
      })
    }

    return NextResponse.json(
      { success: false, error: `Unknown action: ${action}` },
      { status: 400 }
    )
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { success: false, error: msg },
      { status: 500 }
    )
  }
}
