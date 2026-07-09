/**
 * CutFillMap3D — Three.js 3D surface viewer.
 * Renders ALL imported TIN meshes in one scene, colour-coded by elevation (or,
 * toggleable, by each triangle's minimum interior angle — an "Angle Quality"
 * heatmap for spotting thin/degenerate sliver triangles).
 * Optionally overlays each surface's derived outer boundary, source breaklines,
 * the breaklines' convex-hull "data envelope", a best-effort "featureline chain"
 * (breaklines joined end-to-end into closed loops / open gapped chains — see
 * /api/breakline-chain) with its gap/branch points marked, a plain axis-aligned
 * bounding-box "Extent" (x_min/x_max/y_min/y_max — already present on each mesh, no
 * fetch/calculation needed), and/or the mesh's own raw triangle-edge wireframe (built
 * client-side from the same geometry as the solid mesh). A "3D Viewer" (maximize/
 * minimize) button opens the same viewer in a full-screen overlay.
 * Props:
 *   meshes              — array of { name, vertices, faces, z_min, z_max, ... }
 *   sessionKey          — needed to fetch boundary/breakline overlay data
 *   showOverlayControls — show the Boundary/Breaklines toggle buttons and allow
 *                         fetching that overlay data. Default true. Pass false for
 *                         a plain surfaces-only viewer (e.g. the post-calculate view).
 */

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { RotateCcw, Eye, EyeOff, Loader2, Maximize2, Minimize2 } from 'lucide-react'
import { getBoundary, getBreaklines, getBreaklineEnvelope, getBreaklineChain } from '../api'

// ── Minimal OrbitControls ──
function makeOrbitControls(camera, domElement) {
  let down = false, button = 0, lastX = 0, lastY = 0
  const spherical = new THREE.Spherical().setFromVector3(camera.position)
  const target = new THREE.Vector3()

  const sync = () => {
    camera.position.copy(new THREE.Vector3().setFromSpherical(spherical).add(target))
    camera.lookAt(target)
  }

  domElement.addEventListener('pointerdown', e => {
    down = true; button = e.button; lastX = e.clientX; lastY = e.clientY
    domElement.setPointerCapture(e.pointerId)
  })
  domElement.addEventListener('pointermove', e => {
    if (!down) return
    const dx = e.clientX - lastX, dy = e.clientY - lastY
    lastX = e.clientX; lastY = e.clientY
    if (button === 0) {
      spherical.theta -= dx * 0.005
      spherical.phi = Math.max(0.05, Math.min(Math.PI - 0.05, spherical.phi + dy * 0.005))
    } else {
      const r = new THREE.Vector3()
      r.crossVectors(camera.getWorldDirection(new THREE.Vector3()), camera.up).normalize()
      const f = spherical.radius * 0.001
      target.addScaledVector(r, -dx * f)
      target.addScaledVector(camera.up, dy * f)
    }
    sync()
  })
  domElement.addEventListener('pointerup', () => { down = false })
  domElement.addEventListener('wheel', e => {
    e.preventDefault()
    spherical.radius = Math.max(0.1, spherical.radius * (1 + e.deltaY * 0.001))
    sync()
  }, { passive: false })
  sync()
  return { reset() { spherical.setFromVector3(camera.position); target.set(0,0,0); sync() } }
}

// ── Elevation colour ──
function elevColor(z, zMin, zMax) {
  const t = zMax > zMin ? (z - zMin) / (zMax - zMin) : 0.5
  const stops = [[0,0.12,0.47],[0,0.74,0.74],[0.27,0.74,0.27],[0.93,0.86,0.1],[0.86,0.08,0.08]]
  const n = stops.length - 1
  const i = Math.min(Math.floor(t * n), n - 1)
  const f = t * n - i
  const [a, b] = [stops[i], stops[i+1]]
  return new THREE.Color(a[0]+(b[0]-a[0])*f, a[1]+(b[1]-a[1])*f, a[2]+(b[2]-a[2])*f)
}

