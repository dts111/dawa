/**
 * API client — talks to the FastAPI backend.
 * The base URL is read from VITE_API_URL env var (set in Netlify env settings).
 * Falls back to '' (same origin) which works via Vite proxy in dev.
 */

import axios from 'axios'

const BASE = import.meta.env.VITE_API_URL || ''

const client = axios.create({ baseURL: BASE })

/**
 * Upload a LandXML file and parse it.
 * @param {File} file
 * @param {string|null} sessionKey  Pass an existing session key to ADD surfaces from
 *                                  a second (or third) file to the same session.
 * @param {number|null} maxEdgeLength  Trim Delaunay "bridge" triangles whose longest
 *                                     edge exceeds this length (m) — real gaps in the
 *                                     survey data (e.g. separate carriageways) often
 *                                     produce these. There is no auto-computed default:
 *                                     leave null for the raw, unmodified triangulation
 *                                     (the default), or pass an explicit value to trim.
 * @param {boolean} clipToBoundary  Geometrically clip out any faces outside the main
 *                                  boundary polygon (computed after the edge-length
 *                                  trim). REQUIRES maxEdgeLength to also be set (the
 *                                  backend rejects this otherwise, since a raw boundary
 *                                  is too simple to clip against meaningfully). Off by default.
 * @param {number|null} minAngleDeg  Remove thin/degenerate "sliver" triangles whose
 *                                   minimum interior angle is below this value (deg).
 *                                   Independent of maxEdgeLength — catches bad triangle
 *                                   SHAPE regardless of edge length. No auto-computed
 *                                   default, same convention as maxEdgeLength.
 * @returns {Promise<{ session_key, filename, files_loaded, surface_count, surfaces }>}
 */
export async function parseFile(file, sessionKey = null, maxEdgeLength = null, clipToBoundary = false, minAngleDeg = null) {
  const form = new FormData()
  form.append('file', file)
  if (sessionKey) form.append('session_key', sessionKey)
  if (maxEdgeLength) form.append('max_edge_length', maxEdgeLength)
  form.append('clip_to_boundary', clipToBoundary)
  if (minAngleDeg) form.append('min_angle_deg', minAngleDeg)
  const { data } = await client.post('/api/parse', form)
  return data
}

/**
 * Re-apply Max Triangle Edge / Clip to Boundary / Min Triangle Angle to every
 * surface already in the session, using each surface's already-parsed raw faces
 * server-side — no file re-upload. Powers "dynamic" Advanced Options edits (live
 * re-trim as the value changes) instead of only affecting files added afterwards.
 * @param {string} sessionKey
 * @param {number|null} maxEdgeLength  null = no trimming (back to raw).
 * @param {boolean} clipToBoundary
 * @param {number|null} minAngleDeg  null = no sliver trimming.
 * @returns {Promise<{ surface_count, surfaces }>}
 */
export async function retrim(sessionKey, maxEdgeLength = null, clipToBoundary = false, minAngleDeg = null) {
  const form = new FormData()
  form.append('session_key', sessionKey)
  if (maxEdgeLength) form.append('max_edge_length', maxEdgeLength)
  form.append('clip_to_boundary', clipToBoundary)
  if (minAngleDeg) form.append('min_angle_deg', minAngleDeg)
  const { data } = await client.post('/api/retrim', form)
  return data
}

/**
 * Calculate cut/fill volumes between two surfaces.
 * @param {string} sessionKey
 * @param {string} surface1Name
 * @param {string} surface2Name
 * @param {number|null} gridResolution
 * @returns {Promise<{ summary, grid }>}
 */
export async function calculateVolumes(sessionKey, surface1Name, surface2Name, gridResolution = null) {
  const form = new FormData()
  form.append('session_key', sessionKey)
  form.append('surface1_name', surface1Name)
  form.append('surface2_name', surface2Name)
  if (gridResolution) form.append('grid_resolution', gridResolution)
  const { data } = await client.post('/api/calculate', form)
  return data
}

