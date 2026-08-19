import { listCartridges } from '../src/story/cartridges/index'
import { applyParsedScene, createInitialSave, normalizeCharacterState } from '../src/story/engine/reducer'
import { parseStoryProtocol } from '../src/story/engine/protocol'
import { buildWorldContext } from '../src/story/engine/worldContext'

function ok(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
function equal(actual: unknown, expected: unknown, message: string) { if (actual !== expected) throw new Error(`${message}: ${String(actual)} !== ${String(expected)}`) }

const cartridge = listCartridges('en')[0]
ok(cartridge, 'standalone cartridge is registered')
const initial = createInitialSave(cartridge)
equal(initial.version, 10, 'StorySave v10 is active')
const baselineParty = initial.partyMemberIds.length

const first = applyParsedScene(initial, parseStoryProtocol(`Under the awning, an adult woman with short black curls and a green copper brooch lifts a fallen road sign. A clerk says she is called “Ari”; she explains that she knows the old roads and agrees to join your group.
[character_update: character_id="ari-vale" character="Ari" role="Adult guide" detail="Knows the old roads" visual_appearance="One adult woman, short black curls, green copper brooch, ochre raincoat" visual_traits="adult|short black curls|green copper brooch" visual_wardrobe="ochre raincoat" visual_forbidden="age drift|hair drift|missing brooch"]
[party_change: character_id="ari-vale" character="Ari" change="add"]
[choices: "Continue together"|"Ask about the road"|"Make camp"]`, 'en'), cartridge, 'Recruit Ari')
const ari = first.characters.find((character) => character.name === 'Ari')
ok(ari, 'first dynamic companion is persisted')
equal(first.partyMemberIds.length, baselineParty + 1, 'first recruit merges with initial party')

const second = applyParsedScene(first, parseStoryProtocol(`Beside the gate, an adult woman in a blue wool coat sorts a small bundle of herbs. She introduces herself as “Bea”; Bea says she is a healer with limited supplies and agrees to travel with you.
[character_update: character_id="bea-morn" character="Bea" role="Adult healer" detail="Carries limited herbs" visual_appearance="One adult woman, long brown braid, silver leaf pin, blue wool coat" visual_traits="adult|long brown braid|silver leaf pin" visual_wardrobe="blue wool coat" visual_forbidden="age drift|hair drift|missing leaf pin"]
[party_change: character_id="bea-morn" character="Bea" change="add"]
[choices: "Share information"|"Travel together"|"Discuss supplies"]`, 'en'), cartridge, 'Recruit Bea')
equal(second.partyMemberIds.length, baselineParty + 2, 'second recruit merges instead of replacing')
ok(second.partyMemberIds.includes(ari.id), 'first recruit remains after second recruit')

let longState = second
for (let index = 0; index < 24; index += 1) {
  longState = applyParsedScene(longState, parseStoryProtocol(`The journey advances through event ${index + 1}.\n[choices: "Observe"|"Talk to companions"|"Check the route"]`, 'en'), cartridge, `Long turn ${index + 1}`)
}
const restored = JSON.parse(JSON.stringify(longState)) as typeof longState
equal(restored.partyMemberIds.length, baselineParty + 2, 'party survives JSON save/reload after a long history')
const context = buildWorldContext({ cartridge, save: restored, actionId: 'Meet strangers', locale: cartridge.locale })
ok(context.current.activeParty.some((character) => character.id === ari.id), 'AI context includes the complete active party')

const silentRemove = applyParsedScene(restored, parseStoryProtocol(`[party_change: character_id="${ari.id}" character="Ari" change="remove"]\n[choices: "Continue"|"Check the map"|"Rest"]`, 'en'), cartridge, 'Continue')
ok(silentRemove.partyMemberIds.includes(ari.id), 'a remove command without visible departure cannot silently erase a companion')

const migrated = normalizeCharacterState({
  blocks: [
    { id: 'effect-1-0', kind: 'event', text: 'Legacy One joined the party' },
    { id: 'effect-2-0', kind: 'event', text: 'Legacy Two joined the party' },
    { id: 'effect-3-0', kind: 'event', text: 'Legacy One left the party' },
  ],
  relationships: [],
}, cartridge)
ok(migrated.partyMemberIds.some((id) => migrated.characters.find((character) => character.id === id)?.name === 'Legacy Two'), 'v4 protocol events migrate into the party')
ok(!migrated.partyMemberIds.some((id) => migrated.characters.find((character) => character.id === id)?.name === 'Legacy One'), 'v4 explicit departure is respected')

console.log(`standalone protocol ok · game=${cartridge.id} · party=${restored.partyMemberIds.length}`)
