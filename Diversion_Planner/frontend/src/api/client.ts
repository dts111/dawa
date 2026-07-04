import axios from 'axios'
import type { Closure, Diversion, Stakeholder, LibraryEntry, LibrarySuggestion, ImpactedRoad } from '../types'

const api = axios.create({ baseURL: '/api' })

// Closures
export const createClosure = (data: Record<string, unknown>) =>
  api.post<Closure>('/closures', data).then(r => r.data)

export const listClosures = () =>
  api.get<Closure[]>('/closures').then(r => r.data)

export const getClosure = (id: string) =>
  api.get<Closure>(`/closures/${id}`).then(r => r.data)

export const deleteClosure = (id: string) =>
  api.delete(`/closures/${id}`)

export const findNearestNode = (lng: number, lat: number, bearing?: number) =>
  api.get<{
    node_id: number
    lng: number
    lat: number
    distance_m: number
    road_name: string | null
    road_type: string | null
    is_junction: boolean
  }>(
    '/closures/nearest-node/find',
    { params: { lng, lat, ...(bearing !== undefined ? { bearing } : {}) } }
  ).then(r => r.data)

// Routes
export const generateRoutes = (closureId: string, vehicleType = 'car', engine = 'ors') =>
  api.post<Diversion[]>('/routes/generate', {
    closure_id: closureId,
    vehicle_type: vehicleType,
    n_alternatives: 3,
    engine,
  }).then(r => r.data)

export const getRoutesForClosure = (closureId: string) =>
  api.get<Diversion[]>(`/routes/${closureId}`).then(r => r.data)

export const previewDiversionRoutes = (startNode: number, endNode: number, vehicleType = 'car') =>
  api.get<Pick<Diversion, 'route_rank' | 'geom_geojson' | 'distance_m' | 'travel_time_min'>[]>(
    '/routes/preview',
    { params: { start_node: startNode, end_node: endNode, vehicle_type: vehicleType } }
  ).then(r => r.data)

// Stakeholders
export const getStakeholders = (closureId: string) =>
  api.get<Stakeholder[]>(`/stakeholders/${closureId}`).then(r => r.data)

// Library
export const listLibrary = (status?: string) =>
  api.get<LibraryEntry[]>('/library', { params: status ? { status } : {} }).then(r => r.data)

export const suggestDiversions = (closureId: string) =>
  api.get<LibrarySuggestion[]>('/library/suggest', { params: { closure_id: closureId } }).then(r => r.data)

export const approveDiversion = (libraryId: string, approvedBy: string, notes?: string) =>
  api.patch<LibraryEntry>(`/library/${libraryId}/approve`, { approved_by: approvedBy, notes }).then(r => r.data)

export const rejectDiversion = (libraryId: string, approvedBy: string, notes?: string) =>
  api.patch<LibraryEntry>(`/library/${libraryId}/reject`, { approved_by: approvedBy, notes }).then(r => r.data)

// Network utilities
export const previewClosureLine = (startNode: number, endNode: number) =>
  api.get<GeoJSON.LineString>('/network/preview-closure', { params: { start_node: startNode, end_node: endNode } })
    .then(r => r.data)

export const getImpactedRoads = (startNode: number, endNode: number) =>
  api.get<ImpactedRoad[]>('/network/impacted-roads', { params: { start_node: startNode, end_node: endNode } })
    .then(r => r.data)

export const getNodeById = (nodeId: number) =>
  api.get<{ node_id: number; lng: number; lat: number }>(`/network/node/${nodeId}`)
    .then(r => r.data)

// Export
export const getPdfUrl = (closureId: string, ttroRef = 'TTRO/DRAFT') =>
  `/api/export/${closureId}/pdf?ttro_ref=${encodeURIComponent(ttroRef)}`

export const getGeojsonUrl = (closureId: string) =>
  `/api/export/${closureId}/geojson`
