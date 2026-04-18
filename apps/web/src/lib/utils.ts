/**
 * UI Utility Functions
 *
 * Shared helpers used across the web app's component layer.
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges Tailwind CSS class names, resolving conflicts via tailwind-merge.
 * Accepts the same argument types as clsx (strings, arrays, objects, conditionals).
 * @param inputs - Class values to merge
 * @returns Deduplicated, conflict-resolved class string
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
