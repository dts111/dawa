import { useEffect, useState } from 'react'
import { listLibrary, suggestDiversions } from '../api/client'
import type { LibraryEntry, LibrarySuggestion } from '../types'

interface Props {
  activeClosure: { id: string } | null
}

const STATUS_BADGE: Record<string, string> = {
  approved: 'bg-green-100 text-green-700',
  draft: 'bg-yellow-100 text-yellow-700',
  rejected: 'bg-red-100 text-red-700',
}

export default function LibraryPanel({ activeClosure }: Props) {
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  const [suggestions, setSuggestions] = useState<LibrarySuggestion[]>([])
  const [filter, setFilter] = useState<'all' | 'approved' | 'draft' | 'rejected'>('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    listLibrary(filter === 'all' ? undefined : filter)
      .then(setEntries)
      .finally(() => setLoading(false))
  }, [filter])

  const loadSuggestions = async () => {
    if (!activeClosure) return
    const s = await suggestDiversions(activeClosure.id)
    setSuggestions(s)
  }

  const filtered = entries.filter(e =>
    search === '' || e.approved_by?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-4">
      <h2 className="font-bold text-nh-blue text-lg border-b border-gray-200 pb-2">Diversion Library</h2>

      {activeClosure && (
        <button type="button" onClick={loadSuggestions} className="btn-secondary w-full text-sm">
          Suggest Previously Approved Diversions
        </button>
      )}

      {suggestions.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Suggestions</p>
          {suggestions.map(s => (
            <div key={s.library_id} className="border border-green-300 rounded-lg p-3 bg-green-50 text-sm">
              <div className="flex justify-between">
                <span className="font-medium">{s.start_junction} → {s.end_junction}</span>
                <span className="text-green-700 font-bold">{s.score}/100</span>
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {s.distance_km} km · Approved by {s.approved_by}
              </div>
              {s.match_reasons.length > 0 && (
                <div className="text-xs text-green-600 mt-1">{s.match_reasons.join(', ')}</div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          className="input flex-1 text-sm"
          placeholder="Search by approver…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="input text-sm w-28" value={filter} onChange={e => setFilter(e.target.value as typeof filter)}>
          <option value="all">All</option>
          <option value="approved">Approved</option>
          <option value="draft">Draft</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 text-center py-4">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">No library entries yet.</p>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {filtered.map(e => (
            <div key={e.id} className="border border-gray-200 rounded-lg p-3 text-sm">
              <div className="flex justify-between items-start">
                <div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[e.approval_status]}`}>
                    {e.approval_status}
                  </span>
                  <span className="text-xs text-gray-400 ml-2">v{e.version}</span>
                </div>
                <span className="text-xs text-gray-400">
                  {new Date(e.created_at).toLocaleDateString('en-GB')}
                </span>
              </div>
              {e.approved_by && (
                <p className="text-xs text-gray-500 mt-1">Approved by: {e.approved_by}</p>
              )}
              {e.notes && <p className="text-xs text-gray-400 mt-1 italic">{e.notes}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
