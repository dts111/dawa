export type GeoJSONData = GeoJSON.FeatureCollection | null

// Snap a raw [lat, lon] point to the nearest vertex on a GeoJSON line/multiline
// track (e.g. the M25 centerline), so points near but not exactly on the road
// (like the approximate junction coordinates in junctions.ts) land on the
// actual carriageway instead of a nearby slip road or A-road.
export function snapToTrack(lat: number, lon: number, track: GeoJSONData): [number, number] {
  if (!track) return [lon, lat]
  let bestDist = Infinity
  let bestLng = lon, bestLat = lat
  for (const feature of track.features) {
    const geom = feature.geometry as GeoJSON.LineString | GeoJSON.MultiLineString
    const rings = geom.type === 'LineString' ? [geom.coordinates] : geom.coordinates
    for (const coords of rings) {
      for (const [lng, lt] of coords) {
        const d = Math.hypot(lng - lon, lt - lat)
        if (d < bestDist) { bestDist = d; bestLng = lng; bestLat = lt }
      }
    }
  }
  return [bestLng, bestLat]
}
