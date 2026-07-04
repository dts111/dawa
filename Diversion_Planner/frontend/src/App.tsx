import { useState, useCallback, useEffect } from 'react'
import MapView from './components/MapView'
import ClosurePanel from './components/ClosurePanel'
import RoutePanel from './components/RoutePanel'
import AssessmentPanel from './components/AssessmentPanel'
import ExportPanel from './components/ExportPanel'
import LibraryPanel from './components/LibraryPanel'
import { findNearestNode, previewClosureLine, getImpactedRoads } from './api/client'
import { snapToTrack, type GeoJSONData } from './geo'
import { M25_JUNCTIONS, bearingBetween } from './junctions'
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
  const [m25Track, setM25Track] = useState<GeoJSONData>(null)
  useEffect(() => {
    fetch('/m25_track.json').then(r => r.json()).then(setM25Track).catch(console.error)
  }, [])
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

  const handleJunctionPick = useCallback(async (which: 'start' | 'end', pickedId: string, otherId: string) => {
    const picked = M25_JUNCTIONS.find(j => j.id === pickedId)
    if (!picked) return
    setPickError(null)

    const resolveOne = async (target: 'start' | 'end', lat: number, lon: number, bearing?: number) => {
      // Junction coordinates in junctions.ts are approximate interchange centers,
      // not exact points on the carriageway — snap onto the M25 track first so we
      // pick a node actually on the M25, not a nearby slip road or A-road. The
      // bearing (when known) further disambiguates the CW/ACW carriageway, since
      // they run close enough together that distance alone isn't reliable.
      const [snapLng, snapLat] = snapToTrack(lat, lon, m25Track)
      const node = await findNearestNode(snapLng, snapLat, bearing)
      const result: PickedNode = {
        node_id: node.node_id,
        lng: snapLng,
        lat: snapLat,
        road_name: node.road_name,
        road_type: node.road_type,
        is_junction: node.is_junction,
      }
      if (target === 'start') setPickedStart(result)
      else setPickedEnd(result)
    }

    try {
      const other = M25_JUNCTIONS.find(j => j.id === otherId)
      if (other) {
        // Both junctions now known — compute the actual travel bearing between
        // them and re-resolve BOTH points with it, since whichever was picked
        // first had no bearing hint yet and may have landed on the wrong carriageway.
        const startJ = which === 'start' ? picked : other
        const endJ = which === 'start' ? other : picked
        const bearing = bearingBetween(startJ.lat, startJ.lon, endJ.lat, endJ.lon)
        await resolveOne('start', startJ.lat, startJ.lon, bearing)
        await resolveOne('end', endJ.lat, endJ.lon, bearing)
      } else {
        await resolveOne(which, picked.lat, picked.lon)
      }
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 404) {
        setPickError('No road network loaded. Run the OSM import first: docker compose exec backend python scripts/import_osm.py')
      } else {
        setPickError('Failed to find nearest node — check the backend is running.')
      }
    }
  }, [m25Track])

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
                onPickJunction={handleJunctionPick}
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
