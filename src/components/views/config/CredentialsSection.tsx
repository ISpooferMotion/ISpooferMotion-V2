import { invoke } from '@tauri-apps/api/core';
import { AnimatePresence, motion } from 'framer-motion';
import { ExternalLink, Loader2, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useConfig } from '../../../contexts/ConfigContext';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useConfigStore } from '../../../stores/configStore';
import {
  detectCookie,
  logIsm,
  mergeCachedUser,
  validateCookieProfile,
} from '../../../utils/robloxProfiles';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';

type AuthStatus = 'idle' | 'loading' | 'success' | 'error';
type ApiKeyOwnerDetectResult = {
  ok: boolean;
  ownerUserId?: string | null;
  message?: string;
};

export default function CredentialsSection() {
  const { t } = useLanguage();
  const { config, updateConfig, updateCategory } = useConfig();
  const [manualCookieEdit, setManualCookieEdit] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthStatus>('idle');
  const [apiKeyStatus, setApiKeyStatus] = useState<AuthStatus>('idle');
  const { saveSecrets } = useConfigStore();

  const autoDetectEnabled = Boolean(
    config.advanced?.autoCookieStudio || config.advanced?.autoCookieBrowser,
  );
  const cookieReadOnly = autoDetectEnabled && !manualCookieEdit;
  const cookieVal = config.spoofing?.cookie ?? '';
  const apiKeyVal = config.spoofing?.apiKey ?? '';

  const getCookieDetectionMode = () => {
    if (config.advanced?.autoCookieStudio) return 'studio';
    if (config.advanced?.autoCookieBrowser) return 'browser';
    return 'none';
  };

  const applyValidatedCookie = (result: Awaited<ReturnType<typeof validateCookieProfile>>) => {
    mergeCachedUser(result.user);
    updateCategory('spoofing', {
      cookie: result.cookie,
      selectedUser: String(result.user.id),
      selectedGroup: 'none',
    });
    setAuthStatus('success');
    logIsm('info', 'Cookie validated for the selected profile.');
    void saveSecrets();
  };

  const runAutoDetect = async (mode: string) => {
    if (mode === 'none') return;
    setAuthStatus('loading');
    logIsm('info', `Auto detecting Roblox cookie from ${mode}.`);

    try {
      const detected = await detectCookie(
        mode as 'studio' | 'browser',
        config.spoofing?.selectedUser === 'none' ? null : config.spoofing?.selectedUser,
      );
      if (!detected) {
        setAuthStatus('idle');
        const extraMsg =
          mode === 'browser'
            ? ' (Chromium v127+ cookies are encrypted and cannot be auto-detected, please add manually)'
            : ' (Please add it manually)';
        logIsm('info', `No Roblox cookie was found.${extraMsg}`);
        updateCategory('advanced', {
          autoCookieStudio: false,
          autoCookieBrowser: false,
        });
        setManualCookieEdit(true);
        return;
      }
      const result = await validateCookieProfile(detected);
      applyValidatedCookie(result);
    } catch (e: unknown) {
      const errStr = String(e);
      const isAuthFailure =
        errStr.includes('401') ||
        errStr.includes('403') ||
        errStr.includes('Unauthorized') ||
        errStr.includes('Forbidden') ||
        errStr.includes('authenticated user') ||
        errStr.includes('invalid or expired');
      if (isAuthFailure) {
        setAuthStatus('idle');
        updateCategory('advanced', {
          autoCookieStudio: false,
          autoCookieBrowser: false,
        });
        setManualCookieEdit(true);
        logIsm(
          'warn',
          'Auto-detected cookie was invalid or expired. Please add it manually.',
          true,
        );
      } else {
        setAuthStatus('idle');
        logIsm(
          'warn',
          `Auto-detect encountered a temporary error (${errStr}). Keeping the existing cookie. It will retry on next launch.`,
        );
      }
    }
  };

  const handleCookieDetectionChange = (val: string) => {
    updateCategory('advanced', {
      autoCookieStudio: val === 'studio',
      autoCookieBrowser: val === 'browser',
    });
    setManualCookieEdit(false);
    if (val !== 'none') {
      void runAutoDetect(val);
    }
  };

  useEffect(() => {
    const mode = getCookieDetectionMode();
    if (mode !== 'none') {
      void runAutoDetect(mode);
    }
  }, []);

  useEffect(() => {
    const cookie = cookieVal.trim();
    if (cookieReadOnly) return;
    if (!cookie || cookie.length < 50) return;

    const timer = window.setTimeout(async () => {
      try {
        const result = await validateCookieProfile(cookie);
        applyValidatedCookie(result);
      } catch {
        setAuthStatus('idle');
        logIsm('warn', 'The manually entered Roblox cookie could not be validated.');
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [cookieVal, cookieReadOnly]);

  const handleValidateApiKey = async () => {
    const key = apiKeyVal.trim();
    if (key.length < 20) {
      setApiKeyStatus('error');
      logIsm('warn', 'Paste an Open Cloud API key before validating.', true);
      return;
    }

    setApiKeyStatus('loading');
    try {
      const result = await invoke<ApiKeyOwnerDetectResult>('detect_opencloud_api_key_owner', {
        key,
      });
      const message = result.message || 'No validation details returned.';
      if (result.ok) {
        setApiKeyStatus('success');
        logIsm('success', message, true);
        void saveSecrets();
      } else if (/invalid|unauthorized/i.test(message)) {
        setApiKeyStatus('error');
        logIsm('warn', message, true);
      } else {
        setApiKeyStatus('idle');
        logIsm('warn', `Could not fully verify the Open Cloud API key: ${message}`, true);
      }
    } catch (error) {
      setApiKeyStatus('error');
      logIsm('warn', `Open Cloud API key validation failed: ${String(error)}`, true);
    }
  };

  const handleOpenApiDashboard = async () => {
    await invoke('open_external', {
      url: 'https://create.roblox.com/dashboard/credentials?activeTab=ApiKeys',
    }).catch(() => null);
  };

  return (
    <div className="flex flex-col gap-3 w-full">
      {/* Auto Detect Cookie Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-lg border border-border-subtle/60 bg-bg-base/40">
        <div className="space-y-0.5 min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Label className="text-sm font-semibold text-text-primary">
              {t('config.autoDetectCookie')}
            </Label>
            <AnimatePresence>
              {authStatus === 'loading' && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                >
                  <Loader2 size={14} className="animate-spin text-primary" />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <p className="text-xs text-text-secondary leading-relaxed">
            Automatically detect Roblox session cookie from running Studio or local browser.
          </p>
        </div>
        <Select
          value={getCookieDetectionMode()}
          onValueChange={(val) => {
            if (val) handleCookieDetectionChange(val);
          }}
        >
          <SelectTrigger className="w-44 h-8 text-xs shrink-0">
            <SelectValue>
              {getCookieDetectionMode() === 'studio'
                ? t('explorer.robloxStudio')
                : getCookieDetectionMode() === 'browser'
                  ? t('explorer.webBrowser')
                  : t('explorer.disabled')}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="z-50 bg-bg-surface border border-border shadow-xl rounded-md p-1">
            <SelectItem value="none" className="text-xs">
              {t('explorer.disabled')}
            </SelectItem>
            <SelectItem value="studio" className="text-xs">
              {t('explorer.robloxStudio')}
            </SelectItem>
            <SelectItem value="browser" className="text-xs">
              {t('explorer.webBrowser')}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Roblox Cookie Row */}
      <div className="flex flex-col gap-2 p-3.5 rounded-lg border border-border-subtle/60 bg-bg-base/40">
        <div className="space-y-0.5">
          <Label className="text-sm font-semibold text-text-primary">{t('spoof.cookie')}</Label>
          <p className="text-xs text-text-secondary leading-relaxed">
            Manual .ROBLOSECURITY authentication token override for downloading assets.
          </p>
        </div>
        <Input
          type="password"
          placeholder={
            cookieReadOnly ? t('config.autoDetectCookieReadonly') : t('config.pasteCookieManually')
          }
          readOnly={cookieReadOnly}
          value={cookieReadOnly ? '' : cookieVal}
          onChange={(e) => updateConfig('spoofing', 'cookie', e.target.value)}
          className={
            cookieReadOnly ? 'opacity-60 h-8 text-xs bg-bg-base' : 'h-8 text-xs bg-bg-base'
          }
        />
      </div>

      {/* Open Cloud API Key Row */}
      <div className="flex flex-col gap-2 p-3.5 rounded-lg border border-border-subtle/60 bg-bg-base/40">
        <div className="space-y-0.5">
          <Label className="text-sm font-semibold text-text-primary">{t('spoof.apiKey')}</Label>
          <p className="text-xs text-text-secondary leading-relaxed">
            Open Cloud API Key with Asset Permissions for uploading animations and audio.
          </p>
        </div>
        <div className="relative">
          <Input
            type="password"
            placeholder={t('spoof.apiKeyPlaceholder')}
            value={apiKeyVal}
            onChange={(e) => {
              setApiKeyStatus('idle');
              updateConfig('spoofing', 'apiKey', e.target.value);
            }}
            className="pr-20 h-8 text-xs bg-bg-base"
          />
          <div className="absolute right-1 top-0 h-full flex items-center gap-0.5">
            <button
              type="button"
              onClick={handleValidateApiKey}
              className="p-1 rounded text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
              aria-label={t('common.apply')}
              title={t('misc.validateOpenCloudKey')}
              disabled={apiKeyStatus === 'loading'}
            >
              {apiKeyStatus === 'loading' ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <ShieldCheck
                  size={15}
                  className={
                    apiKeyStatus === 'success'
                      ? 'text-green-500'
                      : apiKeyStatus === 'error'
                        ? 'text-red-500'
                        : undefined
                  }
                />
              )}
            </button>
            <button
              type="button"
              onClick={() => void handleOpenApiDashboard()}
              className="p-1 rounded text-muted-foreground hover:text-primary transition-colors"
              aria-label={t('spoof.openApiDashboard')}
              title={t('spoof.openApiDashboard')}
            >
              <ExternalLink size={15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
