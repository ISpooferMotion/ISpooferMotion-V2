import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDown,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useLanguage } from '../../contexts/LanguageContext';
import { cn } from '../../utils/cn';
import {
  clearDebugLogs,
  getDebugLogs,
  type LogEntry,
  subscribeDebugLogs,
} from '../../utils/debugLogger';
import { Button } from '../ui/button';
import { JsonViewer } from '../ui/JsonViewer';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

function useLogs() {
  const [logs, setLogs] = useState<LogEntry[]>(getDebugLogs());
  useEffect(() => {
    return subscribeDebugLogs(setLogs);
  }, []);
  return logs;
}

interface DebugConsoleProps {
  isOpen: boolean;
  onClose: () => void;
  /** When true, fill the parent container instead of rendering as a bottom drawer. */
  fill?: boolean;
}

const LEVEL_CONFIG: Record<string, { color: string; bg: string; border: string; dot: string }> = {
  error: {
    color: 'text-red-400',
    bg: 'bg-red-500/5',
    border: 'border-red-500/10',
    dot: 'bg-red-500',
  },
  warn: {
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/5',
    border: 'border-yellow-500/10',
    dot: 'bg-yellow-500',
  },
  success: {
    color: 'text-green-400',
    bg: 'bg-green-500/5',
    border: 'border-green-500/10',
    dot: 'bg-green-500',
  },
  info: {
    color: 'text-blue-400',
    bg: 'bg-blue-500/5',
    border: 'border-blue-500/10',
    dot: 'bg-blue-500',
  },
};

const SOURCE_CONFIG: Record<string, { label: string; tag: string }> = {
  ism: { label: 'ISM', tag: 'text-primary/60' },
  console: { label: 'DEV', tag: 'text-muted-foreground/60' },
};

/**
 * A clean developer console for inspecting debug logs, errors, and ISM output.
 * Supports filtering by source and level, copy, clear, and auto-scroll.
 * Log entries are collapsed to a single line by default and expand on click.
 */
