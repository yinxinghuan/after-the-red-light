import { parseStoryProtocol } from '../src/story/engine/protocol'
import { applyParsedScene, createInitialSave } from '../src/story/engine/reducer'
import { prepareTurnCandidate } from '../src/story/engine/turnPipeline'
import { listCartridges } from '../src/story/cartridges/index'
import type { StoryCartridge } from '../src/story/types'

function ok(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }

const source = listCartridges('zh')[0]
const cartridge = {
  ...source,
  statDefinitions: [
    { ...source.statDefinitions[0], id: 'coin', label: '钱币', min: 0, max: 999, initial: 6, display: 'number', maxDelta: 30 },
    source.statDefinitions[1], source.statDefinitions[2],
  ],
} as StoryCartridge
const save = createInitialSave(cartridge)
const safe = prepareTurnCandidate({
  save,
  parsed: parseStoryProtocol(`你只询问了价格，交易没有发生。
[scene_location: location="${save.location}"]`, 'zh'),
  cartridge,
  action: '询问价格',
})
ok(safe.canCommitWithoutReplies, 'reply-only failure is safe to commit')
ok(safe.violations.length === 1 && safe.violations[0] === 'turn.requires_actionable_choices', 'one pipeline reports the exact reply-only violation')
const committed = applyParsedScene(save, safe.parsed, cartridge, '询问价格')
ok(!committed.blocks.some((block) => block.id.startsWith('consistency-recovery-')), 'replyless commit does not create a synthetic recovery scene')

const singleChoiceSave = {
  ...save,
  scene: 4,
  sceneLocation: save.location,
  objective: '检查倒木背面的方向记号',
  choices: [{ id: '4-0', label: '和同伴一起收拾工具' }],
}
const singleChoiceReplyless = applyParsedScene(singleChoiceSave, parseStoryProtocol(`你们正准备收拾工具，林间又传来新的响动。
[scene_location: location="${save.location}"]`, 'zh'), cartridge, '和同伴一起收拾工具')
ok(singleChoiceReplyless.choices.length >= 1, 'a selected sole choice cannot leave an ongoing scene without quick replies')
ok(!singleChoiceReplyless.choices.some((choice) => choice.label === '和同伴一起收拾工具'), 'the completed sole choice is not re-offered')
ok(singleChoiceReplyless.choices.some((choice) => choice.label === '检查倒木背面的方向记号'), 'the unresolved objective remains available')
ok(singleChoiceReplyless.blocks.some((block) => block.id === `choices-${singleChoiceReplyless.scene}`), 'state-derived fallback replies are archived')

const destination = cartridge.initialMap.find((node) => node.label !== save.location)!
const transitionReplyless = applyParsedScene(save, parseStoryProtocol(`你离开原来的道路，抵达${destination.label}。
[map_update: location="${destination.label}"]
[scene_location: location="${destination.label}"]`, 'zh'), cartridge, save.choices[0].label)
ok(transitionReplyless.location === destination.label, 'replyless transition commits its authoritative destination')
ok(transitionReplyless.choices.length >= 1, 'replyless transition derives choices from the destination')
ok(transitionReplyless.choices.some((choice) => choice.label === save.objective.replace(/[。.!！?？；;]+$/u, '')), 'destination fallback keeps the unresolved objective instead of adding a generic location detour')

const unsafe = prepareTurnCandidate({
  save,
  parsed: parseStoryProtocol(`你把身上的六枚钱币全部花完了。
[widget: coin, remove: 6]
[scene_location: location="${save.location}"]`, 'zh'),
  cartridge,
  action: '把钱全部花完',
})
ok(!unsafe.canCommitWithoutReplies, 'underspecified spending cannot use replyless commit')
ok(unsafe.paymentViolations.includes('payment.purchase_requires_player_authorization'), 'pipeline preserves the payment authorization failure')

console.log(JSON.stringify({ ok: true, checks: ['single-turn-boundary', 'replyless-safe-commit', 'single-choice-replyless-fallback', 'transition-replyless-fallback', 'underspecified-spend-blocked'] }))
