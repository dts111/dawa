import { useState, useEffect, useRef } from 'react'
import * as d3 from 'd3'
import {
  Mountain, Ruler, Settings2, AlertCircle, AlertTriangle, Loader2,
  PlusCircle, Trash2, Play, Download, FileText, CheckCircle2,
} from 'lucide-react'
import {
  checkBatterRequirement, computeExcavationProfile, getStationProfile,
  downloadExcavationLandXML, downloadExcavationCSV,
} from '../api'

const INTERMEDIATE_PALETTE = ['#2ecc71', '#9b59b6', '#1abc9c', '#e67e22', '#3498db']

function sourceColor(source, hbxcName) {
  if (source === hbxcName) return '#6422b4'
  if (source === 'BATTER') return '#f59e0b'
  let hash = 0
  for (let i = 0; i < source.length; i++) hash = (hash * 31 + source.charCodeAt(i)) >>> 0
  return INTERMEDIATE_PALETTE[hash % INTERMEDIATE_PALETTE.length]
}

export default function ExcavationProfilePanel({ sessionKey, surfaces, onResult }) {
  const [hbxcName, setHbxcName] = useState(surfaces[0]?.name || '')
  const [egName, setEgName] = useState(surfaces[1]?.name || surfaces[0]?.name || '')
  const [intermediateNames, setIntermediateNames] = useState([])

  const [vertices, setVertices] = useState([{ x: '', y: '' }, { x: '', y: '' }])
  const [chainageInterval, setChainageInterval] = useState(10)
  const [toleranceMm, setToleranceMm] = useState(1)
  const [maxSearchDistance, setMaxSearchDistance] = useState(50)
  const [sampleStep, setSampleStep] = useState(0.25)

  const [checking, setChecking] = useState(false)
  const [batterCheck, setBatterCheck] = useState(null)
  const [batterInput, setBatterInput] = useState('')

  const [computing, setComputing] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const [selectedRange, setSelectedRange] = useState(null)
  const [profile, setProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(false)

  const [exportingXml, setExportingXml] = useState(false)
  const [exportingCsv, setExportingCsv] = useState(false)

  const intermediateOptions = surfaces.filter(s => s.name !== hbxcName && s.name !== egName)

  const toggleIntermediate = (name) => {
    setIntermediateNames(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name])
  }

  const updateVertex = (i, key, value) => {
    setVertices(vs => vs.map((v, idx) => idx === i ? { ...v, [key]: value } : v))
  }
  const addVertex = () => setVertices(vs => [...vs, { x: '', y: '' }])
  const removeVertex = (i) => setVertices(vs => vs.length > 2 ? vs.filter((_, idx) => idx !== i) : vs)

  const buildPolyline = () => {
    const poly = vertices.map(v => ({ x: parseFloat(v.x), y: parseFloat(v.y) }))
    if (poly.some(p => Number.isNaN(p.x) || Number.isNaN(p.y))) {
      throw new Error('Enter numeric X/Y values for every corridor vertex.')
    }
    return poly
  }

  const opts = {
    chainageInterval: parseFloat(chainageInterval),
    maxSearchDistance: parseFloat(maxSearchDistance),
    sampleStep: parseFloat(sampleStep),
    toleranceMm: parseFloat(toleranceMm),
  }

  const handleCheck = async () => {
    setError(null)
    setBatterCheck(null)
    setResult(null)
    setChecking(true)
    try {
      const poly = buildPolyline()
      const check = await checkBatterRequirement(sessionKey, hbxcName, egName, intermediateNames, poly, opts)
      setBatterCheck(check)
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Batter requirement check failed.')
    } finally {
      setChecking(false)
    }
  }

  const handleCompute = async () => {
    setError(null)
    setComputing(true)
    setResult(null)
    setSelectedRange(null)
    setProfile(null)
    try {
      const poly = buildPolyline()
      const res = await computeExcavationProfile(
        sessionKey, hbxcName, egName, intermediateNames, poly,
        batterCheck?.batter_required ? batterInput : null, opts,
      )
      setResult(res)
      onResult?.(res)
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Excavation profile computation failed.')
    } finally {
      setComputing(false)
    }
  }

  const handleSelectRange = async (range) => {
    const sel = { side: range.side, chainage: range.chainage_start }
    setSelectedRange(sel)
    setProfile(null)
    setProfileLoading(true)
    try {
      const data = await getStationProfile(sessionKey, sel.chainage, sel.side)
      setProfile(data)
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Failed to load station profile.')
    } finally {
      setProfileLoading(false)
    }
  }

  const handleExportXml = async () => {
    setError(null)
    setExportingXml(true)
    try {
      await downloadExcavationLandXML(sessionKey)
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Export failed.')
    } finally {
      setExportingXml(false)
    }
  }

  const handleExportCsv = async () => {
    setError(null)
    setExportingCsv(true)
    try {
      await downloadExcavationCSV(sessionKey)
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Export failed.')
    } finally {
      setExportingCsv(false)
    }
  }

  const canCompute = hbxcName && egName && hbxcName !== egName &&
    !(batterCheck?.batter_required && !batterInput.trim())

  return (
    <div className="card p-6 space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
          <Mountain className="w-5 h-5 text-brand-600" />
          Maximum Excavation Profile
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Traces the excavation extent between a design formation surface and existing ground along a
          corridor, following intermediate layers where present and flagging anywhere the design
          doesn't cleanly tie in.
        </p>
      </div>

      {/* Surface selection */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label">HBXC — Design Formation Surface</label>
          <select className="select-input" value={hbxcName} onChange={e => setHbxcName(e.target.value)}>
            {surfaces.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">EG — Existing Ground</label>
          <select className="select-input" value={egName} onChange={e => setEgName(e.target.value)}>
            {surfaces.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="label">Intermediate Surfaces (sub-base, capping, etc. — optional)</label>
        {intermediateOptions.length === 0 ? (
          <p className="text-xs text-slate-400">No other surfaces available.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {intermediateOptions.map(s => (
              <label
                key={s.name}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-sm cursor-pointer transition-colors
                  ${intermediateNames.includes(s.name)
                    ? 'border-brand-500 bg-brand-500/10 text-brand-700'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}
              >
                <input
                  type="checkbox"
                  className="hidden"
                  checked={intermediateNames.includes(s.name)}
                  onChange={() => toggleIntermediate(s.name)}
                />
                {s.name}
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Corridor polyline */}
      <div>
        <label className="label">Corridor Centreline (straight-segment polyline)</label>
        <div className="space-y-2">
          {vertices.map((v, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs text-slate-400 w-5">{i + 1}</span>
              <input
                type="number" step="any" placeholder="X" className="select-input text-sm"
                value={v.x} onChange={e => updateVertex(i, 'x', e.target.value)}
              />
              <input
                type="number" step="any" placeholder="Y" className="select-input text-sm"
                value={v.y} onChange={e => updateVertex(i, 'y', e.target.value)}
              />
              <button
                onClick={() => removeVertex(i)}
                disabled={vertices.length <= 2}
                className="p-1.5 text-slate-400 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
                title="Remove vertex"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
        <button onClick={addVertex} className="btn-secondary text-xs py-1 px-3 gap-1 mt-2">
          <PlusCircle className="w-3.5 h-3.5" /> Add Vertex
        </button>
      </div>

      {/* Chainage / tolerance */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Chainage Interval (m)</label>
          <input
            type="number" min="0.1" step="1" className="select-input"
            value={chainageInterval} onChange={e => setChainageInterval(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Tie-in Tolerance (mm)</label>
          <input
            type="number" min="0.01" step="0.5" className="select-input"
            value={toleranceMm} onChange={e => setToleranceMm(e.target.value)}
          />
          <p className="text-xs text-slate-400 mt-1">Floating-point rounding tolerance, not a design tolerance.</p>
        </div>
      </div>

      <details>
        <summary className="flex items-center gap-2 cursor-pointer text-sm text-slate-500 hover:text-slate-800 transition-colors select-none">
          <Settings2 className="w-4 h-4" />
          Advanced options
        </summary>
        <div className="mt-3 pl-6 border-l border-slate-200 grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Max Search Distance (m)</label>
            <input
              type="number" min="1" step="1" className="select-input"
              value={maxSearchDistance} onChange={e => setMaxSearchDistance(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Sample Step (m)</label>
            <input
              type="number" min="0.01" step="0.05" className="select-input"
              value={sampleStep} onChange={e => setSampleStep(e.target.value)}
            />
          </div>
        </div>
      </details>

      {/* Batter check + input */}
      <div className="flex flex-wrap gap-3 items-center">
        <button className="btn-secondary" onClick={handleCheck} disabled={checking || !hbxcName || !egName}>
          {checking
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Checking…</>
            : <><Ruler className="w-4 h-4" /> Check Requirements</>}
        </button>
        {batterCheck && (
          batterCheck.batter_required ? (
            <span className="text-xs text-amber-700 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              Required for {batterCheck.affected_count} of {batterCheck.stations_checked} station/sides
              {batterCheck.affected_examples[0] && (
                <> — e.g. Ch {batterCheck.affected_examples[0].chainage} {batterCheck.affected_examples[0].side === 'L' ? 'left' : 'right'}</>
              )}
            </span>
          ) : (
            <span className="text-xs text-fill flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> No batter angle needed — every segment ties via an intermediate surface.
            </span>
          )
        )}
      </div>

      {batterCheck?.batter_required && (
        <div>
          <label className="label">Batter Angle / Ratio</label>
          <input
            type="text" placeholder="e.g. 1:2 or 45" className="select-input w-48"
            value={batterInput} onChange={e => setBatterInput(e.target.value)}
          />
          <p className="text-xs text-slate-400 mt-1">Ratio as H:V (e.g. "1:2") or plain degrees (e.g. "45").</p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-300 p-3 text-sm text-red-600">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button className="btn-primary w-full justify-center py-3 text-base" onClick={handleCompute} disabled={computing || !canCompute}>
        {computing
          ? <><Loader2 className="w-5 h-5 animate-spin" /> Computing…</>
          : <><Play className="w-5 h-5" /> Compute Excavation Profile</>}
      </button>

      {result && (
        <div className="space-y-4 pt-2 border-t border-slate-200">
          <div className="grid grid-cols-3 gap-3">
            <StatBox label="Tied In" value={result.summary.tied_in_count} color="text-fill border-fill/30 bg-fill/5" />
            <StatBox label="Not Tied In" value={result.summary.untied_count} color="text-cut border-cut/30 bg-cut/5" />
            <StatBox label="Corridor Length" value={`${result.summary.corridor_length_m} m`} color="text-slate-600 border-slate-200 bg-slate-50" />
          </div>

          {result.ranges.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-fill">
              <CheckCircle2 className="w-4 h-4" /> All traced stations tied into existing ground within tolerance.
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-2 bg-slate-50 border-b border-slate-200">
                <span>Side</span><span>Chainage Range</span><span>Max</span><span>Avg</span><span>Stations</span>
              </div>
              {result.ranges.map((r, i) => (
                <button
                  key={i}
                  onClick={() => handleSelectRange(r)}
                  className={`grid grid-cols-[auto_1fr_auto_auto_auto] gap-2 w-full text-left px-4 py-2.5 text-sm items-center transition-colors
                    ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50'} hover:bg-cut/5`}
                >
                  <span className="font-medium text-cut">{r.side}</span>
                  <span className="text-slate-700">Ch {r.chainage_start}–{r.chainage_end}</span>
                  <span className="text-cut font-mono">{r.max_variation_mm}mm</span>
                  <span className="text-slate-500 font-mono">{r.avg_variation_mm}mm</span>
                  <span className="text-slate-400">{r.station_count}</span>
                </button>
              ))}
            </div>
          )}

          <pre className="text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">{result.report_text}</pre>

          {selectedRange && (
            <div>
              <p className="text-xs text-slate-500 mb-2">
                Cross-section at Ch {selectedRange.chainage}, {selectedRange.side === 'L' ? 'left' : 'right'} side
              </p>
              {profileLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-400 py-8 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading profile…
                </div>
              ) : profile && (
                <StationProfileChart profile={profile} hbxcName={hbxcName} />
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <button className="btn-primary flex-1 justify-center" onClick={handleExportXml} disabled={exportingXml}>
              {exportingXml
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Exporting…</>
                : <><Download className="w-4 h-4" /> Export LandXML Surface</>}
            </button>
            <button className="btn-secondary flex-1 justify-center" onClick={handleExportCsv} disabled={exportingCsv}>
              {exportingCsv
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Exporting…</>
                : <><FileText className="w-4 h-4" /> Export CSV Report</>}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function StatBox({ label, value, color }) {
  return (
    <div className={`stat-box rounded-lg border ${color}`}>
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className="text-lg font-bold font-mono">{value}</div>
    </div>
  )
}

function StationProfileChart({ profile, hbxcName }) {
  const svgRef = useRef(null)
  const containerRef = useRef(null)

  useEffect(() => {
    if (!profile?.path?.length || !svgRef.current) return
    const container = containerRef.current
    const W = container.clientWidth || 500
    const H = 220
    const margin = { top: 20, right: 20, bottom: 36, left: 50 }
    const innerW = W - margin.left - margin.right
    const innerH = H - margin.top - margin.bottom

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', W).attr('height', H)
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    const path = profile.path
    const xScale = d3.scaleLinear().domain(d3.extent(path, p => p.offset)).range([0, innerW])
    const yExtent = d3.extent(path, p => p.z)
    const yPad = (yExtent[1] - yExtent[0]) * 0.15 || 0.5
    const yScale = d3.scaleLinear().domain([yExtent[0] - yPad, yExtent[1] + yPad]).range([innerH, 0])

    g.append('g').attr('transform', `translate(0,${innerH})`)
      .call(d3.axisBottom(xScale).ticks(5))
      .selectAll('text, line, path').attr('stroke', '#64748b').attr('fill', '#64748b').attr('font-size', '10')
    g.append('g').call(d3.axisLeft(yScale).ticks(5))
      .selectAll('text, line, path').attr('stroke', '#64748b').attr('fill', '#64748b').attr('font-size', '10')

    const line = d3.line().x(p => xScale(p.offset)).y(p => yScale(p.z)).curve(d3.curveLinear)
    g.append('path').datum(path).attr('fill', 'none').attr('stroke', '#94a3b8').attr('stroke-width', 1.5).attr('d', line)

    g.selectAll('circle.pt').data(path).enter().append('circle')
      .attr('class', 'pt')
      .attr('cx', p => xScale(p.offset)).attr('cy', p => yScale(p.z)).attr('r', 3)
      .attr('fill', p => sourceColor(p.source, hbxcName))

    if (profile.nearest_eg_point && path.length) {
      const [, , ez] = profile.nearest_eg_point
      const endOffset = path[path.length - 1].offset
      g.append('circle')
        .attr('cx', xScale(endOffset)).attr('cy', yScale(ez)).attr('r', 5)
        .attr('fill', 'none').attr('stroke', profile.tied_in ? '#27ae60' : '#e74c3c').attr('stroke-width', 2)
    }
  }, [profile, hbxcName])

  return (
    <div ref={containerRef}>
      <svg ref={svgRef} className="w-full rounded-lg bg-slate-50 border border-slate-200" />
      <div className="flex flex-wrap gap-3 mt-2 text-xs text-slate-500">
        <span>Distance: {profile.distance_3d_mm}mm</span>
        <span className={profile.tied_in ? 'text-fill' : 'text-cut'}>{profile.tied_in ? 'Tied in' : 'Not tied in'}</span>
      </div>
    </div>
  )
}
