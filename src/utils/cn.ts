import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combines standard class names with Tailwind CSS classes, resolving conflicts automatically.
 * @param inputs The class names or expressions to combine
 * @returns The final merged string of class names
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
