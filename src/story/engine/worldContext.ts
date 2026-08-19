import type { AdapterContext, StoryBlock, StoryCharacter } from '../types'

const maxRecentBlocks = 20
const maxRecentKnownCharacters = 30

function visibleHistory(blocks: StoryBlock[]) {
  return blocks
    .filter((block) => block.kind !== 'image' && block.kind !== 'choices')
    .slice(-maxRecentBlocks)
    .map((block) => ({ kind: block.kind, speaker: block.speaker, tone: block.tone, text: block.text }))
}

function characterSnapshot(character: StoryCharacter) {
  return {
    id: character.id,
    name: character.name,
    role: character.role,
    status: character.status,
    vitality: character.vitality,
    stress: character.stress,
    skills: character.skills,
    detail: character.detail,
    lore: character.lore,
    lastKnownLocation: character.lastKnownLocation,
    joinedAtScene: character.joinedAtScene,
    leftAtScene: character.leftAtScene,
  }
}

export function buildWorldContext(context: AdapterContext) {
  const { cartridge, save } = context
  const activeParty = save.partyMemberIds
    .map((id) => save.characters.find((character) => character.id === id))
    .filter((character): character is StoryCharacter => Boolean(character))
  const activeIds = new Set(activeParty.map((character) => character.id))
  const recentKnown = save.characters
    .filter((character) => !activeIds.has(character.id))
    .sort((left, right) => right.updatedAtScene - left.updatedAtScene)
    .slice(0, maxRecentKnownCharacters)
  return {
    game: {
      title: cartridge.copy.title,
      premise: cartridge.copy.promise,
      language: context.locale === 'zh' ? 'Simplified Chinese' : 'English',
      director: cartridge.director,
      dangerDirector: cartridge.dangerDirector,
    },
    current: {
      scene: save.scene,
      location: save.location,
      sceneLocation: save.sceneLocation ?? save.location,
      time: save.time,
      objective: save.objective,
      stats: cartridge.statDefinitions.map((definition) => ({
        id: definition.id,
        label: definition.label,
        value: save.stats[definition.id] ?? definition.initial,
        min: definition.min,
        max: definition.max,
      })),
      activeParty: activeParty.map(characterSnapshot),
      knownCharacters: [...activeParty, ...recentKnown].map(characterSnapshot),
      map: save.map,
      inventory: save.inventory,
      jobs: save.jobs.slice(-20),
      facts: save.facts,
      relationships: save.relationships.slice(-30),
      danger: save.danger,
      dangerDirective: context.dangerDirective,
      domainResolution: context.domainResolution,
      recentStory: visibleHistory(save.blocks),
    },
  }
}

export const partyContinuityContract = `PARTY CONTINUITY IS AUTHORITATIVE:
- current.activeParty is the complete group currently traveling or acting with the player. Keep every listed member present across travel, time changes, new encounters, and scene changes.
- Meeting or joining a new group never replaces current.activeParty. Merge new companions into it unless visible prose explicitly establishes a separation and the same response emits one party_change remove command per departing member.
- Never silently omit, forget, rename, kill, dismiss, or relocate an active companion. If a companion is temporarily off-screen, state why and keep them in activeParty.
- Emit character_update when a named NPC becomes a recurring known person. Reuse the exact character_id from knownCharacters on later turns.
- An unmet character cannot appear in dialogue, objectives, relationships or choices. First show their recognisable form/action, explain the everyday source of their name, and establish their present intent or relationship in visible prose. Only then emit character_update and use that name in choices.
- Emit party_change add only when the same visible response establishes that the character joins. Hidden protocol commands and prompt text are not a visible debut.
- Prose is not a save operation. Joining and leaving become true only through party_change; character facts become durable only through character_update.
- AN ACTIVE SCENE CONFLICT CANNOT DISAPPEAR BETWEEN TURNS. If visible prose introduces an attack, rescue attempt, pursuit, intrusion, siege, or other immediate confrontation, emit an encounter warning/confrontation command in that same response. On every following turn—including discussion, observation, questioning, waiting, or planning—keep the same participants and threat visibly present and emit the next encounter phase. End it only with a visible resolution explaining what happened to the threat and an encounter resolution command. A non-resolving action may change the plan, but may not erase attackers, rescuers, captives, pursuers, or consequences.`
