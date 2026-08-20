import assert from 'node:assert/strict'
import { afterTheRedLight as cartridge } from '../src/story/cartridges/afterTheRedLight'
import { resolveDeterministicChoiceTurn, resolveDeterministicOpeningTurn } from '../src/story/engine/authoredTurns'
import { buildDangerDirective, createDangerFallbackScene, repairLegacyDangerLoopChoices } from '../src/story/engine/dangerDirector'
import { resolveDomainAction } from '../src/story/engine/domainRules'
import { parseStoryProtocol } from '../src/story/engine/protocol'
import { applyParsedScene, createChoiceRecordBlock, createInitialSave } from '../src/story/engine/reducer'

let save = createInitialSave(cartridge)
save.entered = true

function commitDeterministic(action: string): void {
  const turn = save.scene === 0
    ? resolveDeterministicOpeningTurn(save, cartridge, action)
    : resolveDeterministicChoiceTurn(save, cartridge, action)
  assert.ok(turn, `missing deterministic turn for ${action}`)
  save = applyParsedScene(
    save,
    parseStoryProtocol(turn.content, 'zh'),
    cartridge,
    action,
    turn.imagePrompt,
    turn.imageSubject,
    undefined,
    undefined,
    turn.imageCharacterId,
  )
}

commitDeterministic('请玛拉说明她为何立即否认九号房')
commitDeterministic('追问第二次邀请')
commitDeterministic('前往二层确认八号房门的位置')
assert.equal(save.danger.phase, 'warning', 'the authored red-lamp sequence establishes warning authority')

const matchAction = '点燃一根红色火柴照出被墙藏起的门'
const matchResolution = resolveDomainAction(save, cartridge, matchAction)
assert.equal(matchResolution?.status, 'accepted')
assert.equal(matchResolution?.dangerPolicy, 'advance')
const confrontation = buildDangerDirective(save, cartridge, matchAction)
assert.equal(confrontation?.phase, 'confrontation')
save = applyParsedScene(
  save,
  createDangerFallbackScene(save, cartridge, confrontation!),
  cartridge,
  matchAction,
  undefined,
  undefined,
  confrontation,
  matchResolution,
)
assert.equal(save.danger.phase, 'confrontation', 'a governed match response advances the active threat')
assert.equal(save.inventory.find((item) => item.id === 'red-match')?.count, 2, 'the match is consumed exactly once')
assert.ok(save.choices.every((choice) => choice.label.includes('身后的红灯')), 'every fallback choice names the active red-lamp threat')
assert.ok(!save.choices.some((choice) => choice.label === matchAction), 'the completed match action is not offered again')

const response = save.choices.find((choice) => choice.label.startsWith('立即应对'))?.label
assert.ok(response)
const resolution = buildDangerDirective(save, cartridge, response!)
assert.equal(resolution?.phase, 'resolution')
save = applyParsedScene(
  save,
  createDangerFallbackScene(save, cartridge, resolution!),
  cartridge,
  response!,
  undefined,
  undefined,
  resolution,
)
assert.equal(save.danger.phase, 'calm', 'the deterministic fallback closes the exact threat after one response')
assert.ok(save.choices.length >= 1, 'resolution leaves a playable investigation choice')
assert.ok(!save.blocks.some((block) => block.id.startsWith('consistency-recovery-')), 'the red-lamp route never enters generic consistency recovery')

const loopScene = save.scene + 1
const loopChoices = [
  { id: 'legacy-loop-0', label: '查看无名旅馆 · 二层走廊现在能做的事' },
  { id: 'legacy-loop-1', label: '放弃原计划，改走别的路' },
]
const legacy = {
  ...save,
  scene: loopScene,
  danger: { ...save.danger, phase: 'warning' as const, currentThreat: '身后的红灯一盏接一盏熄灭' },
  choices: loopChoices,
  blocks: [
    ...save.blocks,
    { id: `consistency-recovery-${loopScene}`, kind: 'narration' as const, text: '旧版恢复场景' },
    createChoiceRecordBlock(loopScene, loopChoices),
  ],
}
const migrated = repairLegacyDangerLoopChoices(legacy, cartridge)
assert.ok(migrated.choices.every((choice) => choice.label.includes('身后的红灯')), 'old recovery saves reopen on threat-bound actions')
assert.equal(migrated.facts['red-light-danger-loop-repaired-v1'], true)
assert.deepEqual(repairLegacyDangerLoopChoices(migrated, cartridge), migrated, 'danger-loop migration is idempotent')

console.log(JSON.stringify({
  ok: true,
  checks: [
    'match-domain-advances-warning',
    'match-consumed-once',
    'threat-bound-replies',
    'deterministic-resolution-fallback',
    'no-consistency-loop',
    'legacy-save-migration',
  ],
}))
