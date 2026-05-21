import { useState, useCallback, useEffect } from 'react'
import MapView from './components/MapView'
import WorksPanel from './components/WorksPanel'
import RoutePanel from './components/RoutePanel'
import ConsultPanel from './components/ConsultPanel'
import DrawPanel from './components/DrawPanel'
import { fetchRoute, fetchClosure, fetchStakeholders, fetchDrawRoute } from './api'

const EMPTY_WORKS = { reference: '', startDate: '', endDate: '', description: '' }

export default function App() {
  const [appMode, setAppMode] = useState('m25') // 'm25' | 'draw'

  // ── M25 mode ──────────────────────────────────────────────────────
  const [markers, setMarkers] = useState({ start: null, end: null })
  const [activeMarker, setActiveMarker] = useState('start')
  const [worksInfo, setWorksInfo] = useState(EMPTY_WORKS)
  const [direction, setDirection] = useState('clockwise')
  const [closure, setClosure] = useState(null)
  const [routes, setRoutes] = useState(null)
  const [selectedRoute, setSelectedRoute] = useState(0)
  const [junctions, setJunctions] = useState(null)
  const [stakeholders, setStakeholders] = useState(null)
  const [loading, setLoading] = useState(false)
  const [stakeLoading, setStakeLoading] = useState(false)
  const [error, setError] = useState(null)

  // ── Draw mode ─────────────────────────────────────────────────────
  // drawStep: 'place-a' → 'place-b' → 'draw-closure' → 'ready'
  const [drawStep, setDrawStep] = useState('place-a')
  const [pinA, setPinA] = useState(null)           // {lat, lon}
  const [pinB, setPinB] = useState(null)           // {lat, lon}
  const [closurePoints, setClosurePoints] = useState([]) // [[lng, lat], ...]  GeoJSON order
  const [drawRoutes, setDrawRoutes] = useState(null)
  const [drawSelectedRoute, setDrawSelectedRoute] = useState(0)
  const [drawStakeholders, setDrawStakeholders] = useState(null)
  const [drawStakeLoading, setDrawStakeLoading] = useState(false)
  const [drawLoading, setDrawLoading] = useState(false)
  const [drawError, setDrawError] = useState(null)

  // ── M25 effects ───────────────────────────────────────────────────
  useEffect(() => {
    if (appMode !== 'm25' || !markers.start || !markers.end) {
      if (appMode === 'm25') { setClosure(null); setJunctions(null) }
      return
    }
    fetchClosure(markers.start, markers.end, direction).then((data) => {
      if (!data) return
      setClosure(data.closure)
      setJunctions({ exit: data.exit_junction, entry: data.entry_junction })
    })
  }, [markers.start, markers.end, direction, appMode])

  // ── Mode switch ───────────────────────────────────────────────────
  const handleModeSwitch = useCallback((mode) => {
    setAppMode(mode)
    if (mode === 'draw') {
      setDrawStep('place-a')
      setPinA(null); setPinB(null)
      setClosurePoints([])
      setDrawRoutes(null); setDrawStakeholders(null); setDrawError(null)
    }
  }, [])

  // ── M25 handlers ──────────────────────────────────────────────────
  const handleClear = useCallback(() => {
    setMarkers({ start: null, end: null })
    setActiveMarker('start')
    setClosure(null); setRoutes(null); setJunctions(null)
    setStakeholders(null); setError(null)
  }, [])

  const handleFindDiversion = async () => {
    if (!markers.start || !markers.end) {
      setError('Place both Works Start and Works End markers on the map first.')
      return
    }
    setLoading(true); setError(null)
    setRoutes(null); setJunctions(null); setStakeholders(null)
    try {
      const data = await fetchRoute(markers.start, markers.end, direction)
      setRoutes(data); setSelectedRoute(0)
      if (data.exit_junction && data.entry_junction)
        setJunctions({ exit: data.exit_junction, entry: data.entry_junction })
      loadM25Stakeholders(data.alternatives[0]?.geometry?.coordinates)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const loadM25Stakeholders = async (coordinates) => {
    if (!coordinates?.length) return
    setStakeLoading(true)
    try { setStakeholders(await fetchStakeholders(coordinates)) }
    catch (e) { console.error('Stakeholders error:', e) }
    finally { setStakeLoading(false) }
  }

  const handleSelectRoute = (index) => {
    setSelectedRoute(index); setStakeholders(null)
    loadM25Stakeholders(routes?.alternatives?.[index]?.geometry?.coordinates)
  }

  // ── Draw mode handlers ────────────────────────────────────────────
  const handleDrawClear = useCallback(() => {
    setDrawStep('place-a')
    setPinA(null); setPinB(null); setClosurePoints([])
    setDrawRoutes(null); setDrawStakeholders(null); setDrawError(null)
  }, [])

  const handleDrawUndo = useCallback(() => {
    setClosurePoints((prev) => prev.slice(0, -1))
  }, [])

  const handleDrawFinish = useCallback(() => {
    if (closurePoints.length >= 2) setDrawStep('ready')
  }, [closurePoints.length])

  const handleDrawCalculate = async () => {
    if (!pinA || !pinB || closurePoints.length < 2) return
    // Implicitly finish drawing if still in draw-closure step
    if (drawStep === 'draw-closure') setDrawStep('ready')
    setDrawLoading(true); setDrawError(null)
    setDrawRoutes(null); setDrawStakeholders(null)
    const closureGeoJSON = { type: 'LineString', coordinates: closurePoints }
    try {
      const data = await fetchDrawRoute(pinA, pinB, closureGeoJSON)
      setDrawRoutes(data); setDrawSelectedRoute(0)
      loadDrawStakeholders(data.alternatives[0]?.geometry?.coordinates)
    } catch (e) {
      setDrawError(e.message)
    } finally {
      setDrawLoading(false)
    }
  }

  const loadDrawStakeholders = async (coordinates) => {
    if (!coordinates?.length) return
    setDrawStakeLoading(true)
    try { setDrawStakeholders(await fetchStakeholders(coordinates)) }
    catch (e) { console.error('Stakeholders error:', e) }
    finally { setDrawStakeLoading(false) }
  }

  const handleDrawSelectRoute = (index) => {
    setDrawSelectedRoute(index); setDrawStakeholders(null)
    loadDrawStakeholders(drawRoutes?.alternatives?.[index]?.geometry?.coordinates)
  }

  // ── Unified map click ─────────────────────────────────────────────
  const handleMapClick = useCallback((lat, lng, forceKey) => {
    if (appMode === 'draw') {
      // forceKey 'pin-a' / 'pin-b' comes from pin drag-end events
      if (forceKey === 'pin-a') { setPinA({ lat, lon: lng }); return }
      if (forceKey === 'pin-b') { setPinB({ lat, lon: lng }); return }
      if (drawStep === 'place-a') { setPinA({ lat, lon: lng }); setDrawStep('place-b') }
      else if (drawStep === 'place-b') { setPinB({ lat, lon: lng }); setDrawStep('draw-closure') }
      else if (drawStep === 'draw-closure') { setClosurePoints((prev) => [...prev, [lng, lat]]) }
    } else {
      const key = forceKey ?? activeMarker
      setMarkers((prev) => ({ ...prev, [key]: { lat, lon: lng } }))
      if (!forceKey && activeMarker === 'start') setActiveMarker('end')
    }
  }, [appMode, drawStep, activeMarker])

  // Crosshair cursor whenever the map click does something meaningful
  const cursorCrosshair = appMode === 'draw'
    ? drawStep !== 'ready'
    : !!activeMarker

  const mapHint = appMode === 'draw'
    ? drawStep === 'place-a' ? 'Click map — place Route Start (A)'
    : drawStep === 'place-b' ? 'Click map — place Route End (B)'
    : drawStep === 'draw-closure' ? 'Click to add points to the closure line'
    : null
    : activeMarker === 'start' ? 'Click map — Works Start location'
    : activeMarker === 'end'  ? 'Click map — Works End location'
    : null

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <div className="flex-1 relative">
        {mapHint && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-white border border-gray-200 rounded-full px-4 py-1.5 text-xs font-semibold text-gray-600 shadow-sm pointer-events-none">
            {mapHint}
          </div>
        )}
        <MapView
          markers={appMode === 'm25' ? markers : { start: null, end: null }}
          junctions={appMode === 'm25' ? junctions : null}
          closure={appMode === 'm25' ? closure : null}
          routes={appMode === 'm25' ? routes : null}
          selectedRoute={selectedRoute}
          activeMarker={appMode === 'm25' ? activeMarker : null}
          drawData={appMode === 'draw' ? {
            pinA, pinB, closurePoints,
            routes: drawRoutes,
            selectedRoute: drawSelectedRoute,
          } : null}
          cursorCrosshair={cursorCrosshair}
          onMapClick={handleMapClick}
        />
      </div>

      <div className="w-96 flex-shrink-0 flex flex-col overflow-y-auto border-l border-gray-200 bg-white shadow-xl">
        {/* Mode tabs */}
        <div className="flex border-b border-gray-200 flex-shrink-0">
          {[['m25', 'M25 Planner'], ['draw', 'Draw Closure']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => handleModeSwitch(key)}
              className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${
                appMode === key
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {appMode === 'm25' && (
          <>
            <WorksPanel
              worksInfo={worksInfo} markers={markers} junctions={junctions}
              direction={direction} activeMarker={activeMarker} loading={loading} error={error}
              onWorksInfoChange={setWorksInfo} onDirectionChange={setDirection}
              onActiveMarkerChange={setActiveMarker} onFindDiversion={handleFindDiversion}
              onClear={handleClear}
            />
            {routes && (
              <RoutePanel
                direct={routes.direct} alternatives={routes.alternatives}
                selectedRoute={selectedRoute} onSelectRoute={handleSelectRoute}
              />
            )}
            {(stakeholders || stakeLoading) && (
              <ConsultPanel
                stakeholders={stakeholders ?? { councils: [], police: [], ambulance: [], fire: [], areas: [] }}
                loading={stakeLoading}
              />
            )}
          </>
        )}

        {appMode === 'draw' && (
          <>
            <DrawPanel
              drawStep={drawStep} pinA={pinA} pinB={pinB}
              closurePoints={closurePoints} loading={drawLoading} error={drawError}
              onFinishDrawing={handleDrawFinish} onUndo={handleDrawUndo}
              onClear={handleDrawClear} onCalculate={handleDrawCalculate}
            />
            {drawRoutes && (
              <RoutePanel
                direct={null} alternatives={drawRoutes.alternatives}
                selectedRoute={drawSelectedRoute} onSelectRoute={handleDrawSelectRoute}
              />
            )}
            {(drawStakeholders || drawStakeLoading) && (
              <ConsultPanel
                stakeholders={drawStakeholders ?? { councils: [], police: [], ambulance: [], fire: [], areas: [] }}
                loading={drawStakeLoading}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
