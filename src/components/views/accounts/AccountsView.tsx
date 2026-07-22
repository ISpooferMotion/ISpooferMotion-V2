import { invoke } from '@tauri-apps/api/core';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { motion } from 'framer-motion';
import { Plus, RefreshCw, Trash2, Key, Cookie, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';

import { useConfig } from '../../../contexts/ConfigContext';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useConfigStore } from '../../../stores/configStore';
import { validateCookieProfile, logIsm } from '../../../utils/robloxProfiles';
import { itemVariants, pageVariants } from '../../../utils/animations';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Switch } from '../../ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../../ui/dialog';
import { Card } from '../../ui/card';

type ApiKeyOwnerDetectResult = {
  ok: boolean;
  ownerUserId?: string | null;
  message?: string;
};

export default function AccountsView() {
  const { config } = useConfig();
  const { t } = useLanguage();
  const { accountSecrets, updateAccountSecret, updateAccountsList, secretsLoaded } =
    useConfigStore();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newCookie, setNewCookie] = useState('');
  const [newApiKey, setNewApiKey] = useState('');
  const [isDownloader, setIsDownloader] = useState(true);
  const [isUploader, setIsUploader] = useState(true);
  const [isAdding, setIsAdding] = useState(false);

  const [isValidatingAll, setIsValidatingAll] = useState(false);

  const handleAddAccount = async () => {
    setIsAdding(true);
    try {
      let userId = '';
      let name = 'Unknown';
      let avatarUrl = '';

      if (newCookie.trim()) {
        const result = await validateCookieProfile(newCookie.trim());
        userId = String(result.user.id);
        name = result.user.displayName || result.user.name;
        avatarUrl = result.user.avatarUrl || '';
      } else if (newApiKey.trim()) {
        const result = await invoke<ApiKeyOwnerDetectResult>('detect_opencloud_api_key_owner', {
          key: newApiKey.trim(),
        });
        if (result.ok && result.ownerUserId) {
          userId = result.ownerUserId;
          name = `API Key Owner (${userId})`;
        } else {
          throw new Error('API Key is invalid or owner could not be determined.');
        }
      } else {
        throw new Error('You must provide either a Cookie or an API Key.');
      }

      const existingAccounts = [...config.accounts];
      const existingIdx = existingAccounts.findIndex((a) => a.id === userId);

      if (existingIdx >= 0) {
        existingAccounts[existingIdx] = {
          ...existingAccounts[existingIdx],
          isDownloader,
          isUploader,
          name,
          avatarUrl: avatarUrl || existingAccounts[existingIdx].avatarUrl,
        };
      } else {
        existingAccounts.push({
          id: userId,
          name,
          avatarUrl,
          isDownloader,
          isUploader,
        });
      }

      updateAccountsList(existingAccounts);
      await updateAccountSecret(
        userId,
        newCookie.trim() || undefined,
        newApiKey.trim() || undefined,
      );

      setIsAddOpen(false);
      setNewCookie('');
      setNewApiKey('');
      logIsm('success', 'Account added successfully!', true);
    } catch (e: any) {
      logIsm('error', `Failed to add account: ${e.message || String(e)}`, true);
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveAccount = (id: string) => {
    const updated = config.accounts.filter((a) => a.id !== id);
    updateAccountsList(updated);
  };

  const handleValidateAll = async () => {
    setIsValidatingAll(true);
    let validCount = 0;
    let invalidCount = 0;

    const updated = [...config.accounts];

    for (let i = 0; i < updated.length; i++) {
      const acc = updated[i];
      const secrets = accountSecrets[acc.id];
      let cookieOk = acc.cookieValidated ?? false;
      let apiKeyOk = acc.apiKeyValidated ?? false;

      if (secrets?.cookie) {
        try {
          await validateCookieProfile(secrets.cookie);
          cookieOk = true;
          validCount++;
        } catch {
          cookieOk = false;
          invalidCount++;
        }
      }
      if (secrets?.apiKey) {
        try {
          const result = await invoke<ApiKeyOwnerDetectResult>('detect_opencloud_api_key_owner', {
            key: secrets.apiKey,
          });
          apiKeyOk = result.ok;
          if (result.ok) {
            validCount++;
          } else {
            invalidCount++;
          }
        } catch {
          apiKeyOk = false;
          invalidCount++;
        }
      }

      updated[i] = { ...acc, cookieValidated: cookieOk, apiKeyValidated: apiKeyOk };
    }

    updateAccountsList(updated);
    setIsValidatingAll(false);
    logIsm('info', `Validation complete. Valid: ${validCount}, Invalid: ${invalidCount}`, true);
  };

  const handleSelectAccount = async (acc: (typeof config.accounts)[0]) => {
    const store = useConfigStore.getState();
    const secrets = accountSecrets[acc.id];

    store.updateConfig('spoofing', 'selectedUser', acc.id);

    // Disable auto-detect when an account is manually selected.
    store.updateCategory('advanced', {
      autoCookieStudio: false,
      autoCookieBrowser: false,
    });

    const applied: string[] = [];

    if (secrets?.cookie && acc.isDownloader) {
      store.updateConfig('spoofing', 'cookie', secrets.cookie);
      applied.push(t('accounts.downloader'));
    }
    if (secrets?.apiKey && acc.isUploader) {
      store.updateConfig('spoofing', 'apiKey', secrets.apiKey);
      applied.push(t('accounts.uploader'));
    }

    const roles = applied.length > 0 ? ` (${applied.join(', ')})` : '';
    const msg = `${t('accounts.selectedAccount')}: ${acc.name}${roles}`;

    // Use native desktop notifications instead of in-app toasts
    try {
      let permissionGranted = await isPermissionGranted();
      if (!permissionGranted) {
        const permission = await requestPermission();
        permissionGranted = permission === 'granted';
      }
      if (permissionGranted) {
        sendNotification({ title: 'ISpooferMotion', body: msg });
      } else {
        logIsm('success', msg, true);
      }
    } catch (e) {
      logIsm('success', msg, true);
    }
  };

  return (
    <motion.div
      variants={pageVariants}
      initial="hidden"
      animate="show"
      exit="exit"
      className="w-full h-full overflow-y-auto overflow-x-hidden"
    >
      <div className="w-full h-full p-4 lg:p-8">
        <motion.div
          variants={itemVariants}
          className="w-full max-w-4xl mx-auto flex flex-col gap-6 pb-12"
        >
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">{t('accounts.title')}</h1>
              <p className="text-muted-foreground mt-1">{t('accounts.description')}</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={isValidatingAll || config.accounts.length === 0}
                onClick={() => void handleValidateAll()}
              >
                <RefreshCw size={16} className={`mr-2 ${isValidatingAll ? 'animate-spin' : ''}`} />
                {t('accounts.validateAll')}
              </Button>

              <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                <DialogTrigger render={<Button />}>
                  <Plus size={16} className="mr-2" />
                  {t('accounts.addAccount')}
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t('accounts.addAccountTitle')}</DialogTitle>
                  </DialogHeader>
                  <div className="flex flex-col gap-4 py-4">
                    <div className="flex flex-col gap-2">
                      <Label>{t('accounts.cookieLabel')}</Label>
                      <Input
                        type="password"
                        value={newCookie}
                        onChange={(e) => setNewCookie(e.target.value)}
                        placeholder={t('accounts.cookiePlaceholder')}
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label>{t('accounts.apiKeyLabel')}</Label>
                      <Input
                        type="password"
                        value={newApiKey}
                        onChange={(e) => setNewApiKey(e.target.value)}
                        placeholder={t('accounts.apiKeyPlaceholder')}
                      />
                    </div>

                    <div className="flex items-center justify-between p-3 border rounded-md">
                      <div className="space-y-0.5">
                        <Label>{t('accounts.useForDownloading')}</Label>
                        <p className="text-xs text-muted-foreground">
                          {t('accounts.useForDownloadingDesc')}
                        </p>
                      </div>
                      <Switch checked={isDownloader} onCheckedChange={setIsDownloader} />
                    </div>

                    <div className="flex items-center justify-between p-3 border rounded-md">
                      <div className="space-y-0.5">
                        <Label>{t('accounts.useForUploading')}</Label>
                        <p className="text-xs text-muted-foreground">
                          {t('accounts.useForUploadingDesc')}
                        </p>
                      </div>
                      <Switch checked={isUploader} onCheckedChange={setIsUploader} />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setIsAddOpen(false)}>
                      {t('accounts.cancel')}
                    </Button>
                    <Button
                      onClick={() => void handleAddAccount()}
                      disabled={isAdding || (!newCookie && !newApiKey)}
                    >
                      {isAdding ? <RefreshCw className="animate-spin mr-2" size={16} /> : null}
                      {t('accounts.add')}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {config.accounts?.map((acc) => {
              const secrets = accountSecrets[acc.id];
              const isSelected = config.spoofing.selectedUser === acc.id;
              return (
                <Card
                  key={acc.id}
                  className={`p-4 flex flex-col gap-4 transition-colors ${isSelected ? 'border-primary/60 bg-primary/5' : ''}`}
                >
                  <div className="flex items-start gap-4">
                    <div className="relative">
                      {acc.avatarUrl ? (
                        <img
                          src={acc.avatarUrl}
                          alt="Avatar"
                          className="w-12 h-12 rounded-full bg-secondary object-cover"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center text-lg font-bold">
                          {acc.name.charAt(0)}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3
                        className="font-semibold truncate flex items-center gap-1.5"
                        title={acc.name}
                      >
                        {acc.name}
                        {(acc.cookieValidated === true || acc.apiKeyValidated === true) && (
                          <span title={t('accounts.validated') || 'Validated Account'}>
                            <CheckCircle2 size={14} className="text-green-500" />
                          </span>
                        )}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {t('accounts.id')}: {acc.id}
                      </p>
                    </div>
                    <Button
                      variant={isSelected ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleSelectAccount(acc)}
                    >
                      {isSelected ? t('accounts.selected') : t('accounts.select')}
                    </Button>
                    <Button
                      title={t('accounts.deleteAccount')}
                      variant="ghost"
                      size="icon"
                      className="text-red-500 hover:bg-red-500/10 hover:text-red-600"
                      onClick={() => handleRemoveAccount(acc.id)}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {acc.isDownloader && (
                      <div className="flex items-center gap-1.5 text-sm px-2 py-1 rounded-md w-fit bg-green-500/10">
                        <Cookie size={13} className="text-green-500" />
                        <span className="text-green-500">{t('accounts.downloader')}</span>
                        {secrets?.cookie && acc.cookieValidated === true && (
                          <span title={t('accounts.cookieValid')}>
                            <CheckCircle2 size={13} className="text-green-400" />
                          </span>
                        )}
                      </div>
                    )}
                    {acc.isUploader && (
                      <div className="flex items-center gap-1.5 text-sm px-2 py-1 rounded-md w-fit bg-blue-500/10">
                        <Key size={13} className="text-blue-500" />
                        <span className="text-blue-500">{t('accounts.uploader')}</span>
                        {secrets?.apiKey && acc.apiKeyValidated === true && (
                          <span title={t('accounts.apiKeyValid')}>
                            <CheckCircle2 size={13} className="text-blue-400" />
                          </span>
                        )}
                      </div>
                    )}
                    {/* Only render 'missing' pills once secrets have finished loading
                        from disk. Otherwise a stale render during the mount → load
                        window flashed 'Invalid cookie / Invalid API key' for every
                        account, which users read as the app invalidating their
                        credentials on reopen. */}
                    {secretsLoaded && !secrets?.cookie && acc.isDownloader && (
                      <div
                        className="text-xs text-red-500 flex items-center gap-1"
                        title="No cookie is saved for this account"
                      >
                        <ShieldAlert size={12} /> Missing cookie
                      </div>
                    )}
                    {secretsLoaded && !secrets?.apiKey && acc.isUploader && (
                      <div
                        className="text-xs text-yellow-500 flex items-center gap-1"
                        title="No Open Cloud API key is saved for this account"
                      >
                        <ShieldAlert size={12} /> Missing API key
                      </div>
                    )}
                    {secretsLoaded &&
                      acc.isDownloader &&
                      secrets?.cookie &&
                      acc.cookieValidated === false && (
                        <div
                          className="text-xs text-red-500 flex items-center gap-1"
                          title="The saved cookie failed validation — Roblox rejected it"
                        >
                          <ShieldAlert size={12} /> Cookie rejected by Roblox
                        </div>
                      )}
                    {secretsLoaded &&
                      acc.isUploader &&
                      secrets?.apiKey &&
                      acc.apiKeyValidated === false && (
                        <div
                          className="text-xs text-yellow-500 flex items-center gap-1"
                          title="The saved API key failed validation — Roblox rejected it"
                        >
                          <ShieldAlert size={12} /> API key rejected by Roblox
                        </div>
                      )}
                  </div>
                </Card>
              );
            })}

            {(!config.accounts || config.accounts.length === 0) && (
              <div className="col-span-full py-12 text-center border border-dashed rounded-lg text-muted-foreground">
                {t('accounts.noAccounts')}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