/**
 * Fetch a Three.js-ready mesh for one surface.
 */
export async function getMesh(sessionKey, surfaceName) {
  const form = new FormData()
  form.append('session_key', sessionKey)
  form.append('surface_name', surfaceName)
  const { data } = await client.post('/api/mesh', form)
  return data
}

/**
 * Trace the outer boundary/hole loops of a surface's triangulation.
 * @returns {Promise<{ loops: { points: number[][], point_count: number }[] }>}
 */
export async function getBoundary(sessionKey, surfaceName) {
  const form = new FormData()
  form.append('session_key', sessionKey)
  form.append('surface_name', surfaceName)
  const { data } = await client.post('/api/boundary', form)
  return data
}

/**
 * Fetch a surface's source breaklines (3D polylines), if the LandXML file had any.
 * @returns {Promise<{ breaklines: { desc: string, brk_type: string, points: number[][] }[] }>}
 */
export async function getBreaklines(sessionKey, surfaceName) {
  const form = new FormData()
  form.append('session_key', sessionKey)
  form.append('surface_name', surfaceName)
  const { data } = await client.post('/api/breaklines', form)
  return data
}

/**
 * Fetch the convex-hull envelope of a surface's source breakline points — the outer
 * extent of the real survey data, distinct from getBoundary()'s triangulation-derived
 * boundary. Useful for spotting triangulation that extends beyond real survey coverage.
 * @returns {Promise<{ envelope: { points: number[][], point_count: number } | null }>}
 */
export async function getBreaklineEnvelope(sessionKey, surfaceName) {
  const form = new FormData()
  form.append('session_key', sessionKey)
  form.append('surface_name', surfaceName)
  const { data } = await client.post('/api/breakline-envelope', form)
  return data
}

/**
 * Attempt to join a surface's source breaklines end-to-end into continuous
 * polylines — closed loops separate from open (gapped) chains, plus every
 * dead-end and ambiguous-branch point found. A best-effort stitch: real
 * breakline networks are often a mix of feature types that don't trace one
 * clean perimeter, so gaps/branches are reported rather than guessed across.
 * @returns {Promise<{
 *   loops: { points: number[][], point_count: number }[],
 *   open_chains: { points: number[][], point_count: number }[],
 *   gap_points: number[][],
 *   branch_points: number[][],
 * }>}
 */
export async function getBreaklineChain(sessionKey, surfaceName) {
  const form = new FormData()
  form.append('session_key', sessionKey)
  form.append('surface_name', surfaceName)
  const { data } = await client.post('/api/breakline-chain', form)
  return data
}

/**
 * Fetch meshes for ALL surfaces in a session.
 * @param {string} sessionKey
 * @param {string[]} surfaceNames
 * @returns {Promise<object[]>}
 */
export async function getAllMeshes(sessionKey, surfaceNames) {
  return Promise.all(surfaceNames.map(n => getMesh(sessionKey, n)))
}

/**
 * Fetch elevation profiles for all (or selected) surfaces along a section line.
 * @param {string} sessionKey
 * @param {string[]} surfaceNames  pass [] or ['*'] for all surfaces
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @param {number} numSamples
 */
export async function getSection(sessionKey, surfaceNames, x1, y1, x2, y2, numSamples = 400) {
  const form = new FormData()
  form.append('session_key', sessionKey)
  form.append('surface_names', JSON.stringify(surfaceNames.length ? surfaceNames : ['*']))
  form.append('x1', x1)
  form.append('y1', y1)
  form.append('x2', x2)
  form.append('y2', y2)
  form.append('num_samples', numSamples)
  const { data } = await client.post('/api/section', form)
  return data
}

/**
 * Download a PDF report.
 */
export async function downloadPDF(sessionKey, surface1Name, surface2Name, projectName, gridResolution) {
  const form = new FormData()
  form.append('session_key', sessionKey)
  form.append('surface1_name', surface1Name)
  form.append('surface2_name', surface2Name)
  form.append('project_name', projectName)
  if (gridResolution) form.append('grid_resolution', gridResolution)
  const { data } = await client.post('/api/report/pdf', form, { responseType: 'blob' })
  _triggerDownload(data, 'volume_report.pdf', 'application/pdf')
}

