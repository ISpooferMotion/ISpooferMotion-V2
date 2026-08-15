import { AnimatePresence, motion } from 'framer-motion';
import { Palette } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { HexAlphaColorPicker } from 'react-colorful';
import { createPortal } from 'react-dom';

import { useLanguage } from '../../../contexts/LanguageContext';
import { useThemeAccent } from '../../../contexts/ThemeContext';
import { cn } from '../../../utils/cn';
import { Label } from '../../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { SettingCard } from './SettingComponents';

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
    <SettingCard
      icon={Palette}
      title={t('settings.appearance') || 'Appearance & Localization'}
      description="Customize color themes, accent colors, and display language."
    >
      <div className="px-4 py-3 flex items-center justify-between gap-4 hover:bg-bg-elevated/20 transition-colors">
        <div className="space-y-0.5 min-w-0 flex-1">
          <Label className="text-xs font-semibold text-text-primary block">
            {t('settings.theme')}
          </Label>
          <p className="text-[11px] text-text-secondary leading-relaxed">
            Switch between light and dark UI themes.
          </p>
        </div>
        <div className="flex bg-bg-base border border-border rounded-lg p-0.5 overflow-hidden w-40 shrink-0 shadow-xs">
          {(['light', 'dark'] as const).map((tMode) => (
            <button
              key={tMode}
              type="button"
              onClick={() => setThemeMode(tMode)}
              className={cn(
                'flex-1 py-1 text-xs font-medium rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer',
                themeMode === tMode
                  ? 'bg-primary text-primary-foreground font-semibold shadow-xs'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-elevated',
              )}
            >
              <span>{tMode === 'light' ? '☀️' : '🌙'}</span>
              <span>{t(`settings.theme${tMode.charAt(0).toUpperCase() + tMode.slice(1)}`)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-3 flex items-center justify-between gap-4 hover:bg-bg-elevated/20 transition-colors relative">
        <div className="space-y-0.5 min-w-0 flex-1">
          <Label className="text-xs font-semibold text-text-primary block">
            {t('settings.accentColor')}
          </Label>
          <p className="text-[11px] text-text-secondary leading-relaxed">
            Choose the primary brand accent color across UI and buttons.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-mono text-text-muted">
            {(accentColor || '#3B82F6').toUpperCase()}
          </span>
          <div
            className="w-7 h-7 rounded-full border border-border cursor-pointer shadow-xs transition-transform hover:scale-110 shrink-0"
            style={{ backgroundColor: accentColor || '#3B82F6' }}
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
                  className="absolute z-500 p-0 border border-border rounded-xl overflow-hidden shadow-2xl bg-bg-surface flex flex-col pointer-events-auto"
                  onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  style={{
                    top: pickerCoords.top,
                    left: pickerCoords.left,
                  }}
                >
                  <HexAlphaColorPicker color={localAccent} onChange={handleColorChange} />
                  <div className="p-3 border-t border-border flex items-center justify-between bg-bg-elevated/50">
                    <span className="text-xs font-bold text-text-muted">{t('common.hex')}</span>
                    <input
                      type="text"
                      value={localAccent.toUpperCase()}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        handleColorChange(e.target.value)
                      }
                      className="bg-bg-base text-text-primary text-xs font-mono px-2 py-1 rounded w-24 text-center border border-border-subtle outline-none focus:border-primary transition-colors"
                    />
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>,
          document.body,
        )}
      </div>

      <div className="px-4 py-3 flex items-center justify-between gap-4 hover:bg-bg-elevated/20 transition-colors">
        <div className="space-y-0.5 min-w-0 flex-1">
          <Label className="text-xs font-semibold text-text-primary block">
            {t('settings.language')}
          </Label>
          <p className="text-[11px] text-text-secondary leading-relaxed">
            Select your preferred display language for UI labels.
          </p>
        </div>
        <Select value={lang} onValueChange={(val) => setLang(val as any)}>
          <SelectTrigger className="w-40 h-8 text-xs bg-bg-base/70">
            <SelectValue placeholder="Language" />
          </SelectTrigger>
          <SelectContent className="z-50 bg-bg-surface border border-border shadow-xl rounded-md p-1">
            {Object.entries(langOptions).map(([value, label]) => (
              <SelectItem key={value} value={value} className="text-xs">
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </SettingCard>
  );
}
