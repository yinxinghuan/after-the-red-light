import { SCENE_IMAGE_PROMPT_VERSION, type CharacterDefinition, type CharacterVisualIdentity, type DangerDirective, type DomainActionResolution, type ImageBlockStatus, type MapNode, type ParsedCommand, type ParsedScene, type PresetEventResolution, type SceneImageSubject, type StoryBlock, type StoryCartridge, type StoryCharacter, type StorySave } from '../types'
import { t } from '../i18n'
import { chooseSceneImage } from './imageDirector'
import { contextualDangerChoiceLabels, createInitialDangerState, dangerDirectiveChoices, dangerDirectiveEstablished, normalizeDangerState, settleDangerTurn } from './dangerDirector'
import { authoredDecisionContext, createTransitionBlock, filterGroundedChoices } from './continuity'
import { activeStatFloorRule, applyDomainResolution, domainAllowsModelCommand, domainSuppressesDanger, resolveDomainAction, statFloorChoices, syncDomainDerivedState } from './domainRules'
import { encodeChoiceRecord } from './choiceInput'
import { resolveDeterministicChoiceTurn } from './authoredTurns'
import { bindChoiceDestinations, inferActionDestination, mergeRouteHints, playerDeclaredLocationAlias, stableDynamicLocationId, validatedDynamicRouteHints } from './turnConsistency'
import { characterIdentityConflict, hasVisibleCharacterDebut, hasVisiblePartyJoin, matchingCharacter, normalizedCharacterName } from './characterContinuity'
import { presetEventRecoveryChoice, recordPresetEvent } from './presetEventDirector'

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function createInitialSave(cartridge: StoryCartridge, remoteChatId?: string): StorySave {
  const initialPartyMemberIds = cartridge.initialPartyMemberIds ?? cartridge.characters.filter((character) => character.initialStatus === 'companion').map((character) => character.id)
  const initial: StorySave = {
    version: 10, cartridgeId: cartridge.id, locale: cartridge.locale, remoteChatId, entered: false, scene: 0,
    location: cartridge.opening.location, sceneLocation: cartridge.opening.location, time: cartridge.opening.time, objective: cartridge.opening.objective,
    decisionContext: '',
    stats: Object.fromEntries(cartridge.statDefinitions.map((stat) => [stat.id, stat.initial])),
    facts: { ...(cartridge.initialFacts ?? {}) },
    blocks: [...cartridge.opening.blocks, createImageBlock('image-0', cartridge.opening.location, cartridge.opening.imagePrompt, 'idle'), createChoiceRecordBlock(0, cartridge.opening.choices)],
    choices: cartridge.opening.choices, map: cartridge.initialMap.map((node) => ({ ...node, visited: node.visited ?? Boolean(node.current), facts: node.facts ? [...node.facts] : undefined, routeHints: node.routeHints ? [...node.routeHints] : undefined })),
    inventory: cartridge.initialInventory.map((item) => ({ ...item, metrics: item.metrics?.map((metric) => ({ ...metric })), imageStatus: item.imageUrl ? 'ready' : 'idle' })),
    characters: cartridge.characters.filter((character) => !character.hiddenUntilIntroduced).map((character) => {
      const state = characterFromDefinition(character)
      if (initialPartyMemberIds.includes(state.id)) state.status = 'companion'
      return state
    }),
    partyMemberIds: initialPartyMemberIds,
    relationships: [], jobs: [],
    danger: createInitialDangerState(),
    sessionEnded: false,
  }
  initial.choices = bindChoiceDestinations(initial.choices, initial, cartridge)
  return syncDomainDerivedState(initial, cartridge)
}

export function createChoiceRecordBlock(scene: number, choices: StorySave['choices']): StoryBlock {
  return { id: `choices-${scene}`, kind: 'choices', text: encodeChoiceRecord(choices), data: { scene } }
}

type CharacterCommand = Extract<ParsedCommand, { type: 'character_update' | 'party_change' }>

function characterFromDefinition(character: CharacterDefinition): StoryCharacter {
  return {
    ...character,
    skills: character.skills.map((skill) => ({ ...skill })),
    visualIdentity: character.visualIdentity ? cloneVisualIdentity(character.visualIdentity) : undefined,
    status: character.initialStatus ?? 'known', origin: 'cartridge', updatedAtScene: 0,
  }
}

function cloneVisualIdentity(identity: CharacterVisualIdentity): CharacterVisualIdentity {
  return { ...identity, immutableTraits: [...identity.immutableTraits], wardrobe: [...identity.wardrobe], forbiddenDrift: [...identity.forbiddenDrift] }
}

function visualIdentityFromCommand(command: CharacterCommand, source: CharacterVisualIdentity['source']): CharacterVisualIdentity | undefined {
  if (command.type !== 'character_update' || !command.visualAppearance?.trim()) return undefined
  return {
    status: 'queued', version: 1, source,
    appearance: command.visualAppearance.trim(),
    immutableTraits: command.visualTraits?.slice(0, 6) ?? [],
    wardrobe: command.visualWardrobe?.slice(0, 4) ?? [],
    forbiddenDrift: command.visualForbidden?.slice(0, 6) ?? ['age drift', 'face drift', 'hair drift'],
  }
}

function resolveCharacter(save: StorySave, command: CharacterCommand, index: number, cartridge: StoryCartridge): StoryCharacter | undefined {
  if (characterIdentityConflict(save, command, cartridge)) return undefined
  const existing = matchingCharacter(save, command)
  if (existing) {
    existing.role = command.role ?? existing.role
    existing.detail = command.detail ?? existing.detail
    existing.lore = command.lore ?? existing.lore
    existing.vitality = command.vitality == null ? existing.vitality : clamp(command.vitality, 0, 100)
    existing.stress = command.stress == null ? existing.stress : clamp(command.stress, 0, 100)
    existing.skills = command.skills?.map((skill) => ({ ...skill })) ?? existing.skills
    existing.visualIdentity ??= visualIdentityFromCommand(command, existing.origin === 'cartridge' ? 'authored' : 'generated')
    existing.lastKnownLocation = save.location
    existing.updatedAtScene = save.scene
    return existing
  }
  const definition = command.characterId ? cartridge.characters.find((character) => character.id === command.characterId) : undefined
  if (!command.characterId) return undefined
  if (!definition && (command.type !== 'character_update' || !command.visualAppearance?.trim() || !command.visualTraits?.length)) return undefined
  const created: StoryCharacter = {
    ...definition,
    id: command.characterId,
    name: command.character || definition?.name || command.characterId || `NPC ${index + 1}`,
    role: command.role ?? definition?.role ?? t(cartridge.locale, command.type === 'party_change' && command.change === 'add' ? 'companion' : 'knownPerson'),
    vitality: clamp(command.vitality ?? definition?.vitality ?? 100, 0, 100),
    stress: clamp(command.stress ?? definition?.stress ?? 0, 0, 100),
    skills: command.skills?.map((skill) => ({ ...skill })) ?? definition?.skills.map((skill) => ({ ...skill })) ?? [],
    detail: command.detail ?? definition?.detail,
    lore: command.lore ?? definition?.lore,
    visualIdentity: definition?.visualIdentity ? cloneVisualIdentity(definition.visualIdentity) : visualIdentityFromCommand(command, definition ? 'authored' : 'generated'),
    status: 'known', origin: definition ? 'cartridge' : 'generated', lastKnownLocation: save.location, updatedAtScene: save.scene,
  }
  save.characters.push(created)
  return created
}

