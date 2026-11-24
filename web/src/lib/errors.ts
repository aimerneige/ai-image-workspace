import { useCallback } from 'react'
import { ApiError } from '../api/client'
import { useI18n } from '../i18n'

/** Turns any thrown value into a translated, human-readable message. */
export function useErrorMessage() {
  const { tx } = useI18n()
  return useCallback(
    (err: unknown) => {
      if (err instanceof ApiError) {
        const base = tx(`errors.${err.code}`, err.message)
        // Validation errors carry a useful server-side detail.
        if (err.code === 'invalid_request' && err.message && err.message !== err.code) {
          return `${base}: ${err.message.replace(/^invalid request:\s*/, '')}`
        }
        return base
      }
      if (err instanceof Error) return err.message
      return String(err)
    },
    [tx],
  )
}
