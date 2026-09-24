import { lazy, Suspense } from 'react';
import { useWalletAuth } from '@/lib/wallet-auth';
import { isAdminAddress } from '@/lib/admin-address';

// The toolbar (+ model analytics) is ~130KB of code only admins ever run, so it
// is split out of the entry chunk and fetched only once an admin is signed in.
const AdminToolbar = lazy(() => import('./admin-toolbar'));

export function AdminToolbarGate() {
  const { address, isAuthenticated } = useWalletAuth();
  if (!isAuthenticated || !isAdminAddress(address)) return null;
  return (
    <Suspense fallback={null}>
      <AdminToolbar />
    </Suspense>
  );
}
