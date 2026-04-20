/**
 * SectionView — D3.js cross-section / profile viewer.
 *
 * Shows elevation profiles for ALL loaded surfaces along a user-defined line.
 * Cut areas (surface1 above surface2) are shaded red.
 * Fill areas (surface2 above surface1) are shaded green.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import * as d3 from 'd3'
import { Loader2, AlertCircle, Maximize2, ZoomIn, ZoomOut, Ruler } from 'lucide-react'
import { getSection } from '../api'

// Colour palette — one colour per surface (cycles if >8 surfaces)
const PALETTE = [
  '#3498db', // blue
  '#e74c3c', // red
  '#2ecc71', // green
  '#f39c12', // orange
  '#9b59b6', // purple
  '#1abc9c', // teal
  '#e67e22', // amber
  '#e91e8c', // pink
]

export default function SectionView({ sessionKey, surfaces }) {
  const svgRef       = useRef(null)
  const containerRef = useRef(null)
  const zoomRef      = useRef(null)

  // Section line coords — default to a sensible E-W cut through all surface centres
  const [coords, setCoords] = useState(() => autoLine(surfaces))
  const [profileData, setProfileData] = useState(null)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState(null)

  // Automatically fetch when coords change (debounced via button)
  const fetchSection = useCallback(async () => {
    if (!sessionKey || !surfaces.length) return
    setError(null)
    setLoading(true)
    try {
      const data = await getSection(
        sessionKey,
        [],   // [] → backend returns all surfaces
        parseFloat(coords.x1), parseFloat(coords.y1),
        parseFloat(coords.x2), parseFloat(coords.y2),
      )
      setProfileData(data)
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Failed to compute section.')
    } finally {
      setLoading(false)
    }
  }, [sessionKey, surfaces, coords])

  // Auto-fetch when section mounts (with default line)
  useEffect(() => { fetchSection() }, []) // eslint-disable-line

  // Draw D3 chart whenever profileData changes
  useEffect(() => {
    if (!profileData || !svgRef.current) return
    drawChart(profileData, svgRef.current, containerRef.current, zoomRef)
  }, [profileData])

  const handleAutoLine = () => {
    const line = autoLine(surfaces)
    setCoords(line)
  }

  const handleZoom = (factor) => {
    if (!zoomRef.current || !svgRef.current) return
    d3.select(svgRef.current).transition().duration(250).call(zoomRef.current.scaleBy, factor)
  }
  const handleReset = () => {
    if (!zoomRef.current || !svgRef.current) return
    d3.select(svgRef.current).transition().duration(350).call(zoomRef.current.transform, d3.zoomIdentity)
  }

  const surfaceNames = Object.keys(profileData?.profiles ?? {})

  return (
    <div className="space-y-4" ref={containerRef}>

      {/* ── Section line controls ── */}
      <div className="rounded-lg bg-brand-900 border border-slate-700 p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-300">
          <Ruler className="w-4 h-4 text-brand-400" />
          Section Line
          <span className="text-xs text-slate-500 font-normal ml-1">
            — define start and end points in plan coordinates
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <CoordPair label="Start (A)" xKey="x1" yKey="y1" coords={coords} setCoords={setCoords} />
          <CoordPair label="End (B)"   xKey="x2" yKey="y2" coords={coords} setCoords={setCoords} />
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <button className="btn-primary py-1.5 px-4 text-sm" onClick={fetchSection} disabled={loading}>
            {loading
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Computing…</>
              : 'Generate Section'}
          </button>
          <button className="btn-secondary py-1.5 px-3 text-sm" onClick={() => { handleAutoLine(); }} title="Reset to automatic line">
            Auto Line
          </button>
          {profileData && (
            <span className="text-xs text-slate-500 ml-auto">
              Length: {profileData.total_length?.toFixed(2)} m ·{' '}
              {surfaces.length} surface{surfaces.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Chart ── */}
      {profileData && (
        <div className="relative">
          <div className="absolute top-2 right-2 flex flex-col gap-1 z-10">
            <button onClick={() => handleZoom(1.5)} className="btn-secondary p-1.5"><ZoomIn  className="w-4 h-4" /></button>
            <button onClick={() => handleZoom(1/1.5)} className="btn-secondary p-1.5"><ZoomOut className="w-4 h-4" /></button>
            <button onClick={handleReset} className="btn-secondary p-1.5"><Maximize2 className="w-4 h-4" /></button>
          </div>

          <svg ref={svgRef} className="w-full rounded-lg bg-brand-900" />

          {/* Legend */}
          <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 px-2">
            {surfaceNames.map((name, i) => (
              <span key={name} className="flex items-center gap-1.5 text-xs text-slate-300">
                <span className="inline-block w-6 h-0.5 rounded" style={{ backgroundColor: PALETTE[i % PALETTE.length], height: '3px' }} />
                {name}
              </span>
            ))}
            {surfaceNames.length >= 2 && (
              <>
                <span className="flex items-center gap-1.5 text-xs text-slate-400">
                  <span className="inline-block w-3 h-3 rounded-sm bg-cut opacity-50" /> Cut (A above B)
                </span>
                <span className="flex items-center gap-1.5 text-xs text-slate-400">
                  <span className="inline-block w-3 h-3 rounded-sm bg-fill opacity-50" /> Fill (B above A)
                </span>
              </>
            )}
            <span className="ml-auto text-xs text-slate-500">Scroll = zoom · Drag = pan</span>
          </div>
        </div>
      )}

      {loading && !profileData && (
        <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
          <Loader2 className="w-6 h-6 animate-spin text-brand-400" />
          <span>Computing section…</span>
        </div>
      )}
    </div>
  )
}

