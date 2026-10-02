import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function sleep(ms: number = 1000) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Generates page numbers for pagination with ellipsis
 * @param currentPage - Current page number (1-based)
 * @param totalPages - Total number of pages
 * @returns Array of page numbers and ellipsis strings
 *
 * Examples:
 * - Small dataset (≤5 pages): [1, 2, 3, 4, 5]
 * - Near beginning: [1, 2, 3, 4, '...', 10]
 * - In middle: [1, '...', 4, 5, 6, '...', 10]
 * - Near end: [1, '...', 7, 8, 9, 10]
 */
export function getPageNumbers(currentPage: number, totalPages: number) {
  const maxVisiblePages = 5 // Maximum number of page buttons to show
  const rangeWithDots = []

  if (totalPages <= maxVisiblePages) {
    // If total pages is 5 or less, show all pages
    for (let i = 1; i <= totalPages; i++) {
      rangeWithDots.push(i)
    }
  } else {
    // Always show first page
    rangeWithDots.push(1)

    if (currentPage <= 3) {
      // Near the beginning: [1] [2] [3] [4] ... [10]
      for (let i = 2; i <= 4; i++) {
        rangeWithDots.push(i)
      }
      rangeWithDots.push('...', totalPages)
    } else if (currentPage >= totalPages - 2) {
      // Near the end: [1] ... [7] [8] [9] [10]
      rangeWithDots.push('...')
      for (let i = totalPages - 3; i <= totalPages; i++) {
        rangeWithDots.push(i)
      }
    } else {
      // In the middle: [1] ... [4] [5] [6] ... [10]
      rangeWithDots.push('...')
      for (let i = currentPage - 1; i <= currentPage + 1; i++) {
        rangeWithDots.push(i)
      }
      rangeWithDots.push('...', totalPages)
    }
  }

  return rangeWithDots
}

/**
 * Initials from a display name: first character of the first word + first
 * character of the last word. One word only: first two characters. Empty: `?`.
 */
export function getDisplayNameInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase()
  }
  const first = parts[0][0] ?? ''
  const last = parts[parts.length - 1]?.[0] ?? ''
  return (first + last).toUpperCase()
}

type Field = HTMLInputElement | HTMLTextAreaElement

// Inserts `{key}` at the cursor of a text field (or at the end) and keeps the caret after it
export function insertAtCursor(field: Field | null, value: string, token: string): string {
  // A field never clicked reports its caret at 0: add at the end then
  const untouched = !field || (!field.selectionStart && !field.selectionEnd)
  if (!field) return value + token
  const start = untouched ? value.length : field.selectionStart ?? value.length
  const end = untouched ? value.length : field.selectionEnd ?? start
  requestAnimationFrame(() => {
    field.focus()
    field.setSelectionRange(start + token.length, start + token.length)
  })
  return value.slice(0, start) + token + value.slice(end)
}

// Types text at the caret of a React-controlled field: the native setter + an input event fire onChange
export function typeInto(field: Field, token: string) {
  const start = field.selectionStart ?? field.value.length
  const end = field.selectionEnd ?? start
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(field, field.value.slice(0, start) + token + field.value.slice(end))
  field.dispatchEvent(new Event('input', { bubbles: true }))
  field.focus()
  field.setSelectionRange(start + token.length, start + token.length)
}

// Copy of a saved item, ready to open in its editor as a new one: no id, and « (copie) » after its name
export function copyOf<T extends object>(item: T, nameKey?: keyof T, drop: (keyof T)[] = []): T {
  const copy = structuredClone(item) as Record<string, unknown>
  for (const key of ['id', ...drop] as string[]) delete copy[key]
  if (nameKey && typeof copy[nameKey as string] === 'string') copy[nameKey as string] = `${copy[nameKey as string]} (copie)`
  return copy as T
}
