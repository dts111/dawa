import { useState } from 'react'
import { approveDiversion, rejectDiversion, listLibrary } from '../api/client'
import type { Diversion, LibraryEntry, RouteAttributes } from '../types'

interface Props {
  routes: Diversion[]
  selectedRouteRank: number | null
  onSelectRoute: (rank: number | null) => void
  closureId: string | null
}

const RANK_LABELS: Record<number, string> = { 1: 'Primary', 2: 'Alt 1', 3: 'Alt 2' }
const RANK_COLORS: Record<number, string> = { 1: 'border-nh-blue bg-blue-50', 2: 'border-orange-500 bg-orange-50', 3: 'border-purple-600 bg-purple-50' }
const SCORE_COLOR = (s: number) => s >= 75 ? 'text-green-700 bg-green-100' : s >= 50 ? 'text-yellow-700 bg-yellow-100' : 'text-red-700 bg-red-100'

const ROAD_TYPE_COLORS: Record<string, string> = {
  motorway: '#3b82f6',
  motorway_link: '#93c5fd',
  trunk: '#8b5cf6',
  trunk_link: '#c4b5fd',
  primary: '#f59e0b',
  primary_link: '#fcd34d',
  secondary: '#10b981',
  secondary_link: '#6ee7b7',
}
const ROAD_TYPE_LABELS: Record<string, string> = {
  motorway: 'Motorway', motorway_link: 'Motorway link',
  trunk: 'Trunk', trunk_link: 'Trunk link',
  primary: 'Primary', primary_link: 'Primary link',
  secondary: 'Secondary', secondary_link: 'Secondary link',
}

function RouteAttributesDisplay({ attrs }: { attrs: RouteAttributes }) {
  const totalM = Object.values(attrs.road_type_m).reduce((s, v) => s + v, 0)
  const segments = Object.entries(attrs.road_type_m)
    .sort((a, b) => b[1] - a[1])
    .map(([type, m]) => ({ type, m, pct: totalM > 0 ? (m / totalM) * 100 : 0 }))

  return (
    <div className="mt-3 space-y-2 border-t border-gray-200 pt-2">
      {/* Road names */}
      {attrs.named_roads.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {attrs.named_roads.slice(0, 8).map(name => (
            <span key={name} className="px-1.5 py-0.5 rounded text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
              {name}
            </span>
          ))}
          {attrs.named_roads.length > 8 && (
            <span className="px-1.5 py-0.5 rounded text-xs text-gray-400">+{attrs.named_roads.length - 8} more</span>
          )}
        </div>
      )}

      {/* Road type stacked bar */}
      {segments.length > 0 && (
        <div>
          <div className="flex h-2 rounded overflow-hidden gap-px">
            {segments.map(s => (
              <div
                key={s.type}
                style={{ width: `${s.pct}%`, background: ROAD_TYPE_COLORS[s.type] ?? '#9ca3af' }}
                title={`${ROAD_TYPE_LABELS[s.type] ?? s.type}: ${(s.m / 1000).toFixed(1)} km`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
            {segments.map(s => (
              <span key={s.type} className="flex items-center gap-1 text-xs text-gray-500">
                <span className="w-2 h-2 rounded-sm inline-block flex-shrink-0" style={{ background: ROAD_TYPE_COLORS[s.type] ?? '#9ca3af' }} />
                {ROAD_TYPE_LABELS[s.type] ?? s.type} {(s.m / 1000).toFixed(1)} km
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Speed range */}
      {attrs.speed_range && (
        <p className="text-xs text-gray-500">
          Speed limits: <strong>{attrs.speed_range.min}–{attrs.speed_range.max} mph</strong>
        </p>
      )}
    </div>
  )
}

export default function RoutePanel({ routes, selectedRouteRank, onSelectRoute, closureId }: Props) {
  const [approving, setApproving] = useState<string | null>(null)
  const [approverName, setApproverName] = useState('')
  const [libraryEntries, setLibraryEntries] = useState<LibraryEntry[]>([])
  const [msg, setMsg] = useState<string | null>(null)

  const loadLibrary = async () => {
    if (!closureId) return
    const entries = await listLibrary()
    setLibraryEntries(entries.filter(e => e.closure_id === closureId))
  }

  const getLibraryEntry = (divId: string) => libraryEntries.find(e => e.diversion_id === divId)

  const handleApprove = async (div: Diversion) => {
    if (!approverName.trim()) { setMsg('Enter your name to approve'); return }
    setApproving(div.id)
    try {
      await loadLibrary()
      const entry = getLibraryEntry(div.id)
      if (!entry) { setMsg('Library entry not found — generate routes first'); return }
      await approveDiversion(entry.id, approverName)
      await loadLibrary()
      setMsg(`Route ${RANK_LABELS[div.route_rank]} approved by ${approverName}`)
    } catch {
      setMsg('Approval failed')
    } finally {
      setApproving(null)
    }
  }

  if (routes.length === 0) {
    return (
      <div className="text-center text-gray-400 py-12">
        <p className="text-4xl mb-3">🗺️</p>
        <p className="text-sm">No routes yet. Define a closure and generate routes.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h2 className="font-bold text-nh-blue text-lg border-b border-gray-200 pb-2">Diversion Routes</h2>

      <label className="block">
        <span className="label">Approver Name</span>
        <input className="input" value={approverName} onChange={e => setApproverName(e.target.value)} placeholder="Your name" />
      </label>

      {msg && <p className="text-sm text-green-700 bg-green-50 rounded p-2">{msg}</p>}

      {routes.map(route => {
        const isSelected = selectedRouteRank === route.route_rank
        const distKm = ((route.distance_m ?? 0) / 1000).toFixed(1)
        const time = Math.round(route.travel_time_min ?? 0)
        const score = route.score ?? 0

        return (
          <div
            key={route.id}
            className={`border-l-4 rounded-lg p-3 cursor-pointer transition-shadow ${RANK_COLORS[route.route_rank]} ${isSelected ? 'shadow-md ring-2 ring-nh-blue' : 'hover:shadow-sm'}`}
            onClick={() => onSelectRoute(isSelected ? null : route.route_rank)}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-sm">{RANK_LABELS[route.route_rank]}</span>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${SCORE_COLOR(score)}`}>
                {score}/100
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 text-xs text-gray-600">
              <span>Distance: <strong>{distKm} km</strong></span>
              <span>Time: <strong>{time} min</strong></span>
            </div>

            {route.route_attributes && (
              <RouteAttributesDisplay attrs={route.route_attributes} />
            )}

            {isSelected && route.score_breakdown && (
              <div className="mt-3 space-y-1">
                {Object.entries(route.score_breakdown).map(([key, val]) => (
                  <div key={key} className="flex items-center gap-2 text-xs">
                    <span className="w-36 text-gray-500 capitalize">{key.replace(/_/g, ' ')}</span>
                    <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                      <div className="h-1.5 rounded-full bg-nh-blue" style={{ width: `${val}%` }} />
                    </div>
                    <span className="w-8 text-right font-medium">{val}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={e => { e.stopPropagation(); handleApprove(route) }}
                disabled={approving === route.id}
                className="btn-primary text-xs py-1 px-3"
              >
                {approving === route.id ? '…' : 'Approve'}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
