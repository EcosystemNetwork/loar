/**
 * Thirdweb client configuration.
 *
 * Uses VITE_THIRDWEB_CLIENT_ID for browser-side API access.
 * Get a free client ID at https://thirdweb.com/dashboard
 *
 * If no client ID is configured, wallet features will be disabled
 * but the app won't crash.
 */
import { createThirdwebClient } from 'thirdweb';

const clientId = import.meta.env.VITE_THIRDWEB_CLIENT_ID;

export const thirdwebClient = clientId
  ? createThirdwebClient({ clientId })
  : createThirdwebClient({ clientId: 'placeholder' });

export const isThirdwebConfigured = !!clientId;
