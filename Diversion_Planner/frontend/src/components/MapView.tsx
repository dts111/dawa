import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Closure, Diversion } from '../types'
import { M25_JUNCTIONS } from '../junctions'
import { snapToTrack, type GeoJSONData } from '../geo'

type PickedNode = {
  node_id: number
  lng: number
  lat: number
  road_name: string | null
  road_type: string | null
  is_junction: boolean
}

interface Props {
  closure: Closure | null
  routes: Diversion[]
  selectedRouteRank: number | null
  onMapClick: (lng: number, lat: number) => void
  pickingMode: 'start' | 'end' | null
  pickedStart: PickedNode | null
  pickedEnd: PickedNode | null
  previewLine: GeoJSON.LineString | null
  impactedFeatures: GeoJSON.LineString[]
  direction: string
}

const DIRECTION_LABELS: Record<string, string> = { CW: 'Clockwise (CW)', ACW: 'Anticlockwise (ACW)', 'N/A': 'N/A' }

function markerPopupHtml(node: PickedNode, direction: string): string {
  const roadName = node.road_name ?? 'Unknown road'
  const roadKind = node.is_junction ? 'Junction' : 'Main road'
  return `
    <div style="font-size:12px;line-height:1.5;min-width:160px;">
      <div style="font-weight:700;margin-bottom:2px;">${roadName}</div>
      <div>Direction: <strong>${DIRECTION_LABELS[direction] ?? direction}</strong></div>
      <div>${roadKind}${node.road_type ? ` &middot; ${node.road_type.replace(/_/g, ' ')}` : ''}</div>
      <div style="color:#6b7280;margin-top:2px;">${node.lat.toFixed(5)}, ${node.lng.toFixed(5)}</div>
    </div>
  `
}


const ROUTE_COLORS: Record<number, string> = { 1: '#16a34a', 2: '#2563eb', 3: '#eab308' }
const ROUTE_WIDTHS: Record<number, number> = { 1: 6, 2: 4, 3: 4 }

const ROADS_STYLE = 'https://tiles.openfreemap.org/styles/liberty'

const SATELLITE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    'esri-satellite': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
    },
  },
  layers: [{ id: 'esri-satellite', type: 'raster', source: 'esri-satellite' }],
}


