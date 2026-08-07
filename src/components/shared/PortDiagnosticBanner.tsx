import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';

import { useLanguage } from '../../contexts/LanguageContext';
import { usePortDiagnostic } from '../../hooks/usePortDiagnostic';

/**
 * Banner that surfaces a plugin-server port collision.
 *
 * When the desktop app can't bind its default ports (14285-14289) -- usually a
 * stuck previous instance or another program squatting on them -- it moves up
 * the range. The Studio plugin only scans a fixed range and can't read this
 * diagnostic until it connects, so the app tells the user here exactly which
 * port to widen the plugin's Daemon Port Scan Range to.
 */
export function PortDiagnosticBanner() {
  const { t } = useLanguage();
  const diag = usePortDiagnostic();
  const visible = Boolean(diag && (diag.failed || diag.extended));

  return (
    <AnimatePresence>
      {visible && diag && (
        <motion.div
          initial={{ opacity: 0, y: -10, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -10, height: 0 }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          className="w-full px-4 pt-4 shrink-0"
        >
          <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 flex items-start gap-3">
            <AlertTriangle
              size={18}
              className="text-yellow-500 shrink-0 mt-0.5"
              strokeWidth={2.5}
            />
            <div className="text-sm text-foreground space-y-1">
              {diag.failed ? (
                <span className="font-medium">{t('misc.portDiagnosticFailed')}</span>
              ) : (
                <>
                  <span className="font-medium">
                    {t('misc.portDiagnosticExtended').replace('{port}', String(diag.boundPort))}
                  </span>
                  {diag.defaultsOccupied.length > 0 && (
                    <span className="block text-muted-foreground">
                      {t('misc.portDiagnosticOccupied').replace(
                        '{processes}',
                        diag.defaultsOccupied.map((o) => o.exe).join(', '),
                      )}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
