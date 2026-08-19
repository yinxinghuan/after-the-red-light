import assert from 'node:assert/strict'
import { afterTheRedLight as cartridge } from '../src/story/cartridges/afterTheRedLight'
import { resolveDeterministicOpeningTurn } from '../src/story/engine/authoredTurns'
import { resolveDomainAction } from '../src/story/engine/domainRules'
import { parseStoryProtocol } from '../src/story/engine/protocol'
import { applyParsedScene, createInitialSave } from '../src/story/engine/reducer'
import { canonicalizeTurnMetadata } from '../src/story/engine/turnConsistency'

function opening(action: string) {
  let save = createInitialSave(cartridge)
  save.entered = true
  const turn = resolveDeterministicOpeningTurn(save, cartridge, action)
  assert.ok(turn, `missing deterministic opening for ${action}`)
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
  return save
}

function choices(content: string, save: ReturnType<typeof opening>, action: string) {
  const parsed = parseStoryProtocol(content, 'zh')
  const canonical = canonicalizeTurnMetadata(save, parsed, cartridge, undefined, action).parsed
  const command = [...canonical.commands].reverse().find((entry) => entry.type === 'choices')
  assert.equal(command?.type, 'choices')
  return { parsed: canonical, labels: command?.type === 'choices' ? command.choices : [] }
}

const maraOpening = '请玛拉说明她为何立即否认九号房'
let mara = opening(maraOpening)
const maraAction = '先请玛拉指出她亲眼见过的九号房异常，再决定是否上楼'
const maraDraft = `玛拉走到黄铜目录前，手指停在七号和八号之间的空白处。她说自己亲眼见过电梯打开后只有一堵墙，也听见过锁门后的声音。
[choices: "相信玛拉，先上楼二层走廊实地查看"|"质疑玛拉，要求她带你去看她提到的异常"|"暂时留在大厅，使用一根红色火柴照亮楼层目录和周围环境"]
[scene_location: location="无名旅馆 · 大厅"]`
const maraPrepared = choices(maraDraft, mara, maraAction)
assert.deepEqual(maraPrepared.labels, [
  '相信玛拉，先上楼二层走廊实地查看',
  '质疑玛拉，要求她带你去看她提到的异常',
  '暂时留在大厅，使用一根红色火柴照亮楼层目录和周围环境',
], 'valid paraphrased future actions must not collapse to a single mechanics option')
mara = applyParsedScene(mara, maraPrepared.parsed, cartridge, maraAction)
const matchAction = '暂时留在大厅，使用一根红色火柴照亮楼层目录和周围环境'
const matchResolution = resolveDomainAction(mara, cartridge, matchAction)
assert.equal(matchResolution?.status, 'accepted')
mara = applyParsedScene(mara, parseStoryProtocol(matchResolution!.successText, 'zh'), cartridge, matchAction, undefined, undefined, undefined, matchResolution)
assert.deepEqual(mara.choices.map((choice) => choice.label), [
  '相信玛拉，先上楼二层走廊实地查看',
  '质疑玛拉，要求她带你去看她提到的异常',
], 'a governed side action must resume the still-valid story choices instead of converting the objective into a button')
assert.ok(!mara.choices.some((choice) => choice.label === mara.objective))

let key = opening('在前台灯下检查房卡背面的数字压痕')
const inspectAction = '把暗红纤维放在火柴册旁比较，但先不要点燃火柴'
const inspectDraft = `你把暗红纤维放在火柴册旁比较，没有点燃火柴。玛拉在前台看着你。
[choices: "询问玛拉关于暗红纤维的来历"|"仔细检查火柴册和房卡套的细节"|"前往二层走廊查看熄灭的红灯"]
[scene_location: location="无名旅馆 · 大厅"]`
const inspectPrepared = choices(inspectDraft, key, inspectAction)
assert.equal(inspectPrepared.labels.length, 3)
key = applyParsedScene(key, inspectPrepared.parsed, cartridge, inspectAction)

const corridorAction = '前往二层走廊查看熄灭的红灯'
const corridorDraft = `你上楼抵达无名旅馆 · 二层走廊。走廊尽头的红灯已经熄灭，黄铜目录依旧没有九号房。
[choices: "仔细检查熄灭的红灯和周边环境"|"试着用红色火柴点燃，照亮红灯附近的细节"|"返回大厅向玛拉询问更多关于二层走廊的信息"]
[scene_location: location="无名旅馆 · 二层走廊"]`
const corridorPrepared = choices(corridorDraft, key, corridorAction)
assert.deepEqual(corridorPrepared.labels, [
  '仔细检查熄灭的红灯和周边环境',
  '试着用红色火柴点燃，照亮红灯附近的细节',
], 'after a real arrival, local actions should outrank an immediate return to the place just left')
assert.equal(
  resolveDomainAction(key, cartridge, '尝试用红色火柴照亮走廊暗处')?.ruleId,
  'light-red-match',
  'natural generated wording for a costly resource action must enter the local authority rule',
)
assert.equal(
  resolveDomainAction(key, cartridge, '比较火柴册，但先不要点燃火柴'),
  undefined,
  'mentioning or declining a resource action must not spend it',
)

console.log(JSON.stringify({
  ok: true,
  checks: [
    'paraphrased-future-actions-preserved',
    'governed-side-action-resumes-story-siblings',
    'objective-not-rendered-as-action',
    'immediate-location-backtrack-suppressed-when-local-actions-exist',
    'resource-action-paraphrase-is-governed',
    'resource-mention-does-not-spend',
  ],
}, null, 2))
