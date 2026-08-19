import assert from 'node:assert/strict'
import { listCartridges } from '../src/story/cartridges/index'
import { encodeChoiceRecord } from '../src/story/engine/choiceInput'
import { contextualDangerChoiceLabels } from '../src/story/engine/dangerDirector'
import { createInitialSave, createRecoveryChoices, repairLegacyObjectiveRecoveryChoices } from '../src/story/engine/reducer'
import { presetEventRecoveryChoice } from '../src/story/engine/presetEventDirector'

for (const locale of ['zh', 'en'] as const) {
  const cartridge = listCartridges(locale)[0]
  const save = createInitialSave(cartridge)
  save.scene = 12
  save.objective = locale === 'zh' ? '继续审问刚抓到的俘虏。' : 'Continue questioning the captured prisoner.'
  const objective = locale === 'zh' ? '继续审问刚抓到的俘虏' : 'Continue questioning the captured prisoner'
  assert.deepEqual(createRecoveryChoices(save, cartridge).map((choice) => choice.label), [objective], `${locale}: an unresolved objective is the sole ordinary recovery action`)

  const empty = { ...save, objective: '' }
  const observationChoices = createRecoveryChoices(empty, cartridge)
  const authoredEvent = presetEventRecoveryChoice(empty, cartridge)
  assert.equal(observationChoices.length, 1, `${locale}: idle fallback remains singular`)
  if (authoredEvent) assert.equal(observationChoices[0].label, authoredEvent.label, `${locale}: a concrete local event replaces generic observation`)
  else assert.match(observationChoices[0].label, locale === 'zh' ? /^观察/ : /^Observe /, `${locale}: observation is used only without an authored event`)
  const observation = locale === 'zh'
    ? `观察${empty.location}的新变化`
    : `Observe what changed around ${empty.location}`

  if (cartridge.dangerDirector) {
    const threatened = { ...save, danger: { ...save.danger, phase: 'confrontation' as const, currentThreat: locale === 'zh' ? '同伴赶来营救俘虏' : 'companions arrive to rescue the prisoner' } }
    assert.deepEqual(
      createRecoveryChoices(threatened, cartridge).map((choice) => choice.label),
      contextualDangerChoiceLabels(threatened.danger.currentThreat, cartridge.dangerDirector.methods, locale),
      `${locale}: active danger uses threat-bound contextual response methods`,
    )
  }

  const genericDiscuss = locale === 'zh' ? '和同行者商量下一步' : 'Discuss the next move with your companions'
  const legacyChoices = [
    { id: 'objective', label: objective },
    { id: 'observe', label: observation },
    { id: 'discuss', label: genericDiscuss },
  ]
  const legacy = {
    ...save,
    choices: legacyChoices,
    blocks: [...save.blocks, { id: 'choices-12', kind: 'choices' as const, text: encodeChoiceRecord(legacyChoices), data: { scene: 12 } }],
  }
  const migrated = repairLegacyObjectiveRecoveryChoices(legacy, cartridge)
  assert.deepEqual(migrated.choices.map((choice) => choice.label), [objective], `${locale}: legacy objective/observation/discussion menu collapses to the unresolved objective`)
  assert.equal(migrated.blocks.find((block) => block.id === 'choices-12')?.text, encodeChoiceRecord(migrated.choices), `${locale}: immutable choice record is repaired`)
  assert.deepEqual(repairLegacyObjectiveRecoveryChoices(migrated, cartridge), migrated, `${locale}: migration is idempotent`)
}

console.log(JSON.stringify({ ok: true, checks: ['objective-only', 'observation-last-resort', 'danger-methods', 'legacy-record-migration', 'zh-en'] }))
