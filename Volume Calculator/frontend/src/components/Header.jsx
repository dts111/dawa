import { Mountain } from 'lucide-react'

export default function Header() {
  return (
    <header className="border-b border-slate-700 bg-brand-800">
      <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-3">
        <div className="p-2 bg-brand-500 rounded-lg">
          <Mountain className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">
            LandXML Volume Calculator
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Cut &amp; Fill earthwork analysis from TIN surfaces
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-full text-xs bg-brand-500/20 text-brand-400 border border-brand-500/30 font-medium">
            v1.0
          </span>
        </div>
      </div>
    </header>
  )
}
