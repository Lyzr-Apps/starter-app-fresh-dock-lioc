'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { callAIAgent } from '@/lib/aiAgent'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { FiPlus, FiTrash2, FiEdit3, FiSearch, FiSave, FiMessageSquare, FiX, FiSend, FiFileText, FiBook, FiChevronDown, FiChevronUp, FiLoader, FiAlertCircle, FiCheck, FiClock } from 'react-icons/fi'

// ---- Constants ----
const AGENT_ID = '69995932bbc45d3372ca0a6b'
const STORAGE_KEY = 'notekeeper_notes'

const THEME_VARS: React.CSSProperties & Record<string, string> = {
  '--background': '40 30% 96%',
  '--foreground': '30 25% 18%',
  '--card': '40 35% 98%',
  '--card-foreground': '30 25% 18%',
  '--primary': '25 55% 40%',
  '--primary-foreground': '40 30% 98%',
  '--secondary': '40 25% 90%',
  '--secondary-foreground': '30 25% 22%',
  '--accent': '15 60% 45%',
  '--accent-foreground': '40 30% 98%',
  '--destructive': '0 65% 50%',
  '--destructive-foreground': '40 30% 98%',
  '--muted': '40 20% 88%',
  '--muted-foreground': '30 15% 45%',
  '--border': '35 25% 82%',
  '--input': '35 20% 75%',
  '--ring': '25 55% 40%',
  '--sidebar-background': '40 28% 94%',
  '--sidebar-foreground': '30 25% 18%',
  '--sidebar-border': '35 22% 85%',
  '--sidebar-primary': '25 55% 40%',
  '--radius': '0.5rem',
} as React.CSSProperties & Record<string, string>

// ---- Interfaces ----
interface Note {
  id: string
  title: string
  content: string
  createdAt: string
  updatedAt: string
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  action?: string
}

// ---- Sample Data ----
const SAMPLE_NOTES: Note[] = [
  {
    id: 'sample-1',
    title: 'Weekly Grocery List',
    content: 'Milk, eggs, bread, avocados, chicken breast, brown rice, broccoli, olive oil, lemons, Greek yogurt. Remember to check for sales on organic produce.',
    createdAt: '2026-02-20T09:00:00Z',
    updatedAt: '2026-02-20T09:00:00Z',
  },
  {
    id: 'sample-2',
    title: 'Project Meeting Notes',
    content: 'Discussed Q1 roadmap priorities. Key decisions:\n- Launch new dashboard by March 15\n- Hire two frontend developers\n- Migrate database to PostgreSQL\n- Schedule weekly standup at 10am EST\n\nAction items assigned to team leads.',
    createdAt: '2026-02-19T14:30:00Z',
    updatedAt: '2026-02-19T15:00:00Z',
  },
  {
    id: 'sample-3',
    title: 'Book Recommendations',
    content: 'Fiction: "Klara and the Sun" by Kazuo Ishiguro\nNon-fiction: "Thinking, Fast and Slow" by Daniel Kahneman\nTech: "Designing Data-Intensive Applications" by Martin Kleppmann\n\nStart with the Kleppmann book for work reference.',
    createdAt: '2026-02-18T11:00:00Z',
    updatedAt: '2026-02-18T11:00:00Z',
  },
  {
    id: 'sample-4',
    title: 'Workout Plan - Week of Feb 17',
    content: 'Monday: Upper body (bench press, rows, shoulder press)\nTuesday: Cardio (30 min run)\nWednesday: Lower body (squats, lunges, deadlifts)\nThursday: Rest\nFriday: Full body circuit\nSaturday: Yoga/Stretching\nSunday: Rest',
    createdAt: '2026-02-17T08:00:00Z',
    updatedAt: '2026-02-17T08:00:00Z',
  },
]

// ---- Helpers ----
function generateId(): string {
  return 'note-' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36)
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return ''
  }
}

