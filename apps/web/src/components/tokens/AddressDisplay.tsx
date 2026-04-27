/**
 * AddressDisplay — Shows a wallet address with Unstoppable Domains resolution.
 *
 * If the address has a UD domain (.crypto, .x, .wallet, etc.), shows the domain
 * name instead of the hex address. Falls back to truncated address.
 */
import { useUnstoppableDomain, formatDisplayName } from '@/hooks/useUnstoppableDomain';

interface AddressDisplayProps {
  address: string;
  className?: string;
  /** Show full UD name or truncate long ones */
  truncate?: boolean;
}

export function AddressDisplay({ address, className = '', truncate = true }: AddressDisplayProps) {
  const { name } = useUnstoppableDomain(address);
  const display = formatDisplayName(address, name);

  return (
    <span className={`font-mono ${className}`} title={address}>
      {truncate && display.length > 20 ? `${display.slice(0, 18)}...` : display}
    </span>
  );
}

/**
 * Inline address with optional avatar dot for UD-resolved names.
 */
export function AddressWithAvatar({
  address,
  className = '',
}: {
  address: string;
  className?: string;
}) {
  const { name, avatar } = useUnstoppableDomain(address);
  const display = formatDisplayName(address, name);

  return (
    <span className={`inline-flex items-center gap-1 ${className}`} title={address}>
      {avatar && (
        <img
          src={avatar}
          alt=""
          loading="lazy"
          decoding="async"
          className="w-3.5 h-3.5 rounded-full object-cover"
        />
      )}
      <span className="font-mono">{display}</span>
    </span>
  );
}
