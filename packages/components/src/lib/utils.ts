import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * The shadcn class merger, verbatim: `clsx` flattens conditional class inputs,
 * `twMerge` resolves Tailwind conflicts so a caller's `className` beats the
 * variant's default rather than landing in an arbitrary source order.
 *
 * Every component in this package composes classes through here. It is the one
 * file shadcn's registry expects to find at the `utils` alias.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
