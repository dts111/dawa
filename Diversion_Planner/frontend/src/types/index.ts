export interface GeoJsonLineString {
  type: 'LineString'
  coordinates: [number, number][]
}

export interface Closure {
  id: string
  closure_type: 'mainline' | 'slip_entry' | 'slip_exit' | 'interchange'
  direction: 'CW' | 'ACW' | 'N/A'
  start_node: number | null
  end_node: number | null
  start_chainage: string | null
  end_chainage: string | null
  start_junction: string | null
  end_junction: string | null
  date_from: string | null
  date_to: string | null
  reason: string | null
  created_at: string
  geom_geojson: GeoJsonLineString | null
}

export interface ScoreBreakdown {
  distance_efficiency: number
  travel_time_impact: number
  hgv_suitability: number
  emergency_access: number
  local_authority_impact: number
  network_resilience: number
}

export interface RouteAttributes {
  named_roads: string[]
  road_type_m: Record<string, number>
  speed_range: { min: number; max: number } | null
  ors_origin?: [number, number]
  ors_destination?: [number, number]
  motorway_bypass?: boolean
}

export interface Diversion {
  id: string
  closure_id: string
  route_rank: 1 | 2 | 3
  distance_m: number | null
  travel_time_min: number | null
  entry_node: number | null
  exit_node: number | null
  score: number | null
  score_breakdown: ScoreBreakdown | null
  route_attributes: RouteAttributes | null
  geom_geojson: GeoJsonLineString | null
  created_at: string
}

export interface Stakeholder {
  id: number
  name: string
  category: 'local_authority' | 'police' | 'ambulance' | 'fire' | 'national_highways'
  contact_email: string | null
  contact_name: string | null
}

export interface LibraryEntry {
  id: string
  closure_id: string | null
  diversion_id: string | null
  approval_status: 'draft' | 'approved' | 'rejected'
  stakeholder_feedback: unknown[]
  version: number
  approved_by: string | null
  approved_at: string | null
  notes: string | null
  created_at: string
}

export interface LibrarySuggestion {
  library_id: string
  closure_id: string
  diversion_id: string
  start_junction: string | null
  end_junction: string | null
  direction: string
  score: number
  distance_km: number
  approved_by: string | null
  approved_at: string | null
  match_reasons: string[]
}

export interface ImpactedRoad {
  edge_id: number
  name: string
  road_type: string
  source_node: number
  target_node: number
  geojson: GeoJSON.LineString
}

export type Panel = 'closure' | 'routes' | 'assessment' | 'library' | 'export'