function formatTime(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function renderMarkdown(text: string) {
  if (!text) return null
  return (
    <div className="space-y-1">
      {text.split('\n').map((line, i) => {
        if (line.startsWith('### ')) return <h4 key={i} className="font-semibold text-sm mt-3 mb-1">{line.slice(4)}</h4>
        if (line.startsWith('## ')) return <h3 key={i} className="font-semibold text-base mt-3 mb-1">{line.slice(3)}</h3>
        if (line.startsWith('# ')) return <h2 key={i} className="font-bold text-lg mt-4 mb-2">{line.slice(2)}</h2>
        if (line.startsWith('- ') || line.startsWith('* ')) return <li key={i} className="ml-4 list-disc text-sm">{formatInline(line.slice(2))}</li>
        if (/^\d+\.\s/.test(line)) return <li key={i} className="ml-4 list-decimal text-sm">{formatInline(line.replace(/^\d+\.\s/, ''))}</li>
        if (!line.trim()) return <div key={i} className="h-1" />
        return <p key={i} className="text-sm">{formatInline(line)}</p>
      })}
    </div>
  )
}

function formatInline(text: string) {
  const parts = text.split(/\*\*(.*?)\*\*/g)
  if (parts.length === 1) return text
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i} className="font-semibold">{part}</strong> : part
  )
}

// ---- ErrorBoundary ----
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: '' }
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
          <div className="text-center p-8 max-w-md">
            <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
            <p className="text-muted-foreground mb-4 text-sm">{this.state.error}</p>
            <button onClick={() => this.setState({ hasError: false, error: '' })} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm">Try again</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// ---- Inline Sub-Components ----

