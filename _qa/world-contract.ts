import { afterTheRedLight, afterTheRedLightEn } from '../src/story/cartridges/afterTheRedLight'
import { applyDomainResolution, resolveDomainAction } from '../src/story/engine/domainRules'
import { parseStoryProtocol } from '../src/story/engine/protocol'
import { createInitialSave } from '../src/story/engine/reducer'
import { prepareTurnCandidate } from '../src/story/engine/turnPipeline'
import type { StoryCartridge } from '../src/story/types'

function ok(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

function equal(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(`${message}: ${String(actual)} !== ${String(expected)}`)
}

function visibleCorpus(cartridge: StoryCartridge): string {
  return [
    ...cartridge.opening.blocks.map((block) => block.text),
    ...cartridge.opening.choices.map((choice) => choice.label),
    ...Object.values(cartridge.opening.deterministicTurns ?? {}).map((turn) => turn.content),
    ...cartridge.demoTurns.flatMap((turn) => [turn.content, turn.imagePrompt ?? '']),
    ...(cartridge.presetEventDirector?.events ?? []).flatMap((event) => [event.choiceLabel, event.text, event.objective, ...event.choices]),
  ].join('\n')
}

for (const cartridge of [afterTheRedLight, afterTheRedLightEn]) {
  const zh = cartridge.locale === 'zh'
  equal(cartridge.statDefinitions.length, 3, `${cartridge.locale}: exactly three stats`)
  ok(cartridge.statDefinitions.every((stat) => stat.description && stat.description.length >= 40), `${cartridge.locale}: every stat explains meaning and thresholds`)
  ok(cartridge.imageDirector?.perspective?.ordinary === 'balanced', `${cartridge.locale}: balanced ordinary perspective`)
  ok(cartridge.imageDirector?.perspective?.importantDialogue === 'first-person', `${cartridge.locale}: dialogue is first-person`)
  ok(cartridge.imageDirector?.perspective?.newLocation === 'observer', `${cartridge.locale}: locations establish in observer view`)
  ok(cartridge.imageDirector?.guaranteedTriggers.includes('character-expression'), `${cartridge.locale}: important dialogue image guaranteed`)

  const initial = createInitialSave(cartridge)
  equal(initial.characters.length, 1, `${cartridge.locale}: future adults stay hidden`)
  equal(initial.characters[0]?.id, 'mara', `${cartridge.locale}: Mara alone is known at opening`)
  ok(!cartridge.opening.choices.some((choice) => /Noa|Adrian|诺亚|阿德里安/.test(choice.label)), `${cartridge.locale}: opening choices do not name hidden characters`)
  ok(cartridge.characters.every((character) => /adult|成年|三十|thirt/i.test(`${character.role} ${character.detail}`)), `${cartridge.locale}: every recurring character is explicitly adult`)
  ok(!/未成年|minors?|sexual assault|性侵|nudit|裸露/i.test(visibleCorpus(cartridge)), `${cartridge.locale}: visible authored content stays inside the non-explicit adult boundary`)

  const deterministic = cartridge.opening.deterministicTurns ?? {}
  equal(Object.keys(deterministic).length, 3, `${cartridge.locale}: every opening choice is deterministic`)
  for (const choice of cartridge.opening.choices) {
    const turn = deterministic[choice.id]
    ok(turn, `${cartridge.locale}: missing deterministic turn for ${choice.id}`)
    const parsed = parseStoryProtocol(turn.content, cartridge.locale)
    const prepared = prepareTurnCandidate({ save: initial, parsed, cartridge, action: choice.label, imagePrompt: turn.imagePrompt, trustedAuthored: true })
    ok(prepared.violations.length === 0 || prepared.canCommitWithoutReplies, `${cartridge.locale}: opening ${choice.id} violates turn contract: ${prepared.violations.join(', ')}`)
    ok(parsed.commands.some((command) => command.type === 'choices'), `${cartridge.locale}: opening ${choice.id} leaves grounded choices`)
  }

  const matchAction = zh ? '点燃一根红色火柴照出被藏起的细节' : 'Light one red match to reveal the hidden detail'
  const matchSave = createInitialSave(cartridge)
  const matchResolution = resolveDomainAction(matchSave, cartridge, matchAction)
  ok(matchResolution?.status === 'accepted', `${cartridge.locale}: red match action resolves locally`)
  applyDomainResolution(matchSave, cartridge, matchResolution)
  equal(matchSave.inventory.find((item) => item.id === 'red-match')?.count, 2, `${cartridge.locale}: one match consumed once`)
  equal(matchSave.stats.composure, 64, `${cartridge.locale}: match composure cost`)
  equal(matchSave.stats.clues, 1, `${cartridge.locale}: match clue reward`)
  equal(matchSave.facts['red-matches-used'], 1, `${cartridge.locale}: match use persisted`)

  const boundaryAction = zh ? '停下，不要再靠近' : 'Stop, do not come closer'
  const boundarySave = createInitialSave(cartridge)
  const boundaryResolution = resolveDomainAction(boundarySave, cartridge, boundaryAction)
  ok(boundaryResolution?.status === 'accepted', `${cartridge.locale}: explicit boundary resolves locally`)
  applyDomainResolution(boundarySave, cartridge, boundaryResolution)
  equal(boundarySave.stats.desire, 12, `${cartridge.locale}: boundary lowers desire`)
  equal(boundarySave.stats.clues, 0, `${cartridge.locale}: boundary never removes clues`)

  const floorSave = createInitialSave(cartridge)
  floorSave.stats.composure = 0
  const blocked = resolveDomainAction(floorSave, cartridge, zh ? '继续调查镜子' : 'Continue investigating the mirror')
  ok(blocked?.status === 'rejected' && blocked.successChoices.length === 3, `${cartridge.locale}: composure floor exposes three executable recoveries`)
  for (const recovery of blocked.successChoices) ok(resolveDomainAction(floorSave, cartridge, recovery)?.status === 'accepted', `${cartridge.locale}: recovery is executable: ${recovery}`)

  const events = cartridge.presetEventDirector?.events ?? []
  equal(events.length, 8, `${cartridge.locale}: lightweight authored event pool`)
  equal(events.filter((event) => /FIRST-PERSON|first-person/i.test(event.imagePrompt)).length, 4, `${cartridge.locale}: authored events include four first-person frames`)
  equal(events.filter((event) => !/FIRST-PERSON|first-person/i.test(event.imagePrompt)).length, 4, `${cartridge.locale}: authored events include four observer frames`)
  ok(events.every((event) => event.choices.length >= 1 && event.choices.length <= 5), `${cartridge.locale}: authored events keep variable grounded choice counts`)

  const mapIds = new Set(cartridge.initialMap.map((node) => node.id))
  ok(!mapIds.has('room-nine'), `${cartridge.locale}: Room Nine is not preloaded before discovery`)
  for (const [threat, locations] of Object.entries(cartridge.dangerDirector?.threatLocations ?? {})) {
    ok(threat.length > 8 && locations.every((id) => mapIds.has(id)), `${cartridge.locale}: danger locations are valid for ${threat}`)
  }
}

console.log(JSON.stringify({
  ok: true,
  checks: [
    'adult-visible-cast',
    'non-explicit-authored-content',
    'hidden-character-debut',
    'three-deterministic-openings',
    'match-atomicity',
    'boundary-no-punishment',
    'floor-recovery',
    'balanced-authored-perspective',
    'danger-location-scope',
  ],
}))
