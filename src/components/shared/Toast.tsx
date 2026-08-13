import { useEffect } from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';
import { useSpooferStore } from '../../stores/spooferStore';
import { cn } from '../../utils/cn';

export const Toast = () => {
  const toast = useSpooferStore((s) => s.toast);
  const dismiss = useSpooferStore((s) => s.dismissToast);

  useEffect(() => {
    if (!toast) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toast, dismiss]);

  if (!toast) return null;

  const { level, message } = toast;
  const Icon = level === 'success' ? CheckCircle2 : level === 'error' ? XCircle : Info;
  const colour =
    level === 'success'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
      : level === 'error'
        ? 'border-red-500/40 bg-red-500/10 text-red-100'
        : 'border-blue-500/40 bg-blue-500/10 text-blue-100';

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[100] pointer-events-auto"
    >
      <div
        className={cn(
          'flex items-start gap-3 px-4 py-3 rounded-lg border shadow-lg backdrop-blur-md max-w-sm',
          'animate-in slide-in-from-bottom-4 fade-in duration-200',
          colour,
        )}
      >
        <Icon size={18} className="shrink-0 mt-0.5" />
        <p className="text-sm font-medium leading-snug flex-1">{message}</p>
        <button
          onClick={dismiss}
          className="opacity-60 hover:opacity-100 transition-opacity shrink-0"
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};