function hasVisibleDeparture(parsed: ParsedScene, characterName: string): boolean {
  const visible = parsed.blocks.map((block) => `${block.speaker ?? ''} ${block.text}`).join('\n')
  if (!visible.includes(characterName)) return false
  return /离开|离队|分开|告别|留下|失踪|死亡|独自前往|leave|depart|separat|farewell|stay behind|missing|died|dead|goes alone/i.test(visible)
}

type LegacyCharacterState = Pick<StorySave, 'blocks' | 'relationships'> & Partial<Pick<StorySave, 'characters' | 'partyMemberIds'>>

export function normalizeCharacterState(candidate: LegacyCharacterState, cartridge: StoryCartridge): Pick<StorySave, 'characters' | 'partyMemberIds' | 'relationships'> {
  const staticById = new Map(cartridge.characters.map((character) => [character.id, character]))
  const inputCharacters = Array.isArray(candidate.characters) ? candidate.characters : []
  const hasVisibleIntroduction = (character: StoryCharacter): boolean => candidate.blocks.some((block) => block.kind !== 'image' && block.kind !== 'choices' && `${block.speaker ?? ''} ${block.text}`.includes(character.name))
  const characters: StoryCharacter[] = inputCharacters.filter((character) => {
    const definition = staticById.get(character.id)
    if (!definition?.hiddenUntilIntroduced) return true
    if (character.status === 'companion' || character.status === 'departed') return true
    if ((character.updatedAtScene ?? 0) > 0) return true
    if (candidate.relationships.some((event) => event.characterId === character.id || event.actor === character.name)) return true
    return hasVisibleIntroduction(character)
  }).map((character) => {
    const definition = staticById.get(character.id)
    return {
      ...definition, ...character,
      name: character.name || definition?.name || character.id,
      role: character.role || definition?.role || t(cartridge.locale, 'knownPerson'),
      vitality: clamp(Number.isFinite(character.vitality) ? character.vitality : definition?.vitality ?? 100, 0, 100),
      stress: clamp(Number.isFinite(character.stress) ? character.stress : definition?.stress ?? 0, 0, 100),
      skills: (character.skills ?? definition?.skills ?? []).map((skill) => ({ ...skill })),
      visualIdentity: character.visualIdentity ? cloneVisualIdentity(character.visualIdentity) : definition?.visualIdentity ? cloneVisualIdentity(definition.visualIdentity) : undefined,
      status: character.status === 'companion' || character.status === 'departed' ? character.status : 'known',
      origin: character.origin === 'generated' ? 'generated' : 'cartridge',
      updatedAtScene: Number.isFinite(character.updatedAtScene) ? character.updatedAtScene : 0,
    }
  })
  cartridge.characters.forEach((definition) => {
    if (!definition.hiddenUntilIntroduced && !characters.some((character) => character.id === definition.id)) characters.push(characterFromDefinition(definition))
  })
  const findOrCreate = (name: string, id?: string): StoryCharacter => {
    const found = (id ? characters.find((character) => character.id === id) : undefined)
      ?? characters.find((character) => normalizedCharacterName(character.name) === normalizedCharacterName(name))
    if (found) return found
    const created: StoryCharacter = {
      id: id && !characters.some((character) => character.id === id) ? id : `legacy-npc-${characters.length + 1}`,
      name, role: t(cartridge.locale, 'knownPerson'), vitality: 100, stress: 0, skills: [],
      status: 'known', origin: 'generated', updatedAtScene: 0,
    }
    characters.push(created)
    return created
  }
  const explicitParty = new Set(Array.isArray(candidate.partyMemberIds) ? candidate.partyMemberIds.filter((id) => characters.some((character) => character.id === id)) : [])
  if (!candidate.partyMemberIds) {
    const initialPartyIds = cartridge.initialPartyMemberIds ?? cartridge.characters.filter((character) => character.initialStatus === 'companion').map((character) => character.id)
    initialPartyIds.forEach((id) => explicitParty.add(id))
    characters.filter((character) => character.status === 'companion').forEach((character) => explicitParty.add(character.id))
    candidate.blocks.forEach((block) => {
      if (block.kind !== 'event' || !block.id.startsWith('effect-')) return
      const encodedChange = block.data?.partyChange
      const encodedId = typeof block.data?.characterId === 'string' ? block.data.characterId : undefined
      let name = block.text.trim()
      let change: 'add' | 'remove' | undefined = encodedChange === 'add' || encodedChange === 'remove' ? encodedChange : undefined
      const suffixes: Array<[string, 'add' | 'remove']> = [
        ['加入了同行者', 'add'], ['离开了同行者', 'remove'], [' joined the party', 'add'], [' left the party', 'remove'],
      ]
      if (!change) {
        const suffix = suffixes.find(([text]) => name.endsWith(text))
        if (!suffix) return
        name = name.slice(0, -suffix[0].length).trim()
        change = suffix[1]
      } else {
        const suffix = suffixes.find(([text]) => name.endsWith(text))
        if (suffix) name = name.slice(0, -suffix[0].length).trim()
      }
      if (!name && !encodedId) return
      const character = findOrCreate(name || encodedId!, encodedId)
      if (change === 'add') {
        explicitParty.add(character.id)
        character.status = 'companion'
      } else {
        explicitParty.delete(character.id)
        character.status = 'departed'
      }
    })
  }
  const relationships = (candidate.relationships ?? []).map((event) => {
    const character = event.characterId ? characters.find((entry) => entry.id === event.characterId) : findOrCreate(event.actor)
    return { ...event, characterId: character?.id }
  })
  characters.forEach((character) => {
    if (explicitParty.has(character.id)) character.status = 'companion'
    else if (character.status === 'companion') character.status = 'known'
  })
  return { characters, partyMemberIds: [...explicitParty], relationships }
}

export function createImageBlock(id: string, location: string, prompt: string, status: ImageBlockStatus, url = '', metadata?: Record<string, string>): StoryBlock {
  return { id, kind: 'image', text: location, data: { prompt, status, url, ...metadata } }
}

export function updateImageBlock(save: StorySave, blockId: string, patch: { status?: ImageBlockStatus; url?: string }): StorySave {
  return {
    ...save,
    blocks: save.blocks.map((block) => block.id === blockId && block.kind === 'image'
      ? { ...block, data: { ...block.data, ...patch } }
      : block),
  }
}

export function updateCharacterVisualIdentity(save: StorySave, characterId: string, patch: Partial<Pick<CharacterVisualIdentity, 'status' | 'anchorTaskId'>>): StorySave {
  return {
    ...save,
    characters: save.characters.map((character) => character.id === characterId && character.visualIdentity
      ? { ...character, visualIdentity: { ...character.visualIdentity, ...patch } }
      : character),
  }
}

