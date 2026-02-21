'use client'

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { callAIAgent } from '@/lib/aiAgent'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { FiPlus, FiTrash2, FiEdit3, FiSearch, FiSave, FiMessageSquare, FiX, FiSend, FiFileText, FiBook, FiLoader, FiAlertCircle, FiCheck, FiClock, FiDatabase, FiRefreshCw, FiCloud, FiCloudOff, FiMic, FiMicOff, FiBell, FiBellOff, FiCalendar, FiVolume2 } from 'react-icons/fi'

// ---- Constants ----
const AGENT_ID = '69995932bbc45d3372ca0a6b'
const STORAGE_KEY = 'notekeeper_notes'
const REMINDERS_KEY = 'notekeeper_reminders'
const VELODB_API = '/api/velodb'

// ---- VeloDB API Client (Client-side) ----
async function velodbFetch(path: string, options?: RequestInit) {
  try {
    const res = await fetch(`${VELODB_API}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options?.headers },
    })
    return await res.json()
  } catch {
    return { success: false, error: 'Network error' }
  }
}

async function checkVeloDBStatus(): Promise<{ connected: boolean; message: string }> {
  const res = await velodbFetch('?action=status')
  return { connected: res?.connected === true, message: res?.message || 'Unknown status' }
}

async function initVeloDB(): Promise<boolean> {
  const res = await velodbFetch('?action=init')
  return res?.success === true
}

async function fetchNotesFromVeloDB(): Promise<Note[] | null> {
  const res = await velodbFetch('?action=list')
  if (!res?.success || !Array.isArray(res.notes)) return null
  return res.notes.map((n: any) => ({
    id: n.id,
    title: n.title || '',
    content: n.content || '',
    createdAt: n.created_at || n.createdAt || new Date().toISOString(),
    updatedAt: n.updated_at || n.updatedAt || new Date().toISOString(),
  }))
}

async function saveNoteToVeloDB(note: Note, isNew: boolean): Promise<boolean> {
  const res = await velodbFetch('', {
    method: 'POST',
    body: JSON.stringify({
      action: isNew ? 'create' : 'update',
      note: { id: note.id, title: note.title, content: note.content, created_at: note.createdAt },
    }),
  })
  return res?.success === true
}

async function deleteNoteFromVeloDB(id: string): Promise<boolean> {
  const res = await velodbFetch('', {
    method: 'POST',
    body: JSON.stringify({ action: 'delete', id }),
  })
  return res?.success === true
}

async function syncNotesToVeloDB(notes: Note[]): Promise<{ success: boolean; synced: number }> {
  const res = await velodbFetch('', {
    method: 'POST',
    body: JSON.stringify({ action: 'sync', notes }),
  })
  return { success: res?.success === true, synced: res?.synced ?? 0 }
}

// ---- Reminder Detection ----
interface Reminder {
  id: string
  noteId: string
  noteTitle: string
  text: string
  date: Date
  dismissed: boolean
}

const MONTH_NAMES = ['january','february','march','april','may','june','july','august','september','october','november','december']
const MONTH_SHORT = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']

function extractReminders(note: Note): Reminder[] {
  const reminders: Reminder[] = []
  const text = (note.title + ' ' + note.content).toLowerCase()
  const lines = (note.title + '\n' + note.content).split('\n')

  // Keywords that indicate a reminder/event
  const reminderKeywords = /\b(remind|reminder|meeting|deadline|due|appointment|call|standup|review|sync|demo|presentation|interview|conference|schedule|event|follow.?up)\b/i

  for (const line of lines) {
    if (!reminderKeywords.test(line)) continue

    // Try to extract dates from the line
    const dates = parseDatesFromText(line)
    for (const date of dates) {
      if (date >= new Date(Date.now() - 86400000)) { // include today and future
        reminders.push({
          id: `rem-${note.id}-${date.getTime()}`,
          noteId: note.id,
          noteTitle: note.title || 'Untitled',
          text: line.trim(),
          date,
          dismissed: false,
        })
      }
    }
  }

  return reminders
}

function parseDatesFromText(text: string): Date[] {
  const dates: Date[] = []
  const now = new Date()
  const currentYear = now.getFullYear()

  // Pattern: "March 15", "March 15, 2026", "march 15th"
  const monthDayPattern = new RegExp(
    `\\b(${MONTH_NAMES.join('|')}|${MONTH_SHORT.join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:[,\\s]+(\\d{4}))?\\b`, 'gi'
  )
  let match
  while ((match = monthDayPattern.exec(text)) !== null) {
    const monthStr = match[1].toLowerCase()
    let monthIdx = MONTH_NAMES.indexOf(monthStr)
    if (monthIdx === -1) monthIdx = MONTH_SHORT.indexOf(monthStr)
    if (monthIdx === -1) continue
    const day = parseInt(match[2])
    const year = match[3] ? parseInt(match[3]) : currentYear
    if (day >= 1 && day <= 31) {
      const d = new Date(year, monthIdx, day, 9, 0, 0)
      if (!isNaN(d.getTime())) dates.push(d)
    }
  }

  // Pattern: "2/21", "02/21/2026", "2-21-2026"
  const slashPattern = /\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/g
  while ((match = slashPattern.exec(text)) !== null) {
    const m = parseInt(match[1]) - 1
    const d = parseInt(match[2])
    let y = match[3] ? parseInt(match[3]) : currentYear
    if (y < 100) y += 2000
    if (m >= 0 && m <= 11 && d >= 1 && d <= 31) {
      const date = new Date(y, m, d, 9, 0, 0)
      if (!isNaN(date.getTime())) dates.push(date)
    }
  }

  // Pattern: "today", "tomorrow"
  if (/\btoday\b/i.test(text)) {
    dates.push(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0))
  }
  if (/\btomorrow\b/i.test(text)) {
    const tom = new Date(now)
    tom.setDate(tom.getDate() + 1)
    dates.push(new Date(tom.getFullYear(), tom.getMonth(), tom.getDate(), 9, 0, 0))
  }

  // Pattern: "next monday", "next friday" etc.
  const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
  const nextDayMatch = text.match(/\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i)
  if (nextDayMatch) {
    const targetDay = dayNames.indexOf(nextDayMatch[1].toLowerCase())
    if (targetDay >= 0) {
      const d = new Date(now)
      const diff = (targetDay - d.getDay() + 7) % 7 || 7
      d.setDate(d.getDate() + diff)
      dates.push(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0, 0))
    }
  }

  // Deduplicate by timestamp
  const seen = new Set<number>()
  return dates.filter((d) => {
    const t = d.getTime()
    if (seen.has(t)) return false
    seen.add(t)
    return true
  })
}

function formatReminderDate(date: Date): string {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000)

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays > 0 && diffDays <= 7) return `In ${diffDays} days`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ---- Speech Recognition Type ----
interface SpeechRecognitionEvent {
  resultIndex: number
  results: SpeechRecognitionResultList
}

interface SpeechRecognitionResultList {
  length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionResult {
  isFinal: boolean
  length: number
  item(index: number): SpeechRecognitionAlternative
  [index: number]: SpeechRecognitionAlternative
}

interface SpeechRecognitionAlternative {
  transcript: string
  confidence: number
}

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
  hasReminder,
}: {
  note: Note
  isSelected: boolean
  onSelect: () => void
  onDelete: (e: React.MouseEvent) => void
  hasReminder: boolean
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left p-3 rounded-lg border transition-all duration-200 group relative ${isSelected ? 'bg-primary/10 border-primary/40 shadow-md' : 'bg-card border-border hover:bg-secondary/50 hover:shadow-sm'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="font-medium text-sm truncate text-foreground">{note.title || 'Untitled'}</h3>
            {hasReminder && <FiBell className="w-3 h-3 text-accent flex-shrink-0" />}
          </div>
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

  // VeloDB state
  const [veloConnected, setVeloConnected] = useState(false)
  const [veloChecking, setVeloChecking] = useState(true)
  const [veloSyncing, setVeloSyncing] = useState(false)

  // Voice state
  const [isListening, setIsListening] = useState(false)
  const [voiceSupported, setVoiceSupported] = useState(false)
  const [interimTranscript, setInterimTranscript] = useState('')
  const recognitionRef = useRef<any>(null)

  // Reminder state
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const [showReminders, setShowReminders] = useState(false)

  // Chat state
  const [chatOpen, setChatOpen] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)

  const chatEndRef = useRef<HTMLDivElement>(null)
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Check if Speech Recognition is supported
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (SpeechRecognition) {
      setVoiceSupported(true)
    }
  }, [])

  // Load dismissed reminder IDs from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(REMINDERS_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed)) {
          setDismissedIds(new Set(parsed))
        }
      }
    } catch {}
  }, [])

  // Extract reminders from all notes whenever notes change
  useEffect(() => {
    const allReminders: Reminder[] = []
    for (const note of notes) {
      const noteReminders = extractReminders(note)
      allReminders.push(...noteReminders)
    }
    // Sort by date ascending
    allReminders.sort((a, b) => a.date.getTime() - b.date.getTime())
    setReminders(allReminders)
  }, [notes])

  // Active (non-dismissed) reminders
  const activeReminders = useMemo(() => {
    return reminders.filter((r) => !dismissedIds.has(r.id))
  }, [reminders, dismissedIds])

  // Upcoming reminders (today and within next 7 days)
  const upcomingReminders = useMemo(() => {
    const now = new Date()
    const weekFromNow = new Date(now.getTime() + 7 * 86400000)
    return activeReminders.filter((r) => r.date >= new Date(now.getFullYear(), now.getMonth(), now.getDate()) && r.date <= weekFromNow)
  }, [activeReminders])

  // Reminder notification check — check every minute for due reminders
  useEffect(() => {
    const checkReminders = () => {
      const now = new Date()
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const dueToday = activeReminders.filter((r) => {
        const rDate = new Date(r.date.getFullYear(), r.date.getMonth(), r.date.getDate())
        return rDate.getTime() === today.getTime()
      })
      if (dueToday.length > 0 && !showReminders) {
        setShowReminders(true)
      }
    }
    checkReminders()
    const interval = setInterval(checkReminders, 60000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeReminders])

  const dismissReminder = useCallback((id: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev)
      next.add(id)
      try { localStorage.setItem(REMINDERS_KEY, JSON.stringify(Array.from(next))) } catch {}
      return next
    })
  }, [])

  // Load notes: try VeloDB first, fallback to localStorage
  useEffect(() => {
    async function loadNotes() {
      const status = await checkVeloDBStatus()
      setVeloConnected(status.connected)
      setVeloChecking(false)

      if (status.connected) {
        await initVeloDB()
        const dbNotes = await fetchNotesFromVeloDB()
        if (dbNotes && dbNotes.length > 0) {
          setNotes(dbNotes)
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(dbNotes)) } catch {}
          setInitialLoading(false)
          return
        }
        try {
          const stored = localStorage.getItem(STORAGE_KEY)
          if (stored) {
            const parsed = JSON.parse(stored)
            if (Array.isArray(parsed) && parsed.length > 0) {
              setNotes(parsed)
              const nonSample = parsed.filter((n: Note) => !n.id.startsWith('sample-'))
              if (nonSample.length > 0) {
                syncNotesToVeloDB(nonSample).catch(() => {})
              }
            }
          }
        } catch {}
      } else {
        try {
          const stored = localStorage.getItem(STORAGE_KEY)
          if (stored) {
            const parsed = JSON.parse(stored)
            if (Array.isArray(parsed) && parsed.length > 0) {
              setNotes(parsed)
            }
          }
        } catch {}
      }
      setInitialLoading(false)
    }
    loadNotes()
  }, [])

  // Persist notes to localStorage whenever they change
  const isInitialLoadDone = useRef(false)
  useEffect(() => {
    if (initialLoading) return
    if (!isInitialLoadDone.current) {
      isInitialLoadDone.current = true
      return
    }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(notes)) } catch {}
  }, [notes, initialLoading])

  // Sample data toggle
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

  // Note IDs with active reminders
  const noteIdsWithReminders = useMemo(() => {
    const ids = new Set<string>()
    activeReminders.forEach((r) => ids.add(r.noteId))
    return ids
  }, [activeReminders])

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

  // ---- Voice Recognition ----
  const startListening = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      showStatus('error', 'Speech recognition is not supported in this browser. Try Chrome or Edge.')
      return
    }

    // If we're not in a note, create a new one
    if (!isNewNote && !selectedNoteId) {
      setIsNewNote(true)
      setEditTitle('')
      setEditContent('')
    }

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onstart = () => {
      setIsListening(true)
    }

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = ''
      let final = ''

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          final += transcript
        } else {
          interim += transcript
        }
      }

      if (final) {
        setEditContent((prev) => {
          const separator = prev && !prev.endsWith('\n') && !prev.endsWith(' ') ? ' ' : ''
          return prev + separator + final
        })
        setInterimTranscript('')
      } else {
        setInterimTranscript(interim)
      }
    }

    recognition.onerror = (event: any) => {
      if (event.error === 'not-allowed') {
        showStatus('error', 'Microphone access denied. Please allow microphone access in browser settings.')
      } else if (event.error !== 'aborted') {
        showStatus('error', `Voice recognition error: ${event.error}`)
      }
      setIsListening(false)
      setInterimTranscript('')
    }

    recognition.onend = () => {
      setIsListening(false)
      setInterimTranscript('')
    }

    recognitionRef.current = recognition
    recognition.start()
  }, [isNewNote, selectedNoteId, showStatus])

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
    setIsListening(false)
    setInterimTranscript('')
  }, [])

  const toggleVoice = useCallback(() => {
    if (isListening) {
      stopListening()
    } else {
      startListening()
    }
  }, [isListening, startListening, stopListening])

  // Clean up recognition on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop()
      }
    }
  }, [])

  // Save note
  const handleSaveNote = useCallback(async () => {
    if (!editTitle.trim() && !editContent.trim()) {
      showStatus('error', 'Please enter a title or content for your note.')
      return
    }

    // Stop voice if active
    if (isListening) stopListening()

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

      if (veloConnected) {
        const saved = await saveNoteToVeloDB(newNote, true)
        showStatus('success', saved ? 'Note created and saved to VeloDB.' : 'Note created locally. VeloDB sync failed.')
      } else {
        showStatus('success', 'Note created locally.')
      }
    } else if (selectedNoteId) {
      const existingNote = notes.find((n) => n.id === selectedNoteId)
      const updatedNote: Note = {
        id: selectedNoteId,
        title: editTitle.trim() || 'Untitled',
        content: editContent.trim(),
        createdAt: existingNote?.createdAt || now,
        updatedAt: now,
      }
      setNotes((prev) =>
        prev.map((n) => n.id === selectedNoteId ? updatedNote : n)
      )

      if (veloConnected) {
        const saved = await saveNoteToVeloDB(updatedNote, false)
        showStatus('success', saved ? 'Note updated and saved to VeloDB.' : 'Note updated locally. VeloDB sync failed.')
      } else {
        showStatus('success', 'Note updated locally.')
      }
    }

    setSaving(false)
  }, [editTitle, editContent, isNewNote, selectedNoteId, showStatus, veloConnected, notes, isListening, stopListening])

  // Delete note
  const handleDeleteNote = useCallback(async (noteId: string) => {
    setDeleting(true)

    if (veloConnected && !noteId.startsWith('sample-')) {
      await deleteNoteFromVeloDB(noteId)
    }

    setNotes((prev) => prev.filter((n) => n.id !== noteId))
    if (selectedNoteId === noteId) {
      setSelectedNoteId(null)
      setEditTitle('')
      setEditContent('')
      setIsNewNote(false)
    }
    setDeleteConfirmId(null)
    setDeleting(false)
    showStatus('success', veloConnected ? 'Note deleted from VeloDB.' : 'Note deleted locally.')
  }, [selectedNoteId, showStatus, veloConnected])

  // Sync to VeloDB
  const handleSyncToVeloDB = useCallback(async () => {
    if (!veloConnected) {
      showStatus('error', 'VeloDB is not connected. Configure VELODB_HOST in .env first.')
      return
    }
    setVeloSyncing(true)
    const nonSample = notes.filter((n) => !n.id.startsWith('sample-'))
    const result = await syncNotesToVeloDB(nonSample)
    setVeloSyncing(false)
    if (result.success) {
      showStatus('success', `Synced ${result.synced} notes to VeloDB.`)
    } else {
      showStatus('error', 'Failed to sync notes to VeloDB.')
    }
  }, [veloConnected, notes, showStatus])

  // Re-check VeloDB
  const handleCheckVeloDB = useCallback(async () => {
    setVeloChecking(true)
    const status = await checkVeloDBStatus()
    setVeloConnected(status.connected)
    setVeloChecking(false)
    if (status.connected) {
      await initVeloDB()
      showStatus('success', 'VeloDB connected. Table initialized.')
      const dbNotes = await fetchNotesFromVeloDB()
      if (dbNotes && dbNotes.length > 0) {
        setNotes(dbNotes)
      }
    } else {
      showStatus('info', 'VeloDB not configured. Set VELODB_HOST in .env to enable.')
    }
  }, [showStatus])

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

      if (actionPerformed === 'create' && noteData?.title) {
        const newNote: Note = {
          id: noteData?.note_id ?? generateId(),
          title: noteData.title ?? 'Untitled',
          content: noteData?.content ?? '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        setNotes((prev) => [newNote, ...prev])
        if (veloConnected) {
          saveNoteToVeloDB(newNote, true).catch(() => {})
        }
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
  }, [chatInput, showStatus, veloConnected])

  const selectedNote = notes.find((n) => n.id === selectedNoteId) ?? null
  const isEditorActive = isNewNote || selectedNoteId !== null

  return (
    <ErrorBoundary>
      <div style={THEME_VARS} className="min-h-screen bg-background text-foreground font-sans">
        {/* ===== HEADER ===== */}
        <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 md:px-6 shadow-sm">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <FiBook className="w-4 h-4 text-primary-foreground" />
            </div>
            <h1 className="text-lg font-semibold font-serif text-foreground tracking-tight">NoteKeeper</h1>
          </div>

          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative hidden sm:block">
              <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search notes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 w-48 md:w-56 h-9 text-sm bg-background"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <FiX className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Reminders Button */}
            <button
              onClick={() => setShowReminders(!showReminders)}
              className="relative p-2 rounded-md hover:bg-secondary transition-colors"
              aria-label="View reminders"
            >
              <FiBell className="w-4 h-4 text-foreground" />
              {upcomingReminders.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-accent text-accent-foreground text-[10px] flex items-center justify-center font-medium">
                  {upcomingReminders.length}
                </span>
              )}
            </button>

            {/* VeloDB Status */}
            <div className="flex items-center gap-1.5 hidden md:flex">
              {veloChecking ? (
                <FiLoader className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
              ) : veloConnected ? (
                <FiCloud className="w-3.5 h-3.5 text-green-600" />
              ) : (
                <FiCloudOff className="w-3.5 h-3.5 text-muted-foreground" />
              )}
              <span className={`text-xs ${veloConnected ? 'text-green-700' : 'text-muted-foreground'}`}>
                {veloChecking ? 'Connecting...' : veloConnected ? 'VeloDB' : 'Local'}
              </span>
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

        {/* ===== REMINDERS PANEL ===== */}
        {showReminders && (
          <div className="border-b border-border bg-card/80 px-4 md:px-6 py-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <FiCalendar className="w-4 h-4 text-accent" />
                <h3 className="text-sm font-medium text-foreground">Upcoming Reminders</h3>
                {upcomingReminders.length > 0 && (
                  <Badge variant="secondary" className="text-xs">{upcomingReminders.length}</Badge>
                )}
              </div>
              <button onClick={() => setShowReminders(false)} className="p-1 rounded-md hover:bg-secondary text-muted-foreground">
                <FiX className="w-4 h-4" />
              </button>
            </div>
            {upcomingReminders.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No upcoming reminders. Mention dates or meetings in your notes and they will appear here automatically.</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {upcomingReminders.map((reminder) => (
                  <div key={reminder.id} className="flex items-start gap-3 p-2.5 rounded-lg bg-secondary/40 border border-border">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center mt-0.5">
                      <FiBell className="w-3.5 h-3.5 text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-medium text-accent">{formatReminderDate(reminder.date)}</span>
                        <span className="text-xs text-muted-foreground">from: {reminder.noteTitle}</span>
                      </div>
                      <p className="text-xs text-foreground leading-relaxed line-clamp-2">{reminder.text}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => {
                          const note = notes.find((n) => n.id === reminder.noteId)
                          if (note) handleSelectNote(note)
                        }}
                        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary"
                        title="Go to note"
                      >
                        <FiFileText className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => dismissReminder(reminder.id)}
                        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary"
                        title="Dismiss"
                      >
                        <FiBellOff className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ===== MAIN LAYOUT ===== */}
        <div className="flex flex-1" style={{ height: showReminders ? 'calc(100vh - 3.5rem - var(--reminders-height, 0px))' : 'calc(100vh - 3.5rem)' }}>
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
                      hasReminder={noteIdsWithReminders.has(note.id)}
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

            {/* Mobile: New Note + Voice buttons */}
            <div className="md:hidden p-3 border-b border-border flex items-center gap-2">
              <Button onClick={handleNewNote} size="sm" className="gap-1.5">
                <FiPlus className="w-4 h-4" />
                New Note
              </Button>
              {voiceSupported && (
                <Button onClick={toggleVoice} size="sm" variant={isListening ? 'destructive' : 'secondary'} className="gap-1.5">
                  {isListening ? <FiMicOff className="w-4 h-4" /> : <FiMic className="w-4 h-4" />}
                  {isListening ? 'Stop' : 'Voice'}
                </Button>
              )}
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
                      ? 'Start capturing your thoughts, ideas, and tasks. Type, use voice dictation, or chat with the assistant.'
                      : 'Choose a note from the sidebar to edit, or create a new one.'}
                  </p>
                  <div className="flex items-center justify-center gap-3">
                    <Button onClick={handleNewNote} className="gap-2">
                      <FiPlus className="w-4 h-4" />
                      Create New Note
                    </Button>
                    {voiceSupported && (
                      <Button onClick={() => { handleNewNote(); setTimeout(() => startListening(), 100) }} variant="outline" className="gap-2">
                        <FiMic className="w-4 h-4" />
                        Voice Note
                      </Button>
                    )}
                  </div>
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

                    {/* Voice listening indicator */}
                    {isListening && (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200">
                        <span className="relative flex h-3 w-3">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                        </span>
                        <FiVolume2 className="w-4 h-4 text-red-600" />
                        <span className="text-sm text-red-700 font-medium">Listening... speak now</span>
                        <button onClick={stopListening} className="ml-auto text-xs text-red-600 hover:text-red-800 font-medium px-2 py-0.5 rounded border border-red-300 hover:bg-red-100">
                          Stop
                        </button>
                      </div>
                    )}

                    {/* Content */}
                    <div className="relative">
                      <Textarea
                        placeholder="Start writing or tap the mic to dictate..."
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="min-h-[300px] md:min-h-[400px] text-base leading-relaxed border-0 bg-transparent resize-none px-0 focus-visible:ring-0 placeholder:text-muted-foreground/40"
                        rows={16}
                      />
                      {/* Interim transcript ghost text */}
                      {interimTranscript && (
                        <div className="absolute bottom-2 left-0 right-0 px-0">
                          <span className="text-base text-muted-foreground/50 italic">{interimTranscript}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Save bar */}
                <div className="border-t border-border bg-card/60 px-4 md:px-8 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      {editContent.length} characters
                    </span>
                    {/* Voice button in save bar */}
                    {voiceSupported && (
                      <button
                        onClick={toggleVoice}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                          isListening
                            ? 'bg-red-100 text-red-700 border border-red-300 hover:bg-red-200'
                            : 'bg-secondary text-secondary-foreground border border-border hover:bg-secondary/80'
                        }`}
                      >
                        {isListening ? (
                          <>
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                            </span>
                            <FiMicOff className="w-3.5 h-3.5" />
                            Stop Recording
                          </>
                        ) : (
                          <>
                            <FiMic className="w-3.5 h-3.5" />
                            Dictate
                          </>
                        )}
                      </button>
                    )}
                  </div>
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
        {!chatOpen && (
          <button
            onClick={() => setChatOpen(true)}
            className="fixed bottom-6 right-6 w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl transition-all duration-200 flex items-center justify-center hover:scale-105 z-50"
            aria-label="Open chat assistant"
          >
            <FiMessageSquare className="w-5 h-5" />
          </button>
        )}

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

        {/* ===== AGENT & VELODB STATUS SECTION ===== */}
        <div className="fixed bottom-6 left-6 z-40 hidden lg:block space-y-2">
          {/* VeloDB Status Card */}
          <div className="bg-card border border-border rounded-lg shadow-md px-4 py-3 max-w-xs">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <FiDatabase className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">VeloDB</span>
              </div>
              <div className="flex items-center gap-1.5">
                {veloChecking ? (
                  <FiLoader className="w-3 h-3 text-muted-foreground animate-spin" />
                ) : veloConnected ? (
                  <FiCloud className="w-3.5 h-3.5 text-green-600" />
                ) : (
                  <FiCloudOff className="w-3.5 h-3.5 text-muted-foreground" />
                )}
                <span className={`text-xs ${veloConnected ? 'text-green-700' : 'text-muted-foreground'}`}>
                  {veloChecking ? 'Checking...' : veloConnected ? 'Connected' : 'Not configured'}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCheckVeloDB}
                disabled={veloChecking}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-border bg-secondary/50 hover:bg-secondary text-secondary-foreground transition-colors disabled:opacity-50"
              >
                <FiRefreshCw className={`w-3 h-3 ${veloChecking ? 'animate-spin' : ''}`} />
                Reconnect
              </button>
              <button
                onClick={handleSyncToVeloDB}
                disabled={!veloConnected || veloSyncing}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-border bg-primary/10 hover:bg-primary/20 text-foreground transition-colors disabled:opacity-50"
              >
                {veloSyncing ? <FiLoader className="w-3 h-3 animate-spin" /> : <FiDatabase className="w-3 h-3" />}
                Sync Notes
              </button>
            </div>
            {!veloConnected && !veloChecking && (
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                Set VELODB_HOST in .env to enable persistent database storage.
              </p>
            )}
          </div>

          {/* Agent Status Card */}
          <div className="bg-card border border-border rounded-lg shadow-md px-4 py-3 max-w-xs">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">AI Agent</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${activeAgentId === AGENT_ID ? 'bg-amber-500 animate-pulse' : 'bg-green-500'}`} />
              <span className="text-sm font-medium text-foreground">Notes Assistant</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">Manages CRUD operations via natural language.</p>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  )
}
