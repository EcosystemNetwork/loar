/**
 * Thirdweb client configuration.
 *
 * Uses VITE_THIRDWEB_CLIENT_ID for browser-side API access.
 * Get a free client ID at https://thirdweb.com/dashboard
 */
import { createThirdwebClient } from 'thirdweb';

export const thirdwebClient = createThirdwebClient({
  clientId: import.meta.env.VITE_THIRDWEB_CLIENT_ID || '',
});
