function Section({ title, items, dotColor }) {
  if (!items?.length) return null
  return (
    <div className="mb-3">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
        <span className={`inline-block w-2 h-2 rounded-full ${dotColor}`} />
        {title}
      </p>
      {items.map((item, i) => (
        <p
          key={i}
          className="text-sm text-gray-800 py-0.5 pl-3.5 border-l-2 border-gray-200 leading-snug"
        >
          {item}
        </p>
      ))}
    </div>
  )
}

export default function ConsultPanel({ stakeholders, loading }) {
  if (loading) {
    return (
      <div className="p-4 text-center">
        <p className="text-sm text-gray-500">Identifying consultation bodies&hellip;</p>
        <p className="text-xs text-gray-400 mt-1">This takes ~10 seconds</p>
      </div>
    )
  }

  const hasManual = stakeholders.areas?.some((a) => a.includes('verify manually'))
  const hasResults =
    stakeholders.councils?.length ||
    stakeholders.police?.length ||
    stakeholders.ambulance?.length ||
    stakeholders.fire?.length

  return (
    <div className="p-4">
      <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">
        Consultation Required
      </h2>

      {stakeholders.areas?.length > 0 && (
        <p className="text-xs text-gray-400 mb-3">
          Route passes through: {stakeholders.areas.join(', ')}
        </p>
      )}

      {hasResults ? (
        <>
          <Section title="Local Council" items={stakeholders.councils} dotColor="bg-purple-400" />
          <Section title="Police" items={stakeholders.police} dotColor="bg-blue-500" />
          <Section title="Ambulance Service" items={stakeholders.ambulance} dotColor="bg-green-500" />
          <Section title="Fire & Rescue" items={stakeholders.fire} dotColor="bg-orange-500" />
        </>
      ) : (
        <p className="text-sm text-gray-500">No matching areas found. Verify consultation bodies manually.</p>
      )}

      {hasManual && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mt-3">
          Some areas were not automatically matched. Please verify those consultation bodies manually.
        </p>
      )}
    </div>
  )
}
