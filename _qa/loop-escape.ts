import assert from 'node:assert/strict'
import { afterTheRedLight as cartridge, afterTheRedLightEn as cartridgeEn } from '../src/story/cartridges/afterTheRedLight'
import { resolveDeterministicChoiceTurn, resolveDeterministicOpeningTurn } from '../src/story/engine/authoredTurns'
import { parseStoryProtocol } from '../src/story/engine/protocol'
import { applyConsistencyRecovery, applyParsedScene, createInitialSave } from '../src/story/engine/reducer'
import { canonicalizeTurnMetadata, semanticallyRepeatsCurrentAction } from '../src/story/engine/turnConsistency'
import { normalizeSave } from '../src/story/useStoryEngine'

function opening(action: string) {
  let save = createInitialSave(cartridge)
  save.entered = true
  const turn = resolveDeterministicOpeningTurn(save, cartridge, action)
  assert.ok(turn)
  return applyParsedScene(save, parseStoryProtocol(turn.content, 'zh'), cartridge, action, turn.imagePrompt, turn.imageSubject)
}

const mara = opening('请玛拉说明她为何立即否认九号房')
const failed = '查看黄铜目录'
const quarantined = applyConsistencyRecovery(mara, cartridge, failed)
assert.ok(!quarantined.choices.some((choice) => choice.label === failed))
assert.ok(!quarantined.choices.some((choice) => choice.label === mara.objective))
assert.ok(!quarantined.choices.some((choice) => /查看.+现在能做的事|放弃原计划/.test(choice.label)))
assert.deepEqual(
  quarantined.choices.map((choice) => choice.label),
  mara.choices.filter((choice) => choice.label !== failed).map((choice) => choice.label),
  'a rejected recommendation keeps only trustworthy siblings',
)

const secondFailed = quarantined.choices[0].label
const quarantinedTwice = applyConsistencyRecovery(quarantined, cartridge, secondFailed)
assert.equal(quarantinedTwice.choices.length, quarantined.choices.length - 1)
assert.ok(!quarantinedTwice.choices.some((choice) => choice.label === secondFailed))
assert.notDeepEqual(
  quarantinedTwice.choices.map((choice) => choice.label),
  quarantined.choices.map((choice) => choice.label),
  'consecutive failures cannot recreate the same choice-state fixed point',
)

const soleAction = '询问玛拉是否听见楼上脚步'
const sole = applyConsistencyRecovery({ ...mara, choices: [{ id: 'sole', label: soleAction }] }, cartridge, soleAction)
assert.equal(sole.choices.length, 0, 'free input is the escape when no recommended sibling remains')
assert.equal(normalizeSave(sole, cartridge).choices.length, 0, 'reload does not recreate an abstract objective button')

const legacyWithoutFacts = {
  ...sole,
  blocks: sole.blocks.filter((block) => block.kind !== 'choices' || block.id === `choices-${sole.scene}`),
} as typeof sole & { facts?: typeof sole.facts }
delete legacyWithoutFacts.facts
const normalizedLegacyWithoutFacts = normalizeSave(legacyWithoutFacts, cartridge)
assert.equal(normalizedLegacyWithoutFacts.choices.length, 0, 'very old saves without a facts field cannot recreate a recovery button')
assert.equal(normalizedLegacyWithoutFacts.facts.consistency_quarantined_action, soleAction)

assert.equal(semanticallyRepeatsCurrentAction('触摸黄铜目录左下角的缺口', '查看黄铜目录', 'zh'), true)
const semanticDraft = canonicalizeTurnMetadata(mara, parseStoryProtocol(`你继续检查黄铜目录。左下角的缺口、黄铜边框和二层标记仍在原处，没有出现新的证据。
[scene_location: location="无名旅馆 · 大厅"]
[choices: "触摸黄铜目录左下角的缺口"|"沿黄铜边框检查二层标记"]`, 'zh'), cartridge, undefined, '查看黄铜目录')
const semanticChoices = semanticDraft.parsed.commands.find((command) => command.type === 'choices')
assert.equal(semanticChoices?.type, 'choices')
assert.deepEqual(semanticChoices.choices, ['沿黄铜边框检查二层标记'], 'same-object semantic retry is removed while a distinct concrete action survives')

const lounge = opening('循着酒廊传来的低声哼唱离开前台')
assert.equal(resolveDeterministicChoiceTurn({ ...lounge, choices: [{ id: 'stale', label: '查看黄铜目录' }] }, cartridge, '查看黄铜目录'), undefined)
const misplacedDraft = canonicalizeTurnMetadata(lounge, parseStoryProtocol(`诺亚推来的空杯仍在吧台边，黄铜目录则留在大厅前台。
[scene_location: location="无名旅馆 · 丝绒酒廊 · 吧台"]
[choices: "查看黄铜目录"|"检查诺亚推来的空杯"]`, 'zh'), cartridge)
const misplacedChoices = misplacedDraft.parsed.commands.find((command) => command.type === 'choices')
assert.equal(misplacedChoices?.type, 'choices')
assert.deepEqual(misplacedChoices.choices, ['检查诺亚推来的空杯'], 'an old authored label cannot re-enter from the wrong location')

let english = createInitialSave(cartridgeEn)
english.entered = true
const englishOpeningAction = 'Leave the desk and follow the low humming into the lounge'
const englishTurn = resolveDeterministicOpeningTurn(english, cartridgeEn, englishOpeningAction)
assert.ok(englishTurn)
english = applyParsedScene(english, parseStoryProtocol(englishTurn.content, 'en'), cartridgeEn, englishOpeningAction, englishTurn.imagePrompt, englishTurn.imageSubject)
assert.equal(resolveDeterministicChoiceTurn({ ...english, choices: [{ id: 'stale', label: 'Inspect the brass directory' }] }, cartridgeEn, 'Inspect the brass directory'), undefined)

console.log(JSON.stringify({
  ok: true,
  checks: [
    'failed-recommendation-retired',
    'siblings-preserved',
    'consecutive-failure-no-fixed-point',
    'free-input-only-reload-safe',
    'factless-legacy-reload-safe',
    'semantic-retry-filter',
    'authored-action-location-scope',
    'zh-en',
  ],
}))
