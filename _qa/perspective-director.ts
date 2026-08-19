import assert from 'node:assert/strict'
import { listCartridges } from '../src/story/cartridges'
import { createInitialSave, applyParsedScene } from '../src/story/engine/reducer'
import { parseStoryProtocol } from '../src/story/engine/protocol'
import { chooseSceneImage, shouldUsePlayerImageReference } from '../src/story/engine/imageDirector'

function latestImage(save: ReturnType<typeof createInitialSave>) {
  return [...save.blocks].reverse().find((block) => block.kind === 'image')
}

const baseCartridge = listCartridges('zh')[0]
const speaker = { id: 'qa-speaker', name: '守门人', role: '潮门值守', vitality: 80, stress: 12, skills: [] }
const dialogue = `[${speaker.name}] [main] [克制]: "潮门连续关闭不是例行调度。你留在我能看见的地方。"\n[dialogue_focus: speaker="${speaker.name}" expression="压低声音，目光越过你的肩头检查潮门"]\n[choices: "答应留下"|"询问潮门"|"查看路线"]`
const { perspective: _configuredPerspective, ...observerDirector } = baseCartridge.imageDirector!

const legacyDefault = {
  ...baseCartridge,
  characters: [speaker, ...baseCartridge.characters],
  imageDirector: { ...observerDirector, guaranteedTriggers: [...observerDirector.guaranteedTriggers, 'character-expression' as const] },
}
const legacyImage = latestImage(applyParsedScene(createInitialSave(legacyDefault), parseStoryProtocol(dialogue, 'zh'), legacyDefault, '听她说明'))
assert.equal(legacyImage?.data?.perspective, 'observer', 'missing policy must preserve the historical observer default')
assert.doesNotMatch(String(legacyImage?.data?.prompt), /FIRST-PERSON PLAYER-EYE VIEW/, 'observer default must not silently become POV')

const firstPersonDialogue = {
  ...legacyDefault,
  imageDirector: {
    ...legacyDefault.imageDirector!,
    perspective: { ordinary: 'balanced' as const, importantDialogue: 'first-person' as const, newLocation: 'observer' as const },
  },
}
const povImage = latestImage(applyParsedScene(createInitialSave(firstPersonDialogue), parseStoryProtocol(dialogue, 'zh'), firstPersonDialogue, '听她说明'))
assert.equal(povImage?.data?.perspective, 'first-person', 'important dialogue may opt into first person')
assert.match(String(povImage?.data?.prompt), /FIRST-PERSON PLAYER-EYE VIEW/, 'first-person contract reaches the media prompt')
assert.equal(povImage?.data?.playerVisible, 'false', 'first-person camera keeps the protagonist out of frame')
assert.equal(shouldUsePlayerImageReference(String(povImage?.data?.prompt)), false, 'first-person prompt never receives the player avatar reference')

const forcedObserver = latestImage(applyParsedScene(
  createInitialSave(firstPersonDialogue),
  parseStoryProtocol('你推开潮门旁的工具间。\n[choices: "检查绞盘"|"查看潮位"|"返回外堤"]', 'zh'),
  firstPersonDialogue,
  '推开工具间',
  'third-person wide establishing shot of the tool room beside the tide gate',
  'environment',
))
assert.equal(forcedObserver?.data?.perspective, 'observer', 'an explicit third-person proposal overrides an ordinary mixed policy')

const cadenceCartridge = {
  ...firstPersonDialogue,
  imageDirector: { ...firstPersonDialogue.imageDirector, maxQuietTurns: 0, softCooldownTurns: 0 },
}
const base = createInitialSave(cadenceCartridge)
const ordinaryPerspectives = Array.from({ length: 20 }, (_, index) => {
  const scene = index + 1
  const next = { ...base, scene, objective: `检查潮门旁第 ${scene} 处留下的具体划痕` }
  return chooseSceneImage(base, next, parseStoryProtocol(`潮门旁第 ${scene} 处划痕在低光下显出不同深度。\n[choices: "测量划痕"|"比较绞盘"]`, 'zh'), cadenceCartridge).perspective
})
const firstPersonCount = ordinaryPerspectives.filter((value) => value === 'first-person').length
assert.ok(firstPersonCount >= 8 && firstPersonCount <= 12, `balanced ordinary cadence should stay near 40–60%, got ${firstPersonCount}/20`)
assert.ok(ordinaryPerspectives.includes('observer') && ordinaryPerspectives.includes('first-person'), 'balanced cadence must exercise both perspectives')

console.log(JSON.stringify({ ok: true, balancedFirstPerson: firstPersonCount, sampleSize: ordinaryPerspectives.length, checks: ['observer-default', 'important-dialogue-first-person', 'no-avatar-ref-in-pov', 'explicit-observer-override', 'balanced-distribution'] }))
