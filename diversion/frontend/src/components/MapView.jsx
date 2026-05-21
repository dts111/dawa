import { useCallback, useEffect, useRef, useState } from 'react'
import Map, { Marker, Source, Layer, NavigationControl } from 'react-map-gl/maplibre'
import { M25_JUNCTIONS } from '../junctions'
import M25_TRACK from '../m25_track.json'

const ROADS_STYLE = 'https://tiles.openfreemap.org/styles/liberty'

const SATELLITE_STYLE = {
  version: 8,
  sources: {
    satellite: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagery &copy; Esri',
    },
  },
  layers: [{ id: 'satellite-layer', type: 'raster', source: 'satellite' }],
}

const ROUTE_COLORS = ['#3b82f6', '#22c55e', '#f59e0b']

const closureCasingStyle = {
  id: 'closure-casing',
  type: 'line',
  paint: { 'line-color': '#fca5a5', 'line-width': 18, 'line-cap': 'round', 'line-join': 'round' },
}
const closureLineStyle = {
  id: 'closure-line',
  type: 'line',
  paint: { 'line-color': '#dc2626', 'line-width': 10, 'line-cap': 'round', 'line-join': 'round' },
}

// Drawn closure line styles (dashed, slightly thinner — indicates user-drawn, not computed)
const drawnCasingStyle = {
  id: 'drawn-casing',
  type: 'line',
  paint: { 'line-color': '#fca5a5', 'line-width': 14, 'line-cap': 'round', 'line-join': 'round' },
}
const drawnLineStyle = {
  id: 'drawn-line',
  type: 'line',
  paint: {
    'line-color': '#dc2626',
    'line-width': 6,
    'line-cap': 'round',
    'line-join': 'round',
    'line-dasharray': [2, 1.5],
  },
}

function M25JunctionPin({ id, name }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'default' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{
        background: '#003189', color: 'white', fontSize: '9px', fontWeight: '800',
        padding: '2px 5px', borderRadius: '3px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
        whiteSpace: 'nowrap', userSelect: 'none', letterSpacing: '0.3px',
      }}>
        {id}
      </div>
      {hovered && (
        <div style={{
          position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
          background: '#1e3a5f', color: 'white', fontSize: '10px', fontWeight: '600',
          padding: '3px 7px', borderRadius: '4px', whiteSpace: 'nowrap',
          boxShadow: '0 2px 6px rgba(0,0,0,0.4)', marginBottom: '4px',
          pointerEvents: 'none',
        }}>
          {name}
        </div>
      )}
    </div>
  )
}

function JunctionMarker({ label }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{
        background: '#ea580c', color: 'white', fontSize: '10px', fontWeight: '700',
        padding: '2px 6px', borderRadius: '3px', boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
        whiteSpace: 'nowrap', userSelect: 'none',
      }}>
        {label}
      </div>
      <div style={{
        width: '10px', height: '10px', background: '#ea580c',
        transform: 'rotate(45deg)', marginTop: '-3px', boxShadow: '1px 1px 3px rgba(0,0,0,0.3)',
      }} />
    </div>
  )
}

function PinMarker({ label, color }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'grab' }}>
      <div style={{
        background: color, color: 'white', fontSize: '10px', fontWeight: '700',
        padding: '2px 6px', borderRadius: '3px', boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
        whiteSpace: 'nowrap', userSelect: 'none',
      }}>
        {label}
      </div>
      <div style={{
        width: '10px', height: '10px', background: color,
        transform: 'rotate(45deg)', marginTop: '-3px', boxShadow: '1px 1px 3px rgba(0,0,0,0.3)',
      }} />
    </div>
  )
}