export function updateInventoryItemImage(save: StorySave, itemId: string, patch: { status?: ImageBlockStatus; url?: string; styleVersion?: number }): StorySave {
  return {
    ...save,
    inventory: save.inventory.map((item) => item.id === itemId
      ? {
        ...item,
        imageStatus: patch.status ?? item.imageStatus,
        imageUrl: patch.url ?? item.imageUrl,
        imageStyleVersion: patch.styleVersion ?? item.imageStyleVersion,
      }
      : item),
  }
}

export function localizeKnownState(save: StorySave, from: StoryCartridge, to: StoryCartridge): StorySave {
  if (from.locale === to.locale) return save
  const sourceNodeByLabel = new Map(from.initialMap.map((node) => [node.label, node.id]))
  const targetNodeById = new Map(to.initialMap.map((node) => [node.id, node]))
  const map = save.map.map((node) => {
    const target = targetNodeById.get(node.id)
    const connectedId = node.connectedTo ? sourceNodeByLabel.get(node.connectedTo) : undefined
    return target ? {
      ...node, label: target.label, connectedTo: connectedId ? targetNodeById.get(connectedId)?.label : node.connectedTo,
      detail: target.detail ?? node.detail, lore: target.lore ?? node.lore, facts: target.facts ?? node.facts,
      capabilities: target.capabilities ?? node.capabilities,
    } : node
  })
  const locationId = sourceNodeByLabel.get(save.location)
  const openingLocation = save.location === from.opening.location ? to.opening.location : undefined
  const localizedLocation = openingLocation ?? (locationId ? targetNodeById.get(locationId)?.label ?? save.location : save.location)
  const sourceSceneLocation = save.sceneLocation ?? save.location
  const sceneLocation = sourceSceneLocation === save.location
    ? localizedLocation
    : locationId && sourceSceneLocation.includes(save.location)
      ? sourceSceneLocation.replace(save.location, localizedLocation)
      : sourceSceneLocation
  const sourceObjectiveTransitions = from.domainRules?.objectiveTransitions ?? []
  const targetObjectiveTransitions = to.domainRules?.objectiveTransitions ?? []
  const objectiveTransitionIndex = sourceObjectiveTransitions.findIndex((transition) => (
    transition.from === save.objective || transition.to === save.objective
  ))
  const localizedObjective = save.objective === from.opening.objective
    ? to.opening.objective
    : objectiveTransitionIndex >= 0
      ? save.objective === sourceObjectiveTransitions[objectiveTransitionIndex].from
        ? targetObjectiveTransitions[objectiveTransitionIndex]?.from ?? save.objective
        : targetObjectiveTransitions[objectiveTransitionIndex]?.to ?? save.objective
      : save.objective
  const inventoryById = new Map(to.initialInventory.map((item) => [item.id, item]))
  const charactersById = new Map(to.characters.map((character) => [character.id, character]))
  return {
    ...save,
    locale: to.locale,
    location: localizedLocation,
    sceneLocation,
    time: save.time === from.opening.time ? to.opening.time : save.time,
    objective: localizedObjective,
    map,
    inventory: save.inventory.map((item) => {
      const target = inventoryById.get(item.id)
      return target ? {
        ...item, label: target.label, detail: target.detail ?? item.detail, effect: target.effect ?? item.effect,
        lore: target.lore ?? item.lore, metrics: target.metrics ?? item.metrics, imagePrompt: target.imagePrompt ?? item.imagePrompt,
      } : item
    }),
    characters: save.characters.map((character) => {
      const target = charactersById.get(character.id)
      return target ? { ...character, name: target.name, role: target.role, detail: target.detail ?? character.detail, lore: target.lore ?? character.lore, skills: target.skills.map((skill) => ({ ...skill })) } : character
    }),
  }
}

function changeBlock(id: string, text: string, data?: Record<string, string | number>): StoryBlock {
  return { id, kind: 'change', text, data }
}

