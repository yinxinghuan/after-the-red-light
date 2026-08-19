const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams()
const rawOrigin = params.get('api_origin')
export const api_origin = rawOrigin ? decodeURIComponent(rawOrigin) : null
export const telegramId = params.get('telegram_id')
export const isInAigram = Boolean(api_origin && telegramId)

function toBase64(value: string): string { return btoa(unescape(encodeURIComponent(value))) }
function fromBase64(value: string): string { return decodeURIComponent(escape(atob(value))) }

interface BridgeResult<T> { request_id: string; success: boolean; data?: T; error?: string }
export interface AigramResponse<T = unknown> { retcode: number; errcode?: number; msg: string; data: T }

export function callAigramAPI<T = unknown>(url: string, method: 'GET' | 'POST' = 'GET', data: unknown = null): Promise<T> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID()
    const payload = toBase64(JSON.stringify({ url, method, data, request_id: requestId, emitter: window.location.origin }))
    const callbackKey = `__aigram_cb_${requestId.replace(/-/g, '_')}`
    let timer: ReturnType<typeof setTimeout>
    function cleanup() {
      window.removeEventListener('message', handler)
      try { delete (window as any)[callbackKey] } catch { (window as any)[callbackKey] = undefined }
    }
    function finish(result: BridgeResult<T>) {
      clearTimeout(timer); cleanup()
      if (result.success) resolve(result.data as T)
      else reject(new Error(result.error || 'API error'))
    }
    ;(window as any)[callbackKey] = (json: string) => {
      try { const result = JSON.parse(json) as BridgeResult<T>; if (result.request_id === requestId) finish(result) } catch { /* timeout */ }
    }
    function handler(event: MessageEvent) {
      if (api_origin && event.origin !== api_origin) return
      const message = typeof event.data === 'string' ? event.data : ''
      if (!message.startsWith('callAPIResult-')) return
      try { const result = JSON.parse(fromBase64(message.slice(14))) as BridgeResult<T>; if (result.request_id === requestId) finish(result) } catch { /* timeout */ }
    }
    window.addEventListener('message', handler)
    timer = setTimeout(() => { cleanup(); reject(new Error('timeout')) }, 10_000)
    const host = window as any
    if (host.webkit?.messageHandlers?.aigram) host.webkit.messageHandlers.aigram.postMessage(`callAPI-${payload}`)
    else window.parent.postMessage(`callAPI-${payload}`, api_origin || '*')
  })
}

export function postAigramAPI(url: string, data: unknown): void {
  const payload = toBase64(JSON.stringify({ url, method: 'post', data, request_id: crypto.randomUUID(), emitter: window.location.origin }))
  const host = window as any
  if (host.webkit?.messageHandlers?.aigram) host.webkit.messageHandlers.aigram.postMessage(`callAPI-${payload}`)
  else window.parent.postMessage(`callAPI-${payload}`, api_origin || '*')
}
