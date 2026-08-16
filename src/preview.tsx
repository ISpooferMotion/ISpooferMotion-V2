import './index.css';
import './utils/debugLogger';
import { installBrowserTauriMock } from './utils/browserTauriMock';

installBrowserTauriMock();

import React, { Suspense, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import {
  ChevronDown,
  Eye,
  Image as ImageIcon,
  Loader2,
  Minus,
  Pin,
  PinOff,
  Play,
  Square,
  Volume2,
  X,
} from 'lucide-react';

import { Button } from './components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './components/ui/popover';
import { TooltipProvider } from './components/ui/tooltip';
import { ConfigProvider, useConfig } from './contexts/ConfigContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { cn } from './utils/cn';
import { playRobloxAudio, stopRobloxAudio } from './utils/robloxAudio';
import type { ParsedAssetRef } from './utils/robloxPlaceParser/types';

const AnimationPreview = React.lazy(() => import('./components/shared/AnimationPreview'));

function PreviewApp() {
  const { config } = useConfig();
  const [asset, setAsset] = useState<ParsedAssetRef | null>(() => {
    try {
      const stored = localStorage.getItem('preview-current-asset');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const [isPinned, setIsPinned] = useState(true);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);

  const [imageZoom, setImageZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const assetId = asset?.assetId || '';
  const isImage = asset?.type === 'image';
  const isMesh = asset?.type === 'mesh';
  const isAudio = asset?.type === 'audio';
  const isAnimation = asset?.type === 'animation' || asset?.type === 'raw_keyframe_sequence';

  // Reset zoom on asset change
  useEffect(() => {
    setImageZoom(1);
    setPan({ x: 0, y: 0 });
  }, [assetId]);

  // Listen for asset change events from the main window
  useEffect(() => {
    const unlistenPromise = listen<ParsedAssetRef>('preview-asset-change', (event) => {
      if (event.payload) {
        setAsset(event.payload);
        try {
          localStorage.setItem('preview-current-asset', JSON.stringify(event.payload));
        } catch {
          // ignore
        }
      }
    });

    // Notify main window that preview window is ready to receive data
    void emit('preview-window-ready');

    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, []);

  // Fetch thumbnail for images/meshes
  useEffect(() => {
    if (!assetId || (!isImage && !isMesh)) {
      setThumbnailUrl(null);
      return;
    }

    setLoading(true);
    setError(false);
    invoke<string | null>('fetch_roblox_thumbnail', { assetId })
      .then((url) => {
        if (url) {
          setThumbnailUrl(url);
        } else if (isImage) {
          setThumbnailUrl(`https://assetdelivery.roblox.com/v1/asset/?id=${assetId}`);
        } else {
          setError(true);
        }
      })
      .catch(() => {
        if (isImage) {
          setThumbnailUrl(`https://assetdelivery.roblox.com/v1/asset/?id=${assetId}`);
        } else {
          setError(true);
        }
      })
      .finally(() => setLoading(false));
  }, [assetId, isImage, isMesh]);

  const togglePin = async () => {
    const nextPinned = !isPinned;
    setIsPinned(nextPinned);
    try {
      await getCurrentWindow().setAlwaysOnTop(nextPinned);
    } catch (e) {
      console.warn('Failed to toggle always on top', e);
    }
  };

  const handleMinimize = () => {
    getCurrentWindow().minimize();
  };

  const handleClose = async () => {
    try {
      await emit('preview-window-closed');
    } catch {}
    try {
      await getCurrentWindow().destroy();
    } catch {
      await getCurrentWindow().close();
    }
  };

  const handlePlayAudio = async () => {
    if (playingAudioId === assetId) {
      stopRobloxAudio();
      setPlayingAudioId(null);
      return;
    }

    setPlayingAudioId(assetId);
    await playRobloxAudio(assetId, config).catch((err) => {
      console.error('Failed to play audio:', err);
      setPlayingAudioId(null);
    });
  };

  const displayName = asset?.instanceName || asset?.propertyName || assetId || 'Asset Preview';

  return (
    <div
      className={cn(
        'w-full h-full bg-bg-surface/95 backdrop-blur-xl border rounded-xl shadow-2xl flex flex-col overflow-hidden',
        isPinned ? 'border-primary/50 shadow-primary/20 ring-1 ring-primary/30' : 'border-border',
      )}
    >
      {/* Titlebar */}
      <div className="h-9 px-3 bg-bg-elevated/90 border-b border-border flex items-center justify-between drag-region shrink-0">
        <div className="flex items-center gap-2 text-xs font-semibold text-foreground truncate min-w-0">
          <Eye size={13} className="text-primary shrink-0" />
          <span className="truncate">{displayName}</span>
        </div>

        <div className="flex items-center gap-1 no-drag shrink-0">
          <button
            type="button"
            onClick={togglePin}
            className={cn(
              'h-6 px-2 rounded flex items-center gap-1 text-[10px] font-bold transition-colors cursor-pointer',
              isPinned
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground hover:bg-bg-surface',
            )}
            title={isPinned ? 'Unpin Window' : 'Always On Top (Pinned)'}
          >
            {isPinned ? <Pin size={11} /> : <PinOff size={11} />}
            <span>{isPinned ? 'Pinned' : 'Pin'}</span>
          </button>
          <button
            type="button"
            onClick={handleMinimize}
            className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-bg-surface transition-colors cursor-pointer"
            title="Minimize window"
          >
            <Minus size={12} />
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
            title="Close / Dock Preview"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Viewport Content */}
      <div className="flex-1 relative overflow-hidden bg-bg-base flex items-center justify-center">
        {!asset ? (
          <div className="text-xs text-text-muted flex flex-col items-center gap-2 p-6 text-center">
            <Eye size={28} className="opacity-30 text-primary animate-pulse" />
            <span>Select an asset in ISpooferMotion to preview</span>
          </div>
        ) : isAnimation ? (
          <Suspense
            fallback={
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            }
          >
            <AnimationPreview assetId={assetId} assetName={asset.instanceName} inline />
          </Suspense>
        ) : isImage || isMesh ? (
          <div
            className="w-full h-full flex items-center justify-center p-4 bg-checkerboard bg-[size:16px_16px] relative overflow-hidden cursor-grab active:cursor-grabbing select-none"
            onWheel={(e) => {
              e.preventDefault();
              const delta = e.deltaY > 0 ? -0.2 : 0.2;
              setImageZoom((prev) => Math.max(0.25, Math.min(8, +(prev + delta).toFixed(2))));
            }}
            onMouseDown={(e) => {
              if (e.button === 0) {
                setIsDraggingImage(true);
                dragStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
              }
            }}
            onMouseMove={(e) => {
              if (isDraggingImage) {
                setPan({
                  x: e.clientX - dragStartRef.current.x,
                  y: e.clientY - dragStartRef.current.y,
                });
              }
            }}
            onMouseUp={() => setIsDraggingImage(false)}
            onMouseLeave={() => setIsDraggingImage(false)}
          >
            {loading ? (
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            ) : error ? (
              <div className="text-xs text-destructive flex flex-col items-center gap-2">
                <ImageIcon size={24} className="opacity-40" />
                <span>Failed to load preview</span>
              </div>
            ) : thumbnailUrl ? (
              <img
                src={thumbnailUrl}
                alt=""
                className="max-w-full max-h-full object-contain rounded shadow-lg border border-border pointer-events-none transition-transform duration-75"
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${imageZoom})`,
                }}
                draggable={false}
                onError={() => setError(true)}
              />
            ) : (
              <div className="text-xs text-text-muted flex flex-col items-center gap-2">
                <ImageIcon size={24} className="opacity-40" />
                <span>No preview available</span>
              </div>
            )}

            {/* Floating Zoom Controls Overlay */}
            {thumbnailUrl && !loading && !error && (
              <div
                className="absolute bottom-3 right-3 flex items-center gap-1 bg-bg-surface/90 border border-border-subtle rounded-md px-1.5 py-0.5 shadow-md backdrop-blur-xs select-none z-10"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => setImageZoom((prev) => Math.max(0.25, +(prev - 0.25).toFixed(2)))}
                  className="h-5 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground text-xs font-bold rounded cursor-pointer"
                  title="Zoom Out"
                >
                  -
                </button>
                <Popover>
                  <PopoverTrigger
                    render={
                      <button
                        type="button"
                        className="h-5 px-1.5 flex items-center gap-0.5 text-[10px] font-mono font-semibold text-text-secondary hover:text-foreground rounded cursor-pointer"
                      >
                        <span>{Math.round(imageZoom * 100)}%</span>
                        <ChevronDown size={9} />
                      </button>
                    }
                  />
                  <PopoverContent
                    align="end"
                    side="top"
                    sideOffset={4}
                    className="w-20 p-1 bg-bg-surface border border-border shadow-xl rounded-md z-[350]"
                  >
                    <div className="flex flex-col gap-0.5">
                      {[0.5, 1, 1.5, 2, 4].map((z) => (
                        <button
                          key={z}
                          type="button"
                          onClick={() => {
                            setImageZoom(z);
                            setPan({ x: 0, y: 0 });
                          }}
                          className={cn(
                            'flex items-center justify-between px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors text-left',
                            imageZoom === z
                              ? 'bg-primary text-primary-foreground font-bold'
                              : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated',
                          )}
                        >
                          <span>{Math.round(z * 100)}%</span>
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <button
                  type="button"
                  onClick={() => setImageZoom((prev) => Math.min(8, +(prev + 0.25).toFixed(2)))}
                  className="h-5 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground text-xs font-bold rounded cursor-pointer"
                  title="Zoom In"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setImageZoom(1);
                    setPan({ x: 0, y: 0 });
                  }}
                  className="h-5 px-1 flex items-center justify-center text-muted-foreground hover:text-foreground text-[9px] font-medium border-l border-border-subtle/50 ml-0.5 cursor-pointer"
                  title="Reset Zoom"
                >
                  Reset
                </button>
              </div>
            )}
          </div>
        ) : isAudio ? (
          <div className="w-full h-full flex flex-col items-center justify-center p-6 gap-3 bg-gradient-to-b from-bg-base/30 to-bg-base/70">
            <div className="w-14 h-12 flex items-center justify-center bg-primary/10 border border-primary/20 rounded-xl">
              <Volume2 size={24} className="text-primary" />
            </div>
            <Button
              size="sm"
              variant={playingAudioId === assetId ? 'destructive' : 'default'}
              className="h-8 px-4 gap-2 font-semibold text-xs shadow-sm"
              onClick={handlePlayAudio}
            >
              {playingAudioId === assetId ? (
                <>
                  <Square size={12} fill="currentColor" /> Stop Audio
                </>
              ) : (
                <>
                  <Play size={12} fill="currentColor" /> Play Audio
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="text-xs text-text-muted">No visual preview for this asset type</div>
        )}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('preview-root')!).render(
  <React.StrictMode>
    <LanguageProvider>
      <ConfigProvider>
        <TooltipProvider>
          <PreviewApp />
        </TooltipProvider>
      </ConfigProvider>
    </LanguageProvider>
  </React.StrictMode>,
);
