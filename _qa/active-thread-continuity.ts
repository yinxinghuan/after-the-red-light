import assert from 'node:assert/strict'
import { listCartridges } from '../src/story/cartridges/index'
import { buildDangerDirective, contextualDangerChoiceLabels } from '../src/story/engine/dangerDirector'
import { parseStoryProtocol } from '../src/story/engine/protocol'
import { applyParsedScene, createInitialSave, createRecoveryChoices } from '../src/story/engine/reducer'
import { prepareTurnCandidate } from '../src/story/engine/turnPipeline'

for (const locale of ['zh', 'en'] as const) {
  const cartridge = listCartridges(locale)[0]
  if (!cartridge.dangerDirector) continue
  const initial = createInitialSave(cartridge)
  initial.objective = locale === 'zh' ? '审问刚抓到的俘虏' : 'Question the captured prisoner'
  const location = initial.location
  const threat = locale === 'zh' ? '俘虏的同伴赶来营救' : "the prisoner's companions arrive to rescue him"
  const prose = locale === 'zh'
    ? '你把刚抓到的俘虏带回来审问，入口边堆着几只货箱。突然，他的同伴从门外冲来，试图闯入并把俘虏救走；你可以用货箱顶住入口。'
    : 'You bring the captured prisoner back for questioning, with cargo stacked beside the entrance. Suddenly, his companions charge toward the door and try to break in to rescue him; you can brace the entrance with cargo.'
  const action = initial.objective
  const responseChoice = locale === 'zh' ? '用货箱顶住入口' : 'Brace the entrance with cargo'

  const missing = prepareTurnCandidate({ save: initial, cartridge, action, parsed: parseStoryProtocol(`${prose}\n[scene_location: location="${location}"]\n[choices: "${responseChoice}"]`, locale) })
  assert.equal(missing.violations.includes('turn.visible_immediate_threat_requires_encounter'), true, `${locale}: a visible rescue attack must establish encounter state`)

  const established = prepareTurnCandidate({
    save: initial, cartridge, action,
    parsed: parseStoryProtocol(`${prose}\n[scene_location: location="${location}"]\n[encounter: phase="confrontation" kind="${threat}" severity="3" outcome="active"]\n[choices: "${responseChoice}"]`, locale),
  })
  assert.deepEqual(established.violations, [], `${locale}: grounded confrontation commits`)
  let save = applyParsedScene(initial, established.parsed, cartridge, action)
  assert.equal(save.danger.currentThreat, threat)

  const discuss = locale === 'zh' ? '和同行者商量下一步' : 'Discuss the next step with the group'
  const unrelated = locale === 'zh' ? '你们商量后决定明早去远处调查另一件事。' : 'After talking, you decide to investigate something else tomorrow.'
  const dropped = prepareTurnCandidate({ save, cartridge, action: discuss, parsed: parseStoryProtocol(`${unrelated}\n[scene_location: location="${location}"]\n[choices: "${responseChoice}"]`, locale) })
  assert.equal(dropped.violations.includes('turn.active_threat_requires_continuation'), true, `${locale}: discussion cannot erase the active attackers`)

  const directive = buildDangerDirective(save, cartridge, discuss)
  assert.equal(directive?.phase, 'resolution', `${locale}: active danger bypasses opening grace and reaches local resolution`)
  const resolvedProse = locale === 'zh'
    ? '你们当场商量后堵住入口。俘虏的同伴无法突破，只得撤退；营救行动已经被阻止。'
    : "You confer on the spot and block the entrance. The prisoner's companions cannot break through and withdraw; the rescue attempt has been stopped."
  const postResolutionChoice = locale === 'zh'
    ? '检查堵住入口的货箱是否稳固'
    : 'Check whether the cargo bracing the entrance is secure'
  const outcome = directive?.check?.outcome ?? 'success'
  const resolved = prepareTurnCandidate({
    save, cartridge, action: discuss,
    parsed: parseStoryProtocol(`${resolvedProse}\n[scene_location: location="${location}"]\n[encounter: phase="resolution" kind="${threat}" severity="3" outcome="${outcome}"]\n[choices: "${postResolutionChoice}"]`, locale),
  })
  assert.deepEqual(resolved.violations, [], `${locale}: only visible same-thread resolution can close the conflict`)
  save = applyParsedScene(save, resolved.parsed, cartridge, discuss, undefined, undefined, directive)
  assert.equal(save.danger.phase, 'calm', `${locale}: explicit resolution closes danger`)

  const dangerSave = { ...save, danger: { ...save.danger, phase: 'confrontation' as const, currentThreat: threat } }
  assert.deepEqual(
    createRecoveryChoices(dangerSave, cartridge).map((entry) => entry.label),
    contextualDangerChoiceLabels(threat, cartridge.dangerDirector.methods, locale),
    `${locale}: emergency recovery buttons name the exact active threat`,
  )
}

console.log(JSON.stringify({ ok: true, checks: ['threat-establishment', 'nonresolving-action-preserves-thread', 'visible-resolution', 'danger-grace-bypass', 'zh-en'] }))
