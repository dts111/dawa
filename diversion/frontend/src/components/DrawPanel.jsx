function coordStr(pin) {
  return pin ? `${pin.lat.toFixed(5)}, ${pin.lon.toFixed(5)}` : null
}

export default function DrawPanel({
  drawStep, pinA, pinB, closurePoints, loading, error,
  onFinishDrawing, onUndo, onClear, onCalculate,
}) {
  const steps = [
    {
      key: 'place-a',
      label: 'Route Start (A)',
      hint: 'Click the map to place the start of the diversion route',
      done: !!pinA,
      detail: coordStr(pinA),
    },
    {
      key: 'place-b',
      label: 'Route End (B)',
      hint: 'Click the map to place the end of the diversion route',
      done: !!pinB,
      detail: coordStr(pinB),
    },
    {
      key: 'draw-closure',
      label: 'Draw Closure Line',
      hint: 'Click the map to trace the closed section of road',
      done: closurePoints.length >= 2 && drawStep === 'ready',
      detail: closurePoints.length > 0 ? `${closurePoints.length} point${closurePoints.length !== 1 ? 's' : ''}` : null,
    },
  ]

  const stepIndex = { 'place-a': 0, 'place-b': 1, 'draw-closure': 2, 'ready': 2 }
  const activeIdx = stepIndex[drawStep] ?? 0
  const canCalculate = !!pinA && !!pinB && closurePoints.length >= 2 && !loading

  return (
    <div className="p-4 border-b border-gray-200">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-1 h-6 bg-blue-500 rounded" />
        <h1 className="text-base font-bold text-gray-900">Draw Closure Planner</h1>
      </div>

      <div className="space-y-2 mb-4">
        {steps.map((step, i) => {
          const isActive = i === activeIdx && drawStep !== 'ready'
          const isDone = step.done || (step.key === 'place-a' && !!pinA && i < activeIdx) || (step.key === 'place-b' && !!pinB && i < activeIdx)

          return (
            <div
              key={step.key}
              className={`flex gap-3 p-2.5 rounded-lg border ${
                isActive
                  ? 'border-blue-300 bg-blue-50'
                  : isDone
                  ? 'border-green-200 bg-green-50'
                  : 'border-gray-100 bg-gray-50'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold mt-0.5 ${
                  isDone
                    ? 'bg-green-600 text-white'
                    : isActive
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-300 text-gray-500'
                }`}
              >
                {isDone ? '✓' : i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-xs font-semibold ${isActive ? 'text-blue-800' : isDone ? 'text-green-800' : 'text-gray-400'}`}>
                  {step.label}
                </div>
                {isActive && !step.detail && (
                  <div className="text-xs text-gray-500 mt-0.5">{step.hint}</div>
                )}
                {step.detail && (
                  <div className={`text-xs font-mono mt-0.5 ${isDone ? 'text-green-700' : 'text-blue-700'}`}>
                    {step.detail}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Drawing controls — shown while actively drawing */}
      {drawStep === 'draw-closure' && (
        <div className="flex gap-2 mb-4">
          <button
            onClick={onUndo}
            disabled={closurePoints.length === 0}
            className="px-3 py-1.5 text-xs font-semibold border border-gray-300 rounded text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Undo
          </button>
          <button
            onClick={onFinishDrawing}
            disabled={closurePoints.length < 2}
            className="flex-1 py-1.5 text-xs font-semibold bg-gray-800 text-white rounded hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Finish Drawing
          </button>
        </div>
      )}

      {error && (
        <p className="text-red-600 text-xs bg-red-50 border border-red-200 rounded px-3 py-2 mb-3">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          onClick={onClear}
          className="px-3 py-2.5 border border-gray-300 hover:border-red-400 hover:text-red-600 text-gray-500 rounded text-sm transition-colors"
          title="Clear and start over"
        >
          Clear
        </button>
        <button
          onClick={onCalculate}
          disabled={!canCalculate}
          className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded text-sm transition-colors"
        >
          {loading ? 'Calculating…' : 'Calculate Diversion'}
        </button>
      </div>
    </div>
  )
}
