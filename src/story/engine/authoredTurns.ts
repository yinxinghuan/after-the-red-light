import type { DemoTurn, StoryCartridge, StorySave } from '../types'

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

export function hasDeterministicChoiceAction(
  cartridge: Pick<StoryCartridge, 'deterministicChoiceTurns'>,
  action: string,
): boolean {
  const actionKey = normalized(action)
  return Boolean(actionKey) && Boolean(cartridge.deterministicChoiceTurns?.some((candidate) => normalized(candidate.action) === actionKey))
}

export function resolveDeterministicOpeningTurn(
  save: Pick<StorySave, 'choices' | 'location'>,
  cartridge: StoryCartridge,
  action: string,
): DemoTurn | undefined {
  if (!cartridge.opening.deterministicTurns
    || normalized(save.location) !== normalized(cartridge.opening.location)) return undefined
  const actionKey = normalized(action)
  const selected = save.choices.find((choice) => normalized(choice.label) === actionKey)
  return selected ? cartridge.opening.deterministicTurns[selected.id] : undefined
}

export function resolveDeterministicChoiceTurn(
  save: Pick<StorySave, 'choices' | 'location' | 'characters' | 'jobs'>,
  cartridge: StoryCartridge,
  action: string,
  options: { requireVisibleChoice?: boolean } = {},
): DemoTurn | undefined {
  const actionKey = normalized(action)
  if (!actionKey || (options.requireVisibleChoice !== false && !save.choices.some((choice) => normalized(choice.label) === actionKey))) return undefined
  return cartridge.deterministicChoiceTurns?.find((candidate) => {
    if (normalized(candidate.action) !== actionKey) return false
    const when = candidate.when
    if (when?.locations?.length && !when.locations.some((location) => normalized(location) === normalized(save.location))) return false
    if (when?.characterIds?.some((id) => !save.characters.some((character) => character.id === id))) return false
    if (when?.jobs?.some((requirement) => !save.jobs.some((job) => job.id === requirement.id && (!requirement.statuses?.length || requirement.statuses.includes(job.status))))) return false
    return true
  })?.turn
}

/** A deterministic label is a scoped contract, not a global phrase macro.
 * This helper lets generated-choice filtering reject an old authored label
 * when its location/character/job preconditions are no longer true. */
export function deterministicChoiceActionAvailable(
  save: Pick<StorySave, 'choices' | 'location' | 'characters' | 'jobs'>,
  cartridge: StoryCartridge,
  action: string,
): boolean {
  return Boolean(resolveDeterministicChoiceTurn(save, cartridge, action, { requireVisibleChoice: false }))
}
