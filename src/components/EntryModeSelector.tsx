import { FileText, Zap } from 'lucide-react';

interface EntryModeSelectorProps {
  mode: 'manual' | 'auto';
  onChange: (mode: 'manual' | 'auto') => void;
}

export default function EntryModeSelector({ mode, onChange }: EntryModeSelectorProps) {
  return (
    <div className="flex gap-4">
      <button
        onClick={() => onChange('manual')}
        className={`flex flex-col items-start gap-1 px-4 py-3 rounded-lg font-medium transition-colors border-2 ${
          mode === 'manual'
            ? 'bg-blue-50 text-blue-900 border-blue-500 shadow-sm'
            : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
        }`}
      >
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4" />
          <span>Manual Entry</span>
        </div>
        <span className="text-xs font-normal text-slate-600">
          Enter EPG names manually
        </span>
      </button>
      <button
        onClick={() => onChange('auto')}
        className={`flex flex-col items-start gap-1 px-4 py-3 rounded-lg font-medium transition-colors border-2 ${
          mode === 'auto'
            ? 'bg-green-50 text-green-900 border-green-500 shadow-sm'
            : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
        }`}
      >
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4" />
          <span>Auto Parse</span>
        </div>
        <span className="text-xs font-normal text-slate-600">
          Extract EPG from moquery
        </span>
      </button>
    </div>
  );
}
