import type { Diversion } from '../types'

interface Props {
  routes: Diversion[]
  selectedRouteRank: number | null
}

const DIMENSIONS = [
  { key: 'distance_efficiency', label: 'Distance Efficiency', weight: '20%', desc: 'Diversion vs straight-line ratio' },
  { key: 'travel_time_impact', label: 'Travel Time Impact', weight: '25%', desc: 'Extra minutes vs ideal travel time' },
  { key: 'hgv_suitability', label: 'HGV Suitability', weight: '20%', desc: '% of route suitable for HGVs' },
  { key: 'emergency_access', label: 'Emergency Access', weight: '15%', desc: 'Emergency service coverage maintained' },
  { key: 'local_authority_impact', label: 'LA Impact', weight: '10%', desc: 'Fewer local authorities affected' },
  { key: 'network_resilience', label: 'Network Resilience', weight: '10%', desc: 'Route independence from alternatives' },
]

const RANK_LABELS: Record<number, string> = { 1: 'Primary', 2: 'Alt 1', 3: 'Alt 2' }
const RANK_BG: Record<number, string> = { 1: 'bg-nh-blue', 2: 'bg-orange-500', 3: 'bg-purple-600' }

function scoreColor(v: number) {
  if (v >= 75) return 'bg-green-500'
  if (v >= 50) return 'bg-yellow-400'
  return 'bg-red-500'
}

export default function AssessmentPanel({ routes, selectedRouteRank }: Props) {
  const displayRoutes = selectedRouteRank
    ? routes.filter(r => r.route_rank === selectedRouteRank)
    : routes

  if (displayRoutes.length === 0) {
    return (
      <div className="text-center text-gray-400 py-12">
        <p className="text-4xl mb-3">📊</p>
        <p className="text-sm">Generate routes to see assessment scores.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <h2 className="font-bold text-nh-blue text-lg border-b border-gray-200 pb-2">Route Assessment</h2>

      {/* Overall scores */}
      <div className="grid grid-cols-3 gap-2">
        {routes.map(r => (
          <div key={r.id} className={`rounded-lg p-3 text-center text-white ${RANK_BG[r.route_rank]}`}>
            <div className="text-xs opacity-80">{RANK_LABELS[r.route_rank]}</div>
            <div className="text-3xl font-bold mt-1">{r.score ?? '—'}</div>
            <div className="text-xs opacity-80">/ 100</div>
          </div>
        ))}
      </div>

      {/* Dimension breakdown */}
      <div className="space-y-3">
        {DIMENSIONS.map(dim => (
          <div key={dim.key}>
            <div className="flex justify-between text-xs mb-1">
              <span className="font-medium text-gray-700">{dim.label}</span>
              <span className="text-gray-400">{dim.weight}</span>
            </div>
            <div className="space-y-1">
              {displayRoutes.map(r => {
                const val = (r.score_breakdown as Record<string, number> | null)?.[dim.key] ?? 0
                return (
                  <div key={r.id} className="flex items-center gap-2 text-xs">
                    <span className="w-14 text-gray-500 truncate">{RANK_LABELS[r.route_rank]}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-2.5">
                      <div
                        className={`h-2.5 rounded-full transition-all ${scoreColor(val)}`}
                        style={{ width: `${val}%` }}
                      />
                    </div>
                    <span className="w-6 text-right font-semibold">{val}</span>
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-gray-400 mt-0.5">{dim.desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
