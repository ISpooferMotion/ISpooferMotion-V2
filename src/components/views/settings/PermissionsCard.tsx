import { ShieldCheck, Info } from 'lucide-react';
import { useConfig } from '../../../contexts/ConfigContext';
import { Label } from '../../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { SettingCard, SettingFieldRow, SettingSwitchRow } from './SettingComponents';

export default function PermissionsCard() {
  const { config, updateConfig } = useConfig();

  const permissions = config.permissions || {
    enabled: false,
    subjectType: 'experience',
    subjectIds: '',
    action: 'Use',
  };

  const subjectTypeOptions = [
    { value: 'experience', label: 'Experience (Place / Universe)' },
    { value: 'group', label: 'Roblox Group (Group ID)' },
    { value: 'user', label: 'Roblox User (User ID)' },
  ];

  return (
    <SettingCard
      icon={ShieldCheck}
      title="Asset Permissions (Open Cloud)"
      description="Automatically grant permission for spoofed assets to experiences, groups, or users to eliminate 'missing permission' errors."
    >
      <SettingSwitchRow
        label="Auto-Grant Permissions After Spoof"
        description="Automatically call the Roblox Asset Permissions API for newly created assets upon spoof completion."
        checked={permissions.enabled}
        onCheckedChange={(val) => updateConfig('permissions', 'enabled', val)}
      />

      <div className="px-3.5 py-2.5 flex items-center justify-between gap-4 hover:bg-bg-elevated/20 transition-colors">
        <div className="space-y-0.5 min-w-0 flex-1">
          <Label className="text-xs font-semibold text-text-primary block">
            Target Subject Type
          </Label>
          <p className="text-[11px] text-text-secondary leading-snug">
            Choose whether permissions are granted to a Place/Experience, a Group, or a User.
          </p>
        </div>
        <Select
          value={permissions.subjectType}
          onValueChange={(val) =>
            updateConfig('permissions', 'subjectType', val as 'experience' | 'user' | 'group')
          }
        >
          <SelectTrigger className="w-56 h-8 text-xs bg-bg-base/70">
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent className="z-50 bg-bg-surface border border-border shadow-xl rounded-md p-1">
            {subjectTypeOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <SettingFieldRow
        label="Target Subject ID(s)"
        description={`Enter comma-separated ${
          permissions.subjectType === 'experience'
            ? 'Place IDs or Universe IDs'
            : permissions.subjectType === 'user'
              ? 'User IDs'
              : 'Group IDs'
        }.`}
        value={permissions.subjectIds}
        onChange={(val) => updateConfig('permissions', 'subjectIds', val)}
        placeholder={
          permissions.subjectType === 'experience'
            ? 'e.g. 1818, 924364, 12345678'
            : permissions.subjectType === 'user'
              ? 'e.g. 12345678'
              : 'e.g. 1089883489'
        }
      />

      <div className="px-3.5 py-2.5 bg-primary/5 border-t border-primary/10 flex items-start gap-2.5">
        <Info size={14} className="text-primary shrink-0 mt-0.5" />
        <p className="text-[11px] text-text-secondary leading-relaxed">
          <strong className="text-text-primary font-medium">Access Action:</strong> Grants in-game{' '}
          <code className="px-1 py-0.5 rounded bg-bg-base border border-border-subtle text-primary font-mono text-[10px]">
            Use
          </code>{' '}
          permission, allowing the specified experiences, groups, or users to use and play the
          spoofed assets.
        </p>
      </div>
    </SettingCard>
  );
}
