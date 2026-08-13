import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { KeyRound } from 'lucide-react';
import { useLanguage } from '../../../contexts/LanguageContext';
import CredentialsSection from '../config/CredentialsSection';

export default function CredentialsCard() {
  const { t } = useLanguage();

  return (
    <Card className="py-0 flex flex-col bg-bg-surface/50 border border-border-subtle shadow-sm overflow-hidden">
      <CardHeader className="px-4 py-3 border-b border-border-subtle/40 bg-bg-base/20">
        <CardTitle className="text-sm font-bold flex items-center gap-2 text-text-primary">
          <KeyRound size={15} className="text-primary" />
          {t('spoof.options') || 'Credentials & Auth'}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3.5 space-y-2.5">
        <CredentialsSection />
      </CardContent>
    </Card>
  );
}
