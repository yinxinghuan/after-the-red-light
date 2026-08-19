import { listCartridges } from '../src/story/cartridges/index'
import { parseStoryProtocol } from '../src/story/engine/protocol'
import { applyParsedScene, createInitialSave, normalizeCharacterState } from '../src/story/engine/reducer'
import type { StoryCartridge, StoryCharacter } from '../src/story/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const base = listCartridges('zh')[0]
const hidden = {
  id: 'future-guide', name: '纸鸟', role: '尚未遇见的向导', vitality: 80, stress: 10,
  skills: [{ id: 'guide', label: '带路', value: 4 }], hiddenUntilIntroduced: true,
}
const cartridge: StoryCartridge = { ...base, characters: [...base.characters, hidden] }
const initial = createInitialSave(cartridge)
assert(!initial.characters.some((character) => character.id === hidden.id), 'future character leaked into initial roster')

const legacyCharacter: StoryCharacter = { ...hidden, status: 'known', origin: 'cartridge', updatedAtScene: 0 }
const repaired = normalizeCharacterState({ ...initial, characters: [legacyCharacter], partyMemberIds: [], relationships: [] }, cartridge)
assert(!repaired.characters.some((character) => character.id === hidden.id), 'legacy preloaded future character was not removed')

const introduced = applyParsedScene(initial, parseStoryProtocol(`红线里钻出一只缺角的白纸鸟。它说名字太长，叫它纸鸟就好；它愿意为你带路。
[character_update: character_id="future-guide" character="纸鸟" role="向导" detail="缺角的白纸鸟" lore="名字来自它缺失的纸边"]
[choices: "请纸鸟带路"|"观察红线"|"暂时不请纸鸟带路"]`, 'zh'), cartridge, '查看红线')
const revealed = introduced.characters.find((character) => character.id === hidden.id)
assert(revealed?.origin === 'cartridge', 'visible debut did not reveal the authored stable id')
assert(introduced.choices.some((choice) => choice.label.includes('纸鸟')), 'introduced name is not available after visible debut')

const preserved = normalizeCharacterState({ ...introduced, relationships: introduced.relationships }, cartridge)
assert(preserved.characters.some((character) => character.id === hidden.id), 'genuinely introduced character was removed during normalization')

console.log(JSON.stringify({ ok: true, hiddenInitially: true, repairedLegacy: true, stableId: revealed.id }))
