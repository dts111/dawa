import { useState } from 'react'
import Header from './components/Header'
import FileUpload from './components/FileUpload'
import SurfaceSelector from './components/SurfaceSelector'
import CutFillMap2D from './components/CutFillMap2D'
import CutFillMap3D from './components/CutFillMap3D'
import ReportPanel from './components/ReportPanel'
import { RefreshCw } from 'lucide-react'

export default function App() {
  const [parseResult, setParseResult] = useState(null)   // { session_key, surfaces }
  const [results, setResults]         = useState(null)   // { volResult, allMeshes, surface1Name, surface2Name }
  const [tab, setTab]                 = useState('3d')

  const handleParsed = (data) => {
    setParseResult(data)
    setResults(null)
    setTab('3d')
  }

  const handleResults = (data) => {
    setResults(data)
    setTab('cutfill')   // jump to cut/fill map after calculation
  }

  const reset = () => { setParseResult(null); setResults(null) }

  const tabs = [
    { id: '3d',      label: '🌐 3D All Surfaces', available: !!(results?.allMeshes?.length) },
    { id: 'cutfill', label: '🗺 Cut / Fill Map',   available: !!results },
  ]

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6 space-y-6">

        {/* ── Step 1: Import ── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <StepBadge n={1} label="Import LandXML Files" active />
            {parseResult && (
              <button onClick={reset} className="btn-secondary text-xs py-1 px-3 gap-1">
                <RefreshCw className="w-3 h-3" /> New session
              </button>
            )}
          </div>
          <FileUpload onParsed={handleParsed} />
        </section>

        {/* ── Step 2: Calculate ── */}
        {parseResult && parseResult.surfaces.length >= 2 && (
          <section>
            <StepBadge n={2} label="Select Surfaces &amp; Calculate" active />
            <div className="mt-3">
              <SurfaceSelector
                sessionKey={parseResult.session_key}
                surfaces={parseResult.surfaces}
                onResults={handleResults}
              />
            </div>
          </section>
        )}

        {/* ── Step 3: Visualise ── */}
        {results && (
          <section>
            <StepBadge n={3} label="Visualise Results" active />
            <div className="mt-3 card overflow-hidden">

              {/* Tab bar */}
              <div className="flex border-b border-slate-700">
                {tabs.map(t => (
                  <button
                    key={t.id}
                    onClick={() => t.available && setTab(t.id)}
                    className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px
                      ${tab === t.id
                        ? 'border-brand-500 text-brand-400'
                        : t.available
                          ? 'border-transparent text-slate-400 hover:text-slate-200'
                          : 'border-transparent text-slate-600 cursor-not-allowed'
                      }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="p-4">
                {tab === '3d' && results.allMeshes && (
                  <CutFillMap3D meshes={results.allMeshes} />
                )}
                {tab === 'cutfill' && (
                  <CutFillMap2D
                    grid={results.volResult.grid}
                    surface1Name={results.surface1Name}
                    surface2Name={results.surface2Name}
                  />
                )}
              </div>
            </div>
          </section>
        )}

        {/* ── Step 4: Report ── */}
        {results && (
          <section>
            <StepBadge n={4} label="Export Report" active />
            <div className="mt-3">
              <ReportPanel
                summary={results.volResult.summary}
                sessionKey={parseResult.session_key}
                surface1Name={results.surface1Name}
                surface2Name={results.surface2Name}
                gridResolution={null}
              />
            </div>
          </section>
        )}

      </main>

      <footer className="border-t border-slate-700 text-center text-xs text-slate-600 py-4">
        LandXML Volume Calculator · React + FastAPI · Cut/Fill earthwork analysis
      </footer>
    </div>
  )
}

function StepBadge({ n, label, active }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
        ${active ? 'bg-brand-500 text-white' : 'bg-slate-700 text-slate-400'}`}>
        {n}
      </span>
      <span
        className={`text-sm font-semibold ${active ? 'text-slate-200' : 'text-slate-500'}`}
        dangerouslySetInnerHTML={{ __html: label }}
      />
    </div>
  )
}