export default function DebugConsole({ isOpen, onClose, fill = false }: DebugConsoleProps) {
  const { t } = useLanguage();
  const logs = useLogs();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [filterSource, setFilterSource] = useState<string>('all');
  const [filterLevels, setFilterLevels] = useState<string[]>(['info', 'success', 'warn', 'error']);
  const [isCopied, setIsCopied] = useState(false);
  const [showGoToBottom, setShowGoToBottom] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const isAutoScrollEnabled = useRef(true);

  const handleScroll = () => {
    if (scrollContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
      const atBottom = scrollHeight - scrollTop - clientHeight < 50;
      isAutoScrollEnabled.current = atBottom;
      setShowGoToBottom(!atBottom);
    }
  };

  const scrollToBottom = () => {
    if (scrollContainerRef.current) {
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTo({
            top: scrollContainerRef.current.scrollHeight,
            behavior: 'smooth',
          });
        }
      });
      isAutoScrollEnabled.current = true;
      setShowGoToBottom(false);
    }
  };

  const filteredLogs = logs.filter(
    (log) =>
      (filterSource === 'all' || log.source === filterSource) && filterLevels.includes(log.level),
  );

  const groupedLogs = filteredLogs.reduce(
    (acc, currentLog) => {
      const lastLog = acc[acc.length - 1];
      if (
        lastLog &&
        lastLog.message === currentLog.message &&
        lastLog.source === currentLog.source &&
        lastLog.level === currentLog.level
      ) {
        lastLog.count += 1;
        lastLog.timestamp = currentLog.timestamp;
      } else {
        acc.push({ ...currentLog, count: 1 });
      }
      return acc;
    },
    [] as (LogEntry & { count: number })[],
  );

  useEffect(() => {
    if (isOpen && scrollContainerRef.current && isAutoScrollEnabled.current) {
      const container = scrollContainerRef.current;
      container.scrollTop = container.scrollHeight;
    }
  }, [groupedLogs, isOpen]);

  const handleCopy = () => {
    const text = filteredLogs
      .map(
        (l) =>
          `[${l.timestamp}] [${l.source.toUpperCase()}] ${l.level.toUpperCase()}: ${l.message}`,
      )
      .join('\n');
    navigator.clipboard.writeText(text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const toggleLevel = (val: string) => {
    setFilterLevels((prev) =>
      prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val],
    );
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const sources = [
    { value: 'all', label: 'All' },
    { value: 'ism', label: 'ISM' },
    { value: 'console', label: 'DEV' },
  ];

  const levels = [
    { value: 'info', label: 'Info' },
    { value: 'success', label: 'Success' },
    { value: 'warn', label: 'Warn' },
    { value: 'error', label: 'Error' },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="debug-console"
          initial={fill ? { opacity: 0 } : { y: '100%', opacity: 0.5 }}
          animate={fill ? { opacity: 1 } : { y: 0, opacity: 1 }}
          exit={fill ? { opacity: 0 } : { y: '100%', opacity: 0.5 }}
          transition={fill ? { duration: 0.2 } : { type: 'spring', damping: 25, stiffness: 200 }}
          className={cn(
            'w-full bg-background/95 backdrop-blur-2xl flex flex-col z-40 overflow-hidden',
            fill
              ? 'h-full'
              : 'h-1/3 border-t border-border-subtle shadow-[0_-10px_40px_rgba(0,0,0,0.3)]',
          )}
        >
          {/* Header bar */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle bg-bg-surface/50 shrink-0">
            <div className="flex items-center gap-3">
              {!fill && (
                <div className="flex items-center gap-2 text-muted-foreground text-[11px] font-bold uppercase tracking-widest">
                  <Terminal size={14} className="text-primary" />
                  {t('debug.title')}
                </div>
              )}

              {/* Source filter — compact pill toggles */}
              <div className="flex items-center gap-1 bg-bg-base/60 rounded-md p-0.5">
                {sources.map((src) => (
                  <button
                    key={src.value}
                    type="button"
                    onClick={() => setFilterSource(src.value)}
                    className={cn(
                      'px-2 h-6 rounded text-[10px] font-bold uppercase tracking-wider transition-all',
                      filterSource === src.value
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-text-primary',
                    )}
                  >
                    {src.label}
                  </button>
                ))}
              </div>

              {/* Level filter — colored dot toggles */}
              <div className="flex items-center gap-1">
                {levels.map((lvl) => {
                  const active = filterLevels.includes(lvl.value);
                  const config = LEVEL_CONFIG[lvl.value];
                  return (
                    <Tooltip key={lvl.value}>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            onClick={() => toggleLevel(lvl.value)}
                            className={cn(
                              'flex items-center gap-1.5 px-2 h-6 rounded text-[10px] font-semibold transition-all',
                              active
                                ? `${config.color} bg-bg-base/80 border border-border-subtle`
                                : 'text-muted-foreground/40 hover:text-muted-foreground border border-transparent',
                            )}
                          />
                        }
                      >
                        <span
                          className={cn(
                            'w-1.5 h-1.5 rounded-full shrink-0',
                            active ? config.dot : 'bg-muted-foreground/30',
                          )}
                        />
                        {lvl.label}
                      </TooltipTrigger>
                      <TooltipContent>Toggle {lvl.label} logs</TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-text-muted font-mono mr-2">
                {filteredLogs.length} {filteredLogs.length === 1 ? 'entry' : 'entries'}
              </span>

              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-primary"
                      onClick={handleCopy}
                      aria-label={t('debug.copyLogs')}
                    >
                      {isCopied ? <Check size={14} className="text-primary" /> : <Copy size={14} />}
                    </Button>
                  }
                />
                <TooltipContent>{t('debug.copyLogs')}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => clearDebugLogs()}
                      aria-label={t('debug.clearLogs')}
                    >
                      <Trash2 size={14} />
                    </Button>
                  }
                />
                <TooltipContent>{t('debug.clearLogs')}</TooltipContent>
              </Tooltip>

              {!fill && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        onClick={onClose}
                        aria-label={t('debug.hideConsole')}
                      >
                        <X size={14} />
                      </Button>
                    }
                  />
                  <TooltipContent>{t('debug.hideConsole')}</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>

          {/* Scroll-to-bottom floating button */}
          <AnimatePresence>
            {showGoToBottom && (
              <motion.button
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                onClick={scrollToBottom}
                className="absolute bottom-4 right-6 bg-bg-surface text-foreground border border-border-subtle px-2.5 py-1.5 rounded-full text-[10px] font-semibold flex items-center gap-1.5 shadow-lg hover:bg-bg-elevated hover:text-primary transition-colors z-50"
              >
                <ArrowDown size={12} /> {t('debug.goToBottom')}
              </motion.button>
            )}
          </AnimatePresence>

          {/* Log entries */}
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto px-2 py-2 font-mono text-[11px] flex flex-col gap-0.5 selection:bg-primary/30"
            style={{ overflowAnchor: 'none' }}
          >
            {groupedLogs.length === 0 ? (
              <div className="text-muted-foreground/50 italic flex flex-col items-center justify-center h-full gap-2">
                <Terminal size={32} className="opacity-20" />
                <span>{t('debug.noLogs')}</span>
              </div>
            ) : (
              groupedLogs.map((log, index) => {
                const config = LEVEL_CONFIG[log.level] ?? LEVEL_CONFIG.info;
                const sourceCfg = SOURCE_CONFIG[log.source] ?? {
                  label: log.source.toUpperCase(),
                  tag: 'text-muted-foreground/60',
                };
                const rowKey = `${log.id}-${index}`;
                const isExpanded = expandedIds.has(rowKey);
                const firstLine = log.message ? log.message.split('\n')[0] : '';
                const hasMultipleLines = log.message && log.message.includes('\n');
                const hasPayload = log.payload && log.payload.length > 0;
                const isExpandable = hasMultipleLines || hasPayload;

                return (
                  <div
                    key={rowKey}
                    className={cn(
                      'rounded border transition-colors cursor-default',
                      config.bg,
                      config.border,
                      'hover:bg-bg-elevated/40',
                      isExpanded ? 'py-1 px-2' : 'h-7 py-0 px-2',
                    )}
                    onClick={() => isExpandable && toggleExpanded(rowKey)}
                  >
                    {/* Top row — always identical, never moves on expand/collapse */}
                    <div className="flex items-center gap-1.5 h-7 min-w-0">
                      {isExpandable &&
                        (isExpanded ? (
                          <ChevronDown size={11} className="shrink-0 text-muted-foreground/60" />
                        ) : (
                          <ChevronRight size={11} className="shrink-0 text-muted-foreground/40" />
                        ))}
                      <span
                        className={cn('uppercase shrink-0 font-bold select-none', config.color)}
                      >
                        {log.level}
                      </span>
                      <span
                        className={cn('shrink-0 font-bold select-none opacity-50', sourceCfg.tag)}
                      >
                        [{sourceCfg.label}]
                      </span>
                      {log.count > 1 && (
                        <span className="shrink-0 bg-border/40 text-foreground px-1 rounded font-bold text-[9px] select-none">
                          ×{log.count}
                        </span>
                      )}
                      <span className="text-text-primary/90 truncate flex-1 min-w-0">
                        {firstLine}
                      </span>
                      <span className="text-muted-foreground/40 shrink-0 select-none tabular-nums text-[9px]">
                        {log.timestamp}
                      </span>
                    </div>

                    {/* Expanded content — appears below the fixed top row */}
                    {isExpanded && (
                      <div className="flex flex-col gap-1 pl-4 pt-1">
                        {log.message && hasMultipleLines && (
                          <span className="text-text-primary/90 whitespace-pre-wrap leading-relaxed break-words">
                            {log.message
                              .split('\n')
                              .slice(1)
                              .map((line, i) => {
                                const isTrace = /^\s*at\s+/.test(line);
                                if (isTrace) {
                                  return (
                                    <div key={i} className="text-muted-foreground/70 pl-4">
                                      ↳ at {line.replace(/^\s*at\s+/, '')}
                                    </div>
                                  );
                                }
                                return <div key={i}>{line}</div>;
                              })}
                          </span>
                        )}
                        {hasPayload && (
                          <div className="flex flex-col gap-1.5 mt-1">
                            {log.payload!.map((p, i) => (
                              <div
                                key={i}
                                className="bg-bg-base/40 rounded-md p-1.5 border border-border-subtle/30 overflow-x-auto"
                              >
                                <JsonViewer data={p} defaultExpanded={log.level === 'error'} />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
