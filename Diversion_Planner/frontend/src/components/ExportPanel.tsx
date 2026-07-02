import { useState } from 'react'
import { getPdfUrl, getGeojsonUrl, getStakeholders } from '../api/client'
import type { Stakeholder } from '../types'

interface Props {
  closureId: string | null
}

const CATEGORY_LABEL: Record<string, string> = {
  local_authority: 'Local Authority',
  police: 'Police',
  ambulance: 'Ambulance',
  fire: 'Fire & Rescue',
  national_highways: 'National Highways',
}

const CATEGORY_COLOR: Record<string, string> = {
  local_authority: 'bg-blue-100 text-blue-700',
  police: 'bg-indigo-100 text-indigo-700',
  ambulance: 'bg-green-100 text-green-700',
  fire: 'bg-red-100 text-red-700',
  national_highways: 'bg-yellow-100 text-yellow-800',
}

export default function ExportPanel({ closureId }: Props) {
  const [ttroRef, setTtroRef] = useState('TTRO/2026/M25/001')
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([])
  const [loadingSt, setLoadingSt] = useState(false)
  const [stError, setStError] = useState<string | null>(null)

  const loadStakeholders = async () => {
    if (!closureId) return
    setLoadingSt(true)
    setStError(null)
    try {
      const data = await getStakeholders(closureId)
      setStakeholders(data)
    } catch {
      setStError('Failed to load stakeholders. Generate routes first.')
    } finally {
      setLoadingSt(false)
    }
  }

  if (!closureId) {
    return (
      <div className="text-center text-gray-400 py-12">
        <p className="text-4xl mb-3">📄</p>
        <p className="text-sm">Create a closure first to export consultation packs.</p>
      </div>
    )
  }

  const grouped = stakeholders.reduce<Record<string, Stakeholder[]>>((acc, s) => {
    ;(acc[s.category] ??= []).push(s)
    return acc
  }, {})

  return (
    <div className="space-y-5">
      <h2 className="font-bold text-nh-blue text-lg border-b border-gray-200 pb-2">Export & Stakeholders</h2>

      <div>
        <label className="label">TTRO Reference</label>
        <input
          className="input"
          value={ttroRef}
          onChange={e => setTtroRef(e.target.value)}
          placeholder="TTRO/2026/M25/001"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <a
          href={getPdfUrl(closureId, ttroRef)}
          download
          className="btn-primary text-center text-sm py-2.5"
        >
          Download PDF
        </a>
        <a
          href={getGeojsonUrl(closureId)}
          download
          className="btn-secondary text-center text-sm py-2.5"
        >
          Download GeoJSON
        </a>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Affected Stakeholders</p>
          <button type="button" onClick={loadStakeholders} disabled={loadingSt} className="text-xs text-nh-blue hover:underline">
            {loadingSt ? 'Loading…' : 'Identify'}
          </button>
        </div>
        {stError && <p className="text-red-600 text-xs">{stError}</p>}
        {stakeholders.length > 0 ? (
          <div className="space-y-3">
            {Object.entries(grouped).map(([cat, list]) => (
              <div key={cat}>
                <p className="text-xs font-medium text-gray-500 mb-1">{CATEGORY_LABEL[cat] ?? cat}</p>
                <div className="space-y-1">
                  {list.map(s => (
                    <div key={s.id} className="flex items-start justify-between text-xs border border-gray-100 rounded p-2">
                      <div>
                        <span className={`inline-block text-xs px-1.5 py-0.5 rounded mr-2 ${CATEGORY_COLOR[s.category]}`}>
                          {CATEGORY_LABEL[s.category]}
                        </span>
                        <span className="font-medium">{s.name}</span>
                      </div>
                      {s.contact_email && (
                        <a href={`mailto:${s.contact_email}`} className="text-nh-blue hover:underline ml-2 shrink-0">
                          {s.contact_email}
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          !stError && <p className="text-xs text-gray-400">Click Identify to find affected stakeholders.</p>
        )}
      </div>
    </div>
  )
}