export default function MapView({
  // M25 mode props
  markers, junctions, closure, routes, selectedRoute, activeMarker,
  // Draw mode props
  drawData,
  // Shared
  cursorCrosshair, onMapClick,
}) {
  const mapRef = useRef()
  const [satellite, setSatellite] = useState(false)

  // Right-click drag to pan
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map) return

    map.dragRotate.disable()

    let dragging = false, lastX = 0, lastY = 0

    const onDown = (e) => { if (e.button !== 2) return; dragging = true; lastX = e.clientX; lastY = e.clientY }
    const onMove = (e) => {
      if (!dragging) return
      map.panBy([lastX - e.clientX, lastY - e.clientY], { animate: false })
      lastX = e.clientX; lastY = e.clientY
    }
    const onUp   = (e) => { if (e.button === 2) dragging = false }
    const noCtx  = (e) => e.preventDefault()

    const container = map.getContainer()
    container.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    container.addEventListener('contextmenu', noCtx)

    return () => {
      container.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      container.removeEventListener('contextmenu', noCtx)
    }
  }, [mapRef.current])  // eslint-disable-line react-hooks/exhaustive-deps

  const handleClick = useCallback((e) => {
    onMapClick(e.lngLat.lat, e.lngLat.lng)
  }, [onMapClick])

  // Build GeoJSON for the live-drawn closure line
  const drawnLineGeoJSON = drawData?.closurePoints?.length >= 2
    ? { type: 'Feature', geometry: { type: 'LineString', coordinates: drawData.closurePoints }, properties: {} }
    : null

  const drawRoutes   = drawData?.routes?.alternatives
  const drawSelected = drawData?.selectedRoute ?? 0

  // Coord log entries
  const m25HasCoords = markers?.start || markers?.end || junctions?.exit || junctions?.entry
  const drawHasCoords = drawData?.pinA || drawData?.pinB

  return (
    <div className="relative w-full h-full">
      <Map
        ref={mapRef}
        mapStyle={satellite ? SATELLITE_STYLE : ROADS_STYLE}
        initialViewState={{ longitude: -0.42, latitude: 51.45, zoom: 9 }}
        style={{ width: '100%', height: '100%' }}
        onClick={handleClick}
        cursor={cursorCrosshair ? 'crosshair' : 'grab'}
      >
        <NavigationControl position="top-right" showCompass={false} />

        {/* ── M25 road track (always visible) ────────────────────── */}
        <Source id="m25-track" type="geojson" data={M25_TRACK}>
          <Layer
            id="m25-track-casing"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': '#1e3a5f', 'line-width': 8, 'line-opacity': 0.9 }}
          />
          <Layer
            id="m25-track-line"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': '#60a5fa', 'line-width': 4, 'line-opacity': 1 }}
          />
        </Source>

        {/* ── M25 background junction labels (always visible) ────── */}
        {M25_JUNCTIONS.map((jct) => (
          <Marker key={jct.id} longitude={jct.lon} latitude={jct.lat} anchor="center">
            <M25JunctionPin id={jct.id} name={jct.name} />
          </Marker>
        ))}

        {/* ── M25 mode layers ─────────────────────────────────────── */}
        {markers?.start && (
          <Marker
            longitude={markers.start.lon} latitude={markers.start.lat}
            anchor="bottom" draggable
            onDragEnd={(e) => onMapClick(e.lngLat.lat, e.lngLat.lng, 'start')}
          >
            <PinMarker label="WORKS START" color="#dc2626" />
          </Marker>
        )}
        {markers?.end && (
          <Marker
            longitude={markers.end.lon} latitude={markers.end.lat}
            anchor="bottom" draggable
            onDragEnd={(e) => onMapClick(e.lngLat.lat, e.lngLat.lng, 'end')}
          >
            <PinMarker label="WORKS END" color="#991b1b" />
          </Marker>
        )}
        {junctions?.exit && (
          <Marker longitude={junctions.exit.lon} latitude={junctions.exit.lat} anchor="bottom">
            <JunctionMarker label={`EXIT ${junctions.exit.id}`} />
          </Marker>
        )}
        {junctions?.entry && (
          <Marker longitude={junctions.entry.lon} latitude={junctions.entry.lat} anchor="bottom">
            <JunctionMarker label={`ENTRY ${junctions.entry.id}`} />
          </Marker>
        )}
        {routes?.alternatives?.map((route, i) => (
          <Source key={`alt-${i}`} id={`alt-${i}`} type="geojson" data={route.geometry}>
            <Layer
              id={`alt-line-${i}`}
              type="line"
              paint={{
                'line-color': ROUTE_COLORS[i] ?? '#6366f1',
                'line-width': i === selectedRoute ? 6 : 3,
                'line-opacity': i === selectedRoute ? 1 : 0.45,
              }}
            />
          </Source>
        ))}
        {closure && (
          <Source id="closure" type="geojson" data={{ type: 'Feature', geometry: closure, properties: {} }}>
            <Layer {...closureCasingStyle} />
            <Layer {...closureLineStyle} />
          </Source>
        )}

        {/* ── Draw mode layers ─────────────────────────────────────── */}
        {drawData?.pinA && (
          <Marker
            longitude={drawData.pinA.lon} latitude={drawData.pinA.lat}
            anchor="bottom" draggable
            onDragEnd={(e) => onMapClick(e.lngLat.lat, e.lngLat.lng, 'pin-a')}
          >
            <PinMarker label="A  START" color="#16a34a" />
          </Marker>
        )}
        {drawData?.pinB && (
          <Marker
            longitude={drawData.pinB.lon} latitude={drawData.pinB.lat}
            anchor="bottom" draggable
            onDragEnd={(e) => onMapClick(e.lngLat.lat, e.lngLat.lng, 'pin-b')}
          >
            <PinMarker label="B  END" color="#dc2626" />
          </Marker>
        )}
        {drawnLineGeoJSON && (
          <Source id="drawn-closure" type="geojson" data={drawnLineGeoJSON}>
            <Layer {...drawnCasingStyle} />
            <Layer {...drawnLineStyle} />
          </Source>
        )}
        {drawRoutes?.map((route, i) => (
          <Source key={`draw-alt-${i}`} id={`draw-alt-${i}`} type="geojson" data={route.geometry}>
            <Layer
              id={`draw-alt-line-${i}`}
              type="line"
              paint={{
                'line-color': ROUTE_COLORS[i] ?? '#6366f1',
                'line-width': i === drawSelected ? 6 : 3,
                'line-opacity': i === drawSelected ? 1 : 0.45,
              }}
            />
          </Source>
        ))}
      </Map>

      {/* Satellite / Roads toggle */}
      <button
        onClick={() => setSatellite((s) => !s)}
        className="absolute bottom-8 left-3 z-10 bg-white border border-gray-300 rounded shadow px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
      >
        {satellite ? 'Roads' : 'Satellite'}
      </button>

      {/* Coordinate Log */}
      {(m25HasCoords || drawHasCoords) && (
        <div className="absolute bottom-16 right-3 z-10 bg-white border border-gray-200 rounded shadow-lg p-3 text-xs font-mono min-w-[260px]">
          <div className="font-bold text-gray-600 mb-2 text-xs uppercase tracking-wide border-b border-gray-100 pb-1">
            Coordinate Log
          </div>
          <table className="w-full border-collapse">
            <tbody>
              {markers?.start && (
                <tr>
                  <td className="text-red-600 font-semibold pr-3 py-0.5 whitespace-nowrap">Works Start</td>
                  <td className="text-gray-700">{markers.start.lat.toFixed(6)}, {markers.start.lon.toFixed(6)}</td>
                </tr>
              )}
              {markers?.end && (
                <tr>
                  <td className="text-red-900 font-semibold pr-3 py-0.5 whitespace-nowrap">Works End</td>
                  <td className="text-gray-700">{markers.end.lat.toFixed(6)}, {markers.end.lon.toFixed(6)}</td>
                </tr>
              )}
              {junctions?.exit && (
                <tr>
                  <td className="text-orange-600 font-semibold pr-3 py-0.5 whitespace-nowrap">Exit {junctions.exit.id}</td>
                  <td className="text-gray-700">{junctions.exit.lat.toFixed(6)}, {junctions.exit.lon.toFixed(6)}</td>
                </tr>
              )}
              {junctions?.entry && (
                <tr>
                  <td className="text-orange-600 font-semibold pr-3 py-0.5 whitespace-nowrap">Entry {junctions.entry.id}</td>
                  <td className="text-gray-700">{junctions.entry.lat.toFixed(6)}, {junctions.entry.lon.toFixed(6)}</td>
                </tr>
              )}
              {drawData?.pinA && (
                <tr>
                  <td className="text-green-700 font-semibold pr-3 py-0.5 whitespace-nowrap">A  Start</td>
                  <td className="text-gray-700">{drawData.pinA.lat.toFixed(6)}, {drawData.pinA.lon.toFixed(6)}</td>
                </tr>
              )}
              {drawData?.pinB && (
                <tr>
                  <td className="text-red-600 font-semibold pr-3 py-0.5 whitespace-nowrap">B  End</td>
                  <td className="text-gray-700">{drawData.pinB.lat.toFixed(6)}, {drawData.pinB.lon.toFixed(6)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
