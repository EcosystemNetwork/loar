/**
 * PrivateSectionGuard — access gate for the Creator's Room.
 *
 * Shows a locked overlay with instructions on how to gain access
 * when the user doesn't meet the required access tier.
 */
import { useWalletAuth } from '../../lib/wallet-auth';
import { usePrivateAccess, type AccessLevel } from '../../hooks/usePrivateAccess';

interface PrivateSectionGuardProps {
  universeId: string;
  children: React.ReactNode;
}

export function PrivateSectionGuard({ universeId, children }: PrivateSectionGuardProps) {
  const { isAuthenticated, isConnected } = useWalletAuth();
  const { accessLevel, config, isLoading, hasAccess } = usePrivateAccess(universeId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="animate-spin w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (hasAccess) return <>{children}</>;

  return (
    <div className="relative">
      {/* Blurred placeholder */}
      <div className="filter blur-lg pointer-events-none select-none opacity-20" aria-hidden>
        <div className="p-8 space-y-4">
          <div className="h-8 bg-zinc-700 rounded w-48" />
          <div className="h-4 bg-zinc-700 rounded w-full" />
          <div className="h-4 bg-zinc-700 rounded w-3/4" />
          <div className="grid grid-cols-2 gap-4 mt-6">
            <div className="h-32 bg-zinc-700 rounded" />
            <div className="h-32 bg-zinc-700 rounded" />
          </div>
        </div>
      </div>

      {/* Lock overlay */}
      <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/70 backdrop-blur-sm rounded-xl">
        <div className="text-center max-w-md px-6 py-10">
          <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-amber-600/20 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-amber-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
              />
            </svg>
          </div>

          <h3 className="text-white font-semibold text-xl mb-2">Creator's Room</h3>
          <p className="text-zinc-400 text-sm mb-6">
            This universe's private workspace is restricted. Here's how to get access:
          </p>

          <div className="space-y-3 text-left">
            {!isConnected && (
              <AccessOption
                icon="wallet"
                title="Connect Wallet"
                description="Sign in with your wallet to check access."
              />
            )}
            {isConnected && !isAuthenticated && (
              <AccessOption
                icon="key"
                title="Sign In"
                description="Complete SIWE authentication to verify your identity."
              />
            )}
            <AccessOption
              icon="users"
              title="Join the Team"
              description="Ask the universe creator to add you as a team member."
            />
            {config?.holderMinPercentage !== undefined && (
              <AccessOption
                icon="coins"
                title={`Hold ${config.holderMinPercentage}% Tokens`}
                description="Own enough governance tokens to unlock the vault."
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AccessOption({
  icon,
  title,
  description,
}: {
  icon: 'wallet' | 'key' | 'users' | 'coins';
  title: string;
  description: string;
}) {
  const icons = {
    wallet: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 12a2.25 2.25 0 0 0-2.25-2.25H15a3 3 0 1 1 0-6h5.25A2.25 2.25 0 0 1 22.5 6v12a2.25 2.25 0 0 1-2.25 2.25H3.75A2.25 2.25 0 0 1 1.5 18V6a2.25 2.25 0 0 1 2.25-2.25h16.5"
      />
    ),
    key: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z"
      />
    ),
    users: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"
      />
    ),
    coins: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125"
      />
    ),
  };

  return (
    <div className="flex items-start gap-3 bg-zinc-800/50 rounded-lg p-3">
      <div className="w-8 h-8 rounded-full bg-zinc-700/50 flex items-center justify-center shrink-0 mt-0.5">
        <svg
          className="w-4 h-4 text-zinc-300"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          {icons[icon]}
        </svg>
      </div>
      <div>
        <p className="text-white text-sm font-medium">{title}</p>
        <p className="text-zinc-500 text-xs">{description}</p>
      </div>
    </div>
  );
}
