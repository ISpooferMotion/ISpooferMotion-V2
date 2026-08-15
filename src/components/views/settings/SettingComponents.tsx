import React from 'react';
import { cn } from '../../../utils/cn';
import { Card, CardHeader, CardTitle, CardContent } from '../../ui/card';
import { Label } from '../../ui/label';
import { Input } from '../../ui/input';
import { Switch } from '../../ui/switch';

/**
 * Standardized Settings Card container with compact, zero-waste layout.
 */
export function SettingCard({
  icon: Icon,
  title,
  description,
  badge,
  children,
  className,
}: {
  icon?: React.ComponentType<{ size: number; className?: string }> | React.ReactNode;
  title: string;
  description?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const renderIcon = () => {
    if (!Icon) return null;
    if (React.isValidElement(Icon)) return Icon;
    const Comp = Icon as React.ComponentType<{ size: number; className?: string }>;
    return <Comp size={15} className="text-primary shrink-0" />;
  };

  return (
    <Card
      className={cn(
        'bg-bg-surface/40 border border-border-subtle rounded-xl shadow-xs overflow-hidden',
        className,
      )}
    >
      <CardHeader className="px-3.5 py-2.5 border-b border-border-subtle/40 bg-bg-base/20 flex flex-row items-center justify-between">
        <div className="space-y-0.5 min-w-0 flex-1">
          <CardTitle className="text-xs font-bold flex items-center gap-2 text-text-primary">
            {renderIcon()}
            <span>{title}</span>
          </CardTitle>
          {description && (
            <p className="text-[11px] text-text-secondary leading-snug">{description}</p>
          )}
        </div>
        {badge}
      </CardHeader>
      <CardContent className="p-0 divide-y divide-border-subtle/30">{children}</CardContent>
    </Card>
  );
}

/**
 * Standardized Toggle Setting Row (Label + Subtitle on Left, Switch on Right).
 */
export function SettingSwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="px-3.5 py-2.5 flex items-center justify-between gap-4 hover:bg-bg-elevated/20 transition-colors">
      <div className="space-y-0.5 flex-1 min-w-0">
        <Label className="text-xs font-semibold text-text-primary block cursor-pointer">
          {label}
        </Label>
        {description && (
          <p className="text-[11px] text-text-secondary leading-snug">{description}</p>
        )}
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="shrink-0"
      />
    </div>
  );
}

/**
 * Standardized Input Field Setting Row.
 */
export function SettingFieldRow({
  label,
  description,
  value,
  onChange,
  placeholder,
  type = 'text',
  className,
}: {
  label: string;
  description?: string;
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
}) {
  return (
    <div className="px-3.5 py-2.5 flex flex-col gap-1.5 hover:bg-bg-elevated/20 transition-colors">
      <div className="space-y-0.5">
        <Label className="text-xs font-semibold text-text-primary block">{label}</Label>
        {description && (
          <p className="text-[11px] text-text-secondary leading-snug">{description}</p>
        )}
      </div>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          'h-8 text-xs bg-bg-base/70 border-border-subtle focus:border-primary w-full mt-0.5',
          className,
        )}
      />
    </div>
  );
}

/**
 * Custom-designed modern Slider Setting Item.
 */
export function SettingSliderItem({
  label,
  description,
  value,
  onChange,
  min = 1,
  max = 100,
  step = 1,
  ticks,
}: {
  label: string;
  description?: string;
  value: number;
  onChange: (val: number) => void;
  min?: number;
  max?: number;
  step?: number;
  ticks?: (number | string)[];
}) {
  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));

  return (
    <div className="px-3.5 py-2.5 flex flex-col gap-1.5 hover:bg-bg-elevated/20 transition-colors">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="text-xs font-semibold text-text-primary block">{label}</Label>
          {description && (
            <p className="text-[11px] text-text-secondary leading-snug">{description}</p>
          )}
        </div>
        <span className="text-[11px] font-mono font-bold text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-md shrink-0">
          {value}
        </span>
      </div>

      <div className="relative flex items-center w-full py-1">
        {/* Custom Track Background */}
        <div className="w-full h-1.5 bg-bg-base border border-border-subtle/70 rounded-full overflow-hidden relative">
          <div
            className="h-full bg-primary transition-all duration-75 rounded-full"
            style={{ width: `${pct}%` }}
          />
        </div>
        {/* Native Range input overlay */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        {/* Custom Draggable Thumb */}
        <div
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary shadow-xs border border-white pointer-events-none transition-all duration-75"
          style={{ left: `${pct}%` }}
        />
      </div>

      {ticks && (
        <div className="flex justify-between text-[9px] text-text-muted font-mono px-0.5">
          {ticks.map((t, i) => (
            <span key={i}>{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}
