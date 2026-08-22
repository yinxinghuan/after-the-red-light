import { listCartridges } from '../src/story/cartridges/index'
import { parseStoryProtocol } from '../src/story/engine/protocol'
import { applyConsistencyRecovery, applyDisplayedRouteFallback, applyParsedScene, createChoiceRecordBlock, createInitialSave, repairLegacyConsistencyRecovery, restoreDeterministicRecoveryChoice } from '../src/story/engine/reducer'
import { canCommitDisplayedChoiceWithoutGeneratedReplies, canCommitGeneratedTurnWithoutReplies, canonicalizeTurnMetadata, inferActionDestination, validateTurnConsistency } from '../src/story/engine/turnConsistency'
import { decodeChoiceRecord } from '../src/story/engine/choiceInput'
import { resolveDeterministicChoiceTurn, resolveDeterministicOpeningTurn } from '../src/story/engine/authoredTurns'

function ok(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
function equal(actual: unknown, expected: unknown, message: string) { if (actual !== expected) throw new Error(`${message}: ${String(actual)} !== ${String(expected)}`) }

const cartridge = listCartridges('zh').find((candidate) => candidate.initialMap.length > 1) ?? listCartridges('zh')[0]
const initial = createInitialSave(cartridge)
const current = initial.location
const destination = initial.map.find((node) => !node.current)?.label ?? '新地点'

const bare = parseStoryProtocol(`你准备：
跟随向导开始巡逻
观察周围环境的异常动静
询问同伴如何制定应对计划`, 'zh')
equal((bare.commands.find((command) => command.type === 'choices') as { choices?: string[] } | undefined)?.choices?.length, 3, 'bare choices after a cue recover')
ok(bare.blocks.every((block) => !/你准备|跟随向导|观察周围/.test(block.text)), 'recovered choices do not remain in prose')

const missingScene = parseStoryProtocol(`[choices: "检查${current}"|"询问向导"|"等待片刻"]`, 'zh')
ok(validateTurnConsistency(initial, missingScene, cartridge).includes('turn.requires_one_scene_location'), 'scene location is mandatory')
const canonicalMissingScene = canonicalizeTurnMetadata(initial, missingScene, cartridge)
ok(!validateTurnConsistency(initial, canonicalMissingScene.parsed, cartridge).includes('turn.requires_one_scene_location'), 'known current location repairs missing scene metadata')

const missingImageLocation = parseStoryProtocol(`[scene_location: location="${current}"]
[choices: "检查${current}"|"询问向导"|"等待片刻"]`, 'zh')
ok(validateTurnConsistency(initial, missingImageLocation, cartridge, 'current scene image').includes('image.requires_one_image_location'), 'image location is mandatory with a prompt')
const discardedImage = canonicalizeTurnMetadata(initial, missingImageLocation, cartridge, 'current scene image')
equal(discardedImage.imagePrompt, undefined, 'unbound image is discarded without rejecting the story turn')
equal(discardedImage.discardedImage, true, 'discarded image is reported to the caller')

const objectiveMissing = parseStoryProtocol(`你现在的新任务是今晚巡逻。
[scene_location: location="${current}"]
[choices: "检查道路"|"询问向导"|"等待片刻"]`, 'zh')
ok(validateTurnConsistency(initial, objectiveMissing, cartridge).includes('turn.new_task_requires_objective_state'), 'new task requires objective state')
const repairedObjective = canonicalizeTurnMetadata(initial, objectiveMissing, cartridge)
ok(repairedObjective.parsed.commands.some((command) => command.type === 'state' && command.value.includes('新任务')), 'visible new task becomes authoritative objective metadata')
const newObjectiveChoice = canonicalizeTurnMetadata(initial, parseStoryProtocol(`你接受的新任务是守望月桥。
[scene_location: location="${current}"]
[state: value="守望月桥"]
[choices: "查看守望月桥"]`, 'zh'), cartridge)
const newObjectiveChoices = newObjectiveChoice.parsed.commands.find((command) => command.type === 'choices')
ok(newObjectiveChoices?.type === 'choices' && newObjectiveChoices.choices.length === 1, 'choices are grounded against the same turn candidate objective, not the previous save')

const ordinaryAction = canonicalizeTurnMetadata(initial, parseStoryProtocol(`你开始检查门锁。
[choices: "继续检查"|"询问守门人"|"先做标记"]`, 'zh'), cartridge)
equal(ordinaryAction.parsed.commands.some((command) => command.type === 'state'), false, 'ordinary player action never overwrites the long-term objective')

const valid = parseStoryProtocol(`你抵达${destination}，并接受了新的巡逻任务。
[map_update: new_location="${destination}" connected_to="${current}"]
[scene_location: location="${destination}"]
[state: value="完成今晚的巡逻任务"]
[choices: "检查${destination}的道路"|"询问向导"|"等待片刻"]
[image_location: location="${destination}"]`, 'zh')
equal(validateTurnConsistency(initial, valid, cartridge, 'night patrol at the destination').length, 0, 'aligned location, objective, choices, and image pass')

const staleChoice = parseStoryProtocol(`[map_update: new_location="${destination}" connected_to="${current}"]
[scene_location: location="${destination}"]
[choices: "检查${current}的新变化"|"询问向导"|"等待片刻"]`, 'zh')
ok(validateTurnConsistency(initial, staleChoice, cartridge).includes('choices.cannot_act_in_stale_location'), 'choice cannot silently act in the previous location')

const mixedChoices = parseStoryProtocol(`你抵达${destination}，向导指着道路和灯光等你决定。
[map_update: new_location="${destination}" connected_to="${current}"]
[scene_location: location="${destination}"]
[choices: "检查${current}的新变化"|"检查${destination}的道路"|"询问向导"|"留在原地等待"|"观察路边灯光"]`, 'zh')
const filteredMixed = canonicalizeTurnMetadata(initial, mixedChoices, cartridge)
const filteredMixedChoices = filteredMixed.parsed.commands.find((command) => command.type === 'choices')
ok(filteredMixedChoices?.type === 'choices', 'grounded choices survive individual filtering')
equal(filteredMixedChoices.choices.length, 3, 'stale and weakly grounded choices are removed while valid choices remain')
ok(!filteredMixedChoices.choices.some((choice) => choice.includes(current)), 'stale-location dead end never reaches the tray')
equal(validateTurnConsistency(initial, filteredMixed.parsed, cartridge).length, 0, 'remaining choices commit without a three-choice quota')

const hiddenNoun = canonicalizeTurnMetadata(initial, parseStoryProtocol(`码头有人邀请你帮忙搬箱子。
[scene_location: location="${current}"]
[choices: "接受帮忙整理温室和搬运材料"]`, 'zh'), cartridge)
const hiddenNounChoices = hiddenNoun.parsed.commands.find((command) => command.type === 'choices')
ok(hiddenNounChoices?.type === 'choices' && hiddenNounChoices.choices.length === 0, 'weak two-character overlap cannot expose a hidden greenhouse route')

const semanticQualifiers = canonicalizeTurnMetadata(initial, parseStoryProtocol(`广播确认末班列车取消，站务员正在月台解释后续通知。
[scene_location: location="${current}"]
[choices: "询问站务员关于末班列车取消的具体情况"|"留下等待进一步消息"|"前往从未出现的霜港寻找伊芙"]`, 'zh'), cartridge)
const semanticChoices = semanticQualifiers.parsed.commands.find((command) => command.type === 'choices')
ok(semanticChoices?.type === 'choices', 'semantic qualifier fixture keeps a choice command')
equal(semanticChoices.choices.length, 2, 'ordinary Chinese question modifiers do not erase grounded people and events')
ok(!semanticChoices.choices.some((choice) => choice.includes('霜港') || choice.includes('伊芙')), 'unknown named entities remain filtered')

const sublocation = canonicalizeTurnMetadata(initial, parseStoryProtocol(`你走进${current}工坊，仍在当前地图节点范围内。
[scene_location: location="${current}工坊"]
[choices: "留在${current}等待"]`, 'zh'), cartridge)
ok(sublocation.parsed.commands.some((command) => command.type === 'scene_location' && command.location === `${current}工坊`), 'a named sublocation remains exact while attached to its current authoritative map node')
ok(!validateTurnConsistency(initial, sublocation.parsed, cartridge).includes('turn.scene_location_must_match_state'), 'a current-node sublocation cannot create a false teleport recovery')
const exactSceneImage = canonicalizeTurnMetadata(initial, parseStoryProtocol(`你走进${current}工坊。
[scene_location: location="${current}工坊"]
[image_location: location="${current}"]
[choices: "留在${current}等待"]`, 'zh'), cartridge, 'workshop image')
ok(validateTurnConsistency(initial, exactSceneImage.parsed, cartridge, exactSceneImage.imagePrompt).includes('image.location_must_match_scene'), 'an image bound only to the parent map cannot stand in for the exact scene')

const visibleArrival = canonicalizeTurnMetadata(initial, parseStoryProtocol(`你到达${destination}，道路就在眼前。
[scene_location: location="${destination}"]
[choices: "检查${destination}的道路"]`, 'zh'), cartridge)
ok(visibleArrival.parsed.commands.some((command) => command.type === 'map_update' && command.location === destination), 'known visible arrival repairs an omitted map update')

const openingChoice = initial.choices[0]
const deterministicCartridge = {
  ...cartridge,
  opening: {
    ...cartridge.opening,
    deterministicTurns: {
      [openingChoice.id]: { match: [openingChoice.label], content: `你完成了${openingChoice.label}。` },
    },
  },
}
equal(resolveDeterministicOpeningTurn(initial, deterministicCartridge, openingChoice.label)?.content, `你完成了${openingChoice.label}。`, 'authored opening choice resolves locally')
equal(resolveDeterministicOpeningTurn({ ...initial, scene: 2 }, deterministicCartridge, openingChoice.label)?.content, `你完成了${openingChoice.label}。`, 'an opening choice remains deterministic after a free-input detour on the same map node')
equal(resolveDeterministicOpeningTurn(initial, deterministicCartridge, '用户自由输入'), undefined, 'free input remains model-driven')
ok(canCommitDisplayedChoiceWithoutGeneratedReplies(initial, cartridge, openingChoice.label, ['turn.requires_actionable_choices']), 'a displayed button may commit a valid consequence when only generated replies fail')
ok(canCommitDisplayedChoiceWithoutGeneratedReplies({ ...initial, choices: [], sessionEnded: true }, cartridge, cartridge.copy.continue, ['turn.requires_actionable_choices']), 'the visible continue control receives the same reply-only execution promise')
const continueBase = { ...initial, choices: [], sessionEnded: true }
const continueParsed = canonicalizeTurnMetadata(continueBase, parseStoryProtocol(`你继续留在${current}整理行李。
[scene_location: location="${current}"]
[choices: "寻找从未出现的森林王后"]`, 'zh'), cartridge).parsed
const continueViolations = validateTurnConsistency(continueBase, continueParsed, cartridge)
ok(canCommitDisplayedChoiceWithoutGeneratedReplies(continueBase, cartridge, cartridge.copy.continue, continueViolations), 'continue accepts the narrow reply-only failure after full validation')
const continued = applyParsedScene(continueBase, continueParsed, cartridge, cartridge.copy.continue)
ok(continued.choices.length >= 1 && !continued.blocks.some((block) => block.id.startsWith('consistency-recovery-')), 'continue commits its consequence and reducer-owned feasible choices without recovery')
ok(!canCommitDisplayedChoiceWithoutGeneratedReplies(initial, cartridge, '用户自由输入', ['turn.requires_actionable_choices']), 'free input does not inherit the displayed-button execution promise')
ok(canCommitGeneratedTurnWithoutReplies(['turn.requires_actionable_choices']), 'a valid generated consequence may commit when only suggested replies fail')
ok(!canCommitGeneratedTurnWithoutReplies(['payment.purchase_requires_player_authorization']), 'state and payment conflicts never use replyless commit')
ok(!canCommitDisplayedChoiceWithoutGeneratedReplies(initial, cartridge, openingChoice.label, ['turn.scene_location_must_match_state']), 'state conflicts never use the reply-only exception')

const contractedAction = '完成已经约定的搬运工作'
const contractedSave = {
  ...initial,
  choices: [{ id: 'contracted-action', label: contractedAction }],
  jobs: [{ id: 'qa-contract', label: '搬运工作', employer: '码头管理员', wage: 8, status: 'offered' as const, offeredAtScene: 0 }],
}
const contractedCartridge = {
  ...cartridge,
  deterministicChoiceTurns: [{
    action: contractedAction,
    when: { locations: [initial.location], jobs: [{ id: 'qa-contract', statuses: ['offered' as const, 'accepted' as const] }] },
    turn: { match: [], content: '你完成搬运，雇主按已经成立的合同当场结算。' },
  }],
}
equal(resolveDeterministicChoiceTurn(contractedSave, contractedCartridge, contractedAction)?.content, '你完成搬运，雇主按已经成立的合同当场结算。', 'visible contracted action resolves locally')
equal(resolveDeterministicChoiceTurn(contractedSave, contractedCartridge, `我想${contractedAction}`), undefined, 'similar free input remains model-driven')
equal(resolveDeterministicChoiceTurn({ ...contractedSave, jobs: [] }, contractedCartridge, contractedAction), undefined, 'missing contract blocks deterministic settlement')
const contractedRecovery = applyConsistencyRecovery(contractedSave, contractedCartridge, contractedAction)
const restoredContract = restoreDeterministicRecoveryChoice(contractedRecovery, contractedCartridge)
equal(restoredContract.choices[0]?.label, contractedAction, 'legacy recovery restores a now-authoritative valid action')
ok(Boolean(resolveDeterministicChoiceTurn(restoredContract, contractedCartridge, contractedAction)), 'restored contract executes locally')

const action = initial.choices[0].label
const recovery = applyConsistencyRecovery(initial, cartridge, action)
equal(recovery.scene, initial.scene + 1, 'consistency recovery records exactly one attempted turn')
equal(recovery.location, initial.location, 'recovery cannot teleport the player')
equal(recovery.objective, initial.objective, 'recovery cannot replace the objective with the attempted action')
equal(recovery.choices.length, 2, 'recovery exposes only grounded exits')
ok(!recovery.choices.some((choice) => choice.label === action), 'failed generated action is quarantined instead of re-offered')
ok(recovery.blocks.some((block) => block.id === `consistency-recovery-${recovery.scene}`), 'recovery visibly explains that no uncertain state was committed')
const recoveryRecord = recovery.blocks.find((block) => block.id === `choices-${recovery.scene}`)
equal(recoveryRecord?.kind, 'choices', 'recovery persists its visible choice record')
ok(!decodeChoiceRecord(recoveryRecord?.text ?? '').includes(action), 'saved recovery record excludes the failed action')
ok(!recovery.choices.some((choice) => /查看.+现在能做的事|放弃原计划|查明手中房卡/.test(choice.label)), 'quarantine never creates a synthetic menu or objective button')

const nested = applyConsistencyRecovery(recovery, cartridge, recovery.choices[0].label)
ok(!nested.choices.some((choice) => choice.label === action), 'nested recovery never re-offers the original failed generated action')
equal(new Set(nested.choices.map((choice) => choice.label)).size, 1, 'a second rejected recommendation is removed instead of reopening a recovery menu')

const sole = applyConsistencyRecovery({ ...initial, choices: [{ id: 'sole', label: action }] }, cartridge, action)
equal(sole.choices.length, 0, 'when no trustworthy sibling remains the tray stays empty and free input remains the escape')
equal(sole.facts.consistency_quarantined_action, action, 'empty-tray quarantine persists the failed recommendation for reload safety')

const oldScene = initial.scene + 1
const legacy = {
  ...initial,
  scene: oldScene,
  lastActionId: action,
  choices: [
    { id: `recovery-${oldScene}-0`, label: `查看${initial.location}现在能做的事` },
    { id: `recovery-${oldScene}-1`, label: '放弃原计划，改走别的路' },
  ],
  blocks: [
    ...initial.blocks,
    { id: `action-${oldScene}`, kind: 'event' as const, text: action },
    { id: `consistency-recovery-${oldScene}`, kind: 'narration' as const, text: `你重新确认了眼前的情况，没有把不确定的消息写进旅途记录。${initial.location}的一切仍在继续。` },
    createChoiceRecordBlock(oldScene, [
      { id: `recovery-${oldScene}-0`, label: `查看${initial.location}现在能做的事` },
      { id: `recovery-${oldScene}-1`, label: '放弃原计划，改走别的路' },
    ]),
  ],
}
const migrated = repairLegacyConsistencyRecovery(legacy, cartridge)
equal(migrated.objective, initial.objective, 'legacy migration preserves the authoritative objective')
ok(!migrated.choices.some((choice) => choice.label === action), 'legacy looping action is removed from the tray')
equal(migrated.choices.length, initial.choices.length - 1, 'legacy recovery restores only still-trustworthy sibling choices')
ok(!migrated.choices.some((choice) => /查看.+现在能做的事|放弃原计划/.test(choice.label)), 'legacy synthetic recovery menu is removed')
equal(repairLegacyConsistencyRecovery(migrated, cartridge), migrated, 'legacy migration is idempotent')

const routeCartridge = listCartridges('zh').find((candidate) => candidate.id === 'the-wild-road')
if (routeCartridge) {
const routeSave = createInitialSave(routeCartridge)
const semanticRouteAction = '循着鹿蹄印进入西面的树林'
const semanticDestination = inferActionDestination(routeSave, routeCartridge, semanticRouteAction)
equal(semanticDestination?.id, 'antler-wood', 'semantic route hints resolve a displayed action to one stable destination')
const semanticRouteDraft = canonicalizeTurnMetadata(routeSave, parseStoryProtocol(`你已经在西面树林里循着鹿蹄印前进，阔叶林的雾贴着地面。
[scene_location: location="旧十字路口"]
[choices: "观察鹿角林方向的新变化"]`, 'zh'), routeCartridge, undefined, semanticRouteAction)
ok(semanticRouteDraft.parsed.commands.some((command) => command.type === 'map_update' && command.location === semanticDestination?.label), 'semantic destination replaces stale source metadata')
equal(validateTurnConsistency(routeSave, semanticRouteDraft.parsed, routeCartridge, undefined, semanticRouteAction).length, 0, 'displayed route, prose and authoritative location commit together')
const explicitContradiction = canonicalizeTurnMetadata(routeSave, parseStoryProtocol(`你仍在旧十字路口，行动没有衔接。
[scene_location: location="旧十字路口"]
[choices: "查看旧十字路口现在能做的事"]`, 'zh'), routeCartridge, undefined, semanticRouteAction)
ok(validateTurnConsistency(routeSave, explicitContradiction.parsed, routeCartridge, undefined, semanticRouteAction).includes('turn.displayed_route_requires_destination'), 'explicitly remaining at the source cannot masquerade as a completed displayed route')
const routeFallback = applyDisplayedRouteFallback(routeSave, routeCartridge, semanticRouteAction, semanticDestination!)
equal(routeFallback.location, semanticDestination?.label, 'local fallback completes a twice-failed displayed route')
ok(routeFallback.choices.length >= 1, 'local route fallback remains playable at the destination')
const restoredSemanticRoute = restoreDeterministicRecoveryChoice(applyConsistencyRecovery(routeSave, routeCartridge, semanticRouteAction), routeCartridge)
equal(restoredSemanticRoute.choices[0]?.label, semanticRouteAction, 'upgraded saves restore a quarantined route proven by semantic destination hints')
}

console.log(JSON.stringify({ ok: true, checks: ['metadata-canonicalization', 'known-arrival-repair', 'image-discard', 'objective-grounding', 'stale-place-choice-rejected', 'strict-noun-grounding', 'individual-dead-choice-filter', 'variable-choice-support', 'failed-action-quarantine', 'local-recovery-exits', 'nested-recovery-unwind', 'legacy-loop-removal', 'deterministic-opening', 'deterministic-contracted-choice', 'recovery-contract-restoration', 'free-input-open'] }))
