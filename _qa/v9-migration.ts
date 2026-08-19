import assert from 'node:assert/strict'
import { listCartridges } from '../src/story/cartridges'
import { createInitialSave } from '../src/story/engine/reducer'
import { normalizeSave } from '../src/story/useStoryEngine'

for (const locale of ['zh', 'en'] as const) {
  const cartridge = listCartridges(locale)[0]
  const current = createInitialSave(cartridge)
  const firstNode = cartridge.initialMap[0]
  const old = {
    ...current,
    version: 9 as const,
    scene: 7,
    time: locale === 'zh' ? '初夏第 2 天 · 07:30' : 'Early summer · Day 2 · 07:30',
    objective: locale === 'zh' ? '检查路碑下的新鲜车辙' : 'Inspect the fresh cart tracks below the milestone',
    stats: Object.fromEntries(cartridge.statDefinitions.map((definition) => [definition.id, definition.initial - 1])),
    inventory: current.inventory.map((item, index) => index === 0 ? { ...item, count: item.count + 1 } : item),
    map: current.map.map((node) => ({ ...node, routeHints: undefined })),
    choices: [],
  } as unknown as Record<string, unknown>
  delete old.sceneLocation
  delete old.decisionContext
  delete old.jobs

  const migrated = normalizeSave(old as never, cartridge)
  assert.equal(migrated.version, 10, `${locale}: v9 save upgrades to v10`)
  assert.equal(migrated.sceneLocation, migrated.location, `${locale}: missing exact scene safely falls back to map location`)
  assert.deepEqual(migrated.stats, old.stats, `${locale}: stat progress survives migration`)
  assert.equal(migrated.inventory[0]?.count, current.inventory[0]!.count + 1, `${locale}: inventory progress survives migration`)
  assert.deepEqual(migrated.jobs, [], `${locale}: missing job ledger becomes an empty authoritative ledger`)
  assert.ok((migrated.map.find((node) => node.id === firstNode.id)?.routeHints?.length ?? 0) > 0, `${locale}: authored route hints are restored`)
  assert.ok(migrated.choices.length >= 1, `${locale}: migrated save remains playable`)
  assert.deepEqual(normalizeSave(migrated, cartridge), migrated, `${locale}: migration is idempotent`)
}

console.log(JSON.stringify({ ok: true, checks: ['v9-to-v10', 'scene-fallback', 'stats-inventory-preserved', 'route-hints-restored', 'playable', 'idempotent', 'zh-en'] }))
