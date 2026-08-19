import assert from 'node:assert/strict'
import { listCartridges } from '../src/story/cartridges'
import { applyParsedScene, createInitialSave, createRecoveryChoices } from '../src/story/engine/reducer'
import { parseStoryProtocol } from '../src/story/engine/protocol'
import { presetEventRecoveryChoice, resolvePresetEventTurn, selectPresetEvent } from '../src/story/engine/presetEventDirector'

const sourceCartridge = listCartridges('zh').find((candidate) => candidate.initialMap.some((node) => node.id === 'crossroads'))
  ?? listCartridges('zh')[0]
const sourceLocationId = sourceCartridge.initialMap.find((node) => node.current)?.id ?? sourceCartridge.initialMap[0]?.id
assert.ok(sourceLocationId, 'fixture cartridge needs a current map node')

const cartridge = {
  ...sourceCartridge,
  presetEventDirector: {
    events: [{
      id: 'crossroads-cart', locationId: sourceLocationId!, category: 'visitor' as const,
      choiceLabel: '帮路过的车夫扶正歪斜的货箱',
      text: '一辆轻便马车在石标旁停下，最后一只货箱正从绳扣里滑出来。车夫请你扶住箱角，好让他重新收紧绳结。',
      objective: '决定是否帮助车夫固定货箱，或先问清前方路况',
      choices: ['扶住货箱让车夫重新系绳', '先问车夫三条路的近况', '退到石标旁继续观察'] as [string, ...string[]],
      imagePrompt: 'FIRST-PERSON PLAYER-EYE VIEW, a driver reaching toward one slipping cargo box beside an old crossroads, no protagonist body, no text',
      imageSubject: 'environment' as const,
    }],
  },
}

const idle = { ...createInitialSave(cartridge), objective: '', decisionContext: '', jobs: [] }
const selected = selectPresetEvent(idle, cartridge)
assert.equal(selected?.id, 'crossroads-cart', 'idle location resolves its authored event')
assert.equal(presetEventRecoveryChoice(idle, cartridge)?.label, selected?.choiceLabel, 'idle fallback exposes the exact executable event action')
assert.equal(createRecoveryChoices(idle, cartridge)[0]?.label, selected?.choiceLabel, 'generic observation is replaced only when an authored event exists')

const activeObjective = { ...idle, objective: '确认林中猎人记号的来源' }
assert.equal(presetEventRecoveryChoice(activeObjective, cartridge), undefined, 'an unresolved objective cannot be interrupted by a preset event')
const pendingReply = { ...idle, decisionContext: '车夫仍在等你回答是否帮忙。' }
assert.equal(presetEventRecoveryChoice(pendingReply, cartridge), undefined, 'a live reply context cannot be interrupted')
const activeJob = { ...idle, jobs: [{ id: 'work', label: '帮忙卸货', wage: 2, status: 'accepted' as const, offeredAtScene: 0 }] }
assert.equal(presetEventRecoveryChoice(activeJob, cartridge), undefined, 'an open job contract cannot be interrupted')

const turn = resolvePresetEventTurn({ ...idle, choices: [presetEventRecoveryChoice(idle, cartridge)!] }, cartridge, selected!.choiceLabel)
assert.ok(turn, 'the displayed event action resolves without a model call')
const committed = applyParsedScene({ ...idle, choices: [presetEventRecoveryChoice(idle, cartridge)!] }, parseStoryProtocol(turn!.turn.content, 'zh'), cartridge, selected!.choiceLabel, turn!.turn.imagePrompt, turn!.turn.imageSubject, undefined, undefined, undefined, turn)
assert.equal(committed.facts['preset_event:count:crossroads-cart'], 1, 'event use is persisted')
assert.equal(committed.objective, selected?.objective, 'event establishes its concrete next thread')
assert.deepEqual(committed.choices.map((choice) => choice.label), selected?.choices, 'authored follow-up actions survive grounding filters')
assert.equal(resolvePresetEventTurn(committed, cartridge, selected!.choiceLabel), undefined, 'the already-completed button does not silently repeat from a different tray')

console.log(JSON.stringify({ ok: true, checks: ['location-event', 'no-thread-interruption', 'deterministic-resolution', 'fact-record', 'trusted-followups'] }))
