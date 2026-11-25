/**
 * Wallet Connect Button — account entry point.
 *
 * Signed out: a single "Sign In" link to /login (email/social via Circle).
 * Signed in: the avatar button that opens the account menu — everything that
 * is "mine" (works, balance, billing, keys, settings), the display toggles,
 * the wallet addresses and Sign Out. The link set comes from `navLinks.ts`
 * so the account menu and the mobile drawer can never drift apart.
 */

import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Blocks, Check, Copy, LogOut, Moon, Sun } from 'lucide-react';
import { useWalletAuth, getAuthEmail } from '@/lib/wallet-auth';
import { useCircleSolanaAddress } from '@/hooks/useCircleSolanaAddress';
import { useUnstoppableDomain, formatDisplayName } from '@/hooks/useUnstoppableDomain';
import { useWeb3Mode } from '@/lib/web3-mode';
import { useTheme } from '@/components/theme-provider';
import { needsExactMatch, visibleAccountGroups } from '@/lib/navLinks';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface WalletConnectButtonProps {
  size?: 'sm' | 'lg';
  className?: string;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function AddressRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <DropdownMenuItem
      onSelect={(e) => {
        e.preventDefault();
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="flex items-center justify-between gap-2 text-xs"
      title={value}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5 font-mono text-foreground/80">
        {short(value)}
        {copied ? (
          <Check className="h-3 w-3 text-primary" aria-label="Copied" />
        ) : (
          <Copy className="h-3 w-3 opacity-50" aria-hidden="true" />
        )}
      </span>
    </DropdownMenuItem>
  );
}

export const WalletConnectButton: React.FC<WalletConnectButtonProps> = ({ className = '' }) => {
  const { address, solanaAddress: sessionSolana, isAuthenticated, signOut } = useWalletAuth();
  const { name: udName } = useUnstoppableDomain(address);
  const displayName = formatDisplayName(address, udName);
  const email = getAuthEmail();
  const [open, setOpen] = useState(false);
  const { web3Mode, setWeb3Mode } = useWeb3Mode();
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';

  // Prefer the address stored at sign-up; fall back to the lazy Circle lookup
  // for sessions created before Solana was wired (or before this field existed).
  // The fetch only fires when the menu is open and we don't already have one.
  const { address: fetchedSolana } = useCircleSolanaAddress(
    isAuthenticated && open && !sessionSolana
  );
  const solanaAddress = sessionSolana ?? fetchedSolana ?? undefined;

  if (isAuthenticated && address) {
    const groups = visibleAccountGroups();
    const accountLinks = groups.flatMap((g) => g.links);
    return (
      <div className={className}>
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-2 h-8 pl-1 pr-2.5 rounded-full border border-border/60 bg-muted/40 hover:bg-muted transition-colors"
              aria-label="Account menu"
            >
              {/* Identicon */}
              <span
                className="w-6 h-6 rounded-full"
                style={{
                  background: `linear-gradient(135deg, hsl(${parseInt(address.slice(2, 8), 16) % 360}, 70%, 60%), hsl(${parseInt(address.slice(8, 14), 16) % 360}, 70%, 40%))`,
                }}
              />
              <span className="hidden sm:inline text-[13px] font-medium text-foreground/90 max-w-[9rem] truncate">
                {displayName || short(address)}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 max-h-[80vh] overflow-y-auto p-1.5">
            {email && (
              <DropdownMenuLabel className="font-normal px-2 py-1.5">
                <p className="text-[11px] text-muted-foreground">Signed in as</p>
                <p className="text-sm text-foreground truncate">{email}</p>
              </DropdownMenuLabel>
            )}

            {groups.map((group) => (
              <DropdownMenuGroup key={group.label}>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground/70 px-2 pb-0.5">
                  {group.label}
                </DropdownMenuLabel>
                {group.links.map((link) => (
                  <DropdownMenuItem key={link.to} asChild>
                    <Link
                      to={link.to as any}
                      activeOptions={{ exact: needsExactMatch(link.to, accountLinks) }}
                      activeProps={{ className: 'text-primary font-medium' }}
                      className="w-full cursor-pointer text-[13px]"
                    >
                      {link.label}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            ))}

            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground/70 px-2 pb-0.5">
              Display
            </DropdownMenuLabel>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setWeb3Mode(!web3Mode);
              }}
              className="flex items-center justify-between text-[13px]"
            >
              <span className="flex items-center gap-2">
                <Blocks className="h-3.5 w-3.5" /> Show on-chain details
              </span>
              <span className={web3Mode ? 'text-primary text-xs' : 'text-muted-foreground text-xs'}>
                {web3Mode ? 'On' : 'Off'}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setTheme(isDark ? 'light' : 'dark');
              }}
              className="flex items-center justify-between text-[13px]"
            >
              <span className="flex items-center gap-2">
                {isDark ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
                Theme
              </span>
              <span className="text-muted-foreground text-xs">{isDark ? 'Dark' : 'Light'}</span>
            </DropdownMenuItem>

            <DropdownMenuSeparator />
            <AddressRow label="Wallet (EVM)" value={address} />
            {solanaAddress && <AddressRow label="Wallet (Solana)" value={solanaAddress} />}

            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => signOut()}
              className="text-[13px] text-destructive focus:text-destructive"
            >
              <LogOut className="h-3.5 w-3.5 mr-2" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  // Not authenticated — show connect/login button
  // The actual login form is on the /login page
  return (
    <div className={className}>
      <Link
        to="/login"
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-sm rounded-lg shadow-lg shadow-primary/25 transition-all duration-200 hover:shadow-primary/40"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
          />
        </svg>
        Sign In
      </Link>
    </div>
  );
};
