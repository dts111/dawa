import { useState, useCallback, useEffect } from 'react'
import MapView from './components/MapView'
import ClosurePanel from './components/ClosurePanel'
import RoutePanel from './components/RoutePanel'
import AssessmentPanel from './components/AssessmentPanel'
import ExportPanel from './components/ExportPanel'
import LibraryPanel from './components/LibraryPanel'
import { findNearestNode, previewClosureLine, getImpactedRoads } from './api/client'
import type { Closure, Diversion, Panel, ImpactedRoad } from './types'

const NAV: { id: Panel; label: string }[] = [
  { id: 'closure', label: 'Closure' },
  { id: 'routes', label: 'Routes' },
  { id: 'assessment', label: 'Assessment' },
  { id: 'library', label: 'Library' },
  { id: 'export', label: 'Export' },
]

type PickedNode = {
  node_id: number
  lng: number
  lat: number
  road_name: string | null
  road_type: string | null
  is_junction: boolean
}

export default function App() {
  const [panel, setPanel] = useState<Panel>('closure')
  const [activeClosure, setActiveClosure] = useState<Closure | null>(null)
  const [routes, setRoutes] = useState<Diversion[]>([])
  const [selectedRouteRank, setSelectedRouteRank] = useState<number | null>(null)
  const [pickingMode, setPickingMode] = useState<'start' | 'end' | null>(null)
  const [pickedStart, setPickedStart] = useState<PickedNode | null>(null)
  const [pickedEnd, setPickedEnd] = useState<PickedNode | null>(null)
  const [pickError, setPickError] = useState<string | null>(null)
  const [previewLine, setPreviewLine] = useState<GeoJSON.LineString | null>(null)
  const [impactedRoads, setImpactedRoads] = useState<ImpactedRoad[]>([])
  const [selectedImpactedIds, setSelectedImpactedIds] = useState<number[]>([])
  const [impactedClosures, setImpactedClosures] = useState<Closure[]>([])
  const [direction, setDirection] = useState('CW')
  useEffect(() => {
    if (!pickedStart || !pickedEnd) {
      setPreviewLine(null)
      setImpactedRoads([])
      setSelectedImpactedIds([])
      setImpactedClosures([])
      return
    }
    previewClosureLine(pickedStart.node_id, pickedEnd.node_id)
      .then(setPreviewLine)
      .catch(() => setPreviewLine(null))
    getImpactedRoads(pickedStart.node_id, pickedEnd.node_id)
      .then(roads => { setImpactedRoads(roads); setSelectedImpactedIds(roads.map(r => r.edge_id)) })
      .catch(() => { setImpactedRoads([]); setSelectedImpactedIds([]) })
  }, [pickedStart, pickedEnd])

  const handleClear = () => {
    setPickedStart(null)
    setPickedEnd(null)
    setPickingMode(null)
    setPickError(null)
    setActiveClosure(null)
    setRoutes([])
    setSelectedRouteRank(null)
    setImpactedClosures([])
    setPanel('closure')
  }

  const handleToggleImpacted = (id: number) =>
    setSelectedImpactedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  const impactedFeatures: GeoJSON.LineString[] =
    impactedClosures.length > 0
      ? impactedClosures.filter(c => c.geom_geojson).map(c => c.geom_geojson!)
      : impactedRoads.filter(r => selectedImpactedIds.includes(r.edge_id)).map(r => r.geojson)

  const handleMapClick = useCallback(async (lng: number, lat: number) => {
    if (!pickingMode) return
    setPickError(null)
    try {
      const node = await findNearestNode(lng, lat)
      const picked: PickedNode = {
        node_id: node.node_id,
        lng,
        lat,
        road_name: node.road_name,
        road_type: node.road_type,
        is_junction: node.is_junction,
      }
      if (pickingMode === 'start') setPickedStart(picked)
      else setPickedEnd(picked)
      setPickingMode(null)
    } catch (err: unknown) {
      setPickingMode(null)
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 404) {
        setPickError('No road network loaded. Run the OSM import first: docker compose exec backend python scripts/import_osm.py')
      } else {
        setPickError('Failed to find nearest node — check the backend is running.')
      }
    }
  }, [pickingMode])

  const handleClosureCreated = (closure: Closure, newRoutes: Diversion[], newImpactedClosures: Closure[]) => {
    const closureForMap: Closure = previewLine ? { ...closure, geom_geojson: previewLine as Closure['geom_geojson'] } : closure
    setActiveClosure(closureForMap)
    setRoutes(newRoutes)
    setImpactedClosures(newImpactedClosures)
    setImpactedRoads([])
    setSelectedImpactedIds([])
    setSelectedRouteRank(null)
    setPreviewLine(null)
    setPanel('routes')
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-nh-blue text-white flex items-center px-4 py-2.5 shadow-md shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xl font-black tracking-tight">M25</span>
          <div>
            <div className="text-sm font-semibold leading-none">TTRO Diversion Planner</div>
            <div className="text-xs text-blue-200 leading-none mt-0.5">M25 DBFO — Decision Support Tool</div>
          </div>
        </div>
        {activeClosure && (
          <div className="ml-6 text-xs bg-white/10 rounded px-2 py-1">
            Active: {activeClosure.start_junction || 'Node ' + activeClosure.start_node} → {activeClosure.end_junction || 'Node ' + activeClosure.end_node}
            {' '}<span className="opacity-70">{activeClosure.direction}</span>
          </div>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-80 bg-white border-r border-gray-200 flex flex-col shrink-0 overflow-hidden">
          {/* Tab nav */}
          <nav className="flex border-b border-gray-200 bg-gray-50">
            {NAV.map(n => (
              <button
                key={n.id}
                onClick={() => setPanel(n.id)}
                className={`flex-1 py-2 text-xs font-medium transition-colors ${
                  panel === n.id
                    ? 'text-nh-blue border-b-2 border-nh-blue bg-white'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {n.label}
              </button>
            ))}
          </nav>

          {/* Panel content */}
          <div className="flex-1 overflow-y-auto p-4">
            {panel === 'closure' && (
              <ClosurePanel
                onClosureCreated={handleClosureCreated}
                onPickStart={() => { setPickError(null); setPickingMode('start') }}
                onPickEnd={() => { setPickError(null); setPickingMode('end') }}
                onClear={handleClear}
                pickedStart={pickedStart}
                pickedEnd={pickedEnd}
                pickError={pickError}
                impactedRoads={impactedRoads}
                selectedImpactedIds={selectedImpactedIds}
                onToggleImpacted={handleToggleImpacted}
                previewLine={previewLine}
                direction={direction}
                onDirectionChange={setDirection}
              />
            )}
            {panel === 'routes' && (
              <RoutePanel
                routes={routes}
                selectedRouteRank={selectedRouteRank}
                onSelectRoute={setSelectedRouteRank}
                closureId={activeClosure?.id ?? null}
                direction={direction}
              />
            )}
            {panel === 'assessment' && (
              <AssessmentPanel routes={routes} selectedRouteRank={selectedRouteRank} />
            )}
            {panel === 'library' && (
              <LibraryPanel activeClosure={activeClosure} />
            )}
            {panel === 'export' && (
              <ExportPanel closureId={activeClosure?.id ?? null} />
            )}
          </div>
        </aside>

        {/* Map */}
        <main className="flex-1 relative">
          <MapView
            closure={activeClosure}
            routes={routes}
            selectedRouteRank={selectedRouteRank}
            onMapClick={handleMapClick}
            pickingMode={pickingMode}
            pickedStart={pickedStart}
            pickedEnd={pickedEnd}
            previewLine={previewLine}
            impactedFeatures={impactedFeatures}
            direction={direction}
          />
        </main>
      </div>
    </div>
  )
}
