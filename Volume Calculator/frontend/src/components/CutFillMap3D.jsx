/**
 * CutFillMap3D — Three.js 3D surface viewer.
 * Renders ALL imported TIN meshes in one scene, colour-coded by elevation.
 * Props:
 *   meshes  — array of { name, vertices, faces, z_min, z_max, ... }
 */

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { RotateCcw, Eye, EyeOff } from 'lucide-react'

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
    spherical.radius = Math.max(0.1, spherical.radius * (1 + e.deltaY * 0.001))
    sync()
  }, { passive: true })
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

function buildGeo(meshData, zMin, zMax) {
  const { vertices, faces } = meshData
  const positions = new Float32Array(faces.length * 9)
  const colors    = new Float32Array(faces.length * 9)
  let pi = 0, ci = 0
  for (const [a,b,c] of faces) {
    for (const idx of [a,b,c]) {
      const [x,y,z] = vertices[idx]
      positions[pi++]=x; positions[pi++]=z; positions[pi++]=-y
      const col = elevColor(z, zMin, zMax)
      colors[ci++]=col.r; colors[ci++]=col.g; colors[ci++]=col.b
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions,3))
  geo.setAttribute('color',    new THREE.BufferAttribute(colors,3))
  geo.computeVertexNormals()
  return geo
}

export default function CutFillMap3D({ meshes }) {
  const canvasRef  = useRef(null)
  const objRefs    = useRef([])
  const controlRef = useRef(null)

  // visibility state per mesh index
  const [visible, setVisible] = useState(() => meshes.map(() => true))

  useEffect(() => {
    if (!canvasRef.current || !meshes?.length) return

    const canvas = canvasRef.current
    const W = canvas.parentElement.clientWidth || 700
    const H = Math.min(Math.max(W * 0.65, 300), 520)
    canvas.width = W; canvas.height = H

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.setSize(W, H); renderer.setPixelRatio(Math.min(window.devicePixelRatio,2))
    renderer.setClearColor(0x1a2332)

    const scene  = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, W/H, 0.1, 1e7)

    scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    const dir = new THREE.DirectionalLight(0xffffff, 0.8)
    dir.position.set(1,2,1); scene.add(dir)

    const gZMin = Math.min(...meshes.map(m => m.z_min))
    const gZMax = Math.max(...meshes.map(m => m.z_max))

    // Opacities: first mesh fully opaque, rest progressively more transparent
    const opacities = meshes.map((_, i) => Math.max(0.35, 1 - i * 0.25))

    const objs = meshes.map((m, i) => {
      const geo = buildGeo(m, gZMin, gZMax)
      const mat = new THREE.MeshLambertMaterial({
        vertexColors: true, side: THREE.DoubleSide,
        transparent: i > 0, opacity: opacities[i],
        depthWrite: i === 0,
      })
      const obj = new THREE.Mesh(geo, mat)
      scene.add(obj)
      return obj
    })
    objRefs.current = objs

    // Centre the scene
    const box = new THREE.Box3().setFromObject(objs[0])
    const centre = new THREE.Vector3(); box.getCenter(centre)
    const size   = box.getSize(new THREE.Vector3()).length()
    objs.forEach(o => o.position.sub(centre))

    camera.position.set(0, size * 0.6, size * 1.2)
    camera.lookAt(0,0,0)

    const grid = new THREE.GridHelper(size * 1.3, 20, 0x334155, 0x1e3040)
    grid.position.y = -size * 0.3; scene.add(grid)

    controlRef.current = makeOrbitControls(camera, canvas)

    let raf
    const animate = () => { raf = requestAnimationFrame(animate); renderer.render(scene, camera) }
    animate()

    return () => {
      cancelAnimationFrame(raf)
      renderer.dispose()
      objs.forEach(o => o.geometry.dispose())
    }
  }, [meshes])

  // Toggle per-mesh visibility
  useEffect(() => {
    objRefs.current.forEach((o, i) => { if (o) o.visible = visible[i] })
  }, [visible])

  const toggleVisible = (i) => setVisible(v => v.map((b, j) => j === i ? !b : b))

  return (
    <div className="relative">
      <div className="absolute top-2 right-2 z-10">
        <button onClick={() => controlRef.current?.reset()} className="btn-secondary p-1.5" title="Reset camera">
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      <canvas ref={canvasRef} className="w-full rounded-lg" style={{ display: 'block' }} />

      {/* Per-surface toggles */}
      <div className="flex flex-wrap gap-2 mt-3 px-2">
        {meshes.map((m, i) => (
          <button
            key={m.name}
            onClick={() => toggleVisible(i)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs transition-all
              ${visible[i]
                ? 'border-brand-500/50 text-slate-200'
                : 'border-slate-700 text-slate-500 line-through'}`}
            style={{ borderColor: visible[i] ? PALETTE[i] : undefined, color: visible[i] ? PALETTE[i] : undefined }}
          >
            {visible[i] ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            {m.name}
          </button>
        ))}
        <span className="ml-auto text-xs text-slate-500 self-center">
          Left-drag = orbit · Right-drag = pan · Scroll = zoom
        </span>
      </div>

      {/* Elevation legend */}
      <div className="mt-2 px-2 flex items-center gap-2 text-xs text-slate-400">
        <span>Low</span>
        <div className="flex-1 h-3 rounded"
          style={{ background: 'linear-gradient(to right,#1f76f7,#00baba,#45bc45,#eddb18,#dc1414)' }} />
        <span>High elevation</span>
      </div>
    </div>
  )
}

// Surface colour palette (same as SectionView)
const PALETTE = ['#3498db','#e74c3c','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#e91e8c']
