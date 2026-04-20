/**
 * CutFillMap2D — D3.js heatmap rendering cut/fill dz grid.
 * Red = Cut (surface1 > surface2), Green = Fill (surface2 > surface1).
 */

import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'

export default function CutFillMap2D({ grid, surface1Name, surface2Name }) {
  const svgRef = useRef(null)
  const containerRef = useRef(null)
  const zoomRef = useRef(null)
  const [stats, setStats] = useState({ cutCells: 0, fillCells: 0, totalCells: 0 })

  useEffect(() => {
    if (!grid || !svgRef.current) return

    const { x: gridX, y: gridY, dz, resolution } = grid

    const container = containerRef.current
    const W = container.clientWidth || 700
    const H = Math.min(Math.max(W * 0.65, 300), 520)

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', W).attr('height', H)

    const margin = { top: 30, right: 90, bottom: 50, left: 70 }
    const innerW = W - margin.left - margin.right
    const innerH = H - margin.top - margin.bottom

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    // Scales
    const xScale = d3.scaleLinear().domain([gridX[0], gridX[gridX.length - 1]]).range([0, innerW])
    const yScale = d3.scaleLinear().domain([gridY[0], gridY[gridY.length - 1]]).range([innerH, 0])

    // Colour scale — symmetric around 0
    const flatDz = dz.flat().filter(v => v !== null && v !== undefined)
    const absMax = d3.max(flatDz.map(Math.abs)) || 1

    const colorScale = d3.scaleDiverging()
      .domain([-absMax, 0, absMax])
      .interpolator(d3.interpolateRgbBasis(['#27ae60', '#f5f5f5', '#e74c3c']))

    // Pixel size per cell
    const cellW = Math.max(1, innerW / gridX.length)
    const cellH = Math.max(1, innerH / gridY.length)

    // Clip path
    const clipId = 'heatmap-clip'
    svg.append('defs').append('clipPath').attr('id', clipId)
      .append('rect').attr('width', innerW).attr('height', innerH)

    const plot = g.append('g').attr('clip-path', `url(#${clipId})`)

    // Draw cells
    let cutCount = 0, fillCount = 0, totalCount = 0
    dz.forEach((row, ri) => {
      row.forEach((val, ci) => {
        if (val === null || val === undefined) return
        totalCount++
        if (val > 0) cutCount++
        else if (val < 0) fillCount++

        plot.append('rect')
          .attr('x', xScale(gridX[ci]))
          .attr('y', yScale(gridY[ri]) - cellH)
          .attr('width', cellW + 0.5)
          .attr('height', cellH + 0.5)
          .attr('fill', colorScale(val))
      })
    })

    setStats({ cutCells: cutCount, fillCells: fillCount, totalCells: totalCount })

    // Axes
    const xAxis = d3.axisBottom(xScale).ticks(5).tickFormat(d => d.toFixed(0))
    const yAxis = d3.axisLeft(yScale).ticks(5).tickFormat(d => d.toFixed(0))

    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(xAxis)
      .selectAll('text, line, path')
      .attr('stroke', '#94a3b8').attr('fill', '#94a3b8').attr('font-size', '11')

    g.append('g')
      .call(yAxis)
      .selectAll('text, line, path')
      .attr('stroke', '#94a3b8').attr('fill', '#94a3b8').attr('font-size', '11')

    // Axis labels
    g.append('text')
      .attr('x', innerW / 2).attr('y', innerH + 42)
      .attr('text-anchor', 'middle').attr('fill', '#94a3b8').attr('font-size', '12')
      .text('Easting (m)')

    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -innerH / 2).attr('y', -52)
      .attr('text-anchor', 'middle').attr('fill', '#94a3b8').attr('font-size', '12')
      .text('Northing (m)')

    // Colour bar
    const barH = innerH * 0.6
    const barX = innerW + 14
    const barY = (innerH - barH) / 2
    const barW = 14

    const defs = svg.select('defs')
    const gradId = 'dz-gradient'
    const grad = defs.append('linearGradient').attr('id', gradId)
      .attr('x1', '0%').attr('x2', '0%').attr('y1', '100%').attr('y2', '0%')

    const stops = d3.range(0, 1.01, 0.1)
    stops.forEach(t => {
      const val = d3.interpolateNumber(-absMax, absMax)(t)
      grad.append('stop')
        .attr('offset', `${t * 100}%`)
        .attr('stop-color', colorScale(val))
    })

    g.append('rect')
      .attr('x', barX).attr('y', barY).attr('width', barW).attr('height', barH)
      .attr('fill', `url(#${gradId})`)
      .attr('rx', 2)

    const barScale = d3.scaleLinear().domain([-absMax, absMax]).range([barY + barH, barY])
    const barAxis = d3.axisRight(barScale).ticks(5).tickFormat(d => `${d > 0 ? '+' : ''}${d.toFixed(2)}`)
    g.append('g').attr('transform', `translate(${barX + barW},0)`)
      .call(barAxis)
      .selectAll('text, line, path')
      .attr('stroke', '#94a3b8').attr('fill', '#94a3b8').attr('font-size', '10')

    g.append('text')
      .attr('x', barX + barW + 36).attr('y', barY + barH / 2)
      .attr('transform', `rotate(90, ${barX + barW + 36}, ${barY + barH / 2})`)
      .attr('text-anchor', 'middle').attr('fill', '#94a3b8').attr('font-size', '10')
      .text('Δ Elevation (m)')

    // Zoom & pan
    const zoom = d3.zoom()
      .scaleExtent([0.5, 20])
      .translateExtent([[-innerW, -innerH], [innerW * 2, innerH * 2]])
      .on('zoom', (event) => {
        plot.attr('transform', event.transform)
      })

    svg.call(zoom)
    zoomRef.current = zoom

    // Title
    svg.append('text')
      .attr('x', margin.left + innerW / 2).attr('y', 18)
      .attr('text-anchor', 'middle').attr('fill', '#e2e8f0').attr('font-size', '13').attr('font-weight', '600')
      .text(`Cut / Fill Map — ${surface1Name} vs ${surface2Name}`)

  }, [grid, surface1Name, surface2Name])

  const handleZoom = (factor) => {
    if (!zoomRef.current || !svgRef.current) return
    d3.select(svgRef.current).transition().duration(300).call(zoomRef.current.scaleBy, factor)
  }

  const handleReset = () => {
    if (!zoomRef.current || !svgRef.current) return
    d3.select(svgRef.current).transition().duration(400).call(zoomRef.current.transform, d3.zoomIdentity)
  }

  return (
    <div className="relative" ref={containerRef}>
      {/* Controls */}
      <div className="absolute top-2 right-2 flex flex-col gap-1 z-10">
        <button onClick={() => handleZoom(1.5)} className="btn-secondary p-1.5" title="Zoom in">
          <ZoomIn className="w-4 h-4" />
        </button>
        <button onClick={() => handleZoom(1 / 1.5)} className="btn-secondary p-1.5" title="Zoom out">
          <ZoomOut className="w-4 h-4" />
        </button>
        <button onClick={handleReset} className="btn-secondary p-1.5" title="Reset zoom">
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>

      <svg ref={svgRef} className="w-full rounded-lg bg-brand-900" />

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mt-3 px-2 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-cut" />
          Cut ({stats.cutCells.toLocaleString()} cells)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-fill" />
          Fill ({stats.fillCells.toLocaleString()} cells)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-slate-400" />
          No data
        </span>
        <span className="ml-auto">Scroll or pinch to zoom · Drag to pan</span>
      </div>
    </div>
  )
}
