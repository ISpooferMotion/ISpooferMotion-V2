import { ArrowRight, CheckCircle2, Circle, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { cn } from '../../lib/utils';

export interface TutorialStep {
  id: string;
  title: string;
  body: string;

  onEnter?: () => void;

  isComplete?: () => boolean;

  waitingHint?: string;
}

interface TutorialProps {
  steps: TutorialStep[];
  onComplete: () => void;
  onSkip: () => void;

  beforeStep?: (nextId: string | null) => void | Promise<void>;
}

export const Tutorial = ({ steps, onComplete, onSkip, beforeStep }: TutorialProps) => {
  const [stepIndex, setStepIndex] = useState(0);
  const onEnteredRef = useRef<Set<string>>(new Set());

  const advance = () => {
    const nextIdx = stepIndex + 1;
    const nextId = nextIdx >= steps.length ? null : steps[nextIdx].id;
    const finish = nextId === null;
    const run = () => {
      if (finish) {
        onComplete();
        return;
      }
      setStepIndex(nextIdx);
      const next = steps[nextIdx];
      if (next && !onEnteredRef.current.has(next.id)) {
        onEnteredRef.current.add(next.id);
        next.onEnter?.();
      }
    };
    if (beforeStep) {
      const result = beforeStep(nextId);
      if (result && typeof (result as Promise<void>).then === 'function') {
        (result as Promise<void>).then(run);
      } else {
        run();
      }
    } else {
      run();
    }
  };

  useEffect(() => {
    const first = steps[0];
    if (first && !onEnteredRef.current.has(first.id)) {
      onEnteredRef.current.add(first.id);
      first.onEnter?.();
    }
  }, []);

  const step = steps[stepIndex];
  if (!step) return null;

  const isStepComplete = step.isComplete ? step.isComplete() : true;
  const isLast = stepIndex + 1 === steps.length;
  const isRunStep = step.id === 'run';

  return (
    <>
      <div
        key="tutorial-card"
        className={cn(
          'fixed z-[200] w-[280px] max-w-[calc(100vw-32px)] bg-bg-surface border border-border-subtle rounded-xl shadow-2xl p-3 flex flex-col gap-2.5',
          isRunStep ? 'bottom-4 left-4' : 'bottom-4 right-4',
        )}
        role="dialog"
        aria-modal="false"
        aria-label="Tutorial"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-text-primary leading-tight">{step.title}</h3>
            <p className="text-[11px] text-text-muted mt-0.5">
              Step {stepIndex + 1} of {steps.length}
            </p>
          </div>
          <button
            onClick={onSkip}
            className="opacity-50 hover:opacity-100 transition-opacity shrink-0"
            aria-label="Skip tutorial"
          >
            <X size={15} />
          </button>
        </div>

        <p className="text-[12.5px] text-text-secondary leading-relaxed">{step.body}</p>

        {!isStepComplete && step.waitingHint && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-primary/10 border border-primary/20">
            <Circle size={12} className="text-primary shrink-0 mt-0.5" />
            <p className="text-[11.5px] text-primary font-medium leading-snug">
              {step.waitingHint}
            </p>
          </div>
        )}

        <div className="flex items-center gap-1">
          {steps.map((s, i) => (
            <div
              key={s.id}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors',
                i < stepIndex
                  ? 'bg-primary'
                  : i === stepIndex
                    ? isStepComplete
                      ? 'bg-primary'
                      : 'bg-primary/40'
                    : 'bg-bg-elevated',
              )}
            />
          ))}
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onSkip}
            className="px-3 h-8 rounded-md text-[11px] font-medium text-text-muted hover:text-text-primary transition-colors"
          >
            Skip tutorial
          </button>
          <button
            onClick={advance}
            disabled={!isStepComplete}
            className={cn(
              'flex items-center gap-1.5 px-3.5 h-8 rounded-md text-[11px] font-semibold transition-colors',
              isStepComplete
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-bg-elevated text-text-muted cursor-not-allowed border border-border-subtle',
            )}
          >
            {isLast ? (
              <>
                <CheckCircle2 size={13} />
                Finish
              </>
            ) : (
              <>
                Next
                <ArrowRight size={13} />
              </>
            )}
          </button>
        </div>
      </div>
    </>
  );
};
