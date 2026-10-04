import { invoke } from '@tauri-apps/api/core';
import { ArrowUpRight, Check } from 'lucide-react';

import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';

export const V3_PRICING_URL = 'https://ispoofermotion.com/pricing';
export const V3_PROMO_SEEN_KEY = 'ism.v3Promo.seen.v1';

async function openV3Pricing() {
  try {
    await invoke<boolean>('open_external', { url: V3_PRICING_URL });
  } catch (error) {
    console.error('Failed to open V3 pricing page:', error);
  }
}

export function V3PromoModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[430px] max-w-[calc(100%-2rem)] gap-0 overflow-hidden rounded-[4.5px] bg-bg-surface p-0 ring-0 shadow-2xl"
        aria-describedby="v3-promo-description"
      >
        <div className="relative h-[190px] overflow-hidden bg-black">
          <img
            src="/v3-promo.webp"
            alt="ISpooferMotion V3"
            draggable={false}
            className="h-full w-full select-none object-cover object-center"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/55 via-black/10 to-transparent" />
          <div className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-[42px] font-bold leading-none tracking-[-0.04em] text-white drop-shadow-lg">
            ISpooferMotion V3
          </div>
        </div>

        <div className="p-5 pt-4">
          <DialogTitle className="text-[18px] font-semibold tracking-tight text-text-primary">
            ISpooferMotion V3
          </DialogTitle>
          <DialogDescription
            id="v3-promo-description"
            className="mt-1.5 text-[12px] leading-relaxed text-text-secondary"
          >
            The newer paid version of ISpooferMotion, built for the next generation of the app.
          </DialogDescription>

          <div className="mt-4 space-y-2">
            {['Newer V3 experience', 'Continued feature updates'].map((benefit) => (
              <div
                key={benefit}
                className="flex items-center gap-2 text-[12px] text-text-secondary"
              >
                <div className="flex size-4 shrink-0 items-center justify-center rounded-[4.5px] bg-primary/10 text-primary">
                  <Check size={11} strokeWidth={2.4} />
                </div>
                <span>{benefit}</span>
              </div>
            ))}
          </div>

          <Button
            className="mt-5 h-9 w-full rounded-[4.5px] text-[12px] font-semibold"
            onClick={() => void openV3Pricing()}
          >
            Purchase V3
            <ArrowUpRight size={14} />
          </Button>

          <button
            type="button"
            className="mt-2 w-full rounded-[4.5px] py-2 text-[11px] font-medium text-muted-foreground transition-colors hover:text-text-primary"
            onClick={() => onOpenChange(false)}
          >
            Maybe later
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export async function openV3PurchasePage() {
  await openV3Pricing();
}
