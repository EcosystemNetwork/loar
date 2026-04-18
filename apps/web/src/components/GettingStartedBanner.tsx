/**
 * Getting Started Popup
 *
 * One-time modal shown to first-time visitors. Walks users through
 * connect wallet -> create universe -> explore.
 * Dismissed permanently via localStorage — never shown again after close.
 */

import { Link } from '@tanstack/react-router';
import { useWalletAuth } from '@/lib/wallet-auth';
import { Button } from '@/components/ui/button';
import { useState, useEffect } from 'react';
import { Rocket, Globe, ChevronRight, X, CheckCircle2, Sparkles, Wallet } from 'lucide-react';

const DISMISS_KEY = 'loar-onboarding-dismissed';

export function GettingStartedPopup() {
  const { isConnected, isAuthenticated } = useWalletAuth();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1');
  const [visible, setVisible] = useState(false);

  // Show the popup only after the user has authenticated for the first time
  useEffect(() => {
    if (isConnected && isAuthenticated && !dismissed) {
      setVisible(true);
    }
  }, [isConnected, isAuthenticated, dismissed]);

  if (!visible) return null;

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
    setVisible(false);
  };

  const steps = [
    {
      icon: Wallet,
      title: 'Connect Wallet',
      description: 'Sign in with your wallet or email',
      done: isConnected && isAuthenticated,
    },
    {
      icon: Rocket,
      title: 'Create a Universe',
      description: 'Launch your narrative world',
      done: false,
    },
    {
      icon: Globe,
      title: 'Explore & Build',
      description: 'Generate content, trade tokens, govern',
      done: false,
    },
  ];

  const currentStep = steps.findIndex((s) => !s.done);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm" onClick={handleDismiss} />

      {/* Modal */}
      <div className="fixed inset-0 z-[201] flex items-center justify-center p-4 pointer-events-none">
        <div className="relative w-full max-w-lg rounded-2xl overflow-hidden border border-primary/20 bg-background/95 backdrop-blur-xl shadow-2xl shadow-primary/10 pointer-events-auto animate-in fade-in zoom-in-95 duration-200">
          {/* Dismiss button */}
          <button
            onClick={handleDismiss}
            className="absolute top-3 right-3 p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors z-10"
            aria-label="Dismiss getting started guide"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="px-6 md:px-8 py-6 md:py-8">
            {/* Header */}
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="h-4 w-4 text-primary" />
              <p className="text-xs font-semibold text-primary uppercase tracking-wider">
                Getting Started
              </p>
            </div>
            <h2 className="text-xl md:text-2xl font-bold mb-1">Welcome to LOAR</h2>
            <p className="text-sm text-muted-foreground mb-6 max-w-lg">
              Build AI-powered narrative universes, launch governance tokens, and create content
              owned by your community.
            </p>

            {/* Steps */}
            <div className="grid grid-cols-1 gap-3">
              {steps.map((step, i) => {
                const Icon = step.icon;
                const isCurrent = i === currentStep;
                const isDone = step.done;

                return (
                  <div
                    key={step.title}
                    className={`relative flex items-start gap-3 p-4 rounded-xl border transition-all ${
                      isDone
                        ? 'bg-green-500/5 border-green-500/20'
                        : isCurrent
                          ? 'bg-primary/5 border-primary/30 ring-1 ring-primary/20'
                          : 'bg-muted/30 border-border/50 opacity-60'
                    }`}
                  >
                    {/* Step number / check */}
                    <div
                      className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        isDone
                          ? 'bg-green-500/20 text-green-500'
                          : isCurrent
                            ? 'bg-primary/20 text-primary'
                            : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {isDone ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold">{step.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>

                      {/* Action for current step */}
                      {isCurrent && i === 1 && (
                        <Link to="/cinematicUniverseCreate" className="inline-block mt-3">
                          <Button size="sm" className="gap-1.5 text-xs" onClick={handleDismiss}>
                            Create Universe
                            <ChevronRight className="h-3 w-3" />
                          </Button>
                        </Link>
                      )}
                      {isCurrent && i === 2 && (
                        <Link to="/discover" className="inline-block mt-3">
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 text-xs"
                            onClick={handleDismiss}
                          >
                            Explore
                            <ChevronRight className="h-3 w-3" />
                          </Button>
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Dismiss CTA */}
            <Button
              variant="ghost"
              className="w-full mt-4 text-muted-foreground hover:text-foreground"
              onClick={handleDismiss}
            >
              Got it, let me explore
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