function shortChoiceContext(value: string, maxLength: number): string {
  const clean = value.replace(/[\n\r\t]+/g, ' ').replace(/[“”"']/g, '').trim()
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1).trim()}…` : clean
}

export function createRecoveryChoices(
  save: Pick<StorySave, 'scene' | 'location' | 'objective'> & Partial<Pick<StorySave, 'danger' | 'map' | 'facts' | 'time' | 'decisionContext' | 'jobs'>>,
  cartridge: StoryCartridge,
): StorySave['choices'] {
  const location = shortChoiceContext(save.location, cartridge.locale === 'zh' ? 14 : 24)
  const objective = shortChoiceContext(save.objective, cartridge.locale === 'zh' ? 32 : 64).replace(/[。.!！?？；;]+$/u, '')
  const activeThreat = save.danger && save.danger.phase !== 'calm'
  const presetEvent = !activeThreat && !objective && save.map && save.facts && save.time && save.danger && save.decisionContext != null && save.jobs
    ? presetEventRecoveryChoice(save as Pick<StorySave, 'scene' | 'location' | 'map' | 'facts' | 'time' | 'objective' | 'decisionContext' | 'danger' | 'jobs'>, cartridge)
    : undefined
  if (presetEvent) return [presetEvent]
  const labels = activeThreat && cartridge.dangerDirector
    ? contextualDangerChoiceLabels(save.danger?.currentThreat, cartridge.dangerDirector.methods, cartridge.locale)
    : objective
      ? [objective]
      : cartridge.locale === 'zh'
        ? [`观察${location || '周围'}的新变化`]
        : [`Observe what changed around ${location || 'this place'}`]
  return [...new Set(labels)].map((label, index) => ({ id: `recovery-${save.scene}-${index}`, label }))
}

/** Old saves wrapped the active objective in an abstract “trace a clue” label
 * or mixed a live objective with generic observation/discussion buttons.
 * Keep only the unresolved concrete thread; use observation only when no
 * objective exists, and use world-native danger methods during active threat. */
export function repairLegacyObjectiveRecoveryChoices(save: StorySave, cartridge: StoryCartridge): StorySave {
  const wrappedObjective = cartridge.locale === 'zh'
    ? /^追查“.+”的线索$/u
    : /^Trace a clue about “.+”$/i
  const objective = shortChoiceContext(save.objective, cartridge.locale === 'zh' ? 32 : 64).replace(/[。.!！?？；;]+$/u, '')
  const genericRecovery = cartridge.locale === 'zh'
    ? /^(?:观察.+的新变化|追查“.+”的线索|和同行者商量下一步)$/u
    : /^(?:Observe what changed around .+|Trace a clue about “.+”|Discuss the next move with your companions)$/i
  const replacement = createRecoveryChoices(save, cartridge)
  const allLegacyRecovery = save.choices.length > 0 && save.choices.every((choice) => (
    genericRecovery.test(choice.label.trim()) || Boolean(objective && choice.label.trim() === objective)
  ))
  const needsRepair = allLegacyRecovery && (
    save.choices.length !== replacement.length
    || save.choices.some((choice, index) => choice.label !== replacement[index]?.label)
  )
  if (!needsRepair && !save.choices.some((choice) => wrappedObjective.test(choice.label.trim()))) return save
  const choices = allLegacyRecovery
    ? replacement
    : save.choices.map((choice) => wrappedObjective.test(choice.label.trim())
      ? { ...choice, label: replacement[0]?.label ?? choice.label }
      : choice)
  const unique = choices.filter((choice, index, all) => all.findIndex((entry) => entry.label === choice.label) === index).slice(0, 5)
  const recordId = `choices-${save.scene}`
  const blocks = save.blocks.map((block) => block.id === recordId && block.kind === 'choices'
    ? { ...block, text: encodeChoiceRecord(unique) }
    : block)
  return { ...save, choices: unique, blocks }
}

function createActionRecoveryChoices(
  save: Pick<StorySave, 'scene' | 'location'>,
  cartridge: StoryCartridge,
): StorySave['choices'] {
  const location = shortChoiceContext(save.location, cartridge.locale === 'zh' ? 14 : 24)
  const labels = cartridge.locale === 'zh'
    ? [
        `查看${location || '原地'}现在能做的事`,
        '放弃原计划，改走别的路',
      ]
    : [
        `See what is actually possible at ${location || 'the current place'}`,
        'Set the original plan aside and take another route',
      ]
  return labels.map((label, index) => ({ id: `recovery-${save.scene}-${index}`, label }))
}

function isSyntheticConsistencyAction(value: string, locale: StoryCartridge['locale']): boolean {
  const clean = value.trim()
  return locale === 'zh'
    ? /^先在.+确认与这一步有关的路线和线索$/.test(clean)
      || /^暂缓这一步，留在.+观察局势$/.test(clean)
      || clean === '和同行者商量怎样继续刚才的行动'
      || /^查看.+现在能做的事$/.test(clean)
      || clean === '放弃原计划，改走别的路'
    : /^Confirm the route and clues for this action at .+$/i.test(clean)
      || /^Pause this action and observe from .+$/i.test(clean)
      || clean === 'Ask your companions how to continue the same action'
      || /^See what is actually possible at .+$/i.test(clean)
      || clean === 'Set the original plan aside and take another route'
}

function consistencyActions(save: Pick<StorySave, 'blocks'>): Map<number, string> {
  const actions = new Map<number, string>()
  save.blocks.forEach((block) => {
    const match = block.kind === 'event' ? block.id.match(/^action-(\d+)$/) : undefined
    if (match) actions.set(Number(match[1]), block.text.trim())
  })
  return actions
}

function rootConsistencyAction(save: Pick<StorySave, 'scene' | 'blocks' | 'lastActionId'>, cartridge: StoryCartridge, actionId?: string): string {
  const actions = consistencyActions(save)
  let action = actionId?.trim() || actions.get(save.scene) || save.lastActionId?.trim() || ''
  if (!isSyntheticConsistencyAction(action, cartridge.locale)) return action
  for (let scene = save.scene; scene >= 0; scene -= 1) {
    if (!save.blocks.some((block) => block.id === `consistency-recovery-${scene}`)) continue
    const previous = actions.get(scene)
    if (previous && !isSyntheticConsistencyAction(previous, cartridge.locale)) return previous
  }
  return action
}

export function resolveConsistencyRecoverySelection(
  save: Pick<StorySave, 'scene' | 'blocks' | 'choices' | 'lastActionId'>,
  cartridge: StoryCartridge,
  action: string,
): { mode: 'confirm' | 'pause'; originalAction: string } | undefined {
  if (!save.blocks.some((block) => block.id === `consistency-recovery-${save.scene}`)) return undefined
  const index = save.choices.findIndex((choice) => choice.id.startsWith(`recovery-${save.scene}-`) && choice.label === action)
  if (index !== 0 && index !== 1) return undefined
  return { mode: index === 0 ? 'confirm' : 'pause', originalAction: rootConsistencyAction(save, cartridge) }
}

export function applyConsistencyRecoverySelection(
  save: StorySave,
  cartridge: StoryCartridge,
  selectedAction: string,
  selection: { mode: 'confirm' | 'pause'; originalAction: string },
): StorySave {
  const scene = save.scene + 1
  const generic = createRecoveryChoices({ ...save, scene }, cartridge)
  const choices = generic.map((choice, index) => ({ ...choice, id: `recovery-exit-${scene}-${index}` }))
  const uniqueChoices = choices.filter((choice, index, all) => all.findIndex((entry) => entry.label === choice.label) === index).slice(0, 5)
  return {
    ...save,
    scene,
    locale: cartridge.locale,
    lastActionId: selectedAction,
    sessionEnded: false,
    decisionContext: '',
    choices: uniqueChoices,
    blocks: [
      ...save.blocks,
      { id: `action-${scene}`, kind: 'event', text: selectedAction },
      {
        id: `consistency-recovery-exit-${scene}`,
        kind: 'narration',
        text: t(cartridge.locale, selection.mode === 'confirm' ? 'consistencyRecoveryConfirmed' : 'consistencyRecoveryPaused', {
          name: save.location, action: selection.originalAction || selectedAction,
        }),
        data: { consistencyRecoveryExit: selection.mode },
      },
      createChoiceRecordBlock(scene, uniqueChoices),
    ],
  }
}

export function applyConsistencyRecovery(save: StorySave, cartridge: StoryCartridge, actionId: string): StorySave {
  const scene = save.scene + 1
  const originalAction = rootConsistencyAction(save, cartridge, actionId)
  const choices = createActionRecoveryChoices({ ...save, scene }, cartridge)
  return {
    ...save,
    scene,
    locale: cartridge.locale,
    lastActionId: originalAction,
    sessionEnded: false,
    decisionContext: '',
    facts: {
      ...save.facts,
      consistency_quarantined_action: originalAction,
      consistency_quarantined_location: save.location,
    },
    choices,
    blocks: [
      ...save.blocks,
      { id: `action-${scene}`, kind: 'event', text: originalAction },
      { id: `consistency-recovery-${scene}`, kind: 'narration', text: t(cartridge.locale, 'consistencyRecovery', { name: save.location, action: originalAction }) },
      createChoiceRecordBlock(scene, choices),
    ],
  }
}

/** A displayed route is an executable UI contract. If generation and its
 * repair both omit or contradict the destination, complete only the locally
 * certain route transition and continue from grounded state-owned choices. */
export function applyDisplayedRouteFallback(
  save: StorySave,
  cartridge: StoryCartridge,
  action: string,
  destination: MapNode,
): StorySave {
  const choices = createRecoveryChoices({
    ...save,
    scene: save.scene + 1,
    location: destination.label,
  }, cartridge)
  const text = cartridge.locale === 'zh'
    ? `你沿着已经确认的路线离开${save.location}，抵达${destination.label}。“${action}”这一步已经开始，眼前的环境与行动重新衔接。`
    : `You follow the confirmed route out of ${save.location} and reach ${destination.label}. “${action}” is now underway, with the action and surroundings aligned again.`
  const parsed: ParsedScene = {
    raw: text,
    blocks: [{ id: `route-fallback-${save.scene + 1}`, kind: 'narration', text }],
    commands: [
      {
        type: 'map_update', location: destination.label, locationId: destination.id, connectedTo: destination.connectedTo,
        detail: destination.detail, lore: destination.lore, facts: destination.facts, routeHints: destination.routeHints,
      },
      { type: 'scene_location', location: destination.label },
      { type: 'choices', choices: choices.map((choice) => choice.label) },
    ],
  }
  return applyParsedScene(save, parsed, cartridge, action)
}

export function repairLegacyConsistencyRecovery<T extends {
  scene: number
  location: string
  objective: string
  partyMemberIds?: StorySave['partyMemberIds']
  blocks: StorySave['blocks']
  choices: StorySave['choices']
  lastActionId?: string
}>(candidate: T, cartridge: StoryCartridge): T {
  const actions = new Map<number, string>()
  const recoveryScenes = new Set<number>()
  const recoveryLocations = new Map<number, string>()
  for (const block of candidate.blocks) {
    const actionScene = block.kind === 'event' ? block.id.match(/^action-(\d+)$/) : undefined
    if (actionScene) actions.set(Number(actionScene[1]), block.text)
    const recoveryScene = block.kind === 'narration' ? block.id.match(/^consistency-recovery-(\d+)$/) : undefined
    if (recoveryScene) {
      const scene = Number(recoveryScene[1])
      recoveryScenes.add(scene)
      const location = block.text.match(/。([^。]+)的一切仍在继续。?$/)?.[1]
        ?? block.text.match(/Life at (.+?) continues around you\.?$/i)?.[1]
      if (location) recoveryLocations.set(scene, location)
    }
  }
  if (candidate.lastActionId?.trim() && !actions.has(candidate.scene)) actions.set(candidate.scene, candidate.lastActionId.trim())
  if (!recoveryScenes.size) return candidate

  const rootActionForScene = (scene: number, action: string) => {
    if (!isSyntheticConsistencyAction(action, cartridge.locale)) return action
    for (let previous = scene - 1; previous >= 0; previous -= 1) {
      if (!recoveryScenes.has(previous)) continue
      const candidate = actions.get(previous)
      if (candidate && !isSyntheticConsistencyAction(candidate, cartridge.locale)) return candidate
    }
    return action
  }
  const actionChoices = (scene: number) => createActionRecoveryChoices({
    scene, location: recoveryLocations.get(scene) ?? candidate.location,
  }, cartridge)
  const rawCurrentAction = actions.get(candidate.scene)
  const currentAction = rawCurrentAction ? rootActionForScene(candidate.scene, rawCurrentAction) : undefined
  const currentLocation = recoveryLocations.get(candidate.scene) ?? candidate.location
  const currentExpected = currentAction ? t(cartridge.locale, 'consistencyRecovery', { name: currentLocation, action: currentAction }) : ''
  const currentRecovery = candidate.blocks.find((block) => block.id === `consistency-recovery-${candidate.scene}` && block.kind === 'narration')
  const currentWasLegacy = Boolean(currentAction && currentRecovery && (
    currentRecovery.text !== currentExpected || candidate.choices[0]?.label !== actionChoices(candidate.scene)[0]?.label
  ))
  let changed = false
  const blocks = candidate.blocks.map((block) => {
    const recoveryMatch = block.kind === 'narration' ? block.id.match(/^consistency-recovery-(\d+)$/) : undefined
    if (recoveryMatch) {
      const scene = Number(recoveryMatch[1])
      const rawAction = actions.get(scene)
      if (!rawAction) return block
      const action = rootActionForScene(scene, rawAction)
      const text = t(cartridge.locale, 'consistencyRecovery', { name: recoveryLocations.get(scene) ?? candidate.location, action })
      if (block.text === text) return block
      changed = true
      return { ...block, text }
    }
    const choicesMatch = block.kind === 'choices' ? block.id.match(/^choices-(\d+)$/) : undefined
    if (choicesMatch && recoveryScenes.has(Number(choicesMatch[1]))) {
      const scene = Number(choicesMatch[1])
      const rawAction = actions.get(scene)
      if (!rawAction) return block
      const text = encodeChoiceRecord(actionChoices(scene))
      if (block.text === text) return block
      changed = true
      return { ...block, text }
    }
    return block
  })

  let choices = candidate.choices
  if (currentAction && recoveryScenes.has(candidate.scene) && candidate.choices.every((choice) => choice.id.startsWith(`recovery-${candidate.scene}-`))) {
    const aligned = actionChoices(candidate.scene)
    if (candidate.choices.some((choice, index) => choice.label !== aligned[index]?.label)) changed = true
    choices = aligned
  }
  const eventTexts = new Set(candidate.blocks.filter((block) => block.kind === 'event' && block.id.startsWith('action-')).map((block) => block.text.trim()))
  const objective = currentWasLegacy && currentAction && eventTexts.has(candidate.objective.trim()) ? currentAction : candidate.objective
  if (objective !== candidate.objective) changed = true
  return changed ? { ...candidate, objective, choices, blocks } : candidate
}

export function restoreDeterministicRecoveryChoice(save: StorySave, cartridge: StoryCartridge): StorySave {
  if (save.sessionEnded || !save.blocks.some((block) => block.id === `consistency-recovery-${save.scene}`)) return save
  const action = rootConsistencyAction(save, cartridge)
  if (!action) return save
  const scripted = resolveDeterministicChoiceTurn(save, cartridge, action, { requireVisibleChoice: false })
  const route = inferActionDestination(save, cartridge, action)
  if (!scripted && !route) return save
  const retry = { id: `${scripted ? 'scripted' : 'route'}-recovery-${save.scene}`, label: action }
  const choices = [retry, ...save.choices.filter((choice) => choice.label !== action)].slice(0, 5)
  if (save.choices.length === choices.length && save.choices.every((choice, index) => choice.id === choices[index]?.id && choice.label === choices[index]?.label)) return save
  const recordId = `choices-${save.scene}`
  const blocks = save.blocks.map((block) => block.id === recordId && block.kind === 'choices'
    ? { ...block, text: encodeChoiceRecord(choices) }
    : block)
  return { ...save, choices, blocks }
}

function validChoiceLabels(labels: string[]): string[] {
  const seen = new Set<string>()
  return labels.map((label) => label.trim())
    .filter((label) => label.length >= 2 && label.length <= 96 && !seen.has(label) && Boolean(seen.add(label)))
    .slice(0, 5)
}

function deriveReplylessChoices(
  save: StorySave,
  next: StorySave,
  parsed: ParsedScene,
  effects: StoryBlock[],
  cartridge: StoryCartridge,
  actionId: string,
): StorySave['choices'] {
  // Once a visible threat is active, older sibling choices are no longer a
  // safe fallback: they may belong to the interrupted task or even the prior
  // location. Keep every emergency exit tied to the exact unresolved threat.
  if (next.danger.phase !== 'calm' && cartridge.dangerDirector) {
    return contextualDangerChoiceLabels(next.danger.currentThreat, cartridge.dangerDirector.methods, cartridge.locale)
      .filter((label) => label.trim() !== actionId.trim())
      .slice(0, 5)
      .map((label, index) => ({ id: `danger-recovery-${next.scene}-${index}`, label }))
  }
  const candidates = save.location === next.location
    ? save.choices
      .filter((choice) => choice.label.trim() !== actionId.trim())
      .map((choice, index) => ({ id: `derived-${next.scene}-${index}`, label: choice.label }))
    : []
  const context = { ...next, blocks: [...next.blocks, ...effects] }
  // Ground the carry-over against the state in which those choices were
  // originally offered, plus the newly committed prose. `next.blocks`
  // already contains the new action marker, which intentionally closes the
  // previous turn's context window and would otherwise erase every valid
  // sibling choice before the new blocks are appended.
  const grounded = new Set(filterGroundedChoices(candidates, save, cartridge, [...parsed.blocks, ...effects]).map((choice) => choice.label))
  const retained = candidates.filter((choice) => {
    const domain = resolveDomainAction(context, cartridge, choice.label)
    return domain ? domain.status === 'accepted' : grounded.has(choice.label)
  })
  if (retained.length) return retained.slice(0, 5)

  // A completed consequence must never leave the live tray empty merely
  // because the selected action was the only previous choice. Derive fresh
  // exits from the authoritative current place/objective, exclude the action
  // that just completed, and ground them against the newly committed prose.
  const stateCandidates = createRecoveryChoices(next, cartridge)
    .filter((choice) => choice.label.trim() !== actionId.trim())
  const stateGrounded = new Set(filterGroundedChoices(stateCandidates, context, cartridge, [...parsed.blocks, ...effects]).map((choice) => choice.label))
  return stateCandidates.filter((choice) => {
    const domain = resolveDomainAction(context, cartridge, choice.label)
    return domain ? domain.status === 'accepted' : stateGrounded.has(choice.label)
  }).slice(0, 5)
}

function cleanInferredItemLabel(value: string): string {
  return value
    .replace(/^[\s“”"「」『』]+|[\s“”"「」『』]+$/g, '')
    .replace(/^(?:一|1)\s*(?:个|件|把|枚|份|瓶|块|张|卷|只)\s*/, '')
    .replace(/^(?:the|an?)\s+/i, '')
    .trim()
}

function inferInventoryCommands(parsed: ParsedScene, cartridge: StoryCartridge): Extract<ParsedCommand, { type: 'inventory' }>[] {
  const narration = parsed.blocks.filter((block) => block.kind === 'narration').map((block) => block.text).join('\n')
  if (!narration) return []
  const explicit = new Set(parsed.commands.filter((command): command is Extract<ParsedCommand, { type: 'inventory' }> => command.type === 'inventory').map((command) => `${command.action}:${cleanInferredItemLabel(command.item).toLocaleLowerCase()}`))
  const patterns = cartridge.locale === 'zh'
    ? [
        { action: 'add' as const, expression: /你[^。！!？?\n]{0,28}?(?:获得了|得到了|收下了|捡起了?|拾起了?|取走了?|买下了?)([^，,。；;！!？?\n]{1,36})/g },
        { action: 'add' as const, expression: /你把([^，,。；;！!？?\n]{1,36}?)放(?:进|入)了?(?:行囊|背包)/g },
        { action: 'remove' as const, expression: /你[^。！!？?\n]{0,28}?(?:失去了|交出了|丢弃了|用掉了|消耗了)([^，,。；;！!？?\n]{1,36})/g },
      ]
    : [
        { action: 'add' as const, expression: /\byou [^.!?\n]{0,48}?\b(?:obtained|received|picked up|took|bought|kept)\s+([^.,;!?\n]{1,48})/gi },
        { action: 'add' as const, expression: /\byou put\s+([^.,;!?\n]{1,48}?)\s+in(?:to)? (?:your )?(?:pack|bag|inventory)\b/gi },
        { action: 'remove' as const, expression: /\byou [^.!?\n]{0,48}?\b(?:lost|gave away|discarded|consumed|used up)\s+([^.,;!?\n]{1,48})/gi },
      ]
  const inferred: Extract<ParsedCommand, { type: 'inventory' }>[] = []
  const seen = new Set<string>()
  patterns.forEach(({ action, expression }) => {
    let match: RegExpExecArray | null
    while ((match = expression.exec(narration))) {
      if (/(?:可以|能够|也许|或许|打算|准备|\bcan\b|\bcould\b|\bmay\b|\bmight\b|\bplan(?:ned)? to\b)/i.test(match[0])) continue
      const item = cleanInferredItemLabel(match[1])
      const key = `${action}:${item.toLocaleLowerCase()}`
      if (item.length < 2 || seen.has(key) || explicit.has(key)) continue
      seen.add(key)
      inferred.push({ type: 'inventory', action, item, count: 1 })
    }
  })
  return inferred.slice(0, 3)
}

export function applyParsedScene(
  save: StorySave,
  parsed: ParsedScene,
  cartridge: StoryCartridge,
  actionId: string,
  imagePrompt?: string,
  imageSubject?: SceneImageSubject,
  dangerDirective?: DangerDirective,
  domainResolution?: DomainActionResolution,
  imageCharacterId?: string,
  presetEventResolution?: PresetEventResolution,
): StorySave {
  const parsedCheckpoint = parsed.commands.some((command) => command.type === 'session_end')
  const activeDangerDirective = parsedCheckpoint
    || domainSuppressesDanger(domainResolution)
    || !dangerDirective
    || !dangerDirectiveEstablished(parsed, dangerDirective, cartridge.locale)
    ? undefined
    : dangerDirective
  const commandDestination = parsed.commands.find((command) => command.type === 'map_update')
  const domainMap = domainResolution?.status === 'accepted' ? domainResolution.effects.find((effect) => effect.type === 'map') : undefined
  const domainDestination = domainMap?.type === 'map'
    ? (save.map.find((node) => node.id === domainMap.nodeId)?.label ?? cartridge.initialMap.find((node) => node.id === domainMap.nodeId)?.label)
    : undefined
  const transition = createTransitionBlock(save, commandDestination?.type === 'map_update' ? commandDestination.location : domainDestination, cartridge)
  const next: StorySave = {
    ...save, locale: cartridge.locale, scene: save.scene + 1, sceneLocation: save.sceneLocation ?? save.location,
    blocks: [
      ...save.blocks,
      { id: `action-${save.scene + 1}`, kind: 'event', text: actionId },
      ...(transition ? [transition] : []),
      ...(domainResolution ? [] : parsed.blocks),
    ],
    choices: [], relationships: [...save.relationships], jobs: save.jobs.map((job) => ({ ...job })),
    map: save.map.map((node) => ({ ...node })), inventory: save.inventory.map((item) => ({ ...item })),
    characters: save.characters.map((character) => ({ ...character, skills: character.skills.map((skill) => ({ ...skill })), visualIdentity: character.visualIdentity ? cloneVisualIdentity(character.visualIdentity) : undefined })),
    partyMemberIds: [...save.partyMemberIds],
    stats: { ...save.stats },
    facts: { ...save.facts },
    danger: normalizeDangerState(save.danger),
    decisionContext: domainResolution?.continuation === 'resume' ? save.decisionContext : '', sessionEnded: false, lastActionId: actionId,
  }
  recordPresetEvent(next, presetEventResolution)
  delete next.facts.consistency_quarantined_action
  delete next.facts.consistency_quarantined_location
  const declaredAlias = playerDeclaredLocationAlias(actionId, cartridge.locale)
  if (declaredAlias) {
    const sourceNode = next.map.find((node) => node.current || node.label === save.location)
    if (sourceNode) sourceNode.routeHints = mergeRouteHints(sourceNode.routeHints, [declaredAlias])
  }
  const visibleTurnText = parsed.blocks
    .filter((block) => block.kind === 'narration' || block.kind === 'dialogue')
    .map((block) => block.text.trim()).filter(Boolean).join(' ')
  const effects: StoryBlock[] = []
  let dangerCheckAdded = false
  const adjudicatedParsed: ParsedScene = domainResolution
    ? domainResolution.status === 'accepted' && domainResolution.dangerPolicy === 'advance' && activeDangerDirective
      ? { ...parsed, commands: parsed.commands.filter((command) => command.type === 'encounter' || command.type === 'skill_check') }
      : { ...parsed, commands: [] }
    : parsed

  const commands = [...parsed.commands, ...inferInventoryCommands(parsed, cartridge)]
    .filter((command) => domainAllowsModelCommand(command, domainResolution))
  const hasJobSettlement = commands.some((command) => command.type === 'job' && command.action === 'settle')
  commands.forEach((command, index) => {
    const effectId = `effect-${next.scene}-${index}`
    if (command.type === 'choices') {
      const labels = validChoiceLabels(command.choices)
      // Ignore malformed late tags instead of letting them erase an earlier
      // valid choice set recovered from prose.
      if (labels.length) next.choices = labels.map((label, choiceIndex) => ({ id: `${next.scene}-${choiceIndex}`, label }))
    }
    if (command.type === 'situation') next.decisionContext = authoredDecisionContext(command.text, visibleTurnText, cartridge.locale)
    if (command.type === 'widget') {
      const definition = cartridge.statDefinitions.find((stat) => stat.id === command.id)
      if (!definition) return
      if (command.id === 'coin' && command.operation === 'add' && hasJobSettlement) return
      const current = next.stats[command.id] ?? definition.initial
      const raw = Number(command.value)
      const requested = command.operation === 'add' ? current + raw : command.operation === 'remove' ? current - raw : raw
      const maxDelta = definition.maxDelta == null ? Number.POSITIVE_INFINITY : Math.max(0, definition.maxDelta)
      const boundedDelta = clamp(requested - current, -maxDelta, maxDelta)
      next.stats[command.id] = clamp(current + boundedDelta, definition.min, definition.max)
      const delta = next.stats[command.id] - current
      effects.push(changeBlock(effectId, `${definition.label} ${delta > 0 ? '+' : ''}${delta}`, { stat: command.id, delta }))
    }
    if (command.type === 'skill_check') {
      const fixed = activeDangerDirective?.phase === 'resolution' && activeDangerDirective.check ? activeDangerDirective.check : undefined
      const check = fixed ?? command
      const succeeded = fixed ? fixed.outcome === 'critical-success' || fixed.outcome === 'success' || fixed.outcome === 'costly-success' : command.result === 'success'
      effects.push({ id: effectId, kind: 'check', text: `${check.skill} · ${succeeded ? t(cartridge.locale, 'checkSuccess') : t(cartridge.locale, 'checkFailure')}`, data: { dc: check.dc, roll: check.roll, modifier: check.modifier, total: check.total, outcome: fixed?.outcome ?? command.result } })
      dangerCheckAdded = Boolean(fixed)
    }
    if (command.type === 'state' && command.value) next.objective = command.value
    if (command.type === 'clock' && command.value) {
      next.time = command.value
      const day = command.value.match(/(?:第\s*(\d+)\s*天|Day\s*(\d+))/i)
      if (day) next.facts.world_day = Math.max(1, Number(day[1] ?? day[2]))
    }
    if (command.type === 'map_update') {
      const beforeLocation = next.location
      const hints = validatedDynamicRouteHints(command, parsed)
      const existing = next.map.find((node) => node.id === command.locationId || node.label === command.location || node.id === command.location)
      const destinationId = existing?.id ?? command.locationId ?? stableDynamicLocationId(command.location)
      next.map.forEach((node) => { node.current = node.id === destinationId })
      if (existing) {
        existing.current = true
        existing.visited = true
        if (command.connectedTo) existing.connectedTo = command.connectedTo
        if (command.detail) existing.detail = command.detail
        if (command.lore) existing.lore = command.lore
        if (command.facts) existing.facts = command.facts
        existing.routeHints = mergeRouteHints(existing.routeHints, hints)
      } else next.map.push({
        id: destinationId, label: command.location, connectedTo: command.connectedTo, current: true, visited: true,
        detail: command.detail, lore: command.lore, facts: command.facts, routeHints: hints,
      })
      next.location = command.location
      next.sceneLocation = command.location
      if (beforeLocation !== command.location) effects.push({ id: effectId, kind: 'event', text: t(cartridge.locale, 'arrived', { name: command.location }), data: { arrival: command.location, locationId: destinationId } })
    }
    if (command.type === 'scene_location') next.sceneLocation = command.location
    if (command.type === 'inventory') {
      const existing = next.inventory.find((item) => item.label === command.item || item.id === command.item)
      let changed = false
      if (existing) {
        const before = existing.count
        existing.count = Math.max(0, existing.count + (command.action === 'add' ? command.count : -command.count))
        changed = existing.count !== before
        if (command.rarity) existing.rarity = command.rarity
        if (command.detail) existing.detail = command.detail
        if (command.effect) existing.effect = command.effect
        if (command.lore) existing.lore = command.lore
        if (command.metrics) existing.metrics = command.metrics
        if (command.imagePrompt) existing.imagePrompt = command.imagePrompt
      } else if (command.action === 'add') {
        next.inventory.push({
          id: `item-${next.scene}-${index}`, label: command.item, count: command.count, rarity: command.rarity,
          detail: command.detail, effect: command.effect, lore: command.lore, metrics: command.metrics, imagePrompt: command.imagePrompt,
          imageStatus: 'idle',
        })
        changed = true
      }
      next.inventory = next.inventory.filter((item) => item.count > 0)
      if (changed) effects.push(changeBlock(effectId, `${command.action === 'add' ? t(cartridge.locale, 'gained') : t(cartridge.locale, 'lost')} ${command.item} ×${command.count}`, { itemAction: command.action, ...(command.rarity ? { rarity: command.rarity } : {}) }))
    }
    if (command.type === 'job') {
      const existing = next.jobs.find((job) => job.id === command.id)
      if (command.action === 'offer') {
        if (!command.wage || !command.label || existing) return
        next.jobs.push({ id: command.id, label: command.label, employer: command.employer, wage: command.wage, status: 'offered', offeredAtScene: next.scene })
      }
      if (command.action === 'accept' && existing && existing.status === 'offered') existing.status = 'accepted'
      if (command.action === 'cancel' && existing && existing.status !== 'settled') existing.status = 'cancelled'
      const payable = command.action === 'settle' ? next.jobs.find((job) => job.id === command.id) : undefined
      if (payable && (payable.status === 'offered' || payable.status === 'accepted')) {
        const definition = cartridge.statDefinitions.find((stat) => stat.id === 'coin')
        if (!definition) return
        const before = next.stats.coin ?? definition.initial
        const wage = Math.min(payable.wage, definition.maxDelta ?? payable.wage)
        next.stats.coin = clamp(before + wage, definition.min, definition.max)
        const delta = next.stats.coin - before
        payable.status = 'settled'
        payable.settledAtScene = next.scene
        next.facts.jobs_completed = Number(next.facts.jobs_completed ?? 0) + 1
        if (delta) effects.push(changeBlock(effectId, `${definition.label} +${delta}`, { stat: 'coin', delta, jobId: payable.id }))
      }
      next.jobs = next.jobs.slice(-40)
    }
    if (command.type === 'reputation') {
      const delta = /betray|hostile|distrust|拒绝|背叛/i.test(command.action) ? -1 : 1
      const character = next.characters.find((entry) => normalizedCharacterName(entry.name) === normalizedCharacterName(command.npc))
      if (!character) return
      next.relationships.push({ id: effectId, actor: character.name, characterId: character.id, axis: command.action, delta, source: actionId })
      effects.push(changeBlock(effectId, `${command.npc} · ${delta > 0 ? t(cartridge.locale, 'warmer') : t(cartridge.locale, 'colder')}`, { delta, relationshipChange: command.action }))
    }
    if (command.type === 'character_update') {
      const existing = matchingCharacter(next, command)
      if (characterIdentityConflict(next, command, cartridge)) return
      if (!existing && !hasVisibleCharacterDebut(parsed, command.character, cartridge.locale)) return
      resolveCharacter(next, command, index, cartridge)
    }
    if (command.type === 'party_change') {
      const character = resolveCharacter(next, command, index, cartridge)
      if (!character) return
      if (command.change === 'add') {
        if (!hasVisiblePartyJoin(parsed, character.name, cartridge.locale)) return
        if (!next.partyMemberIds.includes(character.id)) next.partyMemberIds.push(character.id)
        character.status = 'companion'
        character.joinedAtScene ??= next.scene
        character.leftAtScene = undefined
      } else {
        if (!hasVisibleDeparture(parsed, character.name)) return
        next.partyMemberIds = next.partyMemberIds.filter((id) => id !== character.id)
        character.status = 'departed'
        character.leftAtScene = next.scene
      }
      character.updatedAtScene = next.scene
      effects.push({ id: effectId, kind: 'event', text: `${character.name}${t(cartridge.locale, command.change === 'add' ? 'joined' : 'left')}`, data: { characterId: character.id, partyChange: command.change } })
    }
    if (command.type === 'session_end') {
      next.sessionEnded = true
      effects.push({ id: effectId, kind: 'summary', text: command.reason })
    }
  })

  if (activeDangerDirective?.phase === 'resolution' && activeDangerDirective.check && !dangerCheckAdded) {
    const check = activeDangerDirective.check
    const succeeded = check.outcome === 'critical-success' || check.outcome === 'success' || check.outcome === 'costly-success'
    effects.push({
      id: `danger-check-${next.scene}`, kind: 'check', text: `${check.skill} · ${succeeded ? t(cartridge.locale, 'checkSuccess') : t(cartridge.locale, 'checkFailure')}`,
      data: { dc: check.dc, roll: check.roll, modifier: check.modifier, total: check.total, outcome: check.outcome },
    })
  }
  if (domainResolution?.status !== 'rejected') effects.push(...settleDangerTurn(save, next, adjudicatedParsed, cartridge, activeDangerDirective))
  effects.push(...applyDomainResolution(next, cartridge, domainResolution))

  // Ordinary scenes must remain playable even when an AI response omits or
  // truncates its machine-readable choices. A real checkpoint may still use
  // the dedicated resume action supplied by the Composer.
  if (next.choices.length) {
    const textGrounded = new Set(filterGroundedChoices(next.choices, { ...next, blocks: [...next.blocks, ...effects] }, cartridge, [...parsed.blocks, ...effects]).map((choice) => choice.label))
    const trustedDomainChoices = new Set(domainResolution?.status === 'accepted' && domainResolution.continuation === 'replace'
      ? domainResolution.successChoices
      : [])
    const trustedPresetChoices = new Set(presetEventResolution
      ? parsed.commands.find((command): command is Extract<ParsedCommand, { type: 'choices' }> => command.type === 'choices')?.choices ?? []
      : [])
    next.choices = next.choices.filter((choice) => {
      const domain = resolveDomainAction(next, cartridge, choice.label)
      const authored = resolveDeterministicChoiceTurn(next, cartridge, choice.label)
      return domain ? domain.status === 'accepted' : trustedDomainChoices.has(choice.label) || trustedPresetChoices.has(choice.label) || Boolean(authored) || Boolean(inferActionDestination(next, cartridge, choice.label)) || textGrounded.has(choice.label)
    })
  }
  if (!next.sessionEnded && next.choices.length === 0) {
    next.choices = activeDangerDirective
      ? dangerDirectiveChoices(activeDangerDirective, next.scene)
      : deriveReplylessChoices(save, next, parsed, effects, cartridge, actionId)
  }

  const floor = activeStatFloorRule(next, cartridge)
  if (!next.sessionEnded && floor) {
    const previous = Number(save.stats[floor.definition.id] ?? floor.definition.initial)
    if (previous > floor.threshold) {
      effects.push({
        id: `stat-floor-${floor.definition.id}-${next.scene}`,
        kind: 'event',
        text: floor.rule.enteredText,
        data: { statFloor: floor.definition.id, threshold: floor.threshold },
      })
    }
    next.choices = statFloorChoices(next, cartridge) ?? next.choices
  }

  if (!next.sessionEnded && next.choices.length) next.choices = bindChoiceDestinations(next.choices, next, cartridge)

  const domainImageNode = domainMap?.type === 'map'
    ? (next.map.find((node) => node.id === domainMap.nodeId) ?? cartridge.initialMap.find((node) => node.id === domainMap.nodeId))
    : undefined
  const imageParsed: ParsedScene = domainImageNode
    ? {
        ...adjudicatedParsed,
        commands: [{
          type: 'map_update', location: domainImageNode.label, locationId: domainImageNode.id, connectedTo: domainImageNode.connectedTo,
          detail: domainImageNode.detail, lore: domainImageNode.lore, facts: domainImageNode.facts, routeHints: domainImageNode.routeHints,
        }],
      }
    : adjudicatedParsed
  const image = domainResolution?.status === 'rejected'
    ? { prompt: '' }
    : chooseSceneImage(
        save, next, imageParsed, cartridge, imagePrompt,
        domainImageNode && !imageSubject ? 'environment' : imageSubject,
        imageCharacterId,
      )
  next.blocks = [
    ...next.blocks,
    ...effects,
    ...(image.prompt ? [createImageBlock(`image-${next.scene}`, next.sceneLocation ?? next.location, image.prompt, 'queued', '', {
      source: image.source ?? 'director', reason: image.reason ?? 'cadence', promptVersion: String(SCENE_IMAGE_PROMPT_VERSION),
      playerVisible: image.playerVisible ? 'true' : 'false',
      perspective: image.perspective ?? 'observer',
      ...(image.identityCharacterId ? { identityCharacterId: image.identityCharacterId } : {}),
    })] : []),
    ...(!next.sessionEnded && next.choices.length ? [createChoiceRecordBlock(next.scene, next.choices)] : []),
  ]
  return syncDomainDerivedState(next, cartridge)
}
