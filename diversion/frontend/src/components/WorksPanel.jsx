function coordLabel(marker) {
  if (!marker) return 'Click map to place'
  return `${marker.lat.toFixed(5)}, ${marker.lon.toFixed(5)}`
}

export default function WorksPanel({
  worksInfo, markers, junctions, direction, activeMarker, loading, error,
  onWorksInfoChange, onDirectionChange, onActiveMarkerChange, onFindDiversion, onClear,
}) {
  const set = (key) => (e) => onWorksInfoChange({ ...worksInfo, [key]: e.target.value })

  return (
    <div className="p-4 border-b border-gray-200">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-1 h-6 bg-yellow-400 rounded" />
        <h1 className="text-base font-bold text-gray-900">M25 Diversion Planner</h1>
      </div>

      {/* Works reference */}
      <div className="mb-3">
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          Works Reference
        </label>
        <input
          type="text"
          placeholder="e.g. M25/2025/J09-J10"
          value={worksInfo.reference}
          onChange={set('reference')}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Dates */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">From</label>
          <input type="date" value={worksInfo.startDate} onChange={set('startDate')}
            className="w-full border border-gray-300 rounded px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">To</label>
          <input type="date" value={worksInfo.endDate} onChange={set('endDate')}
            className="w-full border border-gray-300 rounded px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Description */}
      <div className="mb-3">
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          Description of Works
        </label>
        <textarea
          rows={2}
          placeholder="e.g. Carriageway resurfacing, emergency repair..."
          value={worksInfo.description}
          onChange={set('description')}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>

      {/* Carriageway direction */}
      <div className="mb-4">
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          Affected Carriageway
        </label>
        <div className="flex gap-2">
          {['clockwise', 'anticlockwise'].map((d) => (
            <button
              key={d}
              onClick={() => onDirectionChange(d)}
              className={`flex-1 py-2 rounded border text-xs font-semibold transition-colors capitalize ${
                direction === d
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'border-gray-300 text-gray-600 hover:border-blue-400'
              }`}
            >
              {d === 'clockwise' ? 'Clockwise (CW)' : 'Anticlockwise (ACW)'}
            </button>
          ))}
        </div>
      </div>

      {/* Works location markers */}
      <div className="mb-4 space-y-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Works Location — click map to place
        </p>

        <button
          onClick={() => onActiveMarkerChange('start')}
          className={`w-full text-left px-3 py-2 rounded border text-sm transition-colors ${
            activeMarker === 'start'
              ? 'border-red-500 bg-red-50 ring-1 ring-red-300'
              : 'border-gray-300 hover:border-gray-400'
          }`}
        >
          <div className="flex justify-between items-center">
            <span className="font-semibold text-red-700">Works Start</span>
            <span className="text-gray-400 text-xs font-mono">{coordLabel(markers.start)}</span>
          </div>
          {junctions?.exit ? (
            <div className="text-xs text-blue-700 font-semibold mt-0.5">
              Diversion exits at {junctions.exit.id} — {junctions.exit.name}
            </div>
          ) : (
            <div className="text-xs text-gray-400 mt-0.5">
              Will snap to nearest exit junction
            </div>
          )}
        </button>

        <button
          onClick={() => onActiveMarkerChange('end')}
          className={`w-full text-left px-3 py-2 rounded border text-sm transition-colors ${
            activeMarker === 'end'
              ? 'border-red-800 bg-red-50 ring-1 ring-red-400'
              : 'border-gray-300 hover:border-gray-400'
          }`}
        >
          <div className="flex justify-between items-center">
            <span className="font-semibold text-red-900">Works End</span>
            <span className="text-gray-400 text-xs font-mono">{coordLabel(markers.end)}</span>
          </div>
          {junctions?.entry ? (
            <div className="text-xs text-blue-700 font-semibold mt-0.5">
              Diversion re-enters at {junctions.entry.id} — {junctions.entry.name}
            </div>
          ) : (
            <div className="text-xs text-gray-400 mt-0.5">
              Will snap to nearest entry junction
            </div>
          )}
        </button>
      </div>

      {error && (
        <p className="text-red-600 text-xs bg-red-50 border border-red-200 rounded px-3 py-2 mb-3">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          onClick={onFindDiversion}
          disabled={loading || !markers.start || !markers.end}
          className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded text-sm transition-colors"
        >
          {loading ? 'Calculating...' : 'Find Diversion Route'}
        </button>
        <button
          onClick={onClear}
          className="px-3 py-2.5 border border-gray-300 hover:border-red-400 hover:text-red-600 text-gray-500 rounded text-sm transition-colors"
          title="Clear markers and results"
        >
          Clear
        </button>
      </div>
    </div>
  )
}