export default function MapView({ closure, routes, selectedRouteRank, onMapClick, pickingMode, pickedStart, pickedEnd, previewLine, impactedFeatures, direction }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [satellite, setSatellite] = useState(true)
  const [layers, setLayers] = useState({ m25: true, aroads: true, motorways: true, links: true, junctions: true, diversions: true, closure: true, impacted: true })
  const layersRef = useRef({ m25: true, aroads: true, motorways: true, links: true, junctions: true, diversions: true, closure: true, impacted: true })
  layersRef.current = layers
  const onMapClickRef = useRef(onMapClick)
  onMapClickRef.current = onMapClick
  const [zoomBoxMode, setZoomBoxMode] = useState(false)
  const zoomBoxModeRef = useRef(false)
  zoomBoxModeRef.current = zoomBoxMode
  const zoomBoxStartRef = useRef<{ x: number; y: number } | null>(null)
  const zoomBoxElRef = useRef<HTMLDivElement | null>(null)
  const junctionMarkersRef = useRef<maplibregl.Marker[]>([])
  const startMarkerRef = useRef<maplibregl.Marker | null>(null)
  const endMarkerRef = useRef<maplibregl.Marker | null>(null)
  const orsMarkersRef = useRef<maplibregl.Marker[]>([])
  const prevRoutesLenRef = useRef(0)
  const previewLineRef = useRef<GeoJSON.LineString | null>(null)
  previewLineRef.current = previewLine
  const impactedFeaturesRef = useRef<GeoJSON.LineString[]>([])
  impactedFeaturesRef.current = impactedFeatures
  const directionRef = useRef(direction)
  directionRef.current = direction

  // Track data loaded from JSON files
  const [m25Track, setM25Track] = useState<GeoJSONData>(null)
  const [a217Track, setA217Track] = useState<GeoJSONData>(null)
  const [motorwaysTrack, setMotorwaysTrack] = useState<GeoJSONData>(null)

  // Keep latest props in refs so style-reload handler can access current data
  const closureRef = useRef(closure)
  const routesRef = useRef(routes)
  const selectedRef = useRef(selectedRouteRank)
  closureRef.current = closure
  routesRef.current = routes
  selectedRef.current = selectedRouteRank

  const [interchangeLinks, setInterchangeLinks] = useState<GeoJSONData>(null)
  const interchangeLinksRef = useRef<GeoJSONData>(null)
  interchangeLinksRef.current = interchangeLinks

  // Load DBFO network GeoJSON files once
  useEffect(() => {
    fetch('/m25_track.json').then(r => r.json()).then(setM25Track).catch(console.error)
    fetch('/a217_track.json').then(r => r.json()).then(setA217Track).catch(console.error)
    fetch('/motorways_track.json').then(r => r.json()).then(setMotorwaysTrack).catch(console.error)
    fetch('/interchange_links.json')
      .then(r => r.json())
      .then(d => { console.log('interchange-links loaded:', d.features?.length, 'features'); setInterchangeLinks(d) })
      .catch(e => console.error('interchange-links fetch failed:', e))
  }, [])

  const addCustomLayers = (map: maplibregl.Map) => {
    // DBFO network — M25
    map.addSource('m25-track', { type: 'geojson', data: m25TrackRef.current ?? { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'm25-casing', type: 'line', source: 'm25-track', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1e3a5f', 'line-width': 8, 'line-opacity': 0.9 } })
    map.addLayer({ id: 'm25-line', type: 'line', source: 'm25-track', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#3b82f6', 'line-width': 4, 'line-opacity': 1 } })

    // DBFO network — A-roads
    map.addSource('a217-track', { type: 'geojson', data: a217TrackRef.current ?? { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'a217-casing', type: 'line', source: 'a217-track', filter: ['!=', ['get', 'name'], 'A-road Roundabout'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#14532d', 'line-width': 6, 'line-opacity': 0.9 } })
    map.addLayer({ id: 'a217-line', type: 'line', source: 'a217-track', filter: ['!=', ['get', 'name'], 'A-road Roundabout'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#4ade80', 'line-width': 3, 'line-opacity': 1 } })

    // DBFO network — connecting motorways
    map.addSource('motorways-track', { type: 'geojson', data: motorwaysTrackRef.current ?? { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'motorways-casing', type: 'line', source: 'motorways-track', filter: ['!=', ['get', 'name'], 'Connecting Motorway Roundabout'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#6b21a8', 'line-width': 6, 'line-opacity': 0.9 } })
    map.addLayer({ id: 'motorways-line', type: 'line', source: 'motorways-track', filter: ['!=', ['get', 'name'], 'Connecting Motorway Roundabout'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#c084fc', 'line-width': 3, 'line-opacity': 1 } })

    // Interchange slip roads (gap-fill)
    map.addSource('interchange-links', { type: 'geojson', data: interchangeLinksRef.current ?? { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'links-casing', type: 'line', source: 'interchange-links', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1e3a5f', 'line-width': 7, 'line-opacity': 1 } })
    map.addLayer({ id: 'links-line', type: 'line', source: 'interchange-links', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#3b82f6', 'line-width': 4, 'line-opacity': 1 } })

    // Closure section preview (shown while picking nodes, before closure is created)
    const previewData: GeoJSON.FeatureCollection = previewLineRef.current
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: previewLineRef.current, properties: {} }] }
      : { type: 'FeatureCollection', features: [] }
    map.addSource('preview-closure', { type: 'geojson', data: previewData })
    map.addLayer({ id: 'preview-casing', type: 'line', source: 'preview-closure', paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.8 } })
    map.addLayer({ id: 'preview-line', type: 'line', source: 'preview-closure', paint: { 'line-color': '#dc2626', 'line-width': 4, 'line-dasharray': [6, 3] } })

    // Impacted roads (slip roads, circulatories, connecting links that touch the closure)
    const impactedData: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: impactedFeaturesRef.current.map(g => ({ type: 'Feature' as const, geometry: g, properties: {} })),
    }
    map.addSource('impacted-roads', { type: 'geojson', data: impactedData })
    map.addLayer({ id: 'impacted-casing', type: 'line', source: 'impacted-roads', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.7 } })
    map.addLayer({ id: 'impacted-line', type: 'line', source: 'impacted-roads', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#f97316', 'line-width': 4, 'line-dasharray': [5, 3] } })

    // Closure and diversion route layers (on top)
    map.addSource('closure', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'closure-casing', type: 'line', source: 'closure', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 16, 'line-opacity': 0.85 } })
    map.addLayer({ id: 'closure-line', type: 'line', source: 'closure', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#dc2626', 'line-width': 10 } })

    for (const rank of [1, 2, 3]) {
      map.addSource(`route-${rank}`, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: `route-${rank}-line`, type: 'line', source: `route-${rank}`, paint: { 'line-color': ROUTE_COLORS[rank], 'line-width': ROUTE_WIDTHS[rank], 'line-opacity': 0.9 } })
    }

    applyData(map, closureRef.current, routesRef.current, selectedRef.current)
    applyLayerVisibility(map, layersRef.current)
  }

  // Refs so addCustomLayers can read latest GeoJSON after async fetch
  const m25TrackRef = useRef<GeoJSONData>(null)
  const a217TrackRef = useRef<GeoJSONData>(null)
  const motorwaysTrackRef = useRef<GeoJSONData>(null)
  m25TrackRef.current = m25Track
  a217TrackRef.current = a217Track
  motorwaysTrackRef.current = motorwaysTrack

  // Push fetched data into existing map sources
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    ;(map.getSource('m25-track') as maplibregl.GeoJSONSource | undefined)?.setData(m25Track ?? { type: 'FeatureCollection', features: [] })
    // Re-snap markers now that we have accurate track data
    if (m25Track) addJunctionMarkers(map)
  }, [m25Track])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    ;(map.getSource('a217-track') as maplibregl.GeoJSONSource | undefined)?.setData(a217Track ?? { type: 'FeatureCollection', features: [] })
  }, [a217Track])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    ;(map.getSource('motorways-track') as maplibregl.GeoJSONSource | undefined)?.setData(motorwaysTrack ?? { type: 'FeatureCollection', features: [] })
  }, [motorwaysTrack])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    ;(map.getSource('interchange-links') as maplibregl.GeoJSONSource | undefined)?.setData(interchangeLinks ?? { type: 'FeatureCollection', features: [] })
  }, [interchangeLinks])

  // Start/End pick markers — snap to preview line endpoints when available
  useEffect(() => {
    startMarkerRef.current?.remove()
    startMarkerRef.current = null
    if (!pickedStart || !mapRef.current) return
    const el = document.createElement('div')
    el.style.cssText = 'background:#16a34a;color:#fff;font-size:11px;font-weight:700;padding:3px 8px;border-radius:4px;box-shadow:0 2px 4px rgba(0,0,0,0.4);white-space:nowrap;cursor:default;'
    el.textContent = '🚩 Start'
    const [lng, lat] = [pickedStart.lng, pickedStart.lat]
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 })
    el.addEventListener('mouseenter', () => {
      popup.setLngLat([lng, lat]).setHTML(markerPopupHtml(pickedStart, directionRef.current)).addTo(mapRef.current!)
    })
    el.addEventListener('mouseleave', () => popup.remove())
    startMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([lng, lat])
      .addTo(mapRef.current)
  }, [pickedStart])

  useEffect(() => {
    endMarkerRef.current?.remove()
    endMarkerRef.current = null
    if (!pickedEnd || !mapRef.current) return
    const el = document.createElement('div')
    el.style.cssText = 'background:#dc2626;color:#fff;font-size:11px;font-weight:700;padding:3px 8px;border-radius:4px;box-shadow:0 2px 4px rgba(0,0,0,0.4);white-space:nowrap;cursor:default;'
    el.textContent = '🏁 End'
    const [lng, lat] = [pickedEnd.lng, pickedEnd.lat]
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 })
    el.addEventListener('mouseenter', () => {
      popup.setLngLat([lng, lat]).setHTML(markerPopupHtml(pickedEnd, directionRef.current)).addTo(mapRef.current!)
    })
    el.addEventListener('mouseleave', () => popup.remove())
    endMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([lng, lat])
      .addTo(mapRef.current)
  }, [pickedEnd])

  // ORS routing-point markers (extended start/end used for A-road alternatives)
  useEffect(() => {
    orsMarkersRef.current.forEach(m => m.remove())
    orsMarkersRef.current = []
    if (!mapRef.current || routes.length === 0) return
    const map = mapRef.current

    const makeMarker = (lngLat: [number, number], label: string, color: string) => {
      const el = document.createElement('div')
      el.style.cssText = `background:${color};color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;box-shadow:0 2px 4px rgba(0,0,0,0.5);white-space:nowrap;cursor:default;`
      el.textContent = label
      return new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat(lngLat)
        .addTo(map)
    }

    // A-road routes share the same extended ORS points — grab from route 1 (or first available)
    const aroadRoute = routes.find(r => !r.route_attributes?.motorway_bypass)
    if (aroadRoute?.route_attributes?.ors_origin && aroadRoute?.route_attributes?.ors_destination) {
      orsMarkersRef.current.push(makeMarker(aroadRoute.route_attributes.ors_origin, '⬤ Div start', '#7c3aed'))
      orsMarkersRef.current.push(makeMarker(aroadRoute.route_attributes.ors_destination, '⬤ Div end', '#7c3aed'))
    }
  }, [routes])

  // Preview closure line
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const src = map.getSource('preview-closure') as maplibregl.GeoJSONSource | undefined
    if (!src) return
    src.setData(previewLine
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: previewLine, properties: {} }] }
      : { type: 'FeatureCollection', features: [] })
  }, [previewLine])

  // Impacted roads (auto-detected connected roads)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const src = map.getSource('impacted-roads') as maplibregl.GeoJSONSource | undefined
    if (!src) return
    src.setData({
      type: 'FeatureCollection',
      features: impactedFeatures.map(g => ({ type: 'Feature' as const, geometry: g, properties: {} })),
    })
  }, [impactedFeatures])

  // Auto-hide all network layers (except junctions) when routes first appear
  useEffect(() => {
    const prev = prevRoutesLenRef.current
    prevRoutesLenRef.current = routes.length
    if (prev === 0 && routes.length > 0) {
      setLayers({ m25: false, aroads: false, motorways: false, links: false, junctions: true, diversions: true, closure: true, impacted: true })
      setSatellite(false)
    }
  }, [routes])

  // Turn all DBFO network layers back on when the closure is cleared
  useEffect(() => {
    if (!closure) {
      setLayers({ m25: true, aroads: true, motorways: true, links: true, junctions: true, diversions: true, closure: true, impacted: true })
    }
  }, [closure])

  const applyLayerVisibility = (map: maplibregl.Map, lyr: typeof layers) => {
    const vis = (on: boolean) => on ? 'visible' : 'none'
    ;['m25-casing', 'm25-line'].forEach(id => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', vis(lyr.m25)))
    ;['a217-casing', 'a217-line'].forEach(id => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', vis(lyr.aroads)))
    ;['motorways-casing', 'motorways-line'].forEach(id => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', vis(lyr.motorways)))
    ;['links-casing', 'links-line'].forEach(id => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', vis(lyr.links)))
    ;['closure-casing', 'closure-line'].forEach(id => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', vis(lyr.closure)))
    ;['impacted-casing', 'impacted-line'].forEach(id => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', vis(lyr.impacted)))
    for (const rank of [1, 2, 3]) {
      ;[`route-${rank}-line`, `route-${rank}-arrows`].forEach(id => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', vis(lyr.diversions)))
    }
  }

  // Layer visibility toggles
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    applyLayerVisibility(map, layers)
  }, [layers])

  const applyData = (map: maplibregl.Map, cl: Closure | null, rts: Diversion[], sel: number | null) => {
    const closureSrc = map.getSource('closure') as maplibregl.GeoJSONSource | undefined
    if (closureSrc) {
      closureSrc.setData(
        cl?.geom_geojson
          ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: cl.geom_geojson, properties: {} }] }
          : { type: 'FeatureCollection', features: [] },
      )
      if (map.getLayer('closure-line')) {
        map.setPaintProperty('closure-line', 'line-color', '#dc2626')
        map.setPaintProperty('closure-line', 'line-width', 10)
      }
    }
    for (const rank of [1, 2, 3]) {
      const src = map.getSource(`route-${rank}`) as maplibregl.GeoJSONSource | undefined
      if (!src) continue
      const route = rts.find(r => r.route_rank === rank)
      src.setData(
        route?.geom_geojson
          ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: route.geom_geojson, properties: {} }] }
          : { type: 'FeatureCollection', features: [] },
      )
      if (map.getLayer(`route-${rank}-line`)) {
        map.setPaintProperty(`route-${rank}-line`, 'line-color', ROUTE_COLORS[rank])
        map.setPaintProperty(`route-${rank}-line`, 'line-opacity', sel === null || sel === rank ? 0.9 : 0.3)
        map.setPaintProperty(`route-${rank}-line`, 'line-width', sel === rank ? ROUTE_WIDTHS[rank] + 2 : ROUTE_WIDTHS[rank])
      }
    }
  }

  const addJunctionMarkers = (map: maplibregl.Map) => {
    junctionMarkersRef.current.forEach(m => m.remove())
    junctionMarkersRef.current = M25_JUNCTIONS.map(jct => {
      const [snapLng, snapLat] = snapToTrack(jct.lat, jct.lon, m25TrackRef.current)

      const el = document.createElement('div')
      el.style.cssText = `
        display:inline-block;background:#003189;color:white;font-size:9px;font-weight:800;
        padding:2px 5px;border-radius:3px;box-shadow:0 1px 3px rgba(0,0,0,0.5);
        white-space:nowrap;user-select:none;letter-spacing:0.3px;cursor:default;
      `
      el.textContent = jct.id
      el.title = jct.name

      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([snapLng, snapLat])
        .addTo(map)
      return marker
    })
  }

  // Initialise map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: [-0.28, 51.42],
      zoom: 9,
    })
    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
    map.on('load', () => { addCustomLayers(map); addJunctionMarkers(map) })
    map.on('click', e => {
      if (zoomBoxModeRef.current) return
      onMapClickRef.current(e.lngLat.lng, e.lngLat.lat)
    })

    // Zoom-to-area: click-drag a box (no Shift key needed) to zoom into it
    map.on('mousedown', e => {
      if (!zoomBoxModeRef.current) return
      e.preventDefault()
      map.dragPan.disable()
      zoomBoxStartRef.current = { x: e.point.x, y: e.point.y }
      const el = document.createElement('div')
      el.style.cssText = 'position:absolute;border:2px dashed #2563eb;background:rgba(37,99,235,0.15);pointer-events:none;z-index:30;'
      map.getContainer().appendChild(el)
      zoomBoxElRef.current = el
    })
    map.on('mousemove', e => {
      const start = zoomBoxStartRef.current
      const el = zoomBoxElRef.current
      if (!start || !el) return
      const x = Math.min(start.x, e.point.x)
      const y = Math.min(start.y, e.point.y)
      const w = Math.abs(e.point.x - start.x)
      const h = Math.abs(e.point.y - start.y)
      el.style.left = `${x}px`
      el.style.top = `${y}px`
      el.style.width = `${w}px`
      el.style.height = `${h}px`
    })
    map.on('mouseup', e => {
      const start = zoomBoxStartRef.current
      if (!start) return
      zoomBoxElRef.current?.remove()
      zoomBoxElRef.current = null
      zoomBoxStartRef.current = null
      map.dragPan.enable()
      const dx = Math.abs(e.point.x - start.x)
      const dy = Math.abs(e.point.y - start.y)
      if (dx > 5 && dy > 5) {
        const startLngLat = map.unproject([start.x, start.y])
        map.fitBounds([startLngLat, e.lngLat], { padding: 40 })
      }
      setZoomBoxMode(false)
    })

    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  // Satellite toggle
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    map.setStyle(satellite ? SATELLITE_STYLE : ROADS_STYLE)
    const onIdle = () => {
      addCustomLayers(map)
      addJunctionMarkers(map)
      map.off('idle', onIdle)
    }
    map.on('idle', onIdle)
  }, [satellite])

  // Junction marker visibility toggle
  useEffect(() => {
    junctionMarkersRef.current.forEach(m => {
      (m.getElement() as HTMLElement).style.display = layers.junctions ? '' : 'none'
    })
  }, [layers.junctions])

  // Update cursor
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.getCanvas().style.cursor = zoomBoxMode ? 'crosshair' : pickingMode ? 'crosshair' : 'grab'
  }, [pickingMode, zoomBoxMode])

  // Update closure/routes — skip isStyleLoaded() guard: GeoJSON setData works
  // whenever the source exists; tiles may still be loading without blocking us.
  // Fall back to idle listener if sources haven't been added yet (pre-load edge case).
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (map.getSource('closure')) {
      applyData(map, closure, routes, selectedRouteRank)
    } else {
      const onIdle = () => {
        if (map.getSource('closure')) {
          applyData(map, closure, routes, selectedRouteRank)
          map.off('idle', onIdle)
        }
      }
      map.on('idle', onIdle)
      return () => { map.off('idle', onIdle) }
    }
  }, [closure, routes, selectedRouteRank])

  // Fit bounds to routes
  useEffect(() => {
    const map = mapRef.current
    if (!map || routes.length === 0) return
    const allCoords = routes.flatMap(r => r.geom_geojson?.coordinates ?? [])
    if (allCoords.length === 0) return
    const bounds = allCoords.reduce(
      (b, [lng, lat]) => b.extend([lng, lat] as [number, number]),
      new maplibregl.LngLatBounds(allCoords[0] as [number, number], allCoords[0] as [number, number]),
    )
    map.fitBounds(bounds, { padding: 60, maxZoom: 13 })
  }, [routes])

  const toggleLayer = (key: keyof typeof layers) =>
    setLayers(l => ({ ...l, [key]: !l[key] }))

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />

      {/* Top-left controls */}
      <div className="absolute top-3 left-3 z-10 flex flex-col gap-1">
        <button
          onClick={() => setSatellite(s => !s)}
          className={`px-3 py-1.5 rounded shadow text-xs font-semibold border transition-colors ${
            satellite ? 'bg-white text-gray-800 border-gray-300 hover:bg-gray-100' : 'bg-gray-800 text-white border-gray-700 hover:bg-gray-700'
          }`}
        >
          {satellite ? 'Map' : 'Satellite'}
        </button>

        <button
          onClick={() => setZoomBoxMode(z => !z)}
          className={`px-3 py-1.5 rounded shadow text-xs font-semibold border transition-colors ${
            zoomBoxMode ? 'bg-blue-600 text-white border-blue-700 hover:bg-blue-700' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-100'
          }`}
        >
          {zoomBoxMode ? 'Drag to zoom…' : 'Zoom to area'}
        </button>

        {/* Layer toggles */}
        <div className="bg-white/95 rounded shadow border border-gray-200 p-2 text-xs space-y-1">
          <p className="font-semibold text-gray-600 uppercase tracking-wide mb-1">DBFO Network</p>
          {([
            ['m25', 'M25 Motorway', '#3b82f6'],
            ['links', 'Interchange Slip Roads', '#60a5fa'],
            ['aroads', 'A-Roads', '#4ade80'],
            ['motorways', 'Connecting Motorways', '#c084fc'],
            ['junctions', 'Junction Markers', '#003189'],
          ] as const).map(([key, label, colour]) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={layers[key]} onChange={() => toggleLayer(key)} className="rounded" />
              <span className="w-5 h-1 rounded inline-block" style={{ background: colour }} />
              <span className="text-gray-700">{label}</span>
            </label>
          ))}
        </div>
      </div>

      {pickingMode && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-nh-blue text-white text-sm px-4 py-2 rounded shadow-lg z-10">
          Click map to set {pickingMode === 'start' ? 'start' : 'end'} point
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-8 right-3 bg-white/90 rounded shadow p-2 text-xs space-y-1 z-10">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={layers.closure} onChange={() => toggleLayer('closure')} className="rounded" />
          <span className="w-6 inline-block rounded" style={{ height: 4, background: '#dc2626' }} />Closure
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={layers.impacted} onChange={() => toggleLayer('impacted')} className="rounded" />
          <span className="w-6 inline-block border-t-2 border-dashed" style={{ borderColor: '#f97316' }} />Impacted roads
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={layers.diversions} onChange={() => toggleLayer('diversions')} className="rounded" />
          <span className="w-6 inline-block rounded" style={{ height: 4, background: '#16a34a' }} />Primary diversion
        </label>
        <div className="flex items-center gap-2 pl-5"><span className="w-6 inline-block rounded" style={{ height: 4, background: '#2563eb' }} />Alt diversion 1</div>
        <div className="flex items-center gap-2 pl-5"><span className="w-6 inline-block rounded" style={{ height: 4, background: '#eab308' }} />Alt diversion 2</div>
      </div>
    </div>
  )
}
