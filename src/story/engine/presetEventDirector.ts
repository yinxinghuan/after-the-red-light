import type { Choice, PresetEventDefinition, PresetEventResolution, StoryCartridge, StorySave } from '../types'

const FACT_PREFIX = 'preset_event:'

function stableHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function currentNodeId(save: Pick<StorySave, 'location' | 'map'>, cartridge: StoryCartridge): string | undefined {
  return save.map.find((node) => node.label === save.location)?.id
    ?? save.map.find((node) => node.current)?.id
    ?? cartridge.initialMap.find((node) => node.label === save.location)?.id
}

function currentDay(save: Pick<StorySave, 'facts' | 'time'>): number {
  const stored = Number(save.facts.world_day)
  if (Number.isFinite(stored) && stored >= 1) return Math.floor(stored)
  const match = save.time.match(/(?:第\s*(\d+)\s*天|Day\s*(\d+))/i)
  return Math.max(1, Number(match?.[1] ?? match?.[2] ?? 1))
}

function countKey(eventId: string): string { return `${FACT_PREFIX}count:${eventId}` }
function dayKey(eventId: string): string { return `${FACT_PREFIX}day:${eventId}` }
function eventCount(save: Pick<StorySave, 'facts'>, eventId: string): number {
  return Math.max(0, Math.floor(Number(save.facts[countKey(eventId)]) || 0))
}

export function selectPresetEvent(
  save: Pick<StorySave, 'location' | 'map' | 'facts' | 'time' | 'danger'>,
  cartridge: StoryCartridge,
): PresetEventDefinition | undefined {
  if (!cartridge.presetEventDirector || save.danger.phase !== 'calm') return undefined
  const nodeId = currentNodeId(save, cartridge)
  if (!nodeId) return undefined
  const events = cartridge.presetEventDirector.events.filter((event) => event.locationId === nodeId)
  if (!events.length) return undefined

  const day = currentDay(save)
  const lastId = String(save.facts[`${FACT_PREFIX}last`] ?? '')
  const unusedToday = events.filter((event) => Number(save.facts[dayKey(event.id)] ?? 0) !== day)
  const dayPool = unusedToday.length ? unusedToday : events
  const minimumCount = Math.min(...dayPool.map((event) => eventCount(save, event.id)))
  const leastUsed = dayPool.filter((event) => eventCount(save, event.id) === minimumCount)
  const withoutImmediateRepeat = leastUsed.filter((event) => event.id !== lastId)
  const pool = withoutImmediateRepeat.length ? withoutImmediateRepeat : leastUsed
  const cycle = Math.max(0, Math.floor(Number(save.facts[`${FACT_PREFIX}cycle`]) || 0))
  return pool[stableHash(`${cartridge.id}|${nodeId}|${day}|${cycle}`) % pool.length]
}

function isExplicitLookAction(action: string, locale: StoryCartridge['locale']): boolean {
  const clean = action.trim()
  return locale === 'zh'
    ? /^(?:看看|查看|观察|留意|打听)(?:一下)?(?:周围|附近|这里|当地|当前地点)?(?:有什么)?(?:新鲜事|事情|动静|变化|情况|正在发生的事)?[。.!！?？]*$/u.test(clean)
    : /^(?:look around|take a look around|see what(?:'s| is) happening(?: here)?|check what(?:'s| is) happening(?: nearby)?|notice what changed(?: around here)?)[.!?]*$/i.test(clean)
}

export function presetEventRecoveryChoice(
  save: Pick<StorySave, 'scene' | 'location' | 'map' | 'facts' | 'time' | 'objective' | 'decisionContext' | 'danger' | 'jobs'>,
  cartridge: StoryCartridge,
): Choice | undefined {
  if (save.objective.trim() || save.decisionContext.trim() || save.jobs.some((job) => job.status === 'offered' || job.status === 'accepted')) return undefined
  const event = selectPresetEvent(save, cartridge)
  return event ? { id: `preset-event-${save.scene}-${event.id}`, label: event.choiceLabel } : undefined
}

export function resolvePresetEventTurn(save: StorySave, cartridge: StoryCartridge, action: string): PresetEventResolution | undefined {
  const event = selectPresetEvent(save, cartridge)
  if (!event) return undefined
  const displayed = save.choices.some((choice) => choice.label.trim() === action.trim() && choice.label.trim() === event.choiceLabel.trim())
  if (!displayed && !isExplicitLookAction(action, cartridge.locale)) return undefined
  const location = save.sceneLocation ?? save.location
  const choices = event.choices.slice(0, 5).map((label) => `"${label.replace(/"/g, '\\"')}"`).join('|')
  return {
    eventId: event.id,
    category: event.category,
    turn: {
      match: [],
      content: `${event.text}\n[state: value="${event.objective.replace(/"/g, '\\"')}"]\n[scene_location: location="${location.replace(/"/g, '\\"')}"]\n[choices: ${choices}]`,
      imagePrompt: event.imagePrompt,
      imageSubject: event.imageSubject ?? 'environment',
    },
  }
}

export function recordPresetEvent(save: StorySave, resolution?: PresetEventResolution): void {
  if (!resolution) return
  const day = currentDay(save)
  const count = eventCount(save, resolution.eventId)
  save.facts[countKey(resolution.eventId)] = count + 1
  save.facts[dayKey(resolution.eventId)] = day
  save.facts[`${FACT_PREFIX}last`] = resolution.eventId
  save.facts[`${FACT_PREFIX}last_category`] = resolution.category
  save.facts[`${FACT_PREFIX}cycle`] = Math.max(0, Math.floor(Number(save.facts[`${FACT_PREFIX}cycle`]) || 0)) + 1
}