// ── Triangle "sliver" quality colour — planar (XY) minimum interior angle ──
// Ignores Z, same convention as the backend's edge-length trim (_filter_long_edge_faces),
// since sliver-ness is a property of the planar Delaunay triangulation, not the terrain slope.
function minTriangleAngleDeg(pa, pb, pc) {
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1])
  const ab = dist(pa, pb), bc = dist(pb, pc), ca = dist(pc, pa)
  const angleOpposite = (opp, s1, s2) => {
    const cosv = Math.min(1, Math.max(-1, (s1 * s1 + s2 * s2 - opp * opp) / (2 * s1 * s2)))
    return Math.acos(cosv) * 180 / Math.PI
  }
  const angleA = angleOpposite(bc, ab, ca)
  const angleB = angleOpposite(ca, ab, bc)
  const angleC = angleOpposite(ab, bc, ca)
  return Math.min(angleA, angleB, angleC)
}

function angleQualityColor(minAngleDeg) {
  // 0deg (degenerate sliver) -> red; 40deg+ (healthy) -> green
  const t = Math.min(Math.max(minAngleDeg / 40, 0), 1)
  const stops = [[0.86,0.08,0.08],[0.93,0.86,0.1],[0.27,0.74,0.27]]
  const n = stops.length - 1
  const i = Math.min(Math.floor(t * n), n - 1)
  const f = t * n - i
  const [a, b] = [stops[i], stops[i+1]]
  return new THREE.Color(a[0]+(b[0]-a[0])*f, a[1]+(b[1]-a[1])*f, a[2]+(b[2]-a[2])*f)
}

const FLAT_COLOR = [0.78, 0.78, 0.78]   // neutral grey when neither colour mode is active

// colorMode: 'elevation' | 'angle' | 'flat'
function buildGeo(meshData, zMin, zMax, colorMode) {
  const { vertices, faces } = meshData
  const positions = new Float32Array(faces.length * 9)
  const colors    = new Float32Array(faces.length * 9)
  let pi = 0, ci = 0
  for (const [a,b,c] of faces) {
    // Per-face (not per-vertex) for angle mode — a flat quality colour for the whole
    // triangle, since minimum-angle is a property of the triangle, not each vertex.
    const faceCol = colorMode === 'angle'
      ? angleQualityColor(minTriangleAngleDeg(vertices[a], vertices[b], vertices[c]))
      : null
    for (const idx of [a,b,c]) {
      const [x,y,z] = vertices[idx]
      positions[pi++]=x; positions[pi++]=z; positions[pi++]=-y
      if (colorMode === 'elevation') {
        const col = elevColor(z, zMin, zMax)
        colors[ci++]=col.r; colors[ci++]=col.g; colors[ci++]=col.b
      } else if (colorMode === 'angle') {
        colors[ci++]=faceCol.r; colors[ci++]=faceCol.g; colors[ci++]=faceCol.b
      } else {
        colors[ci++]=FLAT_COLOR[0]; colors[ci++]=FLAT_COLOR[1]; colors[ci++]=FLAT_COLOR[2]
      }
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions,3))
  geo.setAttribute('color',    new THREE.BufferAttribute(colors,3))
  geo.computeVertexNormals()
  return geo
}

// Same LandXML [x,y,z] -> Three.js [x,z,-y] convention as buildGeo, for line overlays
function buildLineObject(points3d, color, closed, dashed = false) {
  const positions = new Float32Array(points3d.length * 3)
  points3d.forEach(([x, y, z], i) => {
    positions[i * 3] = x
    positions[i * 3 + 1] = z
    positions[i * 3 + 2] = -y
  })
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const mat = dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 2, gapSize: 1 })
    : new THREE.LineBasicMaterial({ color })
  const line = closed ? new THREE.LineLoop(geo, mat) : new THREE.Line(geo, mat)
  if (dashed) line.computeLineDistances()
  return line
}

// Small coloured dot markers — used for featureline-chain gap/branch points
function buildPointsObject(points3d, color, size) {
  const positions = new Float32Array(points3d.length * 3)
  points3d.forEach(([x, y, z], i) => {
    positions[i * 3] = x
    positions[i * 3 + 1] = z
    positions[i * 3 + 2] = -y
  })
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const mat = new THREE.PointsMaterial({ color, size, sizeAttenuation: true })
  return new THREE.Points(geo, mat)
}

const BREAKLINE_PALETTE = ['#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#e91e8c', '#3498db']
function breaklineColor(desc) {
  let hash = 0
  for (let i = 0; i < desc.length; i++) hash = (hash * 31 + desc.charCodeAt(i)) >>> 0
  return BREAKLINE_PALETTE[hash % BREAKLINE_PALETTE.length]
}

