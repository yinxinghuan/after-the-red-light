import assert from 'node:assert/strict'
import { listCartridges } from '../src/story/cartridges/index'
import { repairEndedSessionChoices, repairLegacyDomainChoiceReset, resolveDomainAction } from '../src/story/engine/domainRules'
import { encodeChoiceRecord } from '../src/story/engine/choiceInput'
import { applyParsedScene, createChoiceRecordBlock, createInitialSave } from '../src/story/engine/reducer'
import { parseStoryProtocol } from '../src/story/engine/protocol'
import type { StoryCartridge } from '../src/story/types'

const source = listCartridges('zh')[0]
const governedStat = source.statDefinitions[0].id
const cartridge: StoryCartridge = {
  ...source,
  initialMap: source.initialMap.map((node, index) => ({ ...node, capabilities: index === 0 ? ['rest'] : [] })),
  domainRules: { rules: [
    {
      id: 'brief-rest', intent: 'brief-rest', match: ['短暂休息'],
      requirements: [{ type: 'capability', id: 'rest', reason: '这里没有安全的休息条件' }],
      effects: [{ type: 'stat', id: governedStat, delta: 1 }], successText: '你短暂休息后重新集中精神。',
      successChoices: [], rejectionChoices: [],
      successContinuation: 'resume', rejectionContinuation: 'resume',
    },
    {
      id: 'end-day', intent: 'end-day', match: ['结束今天'], requirements: [], effects: [{ type: 'session', ended: true }],
      successText: '你结束今天的行动。', successChoices: [], rejectionChoices: [], successContinuation: 'checkpoint',
    },
  ] },
}

const initial = createInitialSave(cartridge)
initial.scene = 4
initial.objective = '继续核对失踪船只的登记簿'
initial.decisionContext = '登记簿还摊在桌上，证人的陈述尚未核对。'
initial.choices = [
  { id: 'verify', label: '继续核对失踪船只的登记簿' },
  { id: 'ask', label: '请证人补充最后一次见面的时间' },
  { id: 'rest', label: '短暂休息' },
]
initial.blocks.push(createChoiceRecordBlock(4, initial.choices))

const rest = resolveDomainAction(initial, cartridge, '短暂休息')
assert.equal(rest?.status, 'accepted')
const rested = applyParsedScene(initial, parseStoryProtocol(rest!.successText, 'zh'), cartridge, '短暂休息', undefined, undefined, undefined, rest)
assert.equal(rested.objective, initial.objective, 'resume preserves the unresolved objective')
assert.equal(rested.decisionContext, initial.decisionContext, 'resume preserves the scene premise')
assert.deepEqual(rested.choices.map((choice) => choice.label), initial.choices.slice(0, 2).map((choice) => choice.label), 'resume restores grounded siblings and removes the performed action')

const unavailable = { ...initial, map: initial.map.map((node, index) => ({ ...node, current: index === 1 })) }
const rejected = resolveDomainAction(unavailable, cartridge, '短暂休息')
assert.equal(rejected?.status, 'rejected')
assert.equal(rejected?.effects.length, 0, 'capability rejection is atomic')
const rejectedSave = applyParsedScene(unavailable, parseStoryProtocol(rejected!.successText, 'zh'), cartridge, '短暂休息', undefined, undefined, undefined, rejected)
assert.equal(rejectedSave.objective, unavailable.objective, 'rejection does not replace the active thread')

const legacyLabels = ['找一份短工', '吃一顿热饭', '原地休息', '去公共休息处', '结束今天']
const legacy = {
  ...rested,
  choices: legacyLabels.map((label, index) => ({ id: `legacy-${index}`, label })),
  blocks: [...rested.blocks, { id: `choices-${rested.scene}`, kind: 'choices' as const, text: encodeChoiceRecord(legacyLabels.map((label, index) => ({ id: `legacy-${index}`, label }))), data: { scene: rested.scene } }],
}
const migrated = repairLegacyDomainChoiceReset(legacy, cartridge)
assert.deepEqual(repairLegacyDomainChoiceReset(migrated, cartridge), migrated, 'legacy domain-choice migration is idempotent')

const ended = { ...initial, sessionEnded: true, choices: initial.choices }
assert.deepEqual(repairEndedSessionChoices(ended, cartridge).choices, [], 'checkpoint saves cannot retain stale ordinary choices')

console.log(JSON.stringify({ ok: true, checks: ['resume-thread', 'capability-preflight', 'rejection-atomicity', 'legacy-migration', 'checkpoint-clears-choices'] }))
