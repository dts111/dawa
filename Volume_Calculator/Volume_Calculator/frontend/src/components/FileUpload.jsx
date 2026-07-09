import { useCallback, useEffect, useState } from 'react'
import { Upload, CheckCircle, Loader2, AlertCircle, FileX, Layers, PlusCircle, Settings2, Scissors, Shrink, Sparkles, X, Triangle } from 'lucide-react'
import { parseFile, retrim, getAllMeshes } from '../api'
import CutFillMap3D from './CutFillMap3D'

export default function FileUpload({ onParsed }) {
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [errors, setErrors]     = useState([])
  const [session, setSession]   = useState(null)  // { session_key, files_loaded, surfaces }
  const [maxEdgeLength, setMaxEdgeLength] = useState('')   // '' = no trimming (raw import)
  const [clipToBoundary, setClipToBoundary] = useState(false)   // requires maxEdgeLength to be set
  const [minAngle, setMinAngle] = useState('')   // '' = no sliver trimming, independent of maxEdgeLength
  const [retrimLoading, setRetrimLoading] = useState(false)

  const [suggestionDismissed, setSuggestionDismissed] = useState(false)

  // 3D preview of the imported surface(s) — always shown once a session exists,
  // fetched on demand and refetched whenever the session's surfaces change (e.g.
  // more files added).
  const [previewMeshes, setPreviewMeshes] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError]   = useState(null)

  useEffect(() => {
    if (!session) return
    let cancelled = false
    setPreviewLoading(true)
    setPreviewError(null)
    getAllMeshes(session.session_key, session.surfaces.map(s => s.name))
      .then(meshes => { if (!cancelled) setPreviewMeshes(meshes) })
      .catch(err => {
        if (!cancelled) setPreviewError(err.response?.data?.detail || err.message || 'Failed to load preview.')
      })
      .finally(() => { if (!cancelled) setPreviewLoading(false) })
    return () => { cancelled = true }
  }, [session])

  // Dynamic Advanced Options: ~500ms after Max Triangle Edge / Clip to Boundary / Min
  // Triangle Angle stop changing, re-trim the ALREADY-loaded surfaces via the
  // lightweight /api/retrim endpoint (no file re-upload — the backend recomputes from
  // each surface's stored raw faces). Skipped while an upload is in flight to avoid
  // racing with handleFiles.
  useEffect(() => {
    if (!session || loading) return
    const timer = setTimeout(async () => {
      const parsedMaxEdgeLength = maxEdgeLength ? parseFloat(maxEdgeLength) : null
      const effectiveClipToBoundary = clipToBoundary && !!parsedMaxEdgeLength
      const parsedMinAngle = minAngle ? parseFloat(minAngle) : null
      setRetrimLoading(true)
      try {
        const result = await retrim(session.session_key, parsedMaxEdgeLength, effectiveClipToBoundary, parsedMinAngle)
        setSession(prev => prev && { ...prev, surfaces: result.surfaces })
      } catch (err) {
        setErrors(prev => [...prev, err.response?.data?.detail || err.message || 'Failed to update trim.'])
      } finally {
        setRetrimLoading(false)
      }
    }, 500)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxEdgeLength, clipToBoundary, minAngle])

  // Process an array of File objects sequentially, accumulating surfaces
  const handleFiles = useCallback(async (files) => {
    if (!files?.length) return

    const validFiles = Array.from(files).filter(f => {
      const name = f.name.toLowerCase()
      return name.endsWith('.xml') || name.endsWith('.landxml')
    })
    const invalidFiles = Array.from(files).filter(f => {
      const name = f.name.toLowerCase()
      return !name.endsWith('.xml') && !name.endsWith('.landxml')
    })

    const newErrors = invalidFiles.map(f => `"${f.name}" — only .xml or .landxml files accepted.`)

    if (!validFiles.length) {
      setErrors(newErrors)
      return
    }

    setErrors(newErrors)
    setLoading(true)

    // Use the current session_key so all files accumulate in one session
    let currentSessionKey = session?.session_key ?? null
    let latestResult = null
    const parsedMaxEdgeLength = maxEdgeLength ? parseFloat(maxEdgeLength) : null
    const effectiveClipToBoundary = clipToBoundary && !!parsedMaxEdgeLength   // backend rejects clip without a length
    const parsedMinAngle = minAngle ? parseFloat(minAngle) : null

    for (const file of validFiles) {
      try {
        const result = await parseFile(file, currentSessionKey, parsedMaxEdgeLength, effectiveClipToBoundary, parsedMinAngle)
        currentSessionKey = result.session_key   // carry forward for next file
        latestResult = result
      } catch (err) {
        const msg = err.response?.data?.detail || err.message || `Failed to parse "${file.name}".`
        setErrors(prev => [...prev, msg])
      }
    }

    if (latestResult) {
      const updated = {
        session_key:  latestResult.session_key,
        files_loaded: latestResult.files_loaded,
        surfaces:     latestResult.surfaces,
      }
      setSession(updated)
      setSuggestionDismissed(false)   // newly added surfaces might have their own suggestion
      onParsed({ session_key: latestResult.session_key, surfaces: latestResult.surfaces })
    }

    setLoading(false)
  }, [session, onParsed, maxEdgeLength, clipToBoundary, minAngle])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  const onInputChange = (e) => handleFiles(e.target.files)

  const resetAll = () => {
    setSession(null)
    setErrors([])
    setPreviewMeshes(null)
    setPreviewError(null)
    setSuggestionDismissed(false)
    onParsed(null)
  }

  // Largest suggested trim across all currently loaded surfaces (one global setting
  // needs to cover every surface's worst-case bridge triangles). Only worth showing
  // if the user hasn't already set a trim themselves.
  const suggestedMaxEdgeLength = session
    ? Math.max(0, ...session.surfaces.map(s => s.suggested_max_edge_length ?? 0)) || null
    : null
  const showSuggestion = !!suggestedMaxEdgeLength && !maxEdgeLength && !suggestionDismissed

  // ── After at least one file has been loaded ──
  if (session) {
    return (
      <div className="card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
            <Layers className="w-5 h-5 text-brand-600" />
            Loaded Surfaces
            <span className="ml-1 px-2 py-0.5 rounded-full text-xs bg-brand-500/10 text-brand-600 border border-brand-500/30 font-bold">
              {session.surfaces.length}
            </span>
          </h2>
          <button onClick={resetAll} className="btn-secondary text-xs py-1 px-3 gap-1">
            <FileX className="w-3 h-3" /> Clear all
          </button>
        </div>

        {/* Files loaded */}
        <div className="text-xs text-slate-500 space-y-1">
          {session.files_loaded.map((f, i) => (
            <div key={i} className="flex items-center gap-2">
              <CheckCircle className="w-3.5 h-3.5 text-fill flex-shrink-0" />
              <span className="text-slate-700 font-medium truncate">{f}</span>
            </div>
          ))}
        </div>

        {/* Surface table */}
        <div className="rounded-lg border border-slate-200 overflow-hidden">
          <div className="grid grid-cols-[1fr_auto] text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-2 bg-slate-50 border-b border-slate-200">
            <span>Surface Name</span>
            <span className="text-right">Points · Faces · Z range</span>
          </div>
          {session.surfaces.map((s, i) => (
            <div
              key={i}
              className={`grid grid-cols-[1fr_auto] px-4 py-2.5 text-sm items-center
                ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}
            >
              <div>
                <span className="font-medium text-slate-800">{s.name}</span>
                {s.desc && (
                  <span className="ml-2 text-xs text-slate-400 truncate">{s.desc}</span>
                )}
              </div>
              <div className="text-xs text-slate-400 text-right ml-4 whitespace-nowrap">
                {s.point_count?.toLocaleString()} pts · {s.face_count?.toLocaleString()} faces
                <span className="ml-2 text-slate-300">
                  Z {s.z_min?.toFixed(2)}–{s.z_max?.toFixed(2)} m
                </span>
                {s.faces_filtered_count > 0 && (
                  <span className="ml-2 text-amber-600 flex items-center gap-1 justify-end mt-0.5">
                    <Scissors className="w-3 h-3" />
                    {s.faces_filtered_count.toLocaleString()} long-edge faces trimmed (&gt;{s.max_edge_length_used?.toFixed(1)}m)
                  </span>
                )}
                {s.fragment_faces_removed > 0 && (
                  <span className="ml-2 text-amber-600 flex items-center gap-1 justify-end mt-0.5">
                    <Shrink className="w-3 h-3" />
                    {s.fragment_faces_removed.toLocaleString()} faces clipped outside the boundary
                  </span>
                )}
                {s.sliver_faces_removed > 0 && (
                  <span className="ml-2 text-amber-600 flex items-center gap-1 justify-end mt-0.5">
                    <Triangle className="w-3 h-3" />
                    {s.sliver_faces_removed.toLocaleString()} sliver triangles removed (&lt;{s.min_angle_used?.toFixed(1)}°)
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Auto-detected trim suggestion — offered, never applied silently */}
        {showSuggestion && (
          <div className="rounded-lg bg-brand-500/5 border border-brand-500/30 p-3 text-sm flex items-start gap-2">
            <Sparkles className="w-4 h-4 mt-0.5 flex-shrink-0 text-brand-600" />
            <div className="flex-1">
              <p className="text-slate-700">
                Detected extra outer triangulation — some triangle edges are statistical
                outliers compared to the rest of the mesh (likely Delaunay "bridge" triangles
                spanning real gaps in the survey data). Suggested Max Triangle Edge:{' '}
                <strong>{suggestedMaxEdgeLength.toFixed(1)}m</strong>.
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Applying will trim those edges and clip anything left outside the resulting
                boundary — updates the already-loaded surface(s) live, no re-upload needed.
              </p>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => { setMaxEdgeLength(String(suggestedMaxEdgeLength)); setClipToBoundary(true) }}
                  className="btn-primary text-xs py-1 px-3"
                  disabled={loading}
                >
                  Apply suggested trim
                </button>
                <button
                  onClick={() => setSuggestionDismissed(true)}
                  className="btn-secondary text-xs py-1 px-3 gap-1"
                >
                  <X className="w-3 h-3" /> Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 3D preview of imported surface(s), with boundary/breakline overlays */}
        <div>
          {previewLoading && (
            <div className="text-sm text-slate-500 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading preview…
            </div>
          )}
          {previewError && (
            <div className="text-sm text-red-600">{previewError}</div>
          )}
          {previewMeshes && !previewLoading && (
            <CutFillMap3D meshes={previewMeshes} sessionKey={session.session_key} />
          )}
        </div>

        <details open={retrimLoading}>
          <summary className="flex items-center gap-2 cursor-pointer text-sm text-slate-500 hover:text-slate-800 transition-colors select-none">
            <Settings2 className="w-4 h-4" />
            Advanced options
            {retrimLoading && (
              <span className="flex items-center gap-1 text-xs text-brand-600 normal-case font-normal">
                <Loader2 className="w-3 h-3 animate-spin" /> Updating…
              </span>
            )}
          </summary>
          <div className="mt-3 pl-6 border-l border-slate-200 space-y-3">
            <div>
              <label className="label">Max Triangle Edge (m)</label>
              <input
                type="number" min="0.01" step="0.5" placeholder="No trimming" className="select-input w-48"
                value={maxEdgeLength} onChange={e => setMaxEdgeLength(e.target.value)}
              />
              <p className="text-xs text-slate-400 mt-1">
                Blank by default — surfaces import with their raw, unmodified triangulation. Enter a length to
                trim triangles whose longest edge exceeds it, removing Delaunay "bridge" triangles that span
                real gaps in the survey data (e.g. separate carriageways). There's no auto-computed value —
                use the 3D preview above and its "Boundary" overlay to judge a sensible threshold first.
              </p>
            </div>
            <div>
              <label className={`flex items-center gap-2 text-sm cursor-pointer ${maxEdgeLength ? 'text-slate-700' : 'text-slate-400 cursor-not-allowed'}`}>
                <input
                  type="checkbox" checked={clipToBoundary} disabled={!maxEdgeLength}
                  onChange={e => setClipToBoundary(e.target.checked)}
                  className="rounded border-slate-300 text-brand-500 focus:ring-brand-500 disabled:opacity-50"
                />
                Clip to boundary
              </label>
              <p className="text-xs text-slate-400 mt-1">
                {maxEdgeLength
                  ? 'Geometrically removes any triangle whose centre falls outside the main boundary shape (computed after trimming above).'
                  : 'Requires Max Triangle Edge to be set first — the boundary of an untrimmed surface is typically too simple to clip against meaningfully (long "bridge" triangles paper over the real gaps).'}
              </p>
            </div>
            <div>
              <label className="label">Min Triangle Angle (°)</label>
              <input
                type="number" min="0.01" max="60" step="0.5" placeholder="No trimming" className="select-input w-48"
                value={minAngle} onChange={e => setMinAngle(e.target.value)}
              />
              <p className="text-xs text-slate-400 mt-1">
                Blank by default. Removes thin "sliver" triangles whose smallest interior angle
                falls below this value — independent of Max Triangle Edge, since a sliver can
                have perfectly normal-length edges and still be a degenerate shape. Use the "Angle
                Quality" overlay in the 3D preview to see slivers first (red = worst).{' '}
                <strong>Start low (1–3°)</strong> — real corridor surfaces built from many closely
                spaced breaklines (kerblines, chainage lines) naturally contain a lot of thin-but-
                legitimate triangles; a threshold set too high can strip away real surface data,
                not just bad geometry.
              </p>
            </div>
            <p className="text-xs text-slate-400">
              Dynamic — changes here re-trim the surface(s) already loaded above (~0.5s after
              you stop typing/toggling), as well as any files added below.
            </p>
          </div>
        </details>

        {/* Warning if fewer than 2 surfaces */}
        {session.surfaces.length < 2 && (
          <div className="rounded-lg bg-amber-50 border border-amber-300 p-3 text-sm text-amber-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>
              Only <strong>{session.surfaces.length}</strong> surface loaded — you need at least
              2 for cut/fill. Add another LandXML file below.
            </span>
          </div>
        )}

        {/* Errors */}
        {errors.map((e, i) => (
          <div key={i} className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-300 p-3 text-sm text-red-600">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{e}</span>
          </div>
        ))}

        {/* Add more files drop zone */}
        <label
          className={`flex items-center justify-center gap-3 cursor-pointer rounded-xl border-2 border-dashed
            transition-all py-4 px-6 text-sm
            ${dragging
              ? 'border-brand-400 bg-brand-500/5 text-brand-600'
              : 'border-slate-300 hover:border-brand-500/50 text-slate-500 hover:text-slate-700'}
            ${loading ? 'pointer-events-none opacity-60' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input
            type="file"
            accept=".xml,.landxml"
            multiple
            className="hidden"
            onChange={onInputChange}
            disabled={loading}
          />
          {loading
            ? <><Loader2 className="w-4 h-4 animate-spin text-brand-500" /> Parsing files…</>
            : <><PlusCircle className="w-4 h-4" /> Add more LandXML files (drag multiple or click to browse)</>
          }
        </label>
      </div>
    )
  }

  // ── Initial empty state ──
  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-ink mb-1 flex items-center gap-2">
        <Upload className="w-5 h-5 text-brand-600" />
        Import LandXML Files
      </h2>
      <p className="text-sm text-slate-500 mb-4">
        Select or drop <strong className="text-slate-700">one or multiple</strong> LandXML files at once.
        All surfaces from every file will be combined for selection.
      </p>

      <label
        className={`block cursor-pointer rounded-xl border-2 border-dashed transition-all py-12 px-6 text-center
          ${dragging ? 'border-brand-400 bg-brand-500/5' : 'border-slate-300 hover:border-brand-500/60 hover:bg-brand-500/5'}
          ${loading ? 'pointer-events-none opacity-60' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          type="file"
          accept=".xml,.landxml"
          multiple
          className="hidden"
          onChange={onInputChange}
          disabled={loading}
        />

        {loading ? (
          <div className="flex flex-col items-center gap-3 text-brand-500">
            <Loader2 className="w-10 h-10 animate-spin" />
            <p className="text-sm font-medium">Parsing files…</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-slate-400">
            <Upload className="w-12 h-12 mb-1" />
            <p className="text-base font-medium text-slate-800">
              Drop LandXML files here, or click to browse
            </p>
            <p className="text-sm">
              You can select <strong className="text-slate-600">multiple files</strong> at once
            </p>
            <p className="text-xs mt-1">Supports LandXML 1.1 and 1.2 TIN surfaces · Max 50 MB per file</p>
          </div>
        )}
      </label>

      <details className="mt-3">
        <summary className="flex items-center gap-2 cursor-pointer text-sm text-slate-500 hover:text-slate-800 transition-colors select-none">
          <Settings2 className="w-4 h-4" />
          Advanced options
        </summary>
        <div className="mt-3 pl-6 border-l border-slate-200 space-y-3">
          <div>
            <label className="label">Max Triangle Edge (m)</label>
            <input
              type="number" min="0.01" step="0.5" placeholder="No trimming" className="select-input w-48"
              value={maxEdgeLength} onChange={e => setMaxEdgeLength(e.target.value)}
            />
            <p className="text-xs text-slate-400 mt-1">
              Blank by default — surfaces import with their raw, unmodified triangulation. Enter a length to
              trim triangles whose longest edge exceeds it, removing Delaunay "bridge" triangles that span
              real gaps in the survey data (e.g. separate carriageways). There's no auto-computed value —
              use the 3D viewer's "Boundary" overlay to judge a sensible threshold first.
            </p>
          </div>
          <div>
            <label className={`flex items-center gap-2 text-sm cursor-pointer ${maxEdgeLength ? 'text-slate-700' : 'text-slate-400 cursor-not-allowed'}`}>
              <input
                type="checkbox" checked={clipToBoundary} disabled={!maxEdgeLength}
                onChange={e => setClipToBoundary(e.target.checked)}
                className="rounded border-slate-300 text-brand-500 focus:ring-brand-500 disabled:opacity-50"
              />
              Clip to boundary
            </label>
            <p className="text-xs text-slate-400 mt-1">
              {maxEdgeLength
                ? 'Geometrically removes any triangle whose centre falls outside the main boundary shape (computed after trimming above).'
                : 'Requires Max Triangle Edge to be set first — the boundary of an untrimmed surface is typically too simple to clip against meaningfully (long "bridge" triangles paper over the real gaps).'}
            </p>
          </div>
          <div>
            <label className="label">Min Triangle Angle (°)</label>
            <input
              type="number" min="0.01" max="60" step="0.5" placeholder="No trimming" className="select-input w-48"
              value={minAngle} onChange={e => setMinAngle(e.target.value)}
            />
            <p className="text-xs text-slate-400 mt-1">
              Blank by default. Removes thin "sliver" triangles whose smallest interior angle
              falls below this value — independent of Max Triangle Edge, since a sliver can
              have perfectly normal-length edges and still be a degenerate shape.{' '}
              <strong>Start low (1–3°)</strong> — real corridor surfaces built from many closely
              spaced breaklines (kerblines, chainage lines) naturally contain a lot of thin-but-
              legitimate triangles; a threshold set too high can strip away real surface data,
              not just bad geometry.
            </p>
          </div>
        </div>
      </details>

      {errors.map((e, i) => (
        <div key={i} className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 border border-red-300 p-3 text-sm text-red-600">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{e}</span>
        </div>
      ))}
    </div>
  )
}
