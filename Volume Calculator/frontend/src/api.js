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
 * @returns {Promise<{ session_key, filename, files_loaded, surface_count, surfaces }>}
 */
export async function parseFile(file, sessionKey = null) {
  const form = new FormData()
  form.append('file', file)
  if (sessionKey) form.append('session_key', sessionKey)
  const { data } = await client.post('/api/parse', form)
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
