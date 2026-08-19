import { useCallback, useState } from 'react'
import { getGameUuid } from './game-id'
import { generateMediaImage, getMediaImageTask } from './media'

export function useGenImage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const generate = useCallback(async ({ prompt, ref_url, width, height, requestId }: { prompt: string; ref_url?: string; width?: number; height?: number; requestId?: string }) => {
    setLoading(true); setError(null)
    try {
      const sessionId = getGameUuid()
      if (!sessionId) throw new Error('game UUID unavailable')
      return await generateMediaImage(ref_url
        ? { sessionId, prompt, mode: 'edit', referenceUrl: ref_url, width, height, requestId }
        : { sessionId, prompt, mode: 'text', width, height, requestId })
    } catch (cause) {
      const next = cause instanceof Error ? cause : new Error(String(cause)); setError(next); throw next
    } finally { setLoading(false) }
  }, [])
  const resolveTaskUrl = useCallback(async (taskId: string) => {
    const task = await getMediaImageTask(taskId)
    if (task.status !== 'succeeded' || task.media?.type !== 'image') throw new Error('identity image task is not ready')
    return task.media.url
  }, [])
  return { generate, resolveTaskUrl, loading, error }
}