export default function CutFillMap3D({ meshes, sessionKey, showOverlayControls = true }) {
  const canvasRef  = useRef(null)
  const objRefs    = useRef([])
  const controlRef = useRef(null)
  const savedCameraPos = useRef(null)   // preserves the view across overlay-triggered rebuilds

  // visibility state per mesh index
  const [visible, setVisible] = useState(() => meshes.map(() => true))
  const [showBoundary, setShowBoundary] = useState(false)
  const [showBreaklines, setShowBreaklines] = useState(false)
  const [showEnvelope, setShowEnvelope] = useState(false)
  const [showChain, setShowChain] = useState(false)   // best-effort featureline chain, gaps/branches marked
  const [showExtent, setShowExtent] = useState(false)   // plain bounding box, no fetch needed
  const [showTriangles, setShowTriangles] = useState(false)   // raw wireframe, no fetch needed
  const [showElevationColor, setShowElevationColor] = useState(true)   // independent of Triangles, but auto-off when Triangles is switched on
  const [showAngleQuality, setShowAngleQuality] = useState(false)   // mutually exclusive with Elevation Color
  const [overlayData, setOverlayData] = useState({})   // { [surfaceName]: { boundary, breaklines, envelope } }
  const [overlayLoading, setOverlayLoading] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const prevMeshesRef = useRef(meshes)   // detects a new/retrimmed mesh set, to bypass the stale overlay cache

  // Lock body scroll while full screen — otherwise wheel/scroll events over parts of
  // the modal that aren't the canvas itself (buttons, padding, backdrop) fall through
  // to the underlying page.
  useEffect(() => {
    if (!isFullscreen) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prevOverflow }
  }, [isFullscreen])

  // Close on Escape while full screen
  useEffect(() => {
    if (!isFullscreen) return
    const onKey = (e) => { if (e.key === 'Escape') setIsFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isFullscreen])

  // Fetch boundary/breakline/envelope data on demand when toggled on, cached per surface name
  useEffect(() => {
    if (!showOverlayControls) return

    // meshes changes both when a new file is added AND when a live retrim updates
    // the already-loaded surfaces (same surface names, different underlying shape)
    // — either way, any cached overlay data is now stale and must be refetched
    // rather than reused. Compute this via a local variable (not overlayData state
    // directly) so the "missing" check below is correct within THIS effect run,
    // rather than depending on a separate setOverlayData({}) landing in time.
    const meshesChanged = prevMeshesRef.current !== meshes
    prevMeshesRef.current = meshes
    const cacheForThisRun = meshesChanged ? {} : overlayData
    if (meshesChanged && Object.keys(overlayData).length) setOverlayData({})

    if (!showBoundary && !showBreaklines && !showEnvelope && !showChain || !sessionKey) return
    const names = meshes.map(m => m.name)
    const missing = names.filter(n => {
      const cached = cacheForThisRun[n]
      if (!cached) return true
      return (showBoundary && !cached.boundary) || (showBreaklines && !cached.breaklines)
        || (showEnvelope && !cached.envelope) || (showChain && !cached.chain)
    })
    if (!missing.length) return

    let cancelled = false
    setOverlayLoading(true)
    ;(async () => {
      const updates = {}
      for (const name of missing) {
        const existing = cacheForThisRun[name] || {}
        const [boundaryRes, breaklinesRes, envelopeRes, chainRes] = await Promise.all([
          showBoundary && !existing.boundary ? getBoundary(sessionKey, name).catch(() => null) : Promise.resolve(null),
          showBreaklines && !existing.breaklines ? getBreaklines(sessionKey, name).catch(() => null) : Promise.resolve(null),
          showEnvelope && !existing.envelope ? getBreaklineEnvelope(sessionKey, name).catch(() => null) : Promise.resolve(null),
          showChain && !existing.chain ? getBreaklineChain(sessionKey, name).catch(() => null) : Promise.resolve(null),
        ])
        updates[name] = {
          boundary: boundaryRes?.loops ?? existing.boundary ?? null,
          breaklines: breaklinesRes?.breaklines ?? existing.breaklines ?? null,
          envelope: envelopeRes?.envelope ?? existing.envelope ?? null,
          chain: chainRes ?? existing.chain ?? null,
        }
      }
      if (!cancelled) setOverlayData(prev => ({ ...(meshesChanged ? {} : prev), ...updates }))
      setOverlayLoading(false)
    })()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showOverlayControls, showBoundary, showBreaklines, showEnvelope, showChain, meshes, sessionKey])

  useEffect(() => {
    if (!canvasRef.current || !meshes?.length) return

    const canvas = canvasRef.current
    const W = canvas.parentElement.clientWidth || 700
    const H = isFullscreen
      ? Math.max(window.innerHeight * 0.7, 400)
      : Math.min(Math.max(W * 0.65, 300), 520)
    canvas.width = W; canvas.height = H

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.setSize(W, H); renderer.setPixelRatio(Math.min(window.devicePixelRatio,2))
    renderer.setClearColor(0xf3f6f5)

    const scene  = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, W/H, 0.1, 1e7)

    scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    const dir = new THREE.DirectionalLight(0xffffff, 0.8)
    dir.position.set(1,2,1); scene.add(dir)

    const gZMin = Math.min(...meshes.map(m => m.z_min))
    const gZMax = Math.max(...meshes.map(m => m.z_max))

    // Opacities: first mesh fully opaque, rest progressively more transparent
    const opacities = meshes.map((_, i) => Math.max(0.35, 1 - i * 0.25))

    const colorMode = showAngleQuality ? 'angle' : (showElevationColor ? 'elevation' : 'flat')

    const objs = meshes.map((m, i) => {
      const geo = buildGeo(m, gZMin, gZMax, colorMode)
      const mat = new THREE.MeshLambertMaterial({
        vertexColors: true, side: THREE.DoubleSide,
        transparent: i > 0, opacity: opacities[i],
        depthWrite: i === 0,
      })
      const obj = new THREE.Mesh(geo, mat)
      obj.visible = visible[i]
      scene.add(obj)
      return obj
    })
    objRefs.current = objs

    // Centre the scene
    const box = new THREE.Box3().setFromObject(objs[0])
    const centre = new THREE.Vector3(); box.getCenter(centre)
    const size   = box.getSize(new THREE.Vector3()).length()
    objs.forEach(o => o.position.sub(centre))

    // Boundary / breakline overlays, centred the same way as the meshes
    const overlayObjs = []
    meshes.forEach((m, i) => {
      if (!visible[i]) return

      // Triangle wireframe — reuses the solid mesh's own geometry, no fetch needed.
      if (showTriangles) {
        const wireGeo = new THREE.WireframeGeometry(objs[i].geometry)
        const wireMat = new THREE.LineBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.35 })
        const wire = new THREE.LineSegments(wireGeo, wireMat)
        wire.position.sub(centre)
        scene.add(wire)
        overlayObjs.push(wire)
      }

      // Extent doesn't need fetched overlayData — x_min/x_max/y_min/y_max are
      // already on the mesh itself.
      if (showExtent) {
        const z = m.z_min
        const rectPts = [
          [m.x_min, m.y_min, z],
          [m.x_max, m.y_min, z],
          [m.x_max, m.y_max, z],
          [m.x_min, m.y_max, z],
        ]
        const line = buildLineObject(rectPts, 0x00c2a8, true)
        line.position.sub(centre)
        scene.add(line)
        overlayObjs.push(line)
      }

      const data = overlayData[m.name]
      if (!data) return
      if (showBoundary && data.boundary) {
        data.boundary.forEach(loop => {
          const line = buildLineObject(loop.points, 0xffe600, true)
          line.position.sub(centre)
          scene.add(line)
          overlayObjs.push(line)
        })
      }
      if (showBreaklines && data.breaklines) {
        data.breaklines.forEach(bl => {
          const line = buildLineObject(bl.points, breaklineColor(bl.desc), false)
          line.position.sub(centre)
          scene.add(line)
          overlayObjs.push(line)
        })
      }
      if (showEnvelope && data.envelope) {
        const line = buildLineObject(data.envelope.points, 0xff00ff, true)
        line.position.sub(centre)
        scene.add(line)
        overlayObjs.push(line)
      }
      if (showChain && data.chain) {
        data.chain.loops.forEach(loop => {
          const line = buildLineObject(loop.points, 0x32cd32, true)
          line.position.sub(centre)
          scene.add(line)
          overlayObjs.push(line)
        })
        data.chain.open_chains.forEach(chain => {
          const line = buildLineObject(chain.points, 0xff8c00, false, true)
          line.position.sub(centre)
          scene.add(line)
          overlayObjs.push(line)
        })
        if (data.chain.gap_points.length) {
          const pts = buildPointsObject(data.chain.gap_points, 0xdc1414, 3)
          pts.position.sub(centre)
          scene.add(pts)
          overlayObjs.push(pts)
        }
        if (data.chain.branch_points.length) {
          const pts = buildPointsObject(data.chain.branch_points, 0xffa500, 4)
          pts.position.sub(centre)
          scene.add(pts)
          overlayObjs.push(pts)
        }
      }
    })

    if (savedCameraPos.current) {
      camera.position.copy(savedCameraPos.current)
      camera.lookAt(0, 0, 0)
    } else {
      camera.position.set(0, size * 0.6, size * 1.2)
      camera.lookAt(0, 0, 0)
    }

    const grid = new THREE.GridHelper(size * 1.3, 20, 0xb0b8b5, 0xd8dcda)
    grid.position.y = -size * 0.3; scene.add(grid)

    controlRef.current = makeOrbitControls(camera, canvas)

    let raf
    const animate = () => { raf = requestAnimationFrame(animate); renderer.render(scene, camera) }
    animate()

    return () => {
      savedCameraPos.current = camera.position.clone()
      cancelAnimationFrame(raf)
      renderer.dispose()
      objs.forEach(o => o.geometry.dispose())
      overlayObjs.forEach(o => o.geometry.dispose())
    }
  }, [meshes, showBoundary, showBreaklines, showEnvelope, showChain, showExtent, showTriangles, showElevationColor, showAngleQuality, overlayData, visible, isFullscreen])

  // Toggle per-mesh visibility
  const toggleVisible = (i) => setVisible(v => v.map((b, j) => j === i ? !b : b))

  const viewer = (
    <div className="relative">
      <div className="absolute top-2 right-2 z-10 flex gap-1.5">
        <button onClick={() => controlRef.current?.reset()} className="btn-secondary p-1.5" title="Reset camera">
          <RotateCcw className="w-4 h-4" />
        </button>
        <button
          onClick={() => setIsFullscreen(v => !v)}
          className="btn-secondary p-1.5"
          title={isFullscreen ? 'Exit full screen' : '3D Viewer — open full screen'}
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>

      <canvas ref={canvasRef} className="w-full rounded-lg border border-slate-200" style={{ display: 'block' }} />

      {/* Per-surface toggles */}
      <div className="flex flex-wrap gap-2 mt-3 px-2 items-center">
        {meshes.map((m, i) => (
          <button
            key={m.name}
            onClick={() => toggleVisible(i)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs transition-all bg-white
              ${visible[i]
                ? 'border-brand-500/50 text-slate-700'
                : 'border-slate-200 text-slate-400 line-through'}`}
            style={{ borderColor: visible[i] ? PALETTE[i] : undefined, color: visible[i] ? PALETTE[i] : undefined }}
          >
            {visible[i] ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            {m.name}
          </button>
        ))}

        {showOverlayControls && (
          <>
            <span className="w-px h-4 bg-slate-200 mx-1" />

            <button
              onClick={() => setShowBoundary(v => !v)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs transition-all
                ${showBoundary ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-500'}`}
            >
              {overlayLoading && showBoundary && <Loader2 className="w-3 h-3 animate-spin" />}
              Boundary
            </button>
            <button
              onClick={() => setShowBreaklines(v => !v)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs transition-all
                ${showBreaklines ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-500'}`}
            >
              {overlayLoading && showBreaklines && <Loader2 className="w-3 h-3 animate-spin" />}
              Breaklines
            </button>
            <button
              onClick={() => setShowEnvelope(v => !v)}
              title="Convex-hull envelope of all breakline points — the real survey data's outer extent"
              className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs transition-all
                ${showEnvelope ? 'border-fuchsia-400 bg-fuchsia-50 text-fuchsia-700' : 'border-slate-200 bg-white text-slate-500'}`}
            >
              {overlayLoading && showEnvelope && <Loader2 className="w-3 h-3 animate-spin" />}
              Data Envelope
            </button>
            <button
              onClick={() => setShowChain(v => !v)}
              title="Breaklines joined end-to-end into closed loops (solid green) / open chains (dashed orange), with dead-ends (red dots) and ambiguous branch points (orange dots) marked. Best-effort — gaps are reported, never guessed across."
              className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs transition-all
                ${showChain ? 'border-lime-500 bg-lime-50 text-lime-700' : 'border-slate-200 bg-white text-slate-500'}`}
            >
              {overlayLoading && showChain && <Loader2 className="w-3 h-3 animate-spin" />}
              Featureline Chain
            </button>
            <button
              onClick={() => setShowExtent(v => !v)}
              title="Axis-aligned bounding box (x_min/x_max/y_min/y_max) of the surface's points"
              className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs transition-all
                ${showExtent ? 'border-teal-400 bg-teal-50 text-teal-700' : 'border-slate-200 bg-white text-slate-500'}`}
            >
              Extent
            </button>
            <button
              onClick={() => {
                setShowTriangles(v => {
                  const next = !v
                  if (next) setShowElevationColor(false)   // deactivate elevation colour so edges stand out
                  return next
                })
              }}
              title="Raw triangle edges of the mesh — spot bad/spurious triangulation directly"
              className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs transition-all
                ${showTriangles ? 'border-slate-500 bg-slate-100 text-slate-800' : 'border-slate-200 bg-white text-slate-500'}`}
            >
              Triangles
            </button>
            <button
              onClick={() => {
                setShowElevationColor(v => {
                  const next = !v
                  if (next) setShowAngleQuality(false)   // mutually exclusive solid-fill colouring
                  return next
                })
              }}
              title="Colour the surface by elevation (Low→High gradient). Independent of Triangles — auto-off when Triangles is switched on, but toggle it back on any time."
              className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs transition-all
                ${showElevationColor ? 'border-brand-500/50 bg-brand-500/5 text-brand-600' : 'border-slate-200 bg-white text-slate-500'}`}
            >
              Elevation Color
            </button>
            <button
              onClick={() => {
                setShowAngleQuality(v => {
                  const next = !v
                  if (next) setShowElevationColor(false)   // mutually exclusive solid-fill colouring
                  return next
                })
              }}
              title="Colour each triangle by its minimum interior angle — red (~0°) flags thin 'sliver' triangles, green (40°+) is a healthy triangle shape. Can be combined with the Triangles wireframe."
              className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs transition-all
                ${showAngleQuality ? 'border-brand-500/50 bg-brand-500/5 text-brand-600' : 'border-slate-200 bg-white text-slate-500'}`}
            >
              Angle Quality
            </button>
          </>
        )}

        <span className="ml-auto text-xs text-slate-400 self-center">
          Left-drag = orbit · Right-drag = pan · Scroll = zoom
        </span>
      </div>

      {/* Elevation legend — only meaningful while elevation colouring is active */}
      {showElevationColor && (
        <div className="mt-2 px-2 flex items-center gap-2 text-xs text-slate-500">
          <span>Low</span>
          <div className="flex-1 h-3 rounded"
            style={{ background: 'linear-gradient(to right,#1f76f7,#00baba,#45bc45,#eddb18,#dc1414)' }} />
          <span>High elevation</span>
        </div>
      )}

      {/* Angle-quality legend — only meaningful while angle colouring is active */}
      {showAngleQuality && (
        <div className="mt-2 px-2 flex items-center gap-2 text-xs text-slate-500">
          <span>Sliver (~0°)</span>
          <div className="flex-1 h-3 rounded"
            style={{ background: 'linear-gradient(to right,#dc1414,#eddb18,#45bc45)' }} />
          <span>Healthy (40°+)</span>
        </div>
      )}
    </div>
  )

  if (!isFullscreen) return viewer

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) setIsFullscreen(false) }}
    >
      <div className="bg-white rounded-xl p-4 w-full h-full max-w-6xl overflow-auto shadow-2xl">
        {viewer}
      </div>
    </div>
  )
}

// Surface colour palette (same as SectionView)
const PALETTE = ['#3498db','#e74c3c','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#e91e8c']