function NoteCard({
  note,
  isSelected,
  onSelect,
  onDelete,
}: {
  note: Note
  isSelected: boolean
  onSelect: () => void
  onDelete: (e: React.MouseEvent) => void
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left p-3 rounded-lg border transition-all duration-200 group relative ${isSelected ? 'bg-primary/10 border-primary/40 shadow-md' : 'bg-card border-border hover:bg-secondary/50 hover:shadow-sm'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-sm truncate text-foreground">{note.title || 'Untitled'}</h3>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">{note.content || 'No content'}</p>
          <div className="flex items-center gap-1 mt-2">
            <FiClock className="w-3 h-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{formatDate(note.updatedAt)}</span>
          </div>
        </div>
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-destructive/10 hover:text-destructive text-muted-foreground flex-shrink-0"
          aria-label="Delete note"
        >
          <FiTrash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </button>
  )
}

function SidebarSkeleton() {
  return (
    <div className="space-y-3 p-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="p-3 rounded-lg border border-border">
          <Skeleton className="h-4 w-3/4 mb-2" />
          <Skeleton className="h-3 w-full mb-1" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  )
}

function EditorSkeleton() {
  return (
    <div className="p-8 space-y-6">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-64 w-full" />
      <div className="flex justify-end">
        <Skeleton className="h-10 w-32" />
      </div>
    </div>
  )
}

// ---- Main Page ----
export default function Page() {
  // Notes state
  const [notes, setNotes] = useState<Note[]>([])
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [isNewNote, setIsNewNote] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // UI state
  const [showSampleData, setShowSampleData] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  // Chat state
  const [chatOpen, setChatOpen] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)

  const chatEndRef = useRef<HTMLDivElement>(null)
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load notes from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed) && parsed.length > 0) {
          setNotes(parsed)
        }
      }
    } catch {
      // Ignore parse errors, start with empty notes
    }
    setInitialLoading(false)
  }, [])

  // Persist notes to localStorage whenever they change (skip during initial load)
  const isInitialLoadDone = useRef(false)
  useEffect(() => {
    if (initialLoading) return
    // Skip the very first render after loading (that's the load itself)
    if (!isInitialLoadDone.current) {
      isInitialLoadDone.current = true
      return
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notes))
    } catch {
      // Storage full or unavailable — silently fail
    }
  }, [notes, initialLoading])

  // Sample data toggle — merges sample notes without removing user notes
  useEffect(() => {
    if (showSampleData) {
      setNotes((prev) => {
        const sampleIds = new Set(SAMPLE_NOTES.map((s) => s.id))
        const withoutSamples = prev.filter((n) => !sampleIds.has(n.id))
        return [...SAMPLE_NOTES, ...withoutSamples]
      })
    } else {
      const sampleIds = new Set(SAMPLE_NOTES.map((s) => s.id))
      setNotes((prev) => prev.filter((n) => !sampleIds.has(n.id)))
      // If selected note was a sample, deselect
      if (selectedNoteId && sampleIds.has(selectedNoteId)) {
        setSelectedNoteId(null)
        setEditTitle('')
        setEditContent('')
        setIsNewNote(false)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSampleData])

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  // Status message auto-dismiss
  const showStatus = useCallback((type: 'success' | 'error' | 'info', text: string) => {
    setStatusMessage({ type, text })
    if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current)
    statusTimeoutRef.current = setTimeout(() => setStatusMessage(null), 4000)
  }, [])

  // Filtered notes
  const filteredNotes = notes.filter((note) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return (note.title?.toLowerCase().includes(q)) || (note.content?.toLowerCase().includes(q))
  })

  // Select note
  const handleSelectNote = useCallback((note: Note) => {
    setSelectedNoteId(note.id)
    setEditTitle(note.title)
    setEditContent(note.content)
    setIsNewNote(false)
  }, [])

  // New note
  const handleNewNote = useCallback(() => {
    setSelectedNoteId(null)
    setEditTitle('')
    setEditContent('')
    setIsNewNote(true)
  }, [])

  // Save note
  const handleSaveNote = useCallback(async () => {
    if (!editTitle.trim() && !editContent.trim()) {
      showStatus('error', 'Please enter a title or content for your note.')
      return
    }

    setSaving(true)
    const now = new Date().toISOString()

    if (isNewNote) {
      const newNote: Note = {
        id: generateId(),
        title: editTitle.trim() || 'Untitled',
        content: editContent.trim(),
        createdAt: now,
        updatedAt: now,
      }
      setNotes((prev) => [newNote, ...prev])
      setSelectedNoteId(newNote.id)
      setIsNewNote(false)
      showStatus('success', 'Note created successfully.')
    } else if (selectedNoteId) {
      setNotes((prev) =>
        prev.map((n) =>
          n.id === selectedNoteId
            ? { ...n, title: editTitle.trim() || 'Untitled', content: editContent.trim(), updatedAt: now }
            : n
        )
      )
      showStatus('success', 'Note updated successfully.')
    }

    // Brief delay for visual feedback
    await new Promise((r) => setTimeout(r, 300))
    setSaving(false)
  }, [editTitle, editContent, isNewNote, selectedNoteId, showStatus])

  // Delete note
  const handleDeleteNote = useCallback(async (noteId: string) => {
    setDeleting(true)
    await new Promise((r) => setTimeout(r, 300))

    setNotes((prev) => prev.filter((n) => n.id !== noteId))
    if (selectedNoteId === noteId) {
      setSelectedNoteId(null)
      setEditTitle('')
      setEditContent('')
      setIsNewNote(false)
    }
    setDeleteConfirmId(null)
    setDeleting(false)
    showStatus('success', 'Note deleted successfully.')
  }, [selectedNoteId, showStatus])

  // Chat send
  const handleSendChat = useCallback(async () => {
    if (!chatInput.trim()) return

    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: chatInput.trim(),
      timestamp: new Date().toISOString(),
    }
    setChatMessages((prev) => [...prev, userMsg])
    setChatInput('')
    setChatLoading(true)
    setActiveAgentId(AGENT_ID)

    try {
      const result = await callAIAgent(chatInput.trim(), AGENT_ID)
      setActiveAgentId(null)

      const agentData = result?.response?.result
      const responseText = agentData?.response ?? result?.response?.message ?? 'I received your message but could not generate a detailed response.'
      const actionPerformed = agentData?.action_performed ?? ''
      const noteData = agentData?.note_data

      const assistantMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: responseText,
        timestamp: new Date().toISOString(),
        action: actionPerformed,
      }
      setChatMessages((prev) => [...prev, assistantMsg])

      // If agent created/updated a note, reflect in local state
      if (actionPerformed === 'create' && noteData?.title) {
        const newNote: Note = {
          id: noteData?.note_id ?? generateId(),
          title: noteData.title ?? 'Untitled',
          content: noteData?.content ?? '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        setNotes((prev) => [newNote, ...prev])
        showStatus('info', 'Note created via assistant.')
      }
    } catch (err) {
      setActiveAgentId(null)
      const errorMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: 'Sorry, I encountered an error processing your request. Please try again.',
        timestamp: new Date().toISOString(),
      }
      setChatMessages((prev) => [...prev, errorMsg])
    } finally {
      setChatLoading(false)
    }
  }, [chatInput, showStatus])

  const selectedNote = notes.find((n) => n.id === selectedNoteId) ?? null
  const isEditorActive = isNewNote || selectedNoteId !== null

  return (
    <ErrorBoundary>
      <div style={THEME_VARS} className="min-h-screen bg-background text-foreground font-sans" >
        {/* ===== HEADER ===== */}
        <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 md:px-6 shadow-sm">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <FiBook className="w-4 h-4 text-primary-foreground" />
            </div>
            <h1 className="text-lg font-semibold font-serif text-foreground tracking-tight">NoteKeeper</h1>
          </div>

          <div className="flex items-center gap-4">
            {/* Search */}
            <div className="relative hidden sm:block">
              <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search notes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 w-48 md:w-64 h-9 text-sm bg-background"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <FiX className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Sample Data Toggle */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground hidden md:inline">Sample Data</span>
              <Switch checked={showSampleData} onCheckedChange={setShowSampleData} />
            </div>
          </div>
        </header>

        {/* Mobile search */}
        <div className="sm:hidden px-4 py-2 border-b border-border bg-card">
          <div className="relative">
            <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-sm bg-background"
            />
          </div>
        </div>

        {/* ===== MAIN LAYOUT ===== */}
        <div className="flex flex-1" style={{ height: 'calc(100vh - 3.5rem)' }}>
          {/* ---- Sidebar ---- */}
          <aside className="w-72 lg:w-80 border-r border-border bg-card/50 flex flex-col hidden md:flex">
            <div className="p-3 border-b border-border">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">{notes.length} {notes.length === 1 ? 'Note' : 'Notes'}</span>
                {searchQuery && (
                  <Badge variant="secondary" className="text-xs">{filteredNotes.length} found</Badge>
                )}
              </div>
            </div>

            <ScrollArea className="flex-1">
              {initialLoading ? (
                <SidebarSkeleton />
              ) : filteredNotes.length === 0 ? (
                <div className="p-6 text-center">
                  <FiFileText className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
                  <p className="text-sm text-muted-foreground">
                    {searchQuery ? 'No notes match your search.' : 'No notes yet.'}
                  </p>
                  {!searchQuery && (
                    <p className="text-xs text-muted-foreground mt-1">Click the button below to create one.</p>
                  )}
                </div>
              ) : (
                <div className="p-2 space-y-1.5">
                  {filteredNotes.map((note) => (
                    <NoteCard
                      key={note.id}
                      note={note}
                      isSelected={selectedNoteId === note.id}
                      onSelect={() => handleSelectNote(note)}
                      onDelete={(e) => {
                        e.stopPropagation()
                        setDeleteConfirmId(note.id)
                      }}
                    />
                  ))}
                </div>
              )}
            </ScrollArea>

            {/* New Note Button */}
            <div className="p-3 border-t border-border">
              <Button onClick={handleNewNote} className="w-full gap-2" size="sm">
                <FiPlus className="w-4 h-4" />
                New Note
              </Button>
            </div>
          </aside>

          {/* ---- Editor Panel ---- */}
          <main className="flex-1 flex flex-col overflow-hidden bg-background">
            {/* Status message */}
            {statusMessage && (
              <div className={`mx-4 mt-3 px-4 py-2.5 rounded-lg text-sm flex items-center gap-2 transition-all duration-300 ${statusMessage.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : statusMessage.type === 'error' ? 'bg-red-50 text-red-800 border border-red-200' : 'bg-blue-50 text-blue-800 border border-blue-200'}`}>
                {statusMessage.type === 'success' && <FiCheck className="w-4 h-4 flex-shrink-0" />}
                {statusMessage.type === 'error' && <FiAlertCircle className="w-4 h-4 flex-shrink-0" />}
                {statusMessage.type === 'info' && <FiFileText className="w-4 h-4 flex-shrink-0" />}
                <span>{statusMessage.text}</span>
                <button onClick={() => setStatusMessage(null)} className="ml-auto">
                  <FiX className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Mobile: New Note button for small screens */}
            <div className="md:hidden p-3 border-b border-border flex items-center gap-2">
              <Button onClick={handleNewNote} size="sm" className="gap-1.5">
                <FiPlus className="w-4 h-4" />
                New Note
              </Button>
              {notes.length > 0 && (
                <span className="text-xs text-muted-foreground">{notes.length} notes</span>
              )}
            </div>

            {initialLoading ? (
              <EditorSkeleton />
            ) : !isEditorActive ? (
              /* Empty state */
              <div className="flex-1 flex items-center justify-center p-8">
                <div className="text-center max-w-md">
                  <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-secondary/60 flex items-center justify-center">
                    <FiEdit3 className="w-9 h-9 text-primary/60" />
                  </div>
                  <h2 className="text-xl font-semibold font-serif text-foreground mb-2">
                    {notes.length === 0 ? 'Create your first note!' : 'Select a note to view'}
                  </h2>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-6">
                    {notes.length === 0
                      ? 'Start capturing your thoughts, ideas, and tasks. Click the button below or use the chat assistant to get started.'
                      : 'Choose a note from the sidebar to edit, or create a new one.'}
                  </p>
                  <Button onClick={handleNewNote} className="gap-2">
                    <FiPlus className="w-4 h-4" />
                    Create New Note
                  </Button>
                </div>
              </div>
            ) : (
              /* Editor */
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto p-4 md:p-8">
                  <div className="max-w-3xl mx-auto space-y-4">
                    {/* Title */}
                    <div>
                      <Input
                        placeholder="Note title..."
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="text-xl md:text-2xl font-serif font-semibold border-0 border-b border-border rounded-none px-0 h-auto py-2 bg-transparent focus-visible:ring-0 focus-visible:border-primary placeholder:text-muted-foreground/50"
                      />
                    </div>

                    {/* Meta info for existing notes */}
                    {selectedNote && (
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <FiClock className="w-3 h-3" />
                          Created {formatDate(selectedNote.createdAt)} at {formatTime(selectedNote.createdAt)}
                        </span>
                        {selectedNote.updatedAt !== selectedNote.createdAt && (
                          <span className="flex items-center gap-1">
                            <FiEdit3 className="w-3 h-3" />
                            Updated {formatDate(selectedNote.updatedAt)}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Content */}
                    <Textarea
                      placeholder="Start writing your note..."
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="min-h-[300px] md:min-h-[400px] text-base leading-relaxed border-0 bg-transparent resize-none px-0 focus-visible:ring-0 placeholder:text-muted-foreground/40"
                      rows={16}
                    />
                  </div>
                </div>

                {/* Save bar */}
                <div className="border-t border-border bg-card/60 px-4 md:px-8 py-3 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {editContent.length} characters
                  </span>
                  <Button onClick={handleSaveNote} disabled={saving} className="gap-2">
                    {saving ? (
                      <>
                        <FiLoader className="w-4 h-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <FiSave className="w-4 h-4" />
                        Save Note
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </main>
        </div>

        {/* ===== DELETE CONFIRMATION DIALOG ===== */}
        <Dialog open={deleteConfirmId !== null} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null) }}>
          <DialogContent className="sm:max-w-md bg-card">
            <DialogHeader>
              <DialogTitle className="font-serif">Delete Note</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this note? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setDeleteConfirmId(null)} disabled={deleting}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteConfirmId && handleDeleteNote(deleteConfirmId)}
                disabled={deleting}
                className="gap-2"
              >
                {deleting ? (
                  <>
                    <FiLoader className="w-4 h-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <FiTrash2 className="w-4 h-4" />
                    Delete
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== CHAT PANEL ===== */}
        {/* Chat toggle button */}
        {!chatOpen && (
          <button
            onClick={() => setChatOpen(true)}
            className="fixed bottom-6 right-6 w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl transition-all duration-200 flex items-center justify-center hover:scale-105 z-50"
            aria-label="Open chat assistant"
          >
            <FiMessageSquare className="w-5 h-5" />
          </button>
        )}

        {/* Chat panel */}
        {chatOpen && (
          <div className="fixed bottom-6 right-6 w-80 md:w-96 bg-card border border-border rounded-xl shadow-2xl flex flex-col z-50" style={{ height: '28rem' }}>
            {/* Chat header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border rounded-t-xl bg-secondary/30">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center">
                  <FiMessageSquare className="w-3.5 h-3.5 text-primary-foreground" />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-foreground">Notes Assistant</h3>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${activeAgentId ? 'bg-amber-500 animate-pulse' : 'bg-green-500'}`} />
                    <span className="text-xs text-muted-foreground">{activeAgentId ? 'Processing...' : 'Online'}</span>
                  </div>
                </div>
              </div>
              <button onClick={() => setChatOpen(false)} className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
                <FiX className="w-4 h-4" />
              </button>
            </div>

            {/* Chat messages */}
            <ScrollArea className="flex-1 px-4 py-3">
              {chatMessages.length === 0 ? (
                <div className="text-center py-8">
                  <FiMessageSquare className="w-8 h-8 mx-auto text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">Ask me to create, find, or manage your notes.</p>
                  <p className="text-xs text-muted-foreground mt-1">Try: &quot;Create a note about meeting agenda&quot;</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {chatMessages.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] rounded-lg px-3 py-2 ${msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}>
                        {msg.role === 'assistant' ? renderMarkdown(msg.content) : <p className="text-sm">{msg.content}</p>}
                        {msg.action && (
                          <Badge variant="outline" className="mt-1.5 text-xs">{msg.action}</Badge>
                        )}
                        <p className="text-xs opacity-60 mt-1">{formatTime(msg.timestamp)}</p>
                      </div>
                    </div>
                  ))}
                  {chatLoading && (
                    <div className="flex justify-start">
                      <div className="bg-secondary rounded-lg px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '150ms' }} />
                          <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              )}
            </ScrollArea>

            {/* Chat input */}
            <div className="border-t border-border p-3 flex items-center gap-2">
              <Input
                placeholder="Type a message..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendChat() } }}
                className="flex-1 h-9 text-sm bg-background"
                disabled={chatLoading}
              />
              <Button size="icon" onClick={handleSendChat} disabled={chatLoading || !chatInput.trim()} className="h-9 w-9 flex-shrink-0">
                <FiSend className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ===== AGENT INFO SECTION ===== */}
        <div className="fixed bottom-6 left-6 z-40 hidden lg:block">
          <div className="bg-card border border-border rounded-lg shadow-md px-4 py-3 max-w-xs">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Powered by</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${activeAgentId === AGENT_ID ? 'bg-amber-500 animate-pulse' : 'bg-green-500'}`} />
              <span className="text-sm font-medium text-foreground">Notes Assistant Agent</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">Manages note CRUD operations via natural language commands.</p>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  )
}
