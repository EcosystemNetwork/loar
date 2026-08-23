/**
 * AddressDisplay — show a wallet address as a human identity.
 *
 * Resolves ENS first (name + avatar, forward-verified), then Unstoppable
 * Domains, then falls back to a truncated hex address. See
 * {@link useAddressIdentity} for the resolution order.
 */
import { useAddressIdentity, shortAddress } from '@/hooks/useAddressIdentity';

interface AddressDisplayProps {
  address: string;
  className?: string;
  /** Truncate long resolved names (default: true). */
  truncate?: boolean;
  /** Render the avatar (ENS/UD) alongside the name when one exists. */
  showAvatar?: boolean;
}

export function AddressDisplay({
  address,
  className = '',
  truncate = true,
  showAvatar = false,
}: AddressDisplayProps) {
  const { name, avatar } = useAddressIdentity(address);
  const display = name ?? shortAddress(address);
  const text = truncate && display.length > 24 ? `${display.slice(0, 22)}…` : display;

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${name ? '' : 'font-mono'} ${className}`}
      title={name ? `${name} · ${address}` : address}
    >
      {showAvatar && avatar && (
        <img
          src={avatar}
          alt=""
          loading="lazy"
          decoding="async"
          className="w-4 h-4 rounded-full object-cover shrink-0"
        />
      )}
      <span className="truncate">{text}</span>
    </span>
  );
}
