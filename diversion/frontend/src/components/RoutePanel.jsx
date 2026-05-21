const DOT_COLORS = ['bg-blue-500', 'bg-green-500', 'bg-amber-500']

export default function RoutePanel({ direct, alternatives, selectedRoute, onSelectRoute }) {
  const directDist = direct?.distance_km ?? 0
  const directTime = direct?.duration_min ?? 0

  return (
    <div className="p-4 border-b border-gray-200">
      <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">
        Diversion Options
      </h2>

      {direct && (
        <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded text-xs">
          <span className="font-semibold text-red-700">Closed section (M25): </span>
          <span className="text-gray-600">{directDist} km &middot; {directTime} min (direct)</span>
        </div>
      )}

      <div className="space-y-2">
        {alternatives.map((alt, i) => {
          const extraDist = (alt.distance_km - directDist).toFixed(1)
          const extraTime = (alt.duration_min - directTime).toFixed(0)
          const isSelected = i === selectedRoute

          return (
            <button
              key={i}
              onClick={() => onSelectRoute(i)}
              className={`w-full text-left p-3 rounded-lg border transition-all ${
                isSelected
                  ? 'border-blue-500 bg-blue-50 shadow-sm'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${DOT_COLORS[i] ?? 'bg-indigo-500'}`} />
                  <span className="font-semibold text-sm text-gray-800">{alt.label}</span>
                </div>
                <span className="text-xs text-gray-500">
                  +{extraDist} km &middot; +{extraTime} min
                </span>
              </div>

              <div className="text-xs text-gray-500 mb-1 leading-relaxed">
                {alt.road_names.slice(0, 6).join(' → ')}
                {alt.road_names.length > 6 && <span className="text-gray-400"> &hellip;</span>}
              </div>

              <div className="text-xs font-medium text-gray-700">
                {alt.distance_km} km total &middot; {alt.duration_min} min
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