/**
 * Download an Excel report.
 */
export async function downloadExcel(sessionKey, surface1Name, surface2Name, projectName, gridResolution) {
  const form = new FormData()
  form.append('session_key', sessionKey)
  form.append('surface1_name', surface1Name)
  form.append('surface2_name', surface2Name)
  form.append('project_name', projectName)
  if (gridResolution) form.append('grid_resolution', gridResolution)
  const { data } = await client.post('/api/report/excel', form, { responseType: 'blob' })
  _triggerDownload(
    data,
    'volume_report.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )
}

function _triggerDownload(blob, filename, mimeType) {
  const url = URL.createObjectURL(new Blob([blob], { type: mimeType }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Build the shared FormData payload used by every excavation-profile endpoint.
 */
function _excavationForm(sessionKey, hbxcName, egName, intermediateNames, polyline, opts = {}) {
  const form = new FormData()
  form.append('session_key', sessionKey)
  form.append('hbxc_name', hbxcName)
  form.append('eg_name', egName)
  form.append('intermediate_names', JSON.stringify(intermediateNames || []))
  form.append('polyline', JSON.stringify(polyline))
  form.append('chainage_interval', opts.chainageInterval ?? 10.0)
  form.append('max_search_distance', opts.maxSearchDistance ?? 50.0)
  form.append('sample_step', opts.sampleStep ?? 0.25)
  form.append('tolerance_mm', opts.toleranceMm ?? 1.0)
  return form
}

/**
 * Check whether any station/side along the corridor needs a batter angle,
 * without supplying one. Lets the UI only prompt for it when actually needed.
 * @returns {Promise<{ batter_required, stations_checked, affected_count, affected_examples }>}
 */
export async function checkBatterRequirement(sessionKey, hbxcName, egName, intermediateNames, polyline, opts = {}) {
  const form = _excavationForm(sessionKey, hbxcName, egName, intermediateNames, polyline, opts)
  const { data } = await client.post('/api/excavation/batter-check', form)
  return data
}

/**
 * Run the full Maximum Excavation Profile pipeline.
 * @param {string|null} batterInput  e.g. "1:2" or "45" — required only if
 *                                   checkBatterRequirement reported batter_required.
 * @returns {Promise<{ config, stations, ranges, report_text, summary }>}
 */
export async function computeExcavationProfile(sessionKey, hbxcName, egName, intermediateNames, polyline, batterInput = null, opts = {}) {
  const form = _excavationForm(sessionKey, hbxcName, egName, intermediateNames, polyline, opts)
  if (batterInput) form.append('batter_input', batterInput)
  const { data } = await client.post('/api/excavation/compute', form)
  return data
}

/**
 * Fetch the full traced path (and raw surface samples) for one station/side,
 * for on-demand cross-section charting. Requires a prior computeExcavationProfile call.
 */
export async function getStationProfile(sessionKey, chainage, side) {
  const form = new FormData()
  form.append('session_key', sessionKey)
  form.append('chainage', chainage)
  form.append('side', side)
  const { data } = await client.post('/api/excavation/station-profile', form)
  return data
}

/**
 * Download the rebuilt excavation surface as a LandXML TIN surface.
 */
export async function downloadExcavationLandXML(sessionKey) {
  const form = new FormData()
  form.append('session_key', sessionKey)
  const { data } = await client.post('/api/excavation/export/landxml', form, { responseType: 'blob' })
  _triggerDownload(data, 'excavation_profile.xml', 'application/xml')
}

/**
 * Download the chainage-range report as CSV.
 */
export async function downloadExcavationCSV(sessionKey) {
  const form = new FormData()
  form.append('session_key', sessionKey)
  const { data } = await client.post('/api/excavation/export/csv', form, { responseType: 'blob' })
  _triggerDownload(data, 'excavation_report.csv', 'text/csv')
}
