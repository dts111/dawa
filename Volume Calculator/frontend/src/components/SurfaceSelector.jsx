import { useState } from 'react'
import { Layers, Calculator, Settings2, AlertCircle, Loader2 } from 'lucide-react'
import { calculateVolumes, getAllMeshes } from '../api'

export default function SurfaceSelector({ sessionKey, surfaces, onResults }) {
  const [surface1, setSurface1] = useState(surfaces[0]?.name || '')
  // Default surface2 to second surface if available, else same as surface1
  const [surface2, setSurface2] = useState(surfaces[1]?.name || surfaces[0]?.name || '')
  const [resolution, setResolution] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const surfaceMap = Object.fromEntries(surfaces.map(s => [s.name, s]))

  const handleCalculate = async () => {
    if (!surface1 || !surface2) return
    if (surface1 === surface2) {
      setError('Please select two different surfaces.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const allSurfaceNames = surfaces.map(s => s.name)
      const [volResult, allMeshes] = await Promise.all([
        calculateVolumes(sessionKey, surface1, surface2, resolution ? parseFloat(resolution) : null),
        getAllMeshes(sessionKey, allSurfaceNames),
      ])
      onResults({
        volResult,
        allMeshes,           // every loaded surface as a mesh
        surface1Name: surface1,
        surface2Name: surface2,
      })
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Calculation failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
        <Layers className="w-5 h-5 text-brand-400" />
        Select Surfaces
      </h2>
      <p className="text-sm text-slate-400 mb-5">
        Found <strong className="text-slate-200">{surfaces.length}</strong> TIN surface{surfaces.length !== 1 ? 's' : ''}.
        Choose the existing ground and design (reference) surfaces.
      </p>

      {/* Surface cards */}
      <div className="grid sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="label">Surface 1 — Existing Ground</label>
          <select
            className="select-input"
            value={surface1}
            onChange={e => setSurface1(e.target.value)}
            disabled={loading}
          >
            {surfaces.map(s => (
              <option key={s.name} value={s.name}>{s.name}</option>
            ))}
          </select>
          {surfaceMap[surface1] && (
            <SurfaceInfo surface={surfaceMap[surface1]} color="text-brand-400" />
          )}
        </div>

        <div>
          <label className="label">Surface 2 — Reference / Design</label>
          <select
            className="select-input"
            value={surface2}
            onChange={e => setSurface2(e.target.value)}
            disabled={loading}
          >
            {surfaces.map(s => (
              <option key={s.name} value={s.name}>{s.name}</option>
            ))}
          </select>
          {surfaceMap[surface2] && (
            <SurfaceInfo surface={surfaceMap[surface2]} color="text-fill" />
          )}
        </div>
      </div>

      {/* Advanced options */}
      <details className="mb-4">
        <summary className="flex items-center gap-2 cursor-pointer text-sm text-slate-400 hover:text-slate-200 transition-colors select-none">
          <Settings2 className="w-4 h-4" />
          Advanced options
        </summary>
        <div className="mt-3 pl-6 border-l border-slate-700">
          <label className="label">Grid Resolution (m)</label>
          <input
            type="number"
            min="0.1"
            step="0.5"
            placeholder="Auto"
            className="select-input w-48"
            value={resolution}
            onChange={e => setResolution(e.target.value)}
            disabled={loading}
          />
          <p className="text-xs text-slate-500 mt-1">
            Leave blank for automatic resolution. Smaller values give more precise
            volumes but increase computation time.
          </p>
        </div>
      </details>

      {/* Error */}
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        className="btn-primary w-full justify-center py-3 text-base"
        onClick={handleCalculate}
        disabled={loading || !surface1 || !surface2}
      >
        {loading ? (
          <><Loader2 className="w-5 h-5 animate-spin" /> Calculating…</>
        ) : (
          <><Calculator className="w-5 h-5" /> Calculate Cut &amp; Fill Volumes</>
        )}
      </button>
    </div>
  )
}

function SurfaceInfo({ surface, color }) {
  return (
    <div className={`mt-2 text-xs space-y-0.5 ${color}`}>
      <p>Points: {surface.point_count?.toLocaleString()} · Faces: {surface.face_count?.toLocaleString()}</p>
      <p>
        Z: {surface.z_min?.toFixed(2)} – {surface.z_max?.toFixed(2)} m
      </p>
      {surface.desc && <p className="text-slate-500 truncate" title={surface.desc}>{surface.desc}</p>}
    </div>
  )
}
