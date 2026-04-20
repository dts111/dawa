import { useCallback, useState } from 'react'
import { Upload, CheckCircle, Loader2, AlertCircle, FileX, Layers, PlusCircle } from 'lucide-react'
import { parseFile } from '../api'

export default function FileUpload({ onParsed }) {
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [errors, setErrors]     = useState([])
  const [session, setSession]   = useState(null)  // { session_key, files_loaded, surfaces }

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

    for (const file of validFiles) {
      try {
        const result = await parseFile(file, currentSessionKey)
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
      onParsed({ session_key: latestResult.session_key, surfaces: latestResult.surfaces })
    }

    setLoading(false)
  }, [session, onParsed])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  const onInputChange = (e) => handleFiles(e.target.files)

  const resetAll = () => {
    setSession(null)
    setErrors([])
    onParsed(null)
  }

  // ── After at least one file has been loaded ──
  if (session) {
    return (
      <div className="card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Layers className="w-5 h-5 text-brand-400" />
            Loaded Surfaces
            <span className="ml-1 px-2 py-0.5 rounded-full text-xs bg-brand-500/20 text-brand-400 border border-brand-500/30 font-bold">
              {session.surfaces.length}
            </span>
          </h2>
          <button onClick={resetAll} className="btn-secondary text-xs py-1 px-3 gap-1">
            <FileX className="w-3 h-3" /> Clear all
          </button>
        </div>

        {/* Files loaded */}
        <div className="text-xs text-slate-400 space-y-1">
          {session.files_loaded.map((f, i) => (
            <div key={i} className="flex items-center gap-2">
              <CheckCircle className="w-3.5 h-3.5 text-fill flex-shrink-0" />
              <span className="text-slate-300 font-medium truncate">{f}</span>
            </div>
          ))}
        </div>

        {/* Surface table */}
        <div className="rounded-lg border border-slate-700 overflow-hidden">
          <div className="grid grid-cols-[1fr_auto] text-xs font-semibold text-slate-400 uppercase tracking-wide px-4 py-2 bg-brand-900 border-b border-slate-700">
            <span>Surface Name</span>
            <span className="text-right">Points · Faces · Z range</span>
          </div>
          {session.surfaces.map((s, i) => (
            <div
              key={i}
              className={`grid grid-cols-[1fr_auto] px-4 py-2.5 text-sm items-center
                ${i % 2 === 0 ? 'bg-brand-800' : 'bg-brand-900'}`}
            >
              <div>
                <span className="font-medium text-slate-200">{s.name}</span>
                {s.desc && (
                  <span className="ml-2 text-xs text-slate-500 truncate">{s.desc}</span>
                )}
              </div>
              <div className="text-xs text-slate-500 text-right ml-4 whitespace-nowrap">
                {s.point_count?.toLocaleString()} pts · {s.face_count?.toLocaleString()} faces
                <span className="ml-2 text-slate-600">
                  Z {s.z_min?.toFixed(2)}–{s.z_max?.toFixed(2)} m
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Warning if fewer than 2 surfaces */}
        {session.surfaces.length < 2 && (
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-sm text-amber-400 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>
              Only <strong>{session.surfaces.length}</strong> surface loaded — you need at least
              2 for cut/fill. Add another LandXML file below.
            </span>
          </div>
        )}

        {/* Errors */}
        {errors.map((e, i) => (
          <div key={i} className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{e}</span>
          </div>
        ))}

        {/* Add more files drop zone */}
        <label
          className={`flex items-center justify-center gap-3 cursor-pointer rounded-xl border-2 border-dashed
            transition-all py-4 px-6 text-sm
            ${dragging
              ? 'border-brand-400 bg-brand-500/10 text-brand-300'
              : 'border-slate-600 hover:border-brand-500/50 text-slate-400 hover:text-slate-300'}
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
            ? <><Loader2 className="w-4 h-4 animate-spin text-brand-400" /> Parsing files…</>
            : <><PlusCircle className="w-4 h-4" /> Add more LandXML files (drag multiple or click to browse)</>
          }
        </label>
      </div>
    )
  }

  // ── Initial empty state ──
  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
        <Upload className="w-5 h-5 text-brand-400" />
        Import LandXML Files
      </h2>
      <p className="text-sm text-slate-400 mb-4">
        Select or drop <strong className="text-slate-300">one or multiple</strong> LandXML files at once.
        All surfaces from every file will be combined for selection.
      </p>

      <label
        className={`block cursor-pointer rounded-xl border-2 border-dashed transition-all py-12 px-6 text-center
          ${dragging ? 'border-brand-400 bg-brand-500/10' : 'border-slate-600 hover:border-brand-500/60 hover:bg-brand-500/5'}
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
          <div className="flex flex-col items-center gap-3 text-brand-400">
            <Loader2 className="w-10 h-10 animate-spin" />
            <p className="text-sm font-medium">Parsing files…</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-slate-400">
            <Upload className="w-12 h-12 mb-1" />
            <p className="text-base font-medium text-slate-200">
              Drop LandXML files here, or click to browse
            </p>
            <p className="text-sm">
              You can select <strong className="text-slate-300">multiple files</strong> at once
            </p>
            <p className="text-xs mt-1">Supports LandXML 1.1 and 1.2 TIN surfaces · Max 50 MB per file</p>
          </div>
        )}
      </label>

      {errors.map((e, i) => (
        <div key={i} className="mt-3 flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{e}</span>
        </div>
      ))}
    </div>
  )
}
