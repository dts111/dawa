const BASE = '/api'

export async function fetchClosure(start, end, direction = 'clockwise') {
  const resp = await fetch(`${BASE}/closure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      start: [start.lat, start.lon],
      end:   [end.lat,   end.lon],
      direction,
    }),
  })
  if (!resp.ok) return null
  return resp.json()
}

export async function fetchRoute(start, end, direction = 'clockwise') {
  const resp = await fetch(`${BASE}/route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      start: [start.lat, start.lon],
      end: [end.lat, end.lon],
      direction,
    }),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err.detail || `Request failed (${resp.status})`)
  }
  return resp.json()
}

export async function fetchDrawRoute(a, b, closure) {
  const resp = await fetch(`${BASE}/route-draw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ a: [a.lat, a.lon], b: [b.lat, b.lon], closure }),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err.detail || `Request failed (${resp.status})`)
  }
  return resp.json()
}

export async function fetchStakeholders(coordinates) {
  const resp = await fetch(`${BASE}/stakeholders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ coordinates }),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to identify stakeholders')
  }
  return resp.json()
}
