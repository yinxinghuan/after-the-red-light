import assert from 'node:assert/strict'
import { resolveCartridge } from '../src/story/cartridges/index'
import { buildDangerDirective } from '../src/story/engine/dangerDirector'
import { parseStoryProtocol } from '../src/story/engine/protocol'
import { applyParsedScene, createInitialSave } from '../src/story/engine/reducer'
import { prepareTurnCandidate } from '../src/story/engine/turnPipeline'
import type { DangerDirective, StoryCartridge } from '../src/story/types'

for (const locale of ['zh', 'en'] as const) {
  const source = resolveCartridge(undefined, locale)
  const nodes = source.initialMap.slice(0, 2)
  assert.equal(nodes.length, 2, `${locale}: fixture needs two map nodes`)
  const threats = locale === 'zh' ? ['码头起重机钢索断裂', '山路落石封住去路'] : ['a dock crane cable snaps', 'a rockfall blocks the hill road']
  const cartridge: StoryCartridge = {
    ...source,
    dangerDirector: {
      ...source.dangerDirector!,
      graceScenes: 0,
      minSafeTurns: 0,
      maxSafeTurns: 0,
      threatPalette: threats,
      threatLocations: { [threats[0]]: [nodes[0].id], [threats[1]]: [nodes[1].id] },
    },
  }

  for (const [index, node] of nodes.entries()) {
    for (let cycle = 0; cycle < 24; cycle += 1) {
      const save = createInitialSave(cartridge)
      save.scene = 20
      save.location = node.label
      save.map = save.map.map((entry) => ({ ...entry, current: entry.id === node.id }))
      save.danger = { ...save.danger, safeTurns: 10, cycle }
      assert.equal(buildDangerDirective(save, cartridge, `cycle-${cycle}`)?.threat, threats[index], `${locale}: threat must match current map node`)
    }
  }

  const save = createInitialSave(cartridge)
  const threat = threats[0]
  const directive: DangerDirective = {
    phase: 'warning', threat, severity: 2,
    methods: cartridge.dangerDirector!.methods,
    physicalCombat: cartridge.dangerDirector!.physicalCombat,
  }
  const hidden = parseStoryProtocol(`${locale === 'zh' ? '你检查了桌上的旧设备，皮带张力和漏水点都还没有确认。' : 'You inspect the old equipment; its belt tension and leak still need checking.'}
[scene_location: location="${save.location}"]
[choices: "${locale === 'zh' ? '检查皮带张力' : 'Check belt tension'}"|"${locale === 'zh' ? '寻找漏水点' : 'Find the leak'}"]`, locale)
  const rejected = prepareTurnCandidate({ save, parsed: hidden, cartridge, action: 'inspect', dangerDirective: directive, skipTurnValidation: true })
  assert(rejected.violations.includes('turn.scheduled_threat_requires_visible_establishment'), `${locale}: hidden directive must fail even in demo mode`)
  assert(rejected.violations.includes('turn.scheduled_threat_choices_must_address_threat'), `${locale}: unrelated choices must fail`)
  const ignored = applyParsedScene(save, hidden, cartridge, 'inspect', undefined, undefined, directive)
  assert.equal(ignored.danger.phase, 'calm', `${locale}: reducer must reject hidden danger authority`)
  assert.notEqual(ignored.danger.currentThreat, threat, `${locale}: hidden threat must not persist`)

  const labels = locale === 'zh'
    ? [`确认“${threat}”的具体位置`, `警告众人避开“${threat}”`]
    : [`Confirm where ${threat}`, `Warn everyone about ${threat}`]
  const visible = parseStoryProtocol(`${locale === 'zh' ? `远处传来巨响：${threat}，周围的人立刻停下脚步。` : `A crash rings out: ${threat}, and everyone nearby stops.`}
[encounter: phase="warning" kind="${threat}" severity="2" outcome="active"]
[scene_location: location="${save.location}"]
[choices: "${labels[0]}"|"${labels[1]}"]`, locale)
  const accepted = prepareTurnCandidate({ save, parsed: visible, cartridge, action: 'inspect', dangerDirective: directive, skipTurnValidation: true })
  assert(!accepted.violations.includes('turn.scheduled_threat_requires_visible_establishment'), `${locale}: exact visible directive should pass`)
  assert(!accepted.violations.includes('turn.scheduled_threat_choices_must_address_threat'), `${locale}: grounded choices should pass`)
  const committed = applyParsedScene(save, accepted.parsed, cartridge, 'inspect', undefined, undefined, directive)
  assert.equal(committed.danger.phase, 'warning', `${locale}: established threat becomes authoritative`)
  assert.equal(committed.danger.currentThreat, threat, `${locale}: exact threat persists`)
}

console.log(JSON.stringify({ ok: true, checks: ['location-scope-96', 'hidden-directive-rejected', 'unrelated-choices-rejected', 'positive-control'] }))
