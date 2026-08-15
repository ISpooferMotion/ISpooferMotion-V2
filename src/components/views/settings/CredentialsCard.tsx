import { KeyRound } from 'lucide-react';
import { useLanguage } from '../../../contexts/LanguageContext';
import CredentialsSection from '../config/CredentialsSection';
import { SettingCard } from './SettingComponents';

export default function CredentialsCard() {
  const { t } = useLanguage();

  return (
    <SettingCard
      icon={KeyRound}
      title={t('spoof.options') || 'Credentials & Authentication'}
      description="Manage Roblox session cookies and Open Cloud API credentials for downloading and uploading."
    >
      <CredentialsSection />
    </SettingCard>
  );
}
