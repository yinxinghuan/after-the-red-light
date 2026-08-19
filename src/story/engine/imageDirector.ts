import { SCENE_IMAGE_PROMPT_VERSION, type ParsedScene, type SceneImagePerspective, type SceneImageSubject, type SceneImageTrigger, type StoryCartridge, type StorySave } from '../types'

export interface SceneImageDecision {
  prompt?: string
  source?: 'ai' | 'director'
  reason?: 'ai-proposal' | SceneImageTrigger | 'cadence'
  playerVisible?: boolean
  identityCharacterId?: string
  perspective?: SceneImagePerspective
}

function lastScheduledScene(save: StorySave): number {
  return save.blocks.reduce((latest, block) => {
    if (block.kind !== 'image') return latest
    const match = block.id.match(/^image-(\d+)$/)
    return match ? Math.max(latest, Number(match[1])) : latest
  }, 0)
}

function firstTrigger(triggers: SceneImageTrigger[], allowed: SceneImageTrigger[]): SceneImageTrigger | undefined {
  return triggers.find((trigger) => allowed.includes(trigger))
}

function normalizedName(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s·•.。,:：，'’"“”()（）\-—_]/g, '')
}

function substantiveDialogue(value: string): boolean {
  const compact = value.replace(/\s+/g, '')
  const han = compact.match(/[\u3400-\u9fff]/g)?.length ?? 0
  const words = value.match(/[a-z][a-z'-]*/gi)?.length ?? 0
  return han >= 6 || words >= 5 || compact.length >= 18
}

function expressionOwner(next: StorySave, parsed: ParsedScene) {
  const explicit = [...parsed.commands].reverse().find((command) => command.type === 'dialogue_focus')
  const impactfulCommand = parsed.commands.some((command) =>
    command.type === 'state' || command.type === 'map_update' || command.type === 'reputation'
    || command.type === 'party_change' || command.type === 'character_update' || command.type === 'job' || command.type === 'encounter'
    || command.type === 'session_end' || command.type === 'skill_check')
  const importantText = /真相|秘密|线索|发现|决定|答应|承诺|警告|小心|必须|不能|不要|别|愿意|喜欢|害怕|担心|抱歉|原谅|谢谢你|再见|留下|离开|失踪|死亡|请求|邀请|任务|报酬|危险|救|trust|truth|secret|clue|discover|decid|promise|warn|careful|must|cannot|can't|don't|stay|leave|missing|dead|afraid|sorry|forgive|thank you|invite|request|task|payment|danger|save/i
  const neutralTone = /^(?:main|neutral|ordinary|calm|polite|matter[- ]of[- ]fact|平静|中性|普通|客气|礼貌|随口)$/i
  const dialogues = [...parsed.blocks].reverse().filter((block) => block.kind === 'dialogue' && block.speaker)
  const selected = explicit?.type === 'dialogue_focus'
    ? dialogues.find((dialogue) => normalizedName(dialogue.speaker ?? '') === normalizedName(explicit.speaker))
    : dialogues.find((dialogue) => substantiveDialogue(dialogue.text) && (
        importantText.test(dialogue.text) || (!neutralTone.test(dialogue.tone?.trim() ?? 'main')) || impactfulCommand
      ))
  if (!selected?.speaker) return undefined
  const speaker = normalizedName(selected.speaker)
  const character = next.characters.find((entry) => normalizedName(entry.name) === speaker)
  return { character, dialogue: selected, expression: explicit?.type === 'dialogue_focus' ? explicit.expression : undefined }
}

function detectTriggers(previous: StorySave, next: StorySave, parsed: ParsedScene): SceneImageTrigger[] {
  const triggers: SceneImageTrigger[] = []
  for (const command of parsed.commands) {
    if (command.type === 'map_update') {
      const known = previous.map.find((node) => node.label === command.location || node.id === command.location)
      if (!known?.visited) triggers.push('new-location')
    }
    if (command.type === 'inventory' && command.action === 'add' && (command.rarity === 'rare' || command.rarity === 'legendary')) triggers.push('rare-item')
    if (command.type === 'party_change') triggers.push('party-change')
    if (command.type === 'session_end') triggers.push('chapter-checkpoint')
    if (command.type === 'reputation') triggers.push('relationship-change')
    if (command.type === 'state' && command.value && command.value !== previous.objective) triggers.push('objective-change')
    if (command.type === 'skill_check') triggers.push('skill-outcome')
  }
  if (expressionOwner(next, parsed)) triggers.push('character-expression')
  return [...new Set(triggers)]
}

function focusFor(reason: SceneImageTrigger | 'cadence', parsed: ParsedScene, next: StorySave): string {
  if (reason === 'new-location') {
    const node = next.map.find((entry) => entry.current)
    const evidence = [node?.detail, ...(node?.facts ?? [])].filter(Boolean).join('; ')
    return `the first arrival at ${next.location}${evidence ? `, visibly established through these local facts: ${evidence}` : ''}`
  }
  if (reason === 'rare-item') {
    const item = parsed.commands.find((command) => command.type === 'inventory' && command.action === 'add' && (command.rarity === 'rare' || command.rarity === 'legendary'))
    return item?.type === 'inventory' ? `the discovery of ${item.item}` : 'an important discovery'
  }
  if (reason === 'party-change') {
    const party = parsed.commands.find((command) => command.type === 'party_change')
    return party?.type === 'party_change' ? `${party.character} ${party.change === 'add' ? 'joining' : 'leaving'} the group` : 'a change in the group'
  }
  if (reason === 'chapter-checkpoint') return 'the visible situation at this chapter checkpoint'
  if (reason === 'relationship-change') {
    const relationship = parsed.commands.find((command) => command.type === 'reputation')
    return relationship?.type === 'reputation' ? `a relationship turning point involving ${relationship.npc}` : 'a relationship turning point'
  }
  if (reason === 'objective-change') return `the newly established objective: ${next.objective}`
  if (reason === 'skill-outcome') return 'the visible consequence of the latest attempt'
  if (reason === 'character-expression') {
    const owner = expressionOwner(next, parsed)
    return owner ? `${owner.character?.name ?? owner.dialogue.speaker}'s readable expression and gesture while saying: ${owner.dialogue.text}` : 'an important character reaction'
  }
  return 'the most visually distinctive visible consequence of the latest turn'
}

function visibleBeat(parsed: ParsedScene): string {
  return parsed.blocks
    .filter((block) => block.kind !== 'change' && block.kind !== 'image' && block.kind !== 'choices' && block.text.trim())
    .slice(-4)
    .map((block) => block.speaker ? `${block.speaker}: ${block.text}` : block.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(0, 760)
}

function words(value: string): string[] {
  return value.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []
}

function pairs(value: string): Set<string> {
  const tokens = words(value)
  return new Set(tokens.slice(0, -1).map((token, index) => `${token} ${tokens[index + 1]}`))
}

function carriesOpeningResidue(cartridge: StoryCartridge, next: StorySave, parsed: ParsedScene, proposal: string): boolean {
  if (next.location === cartridge.opening.location) return false
  const directionPairs = pairs(cartridge.sceneImageDirection ?? '')
  const openingReference = `${cartridge.opening.imagePrompt} ${cartridge.sceneImageAvoid ?? ''}`
  const openingPairs = pairs(openingReference)
  const proposalPairs = pairs(proposal)
  const beatPairs = pairs(visibleBeat(parsed))
  let residuePairs = 0
  for (const phrase of proposalPairs) {
    if (openingPairs.has(phrase) && !directionPairs.has(phrase) && !beatPairs.has(phrase)) residuePairs += 1
  }
  const directionWords = new Set(words(cartridge.sceneImageDirection ?? ''))
  const openingWords = new Set(words(openingReference).filter((token) => !directionWords.has(token)))
  const beatWords = new Set(words(visibleBeat(parsed)))
  const proposalWords = new Set(words(proposal))
  let residueWords = 0
  for (const token of proposalWords) {
    if (openingWords.has(token) && !beatWords.has(token)) residueWords += 1
  }
  return residuePairs >= 1 || residueWords >= 2
}

function latestLocation(next: StorySave, parsed: ParsedScene): string {
  const scene = [...parsed.commands].reverse().find((command) => command.type === 'scene_location')
  if (scene?.type === 'scene_location') return scene.location
  const update = [...parsed.commands].reverse().find((command) => command.type === 'map_update')
  return update?.type === 'map_update' ? update.location : next.sceneLocation ?? next.location
}

function playerIsVisible(parsed: ParsedScene, proposal?: string, subject?: SceneImageSubject): boolean {
  if (subject === 'player') return true
  if (subject === 'environment' || subject === 'others') return false
  const shot = proposal ?? ''
  if (/\b(no people|nobody|unoccupied|environment-only|object-only)\b|无人|空镜|纯环境|物品特写/i.test(shot)) return false
  return /\b(player protagonist|protagonist|player character|returning player|the player|traveler|wayfarer|adventurer|you)\b|玩家|主角|旅人|旅行者|冒险者|你/i.test(shot)
}

function directedPerspective(
  cartridge: StoryCartridge,
  next: StorySave,
  parsed: ParsedScene,
  reason: SceneImageTrigger | 'cadence',
  proposal: string | undefined,
  playerVisible: boolean,
): SceneImagePerspective {
  if (playerVisible) return 'observer'
  const shot = proposal ?? ''
  if (/\b(first[- ]person|player[- ]eye|point[- ]of[- ]view|POV)\b|第一人称|主角视角|玩家视角/i.test(shot)) return 'first-person'
  if (/\b(third[- ]person|over[- ]the[- ]shoulder|wide establishing|full[- ]body protagonist)\b|第三人称|肩后|全身主角|环境建立镜头/i.test(shot)) return 'observer'

  const policy = cartridge.imageDirector?.perspective
  if (reason === 'character-expression') return policy?.importantDialogue ?? 'observer'
  if (reason === 'new-location') return policy?.newLocation ?? 'observer'
  const ordinary = policy?.ordinary ?? 'observer'
  if (ordinary === 'observer') return 'observer'
  // Use the authoritative scene number rather than model wording so the
  // observed mix cannot drift when prose happens to hash into one bucket.
  const roll = Math.max(0, Math.floor(next.scene)) % 4
  return ordinary === 'balanced'
    ? (roll % 2 === 0 ? 'first-person' : 'observer')
    : (roll === 0 ? 'observer' : 'first-person')
}

function buildScenePrompt(
  cartridge: StoryCartridge,
  next: StorySave,
  parsed: ParsedScene,
  reason: SceneImageTrigger | 'cadence',
  aiProposal?: string,
  playerVisible = false,
  identityCharacterId?: string,
  perspective: SceneImagePerspective = 'observer',
): string {
  const beat = visibleBeat(parsed) || next.objective
  const proposal = aiProposal?.replace(/\s+/g, ' ').trim().slice(0, 620)
  const acceptedProposal = proposal && !carriesOpeningResidue(cartridge, next, parsed, proposal) ? proposal : ''
  const direction = cartridge.sceneImageDirection ?? `${cartridge.theme.material} story-world editorial illustration`
  const dialogueMoment = reason === 'character-expression' ? expressionOwner(next, parsed) : undefined
  return [
    'Create one fresh 4:3 cinematic illustration in the established story world.',
    acceptedProposal ? `Primary shot brief: ${acceptedProposal}.` : `Primary shot focus: ${focusFor(reason, parsed, next)}.`,
    `Latest visible story beat, which overrides older continuity hints: ${beat}.`,
    `Current location hint: ${latestLocation(next, parsed)}. Use it only when consistent with the latest visible beat; never drag an earlier location into a newer scene.`,
    `Mandatory art direction: ${direction}.`,
    perspective === 'first-person' ? 'FIRST-PERSON PLAYER-EYE VIEW. The camera is the protagonist’s eyes inside the current scene. Do not show the protagonist’s face, head, back, shoulders, silhouette, reflection, or full body, and do not use an over-the-shoulder third-person composition. Do not invent the protagonist’s hands; show them only when the latest visible story explicitly establishes them. Build the foreground from the other person’s gesture, a nearby object, a doorframe, work surface, or window edge.' : '',
    playerVisible ? 'The player protagonist is the dominant visible human in this frame and must be the same person performing the single main player action. Keep their face naturally readable and do not assign that action or identity to a companion, NPC, background figure or animal.' : '',
    dialogueMoment ? `${dialogueMoment.character?.name ?? dialogueMoment.dialogue.speaker} is the one dominant visible adult seen from the protagonist’s position. Use a contextual medium close-up or chest-up reaction shot. Make ${dialogueMoment.expression ? `this expression visually specific: ${dialogueMoment.expression}` : 'the current expression legible through eyes, mouth, posture and one restrained hand gesture'}. Keep enough current-location background to preserve narrative context, and avoid a centered passport portrait.` : identityCharacterId ? 'Use a contextual medium close-up or chest-up reaction shot from the protagonist’s position. The named identity owner is the only clearly readable face; make their current emotion legible through eyes, mouth, posture and one restrained hand gesture. Keep enough current-location background to preserve narrative context, and avoid a centered passport portrait.' : '',
    'Compose one readable moment with one dominant action and at most two focal subjects. Choose a camera position, scale, lighting pattern and silhouette that differ from earlier images.',
    'Ignore all cover art and opening-scene imagery. Derive the depicted location, action, subjects, props and weather only from the primary shot brief and latest visible story beat.',
    'Show only people, objects, places and consequences established in the latest visible story. No montage, split screen, flash-forward, readable text, letters, logo, border, poster layout or UI.',
  ].filter(Boolean).join(' ')
}

export function shouldUsePlayerImageReference(prompt: string): boolean {
  const explicitlyEmpty = /\b(no people|nobody|unoccupied|environment-only|object-only)\b|无人|空镜|纯环境|物品特写/i.test(prompt)
  const firstPerson = /\b(first[- ]person|player[- ]eye|point[- ]of[- ]view|POV)\b|第一人称|主角视角|玩家视角/i.test(prompt)
  const playerVisible = /\b(player protagonist|protagonist|player character|returning player|the player|traveler|wayfarer|adventurer|you)\b|玩家|主角|旅人|旅行者|冒险者/i.test(prompt)
  return playerVisible && !explicitlyEmpty && !firstPerson
}

export function upgradePendingSceneImagePrompts(save: StorySave, cartridge: StoryCartridge): StorySave {
  let changed = false
  const blocks = save.blocks.map((block, index) => {
    if (block.kind !== 'image' || block.id === 'image-0' || block.data?.status === 'ready') return block
    if (Number(block.data?.promptVersion ?? 0) >= SCENE_IMAGE_PROMPT_VERSION) return block
    let previousImage = -1
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (save.blocks[cursor]?.kind === 'image') { previousImage = cursor; break }
    }
    const parsed: ParsedScene = {
      blocks: save.blocks.slice(previousImage + 1, index).filter((candidate) => candidate.kind !== 'image'),
      commands: [],
      raw: '',
    }
    const historical = { ...save, sceneLocation: block.text || save.sceneLocation || save.location }
    const visible = playerIsVisible(parsed)
    const perspective = directedPerspective(cartridge, historical, parsed, 'cadence', undefined, visible)
    changed = true
    return {
      ...block,
      data: {
        ...block.data,
        prompt: buildScenePrompt(cartridge, historical, parsed, 'cadence', undefined, visible, undefined, perspective),
        promptVersion: SCENE_IMAGE_PROMPT_VERSION,
        playerVisible: visible ? 'true' : 'false',
        perspective,
        status: block.data?.status === 'generating' ? 'queued' : block.data?.status ?? 'queued',
      },
    }
  })
  return changed ? { ...save, blocks } : save
}

export function chooseSceneImage(
  previous: StorySave,
  next: StorySave,
  parsed: ParsedScene,
  cartridge: StoryCartridge,
  aiPrompt?: string,
  imageSubject?: SceneImageSubject,
  imageCharacterId?: string,
): SceneImageDecision {
  const director = cartridge.imageDirector
  const owner = expressionOwner(next, parsed)
  if (director && owner && director.guaranteedTriggers.includes('character-expression')) {
    const identityCharacterId = owner.character?.visualIdentity ? owner.character.id : undefined
    const perspective = directedPerspective(cartridge, next, parsed, 'character-expression', undefined, false)
    return { prompt: buildScenePrompt(cartridge, next, parsed, 'character-expression', undefined, false, identityCharacterId, perspective), source: 'director', reason: 'character-expression', playerVisible: false, identityCharacterId, perspective }
  }

  const proposal = aiPrompt?.trim()
  if (proposal) {
    const visible = playerIsVisible(parsed, proposal, imageSubject)
    const identityOwner = imageSubject === 'others' && imageCharacterId
      ? next.characters.find((character) => character.id === imageCharacterId && character.visualIdentity)
      : undefined
    const perspective = directedPerspective(cartridge, next, parsed, 'cadence', proposal, visible)
    return {
      prompt: buildScenePrompt(cartridge, next, parsed, 'cadence', proposal, visible, identityOwner?.id, perspective),
      source: 'ai',
      reason: 'ai-proposal',
      playerVisible: visible,
      identityCharacterId: identityOwner?.id,
      perspective,
    }
  }

  if (!director) return {}
  const visible = owner ? false : playerIsVisible(parsed, undefined, imageSubject)
  const triggers = detectTriggers(previous, next, parsed)
  const guaranteed = firstTrigger(triggers, director.guaranteedTriggers)
  if (guaranteed) {
    const identityCharacterId = owner?.character?.visualIdentity ? owner.character.id : undefined
    const perspective = directedPerspective(cartridge, next, parsed, guaranteed, undefined, visible)
    return { prompt: buildScenePrompt(cartridge, next, parsed, guaranteed, undefined, visible, identityCharacterId, perspective), source: 'director', reason: guaranteed, playerVisible: visible, identityCharacterId, perspective }
  }

  const turnsSinceImage = next.scene - lastScheduledScene(previous)
  const soft = firstTrigger(triggers, director.softTriggers)
  if (soft && turnsSinceImage >= director.softCooldownTurns) {
    const identityCharacterId = owner?.character?.visualIdentity ? owner.character.id : undefined
    const perspective = directedPerspective(cartridge, next, parsed, soft, undefined, visible)
    return { prompt: buildScenePrompt(cartridge, next, parsed, soft, undefined, visible, identityCharacterId, perspective), source: 'director', reason: soft, playerVisible: visible, identityCharacterId, perspective }
  }
  if (turnsSinceImage >= director.maxQuietTurns) {
    const identityCharacterId = owner?.character?.visualIdentity ? owner.character.id : undefined
    const perspective = directedPerspective(cartridge, next, parsed, 'cadence', undefined, visible)
    return { prompt: buildScenePrompt(cartridge, next, parsed, 'cadence', undefined, visible, identityCharacterId, perspective), source: 'director', reason: 'cadence', playerVisible: visible, identityCharacterId, perspective }
  }
  return {}
}
