import { useCallback, useEffect, useRef, useState } from 'react'
import { callAigramAPI, isInAigram, postAigramAPI, telegramId, type AigramResponse } from '../runtime/bridge'
import { getGameUuid } from '../runtime/game-id'

interface SaveRow { user_id: string; resource_data: string }

export function useGameSave<T>(gameId: string) {
  const [savedData, setSavedData] = useState<T | null | undefined>(undefined)
  const pending = useRef<T | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const key = `${gameId}-save`
  const sessionId = getGameUuid()
  const canSync = isInAigram && Boolean(sessionId && telegramId)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (canSync && sessionId && telegramId) {
        try {
          const response = await callAigramAPI<AigramResponse<SaveRow[]>>(`/note/aigram/ai/game/get/data/list?session_id=${encodeURIComponent(sessionId)}`)
          const mine = (Array.isArray(response?.data) ? response.data : []).find((row) => row.user_id === telegramId)
          if (mine?.resource_data) { const parsed = JSON.parse(mine.resource_data) as T; if (!cancelled) setSavedData(parsed); return }
        } catch { /* use local */ }
      }
      try { const local = alteruLocalStorage.getItem(key); if (local) { if (!cancelled) setSavedData(JSON.parse(local) as T); return } } catch { /* empty */ }
      if (!cancelled) setSavedData(null)
    })()
    return () => { cancelled = true }
  }, [canSync, key, sessionId])

  const flush = useCallback(() => {
    const value = pending.current; pending.current = null; timer.current = null
    if (value && canSync && sessionId) postAigramAPI('/note/aigram/ai/game/save/data', { session_id: sessionId, resource_data: JSON.stringify(value) })
  }, [canSync, sessionId])

  const persist = useCallback((value: T) => {
    const stamped = { ...(value as object), _lastActive: Date.now() } as T
    try { alteruLocalStorage.setItem(key, JSON.stringify(stamped)) } catch { /* quota */ }
    if (canSync) { pending.current = stamped; if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(flush, 1000) }
  }, [canSync, flush, key])

  useEffect(() => () => {
    if (timer.current) {
      clearTimeout(timer.current)
      flush()
    }
  }, [flush])

  const clear = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current); timer.current = null; pending.current = null
    try { alteruLocalStorage.removeItem(key) } catch { /* ignore */ }
    if (canSync && sessionId) postAigramAPI('/note/aigram/ai/game/save/data', { session_id: sessionId, resource_data: '' })
    setSavedData(null)
  }, [canSync, key, sessionId])

  return { savedData, loaded: savedData !== undefined, hasSave: savedData != null, persist, clear }
}
