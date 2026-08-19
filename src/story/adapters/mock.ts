import type { StoryAdapter } from '../types'
import { t } from '../i18n'
import { domainDemoContent } from '../engine/domainRules'

export const mockAdapter: StoryAdapter = {
  id: 'demo',
  async send(action, context, onProgress) {
    onProgress?.({ label: t(context.locale, 'worldResponding'), percent: 24 })
    await new Promise((resolve) => window.setTimeout(resolve, 360))
    const normalized = action.toLowerCase()
    const unused = context.cartridge.demoTurns.find((turn, index) => index >= context.save.scene && turn.match.some((keyword) => normalized.includes(keyword.toLowerCase())))
    const turn = unused ?? context.cartridge.demoTurns[context.save.scene]
    onProgress?.({ label: t(context.locale, 'checkingState'), percent: 68 })
    await new Promise((resolve) => window.setTimeout(resolve, 440))
    if (context.domainResolution) return { content: domainDemoContent(context.domainResolution) }
    if (turn) return { content: turn.content, imagePrompt: turn.imagePrompt, imageSubject: turn.imageSubject, imageCharacterId: turn.imageCharacterId }
    throw new Error(t(context.locale, 'demoComplete'))
  },
}