// ── CoordPair input group ──
function CoordPair({ label, xKey, yKey, coords, setCoords }) {
  return (
    <div>
      <p className="label mb-1">{label}</p>
      <div className="flex gap-2">
        <div className="flex-1">
          <span className="text-xs text-slate-500">X (Easting)</span>
          <input
            type="number"
            step="any"
            className="select-input mt-0.5 text-sm"
            value={coords[xKey]}
            onChange={e => setCoords(c => ({ ...c, [xKey]: e.target.value }))}
          />
        </div>
        <div className="flex-1">
          <span className="text-xs text-slate-500">Y (Northing)</span>
          <input
            type="number"
            step="any"
            className="select-input mt-0.5 text-sm"
            value={coords[yKey]}
            onChange={e => setCoords(c => ({ ...c, [yKey]: e.target.value }))}
          />
        </div>
      </div>
    </div>
  )
}

// ── Auto-compute a sensible E-W section line through all surfaces ──
function autoLine(surfaces) {
  if (!surfaces?.length) return { x1: 0, y1: 0, x2: 100, y2: 0 }
  const xMin = Math.min(...surfaces.map(s => s.x_min ?? 0))
  const xMax = Math.max(...surfaces.map(s => s.x_max ?? 100))
  const yMid = (
    Math.min(...surfaces.map(s => s.y_min ?? 0)) +
    Math.max(...surfaces.map(s => s.y_max ?? 100))
  ) / 2
  // Add 5% padding on each side
  const pad = (xMax - xMin) * 0.05
  return {
    x1: (xMin - pad).toFixed(3),
    y1: yMid.toFixed(3),
    x2: (xMax + pad).toFixed(3),
    y2: yMid.toFixed(3),
  }
}

