declare global { interface Window { __GAME_UUID__?: string } }

let explicit: string | null = null

export function setGameUuid(uuid: string): void {
  if (!uuid) return
  if (explicit && explicit !== uuid) {
    console.warn(`[runtime] ignoring changed game uuid ${uuid}`)
    return
  }
  explicit = uuid
}

export function getGameUuid(): string | null {
  if (explicit) return explicit
  if (typeof window !== 'undefined' && window.__GAME_UUID__) return window.__GAME_UUID__
  const meta = typeof document !== 'undefined' ? document.querySelector('meta[name="game-uuid"]') : null
  return meta?.getAttribute('content') || null
}

/** Same-origin base for game-owned Worker routes after Remix UUID replacement. */
export function getGameApiBase(): string {
  const uuid = getGameUuid()
  return uuid ? `/${uuid}` : ''
}
