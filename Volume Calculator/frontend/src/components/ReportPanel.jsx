import { useState } from 'react'
import { FileText, FileSpreadsheet, Loader2, TrendingUp, TrendingDown, Minus, CheckCircle2 } from 'lucide-react'
import { downloadPDF, downloadExcel } from '../api'

export default function ReportPanel({ summary, sessionKey, surface1Name, surface2Name, gridResolution }) {
  const [projectName, setProjectName] = useState('Earthworks Project')
  const [loadingPdf, setLoadingPdf] = useState(false)
  const [loadingXlsx, setLoadingXlsx] = useState(false)
  const [error, setError] = useState(null)
  const [successMsg, setSuccessMsg] = useState(null)

  const handleDownload = async (type) => {
    setError(null)
    setSuccessMsg(null)
    const setter = type === 'pdf' ? setLoadingPdf : setLoadingXlsx
    setter(true)
    try {
      if (type === 'pdf') {
        await downloadPDF(sessionKey, surface1Name, surface2Name, projectName, gridResolution)
      } else {
        await downloadExcel(sessionKey, surface1Name, surface2Name, projectName, gridResolution)
      }
      setSuccessMsg(`${type.toUpperCase()} downloaded successfully.`)
      setTimeout(() => setSuccessMsg(null), 4000)
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Download failed.')
    } finally {
      setter(false)
    }
  }

  const { cut_volume_m3, fill_volume_m3, net_volume_m3, grid_resolution_m, grid_cols, grid_rows } = summary

  return (
    <div className="card p-6 space-y-5">
      <h2 className="text-lg font-semibold text-white flex items-center gap-2">
        <FileText className="w-5 h-5 text-brand-400" />
        Results &amp; Report
      </h2>

      {/* Volume stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatBox
          label="Cut Volume"
          value={cut_volume_m3}
          unit="m³"
          color="text-cut border-cut/30 bg-cut/5"
          icon={<TrendingDown className="w-5 h-5 text-cut" />}
        />
        <StatBox
          label="Fill Volume"
          value={fill_volume_m3}
          unit="m³"
          color="text-fill border-fill/30 bg-fill/5"
          icon={<TrendingUp className="w-5 h-5 text-fill" />}
        />
        <StatBox
          label="Net Volume"
          value={net_volume_m3}
          unit="m³"
          color={
            net_volume_m3 > 0
              ? 'text-cut border-cut/30 bg-cut/5'
              : net_volume_m3 < 0
              ? 'text-fill border-fill/30 bg-fill/5'
              : 'text-slate-300 border-slate-600 bg-slate-700/30'
          }
          icon={<Minus className="w-5 h-5" />}
          prefix={net_volume_m3 > 0 ? '+' : ''}
        />
      </div>

      {/* Grid info */}
      <div className="rounded-lg bg-brand-900 border border-slate-700 px-4 py-3 text-sm text-slate-400 flex flex-wrap gap-4">
        <span>
          Grid: <strong className="text-slate-200">{grid_cols} × {grid_rows}</strong> cells
        </span>
        <span>
          Resolution: <strong className="text-slate-200">{grid_resolution_m?.toFixed(3)} m</strong>
        </span>
        <span>
          Convention: <span className="text-cut font-medium">Cut</span> = surface 1 above surface 2
        </span>
      </div>

      {/* Project name */}
      <div>
        <label className="label">Project Name (for report)</label>
        <input
          type="text"
          className="select-input"
          value={projectName}
          onChange={e => setProjectName(e.target.value)}
          placeholder="My Earthworks Project"
        />
      </div>

      {/* Download buttons */}
      <div className="flex flex-wrap gap-3">
        <button
          className="btn-primary flex-1 justify-center"
          onClick={() => handleDownload('pdf')}
          disabled={loadingPdf || loadingXlsx}
        >
          {loadingPdf
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating PDF…</>
            : <><FileText className="w-4 h-4" /> Export PDF Report</>
          }
        </button>
        <button
          className="btn-secondary flex-1 justify-center"
          onClick={() => handleDownload('xlsx')}
          disabled={loadingPdf || loadingXlsx}
        >
          {loadingXlsx
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating Excel…</>
            : <><FileSpreadsheet className="w-4 h-4" /> Export Excel Report</>
          }
        </button>
      </div>

      {/* Feedback */}
      {successMsg && (
        <div className="flex items-center gap-2 text-sm text-fill">
          <CheckCircle2 className="w-4 h-4" />
          {successMsg}
        </div>
      )}
      {error && (
        <div className="text-sm text-red-400">{error}</div>
      )}
    </div>
  )
}

function StatBox({ label, value, unit, color, icon, prefix = '' }) {
  const formatted = Math.abs(value) >= 1000
    ? value.toLocaleString(undefined, { maximumFractionDigits: 1 })
    : value.toFixed(3)

  return (
    <div className={`stat-box rounded-lg border ${color}`}>
      <div className="mb-1">{icon}</div>
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className="text-lg font-bold font-mono">
        {prefix}{formatted}
      </div>
      <div className="text-xs text-slate-500">{unit}</div>
    </div>
  )
}