// ── D3 chart renderer ──
function drawChart(profileData, svgEl, containerEl, zoomRef) {
  const { distance, profiles } = profileData
  const surfNames = Object.keys(profiles)
  if (!surfNames.length) return

  d3.select(svgEl).selectAll('*').remove()

  const W = (containerEl?.clientWidth || 800)
  const H = Math.min(Math.max(W * 0.55, 280), 480)
  const margin = { top: 30, right: 30, bottom: 52, left: 72 }
  const iW = W - margin.left - margin.right
  const iH = H - margin.top - margin.bottom

  const svg = d3.select(svgEl).attr('width', W).attr('height', H)
  const clipId = 'section-clip'
  svg.append('defs').append('clipPath').attr('id', clipId)
    .append('rect').attr('width', iW).attr('height', iH)

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)
  const plot = g.append('g').attr('clip-path', `url(#${clipId})`)

  // Scales
  const allZ = surfNames.flatMap(n => profiles[n].filter(v => v !== null))
  const zPad = (d3.max(allZ) - d3.min(allZ)) * 0.08 || 1

  const xScale = d3.scaleLinear().domain([0, distance[distance.length - 1]]).range([0, iW])
  const yScale = d3.scaleLinear()
    .domain([d3.min(allZ) - zPad, d3.max(allZ) + zPad])
    .range([iH, 0])

  // ── Fill between first two surfaces ──
  if (surfNames.length >= 2) {
    const z1arr = profiles[surfNames[0]]
    const z2arr = profiles[surfNames[1]]

    const cutArea = d3.area()
      .defined((_, i) => z1arr[i] !== null && z2arr[i] !== null && z1arr[i] > z2arr[i])
      .x((_, i)  => xScale(distance[i]))
      .y0((_, i) => yScale(z2arr[i]))
      .y1((_, i) => yScale(z1arr[i]))
      .curve(d3.curveMonotoneX)

    const fillArea = d3.area()
      .defined((_, i) => z1arr[i] !== null && z2arr[i] !== null && z2arr[i] > z1arr[i])
      .x((_, i)  => xScale(distance[i]))
      .y0((_, i) => yScale(z1arr[i]))
      .y1((_, i) => yScale(z2arr[i]))
      .curve(d3.curveMonotoneX)

    const dummy = distance.map((_, i) => i)

    plot.append('path').datum(dummy)
      .attr('fill', '#e74c3c').attr('opacity', 0.22).attr('d', cutArea)
    plot.append('path').datum(dummy)
      .attr('fill', '#27ae60').attr('opacity', 0.22).attr('d', fillArea)
  }

  // ── Surface profile lines ──
  const lineGen = (zArr) => d3.line()
    .defined((_, i) => zArr[i] !== null)
    .x((_, i) => xScale(distance[i]))
    .y((_, i) => yScale(zArr[i]))
    .curve(d3.curveMonotoneX)

  surfNames.forEach((name, idx) => {
    const color = PALETTE[idx % PALETTE.length]
    const zArr  = profiles[name]
    const dummy = distance.map((_, i) => i)

    plot.append('path')
      .datum(dummy)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', idx === 0 ? 2.5 : 2)
      .attr('stroke-dasharray', idx === 0 ? 'none' : idx === 1 ? 'none' : '6,3')
      .attr('d', lineGen(zArr)(dummy))
  })

  // ── Axes ──
  const xAxis = d3.axisBottom(xScale).ticks(6).tickFormat(d => `${d.toFixed(0)} m`)
  const yAxis = d3.axisLeft(yScale).ticks(5).tickFormat(d => `${d.toFixed(2)}`)

  const axStyle = (sel) => sel.selectAll('text, line, path')
    .attr('stroke', '#94a3b8').attr('fill', '#94a3b8').attr('font-size', '11')

  g.append('g').attr('transform', `translate(0,${iH})`).call(xAxis).call(axStyle)
  g.append('g').call(yAxis).call(axStyle)

  // Axis labels
  g.append('text').attr('x', iW / 2).attr('y', iH + 44)
    .attr('text-anchor', 'middle').attr('fill', '#94a3b8').attr('font-size', '12')
    .text('Distance along section (m)')

  g.append('text')
    .attr('transform', 'rotate(-90)').attr('x', -iH / 2).attr('y', -58)
    .attr('text-anchor', 'middle').attr('fill', '#94a3b8').attr('font-size', '12')
    .text('Elevation (m)')

  // Title
  svg.append('text').attr('x', margin.left + iW / 2).attr('y', 18)
    .attr('text-anchor', 'middle').attr('fill', '#e2e8f0').attr('font-size', '13').attr('font-weight', '600')
    .text(`Section A–B  (${surfNames.length} surface${surfNames.length !== 1 ? 's' : ''})`)

  // ── Grid lines ──
  g.append('g').attr('class', 'grid')
    .call(d3.axisLeft(yScale).ticks(5).tickSize(-iW).tickFormat(''))
    .call(s => s.selectAll('.tick line').attr('stroke', '#334155').attr('stroke-dasharray', '3,3'))
    .call(s => s.select('.domain').remove())

  // ── Hover tooltip ──
  const tooltip = svg.append('g').style('display', 'none')
  const tooltipLine = plot.append('line')
    .attr('stroke', '#64748b').attr('stroke-width', 1).attr('stroke-dasharray', '4,3')
    .attr('y1', 0).attr('y2', iH).style('display', 'none')

  const tooltipBg = tooltip.append('rect')
    .attr('rx', 4).attr('fill', '#1e293b').attr('stroke', '#334155').attr('stroke-width', 1)
  const tooltipLines = surfNames.map((_, i) =>
    tooltip.append('text').attr('font-size', '11').attr('fill', PALETTE[i % PALETTE.length])
  )
  const tooltipDist = tooltip.append('text')
    .attr('font-size', '10').attr('fill', '#64748b')

  svg.append('rect')
    .attr('transform', `translate(${margin.left},${margin.top})`)
    .attr('width', iW).attr('height', iH)
    .attr('fill', 'transparent')
    .on('mousemove', function(event) {
      const [mx] = d3.pointer(event)
      const d0 = xScale.invert(mx)
      const idx = d3.bisectLeft(distance, d0)
      if (idx < 0 || idx >= distance.length) return

      const xPos = xScale(distance[idx])
      tooltipLine.style('display', null).attr('x1', xPos).attr('x2', xPos)

      const lines = surfNames.map(n => {
        const z = profiles[n][idx]
        return z !== null ? `${n}: ${z.toFixed(3)} m` : `${n}: —`
      })

      const lineH = 16
      const padX = 8, padY = 6
      const textW = Math.max(...lines.map(l => l.length)) * 6.5
      const bW = textW + padX * 2
      const bH = (lines.length + 1) * lineH + padY * 2

      // Position box — flip if near right edge
      const boxX = xPos + margin.left + (xPos > iW * 0.7 ? -(bW + 12) : 12)
      const boxY = margin.top + 10

      tooltip.style('display', null).attr('transform', `translate(${boxX},${boxY})`)
      tooltipBg.attr('width', bW).attr('height', bH)
      tooltipDist.attr('x', padX).attr('y', padY + lineH * 0.9)
        .text(`@ ${distance[idx].toFixed(1)} m`)
      tooltipLines.forEach((t, i) => {
        t.attr('x', padX).attr('y', padY + lineH * (i + 2)).text(lines[i])
      })
    })
    .on('mouseleave', () => {
      tooltip.style('display', 'none')
      tooltipLine.style('display', 'none')
    })

  // ── Zoom ──
  const zoom = d3.zoom()
    .scaleExtent([0.5, 30])
    .translateExtent([[-iW * 0.2, -iH * 0.3], [iW * 1.2, iH * 1.3]])
    .on('zoom', (event) => {
      const t = event.transform
      const newX = t.rescaleX(xScale)
      plot.selectAll('path').each(function() {
        // Re-bind line data with updated scale (done by re-running generators)
      })
      // Re-draw everything on zoom
      const newXAxis = d3.axisBottom(newX).ticks(6).tickFormat(d => `${d.toFixed(0)} m`)
      g.select('.x-axis').call(newXAxis)
      plot.attr('transform', t)
      plot.attr('transform', `translate(${t.x},${t.y}) scale(${t.k},${t.k})`)
    })

  // Simpler approach: zoom entire plot group
  const zoom2 = d3.zoom()
    .scaleExtent([0.5, 30])
    .on('zoom', (event) => {
      plot.attr('transform', event.transform)
    })

  svg.call(zoom2)
  zoomRef.current = zoom2
}
