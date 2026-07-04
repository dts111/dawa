import { useState } from 'react'
import { createClosure, generateRoutes } from '../api/client'
import type { Closure, Diversion, ImpactedRoad } from '../types'

interface Props {
  onClosureCreated: (closure: Closure, routes: Diversion[], impactedClosures: Closure[]) => void
  onPickStart: () => void
  onPickEnd: () => void
  onClear: () => void
  pickedStart: { node_id: number; lng: number; lat: number } | null
  pickedEnd: { node_id: number; lng: number; lat: number } | null
  pickError: string | null
  impactedRoads: ImpactedRoad[]
  selectedImpactedIds: number[]
  onToggleImpacted: (id: number) => void
  previewLine: GeoJSON.LineString | null
  direction: string
  onDirectionChange: (direction: string) => void
}

export default function ClosurePanel({ onClosureCreated, onPickStart, onPickEnd, onClear, pickedStart, pickedEnd, pickError, impactedRoads, selectedImpactedIds, onToggleImpacted, previewLine, direction, onDirectionChange }: Props) {
  const [form, setForm] = useState({
    closure_type: 'mainline',
    start_junction: '',
    end_junction: '',
    start_chainage: '',
    end_chainage: '',
    date_from: '',
    date_to: '',
    reason: '',
    vehicle_type: 'car',
    engine: 'ors',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pickedStart?.node_id || !pickedEnd?.node_id) {
      setError('Pick start and end points on the map first')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const closure = await createClosure({
        closure_type: form.closure_type,
        direction,
        start_node: pickedStart.node_id,
        end_node: pickedEnd.node_id,
        start_junction: form.start_junction || null,
        end_junction: form.end_junction || null,
        start_chainage: form.start_chainage || null,
        end_chainage: form.end_chainage || null,
        date_from: form.date_from || null,
        date_to: form.date_to || null,
        reason: form.reason || null,
        geom_geojson: previewLine ?? undefined,
      })
      const routes = await generateRoutes(closure.id, form.vehicle_type, form.engine)

      const closureTypeFor = (rt: string) =>
        rt === 'motorway_link' ? 'slip_entry'
        : (rt === 'trunk' || rt === 'primary') ? 'interchange'
        : 'slip_exit'

      const impactedClosures = await Promise.all(
        impactedRoads.filter(r => selectedImpactedIds.includes(r.edge_id)).map(road =>
          createClosure({
            closure_type: closureTypeFor(road.road_type),
            direction,
            start_node: road.source_node,
            end_node: road.target_node,
            date_from: form.date_from || null,
            date_to: form.date_to || null,
            reason: form.reason || null,
            geom_geojson: road.geojson,
          })
        )
      )

      onClosureCreated(closure, routes, impactedClosures)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create closure or generate routes'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h2 className="font-bold text-nh-blue text-lg border-b border-gray-200 pb-2">Define Closure</h2>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="label">Type</span>
          <select className="input" value={form.closure_type} onChange={e => set('closure_type', e.target.value)}>
            <option value="mainline">Mainline</option>
            <option value="slip_entry">Slip Entry</option>
            <option value="slip_exit">Slip Exit</option>
            <option value="interchange">Interchange</option>
          </select>
        </label>
        <label className="block">
          <span className="label">Direction</span>
          <select className="input" value={direction} onChange={e => onDirectionChange(e.target.value)}>
            <option value="CW">Clockwise</option>
            <option value="ACW">Anticlockwise</option>
            <option value="N/A">N/A</option>
          </select>
        </label>
      </div>

      {/* Node picking */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Network Nodes</p>
        <div className="flex gap-2 items-center">
          <button type="button" onClick={onPickStart} className="btn-secondary text-sm flex-1">
            Start of closure
          </button>
          {pickedStart && <span className="text-green-600 text-lg">✓</span>}
        </div>
        <div className="flex gap-2 items-center">
          <button type="button" onClick={onPickEnd} className="btn-secondary text-sm flex-1">
            End of closure
          </button>
          {pickedEnd && <span className="text-green-600 text-lg">✓</span>}
        </div>
      </div>

      {pickError && (
        <p className="text-red-600 text-xs bg-red-50 border border-red-200 rounded p-2">{pickError}</p>
      )}

      {impactedRoads.length > 0 && (
        <div className="border border-red-200 rounded-lg p-3 bg-red-50 space-y-1.5">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-semibold text-red-800 uppercase tracking-wide">
              Impacted Roads
            </p>
            <span className="text-xs text-red-600">{selectedImpactedIds.length}/{impactedRoads.length} selected</span>
          </div>
          {impactedRoads.map(road => (
            <label key={road.edge_id} className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={selectedImpactedIds.includes(road.edge_id)}
                onChange={() => onToggleImpacted(road.edge_id)}
                className="rounded accent-green-600 shrink-0"
              />
              <span className="flex-1 text-xs text-red-700 font-medium truncate group-hover:text-red-900">
                {road.name}
              </span>
              <span className="text-xs text-red-500 shrink-0 capitalize">
                {road.road_type.replace(/_/g, ' ')}
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="label">Start Junction</span>
          <input className="input" value={form.start_junction} onChange={e => set('start_junction', e.target.value)} placeholder="e.g. J10" />
        </label>
        <label className="block">
          <span className="label">End Junction</span>
          <input className="input" value={form.end_junction} onChange={e => set('end_junction', e.target.value)} placeholder="e.g. J11" />
        </label>
        <label className="block">
          <span className="label">Start Chainage</span>
          <input className="input" value={form.start_chainage} onChange={e => set('start_chainage', e.target.value)} placeholder="e.g. 37+200" />
        </label>
        <label className="block">
          <span className="label">End Chainage</span>
          <input className="input" value={form.end_chainage} onChange={e => set('end_chainage', e.target.value)} placeholder="e.g. 40+750" />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="label">Date From</span>
          <input className="input" type="datetime-local" value={form.date_from} onChange={e => set('date_from', e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Date To</span>
          <input className="input" type="datetime-local" value={form.date_to} onChange={e => set('date_to', e.target.value)} />
        </label>
      </div>

      <label className="block">
        <span className="label">Reason for Closure</span>
        <textarea className="input resize-none" rows={2} value={form.reason} onChange={e => set('reason', e.target.value)} placeholder="e.g. Carriageway resurfacing — lane 1 and 2" />
      </label>

      <label className="block">
        <span className="label">Vehicle Type for Routing</span>
        <select className="input" value={form.vehicle_type} onChange={e => set('vehicle_type', e.target.value)}>
          <option value="car">All vehicles</option>
          <option value="hgv">HGV (restricted roads excluded)</option>
        </select>
      </label>

      <label className="block">
        <span className="label">Routing Engine</span>
        <select className="input" value={form.engine} onChange={e => set('engine', e.target.value)}>
          <option value="ors">OpenRouteService (external)</option>
          <option value="pgr">DBFO Network (pgRouting)</option>
        </select>
      </label>

      {error && <p className="text-red-600 text-sm bg-red-50 rounded p-2">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={loading} className="btn-primary flex-1">
          {loading ? 'Generating…' : 'GENERATE DIVERSION'}
        </button>
        <button type="button" onClick={onClear} className="btn-secondary px-4">
          Clear
        </button>
      </div>
    </form>
  )
}
