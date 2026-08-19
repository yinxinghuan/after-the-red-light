import type { DomainChoiceAuthorityAudit, StoryCartridge, StorySave } from '../types'
import { auditDomainChoiceAuthority } from './domainRules'

export interface AuthorityShadowSample extends DomainChoiceAuthorityAudit {
  scene: number
  location: string
  objective: string
  dangerPhase: StorySave['danger']['phase']
}

declare global {
  interface Window {
    __AFTER_RED_LIGHT_AUTHORITY_SHADOW__?: AuthorityShadowSample[]
  }
}

/**
 * QA-only, in-memory shadow evidence. It is enabled with
 * `?authority_shadow=1`, never changes choices, never enters the save, and
 * never sends data remotely.
 */
export function recordAuthorityShadowSample(save: StorySave, cartridge: StoryCartridge): void {
  if (typeof window === 'undefined') return
  const enabled = cartridge.domainRules?.authorityMode === 'shadow'
    && new URLSearchParams(window.location.search).get('authority_shadow') === '1'
  if (!enabled) return
  const sample: AuthorityShadowSample = {
    ...auditDomainChoiceAuthority(save, cartridge, save.choices),
    scene: save.scene,
    location: save.location,
    objective: save.objective,
    dangerPhase: save.danger.phase,
  }
  const previous = window.__AFTER_RED_LIGHT_AUTHORITY_SHADOW__ ?? []
  const duplicate = previous.at(-1)
  if (duplicate?.scene === sample.scene
    && duplicate.location === sample.location
    && JSON.stringify(duplicate.narrativeChoices) === JSON.stringify(sample.narrativeChoices)) return
  window.__AFTER_RED_LIGHT_AUTHORITY_SHADOW__ = [...previous, sample].slice(-100)
}
