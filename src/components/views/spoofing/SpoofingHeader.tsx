import { useSpooferStore } from '../../../stores/spooferStore';

export const SpoofProgressText = () => {
  const isReplacing = useSpooferStore((s) => s.isReplacing);
  const isGrantingPermissions = useSpooferStore((s) => s.isGrantingPermissions);
  const spoofProgress = useSpooferStore((s) => s.spoofProgress);
  const spoofStatusText = useSpooferStore((s) => s.spoofStatusText);
  const replaceCurrentCount = useSpooferStore((s) => s.replaceCurrentCount);
  const replaceTotalCount = useSpooferStore((s) => s.replaceTotalCount);
  const permissionsCurrentCount = useSpooferStore((s) => s.permissionsCurrentCount);
  const permissionsTotalCount = useSpooferStore((s) => s.permissionsTotalCount);

  if (isReplacing) {
    return (
      <>
        Replacing {replaceTotalCount > 0 ? `(${replaceCurrentCount}/${replaceTotalCount})` : '...'}
      </>
    );
  }

  if (isGrantingPermissions) {
    return (
      <>
        Asset Permissions{' '}
        {permissionsTotalCount > 0
          ? `(${permissionsCurrentCount}/${permissionsTotalCount})`
          : '...'}
      </>
    );
  }

  return (
    <>
      {spoofStatusText && spoofStatusText !== 'Initializing...'
        ? `${spoofStatusText} (${Math.round(spoofProgress)}%)`
        : `Spoofing (${Math.round(spoofProgress)}%)`}
    </>
  );
};

export const SpoofProgressOverlay = () => {
  const isSpoofing = useSpooferStore((s) => s.isSpoofing);
  const isReplacing = useSpooferStore((s) => s.isReplacing);
  const isGrantingPermissions = useSpooferStore((s) => s.isGrantingPermissions);
  const spoofProgress = useSpooferStore((s) => s.spoofProgress);
  const replaceCurrentCount = useSpooferStore((s) => s.replaceCurrentCount);
  const replaceTotalCount = useSpooferStore((s) => s.replaceTotalCount);
  const permissionsCurrentCount = useSpooferStore((s) => s.permissionsCurrentCount);
  const permissionsTotalCount = useSpooferStore((s) => s.permissionsTotalCount);

  const pct = isSpoofing
    ? spoofProgress
    : isReplacing
      ? replaceTotalCount > 0
        ? (replaceCurrentCount / replaceTotalCount) * 100
        : 50
      : isGrantingPermissions
        ? permissionsTotalCount > 0
          ? (permissionsCurrentCount / permissionsTotalCount) * 100
          : 50
        : 0;

  return (
    <div
      className="absolute left-0 top-0 bottom-0 bg-black/25 pointer-events-none"
      style={{
        width: `${pct}%`,
        transition: 'width 50ms linear',
      }}
    />
  );
};
