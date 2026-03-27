/**
 * Theme Provider
 *
 * Thin wrapper around next-themes for dark/light/system theme support.
 * Re-exports useTheme for consumer convenience.
 */

import * as React from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}

export { useTheme } from 'next-themes';
