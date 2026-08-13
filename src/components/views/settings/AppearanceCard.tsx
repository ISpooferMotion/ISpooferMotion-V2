import { AnimatePresence, motion } from 'framer-motion';
import { Palette } from 'lucide-react';
import { useCallback, useEffect, useState, useRef } from 'react';
import { HexAlphaColorPicker } from 'react-colorful';
import { createPortal } from 'react-dom';

import { useLanguage } from '../../../contexts/LanguageContext';
import { useThemeAccent } from '../../../contexts/ThemeContext';
import { cn } from '../../../utils/cn';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Label } from '../../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';

export default function AppearanceCard() {
  const { t, lang, setLang } = useLanguage();
  const { accentColor, setAccentColor, themeMode, setThemeMode } = useThemeAccent();
  const [localAccent, setLocalAccent] = useState(accentColor);
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const [pickerCoords, setPickerCoords] = useState({ top: 0, left: 0 });
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const langOptions = {
    en: '🇬🇧 English',
    es: '🇪🇸 Español',
    ru: '🇷🇺 Русский',
    fr: '🇫🇷 Français',
  };

  useEffect(() => {
    setLocalAccent(accentColor);
  }, [accentColor]);

  useEffect(() => {
    if (!isColorPickerOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsColorPickerOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isColorPickerOpen]);

  const handleColorChange = useCallback(
    (hex: string) => {
      setLocalAccent((prev) => {
        if (prev === hex) return prev;
        return hex;
      });
      document.documentElement.style.setProperty('--primary', hex);

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        setAccentColor(hex);
      }, 50);
    },
    [setAccentColor],
  );

  return (
    <Card className="bg-bg-surface/50 border border-border-subtle shadow-sm overflow-hidden">
      <CardHeader className="pb-3 border-b border-border-subtle/40 bg-bg-base/20">
        <CardTitle className="text-base font-bold flex items-center gap-2 text-text-primary">
          <Palette size={16} className="text-primary" />
          {t('settings.appearance')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-lg border border-border-subtle/60 bg-bg-base/40">
          <Label className="text-sm font-semibold text-text-primary">{t('settings.theme')}</Label>
          <div className="flex bg-card border border-border rounded-md p-1 overflow-hidden w-40 shrink-0 shadow-sm">
            {(['light', 'dark'] as const).map((tMode) => (
              <button
                key={tMode}
                onClick={() => setThemeMode(tMode)}
                className={cn(
                  'flex-1 py-1.5 text-xs font-medium rounded-sm transition-all flex items-center justify-center gap-1.5',
                  themeMode === tMode
                    ? 'bg-foreground text-background shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                )}
              >
                {tMode === 'light' ? '☀️ ' : '🌙 '}
                {t(`settings.theme${tMode.charAt(0).toUpperCase() + tMode.slice(1)}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="relative">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-lg border border-border-subtle/60 bg-bg-base/40">
            <Label className="text-sm font-semibold text-text-primary">
              {t('settings.accentColor')}
            </Label>
            <div
              className="w-7 h-7 rounded-full border border-border cursor-pointer shadow-sm transition-transform hover:scale-105 shrink-0"
              style={{ backgroundColor: accentColor }}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                setPickerCoords({
                  top: rect.bottom + 8,
                  left: rect.right - 200,
                });
                setIsColorPickerOpen((prev) => !prev);
              }}
            />
          </div>

          {createPortal(
            <AnimatePresence>
              {isColorPickerOpen && (
                <div className="fixed inset-0 z-9999 pointer-events-none">
                  <div
                    className="absolute inset-0 z-490 pointer-events-auto"
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                      setIsColorPickerOpen(false);
                    }}
                  />

                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: -10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -10 }}
                    className="absolute z-500 p-0 border border-border rounded-xl overflow-hidden shadow-lg bg-card flex flex-col pointer-events-auto"
                    onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    style={{
                      top: pickerCoords.top,
                      left: pickerCoords.left,
                    }}
                  >
                    <HexAlphaColorPicker color={localAccent} onChange={handleColorChange} />
                    <div className="p-3 border-t border-border flex items-center justify-between bg-muted">
                      <span className="text-xs font-bold text-muted-foreground">
                        {t('common.hex')}
                      </span>
                      <input
                        type="text"
                        value={localAccent.toUpperCase()}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          handleColorChange(e.target.value)
                        }
                        className="bg-background text-foreground text-xs font-mono px-2 py-1 rounded w-20 text-center border border-input outline-none focus:border-primary transition-colors"
                      />
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>,
            document.body,
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-lg border border-border-subtle/60 bg-bg-base/40">
          <Label className="text-sm font-semibold text-text-primary">
            {t('settings.language')}
          </Label>
          <Select value={lang} onValueChange={(val) => setLang(val as any)}>
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue placeholder="Language" />
            </SelectTrigger>
            <SelectContent
              position="popper"
              className="z-50 bg-bg-surface border border-border shadow-xl rounded-md p-1"
            >
              {Object.entries(langOptions).map(([value, label]) => (
                <SelectItem key={value} value={value} className="text-xs">
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
