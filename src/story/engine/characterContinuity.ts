import type { Locale, ParsedCommand, ParsedScene, StoryCartridge, StoryCharacter, StorySave } from '../types'

export type CharacterCommand = Extract<ParsedCommand, { type: 'character_update' | 'party_change' }>

export function normalizedCharacterName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s·•._-]+/g, '')
}

export function matchingCharacter(save: Pick<StorySave, 'characters'>, command: CharacterCommand): StoryCharacter | undefined {
  const byId = command.characterId ? save.characters.find((character) => character.id === command.characterId) : undefined
  const byName = save.characters.find((character) => normalizedCharacterName(character.name) === normalizedCharacterName(command.character))
  return byId ?? byName
}

export function characterIdentityConflict(save: Pick<StorySave, 'characters'>, command: CharacterCommand, cartridge: Pick<StoryCartridge, 'characters'>): boolean {
  const byId = command.characterId ? save.characters.find((character) => character.id === command.characterId) : undefined
  const byName = save.characters.find((character) => normalizedCharacterName(character.name) === normalizedCharacterName(command.character))
  const definition = command.characterId ? cartridge.characters.find((character) => character.id === command.characterId) : undefined
  if (byId && normalizedCharacterName(byId.name) !== normalizedCharacterName(command.character)) return true
  if (command.characterId && byName && byName.id !== command.characterId) return true
  if (definition && normalizedCharacterName(definition.name) !== normalizedCharacterName(command.character)) return true
  return false
}

function visibleNarration(parsed: ParsedScene): string {
  return parsed.blocks.filter((block) => block.kind === 'narration').map((block) => block.text.trim()).filter(Boolean).join('\n')
}

function visibleTurn(parsed: ParsedScene): string {
  return parsed.blocks.filter((block) => block.kind === 'narration' || block.kind === 'dialogue').map((block) => `${block.speaker ?? ''} ${block.text}`.trim()).filter(Boolean).join('\n')
}

function visibleMentionsCharacter(value: string, name: string): boolean {
  if (value.includes(name)) return true
  return name.split(/[\s·•]+/).map((part) => part.trim()).filter((part) => part.length >= 3).some((part) => value.includes(part))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function hasVisibleCharacterDebut(parsed: ParsedScene, name: string, locale: Locale): boolean {
  const narration = visibleNarration(parsed)
  const exactName = name.trim()
  const nameIndex = narration.indexOf(exactName)
  if (!exactName || nameIndex < 0) return false
  const before = narration.slice(0, nameIndex)
  const after = `${narration.slice(nameIndex + exactName.length)}\n${parsed.blocks.filter((block) => block.kind === 'dialogue').map((block) => `${block.speaker ?? ''} ${block.text}`).join('\n')}`
  const sourceWindow = narration.slice(Math.max(0, nameIndex - 56), Math.min(narration.length, nameIndex + exactName.length + 48))
  const escapedName = escapeRegExp(exactName)
  const hasNamedDialogue = parsed.blocks.some((block) => block.kind === 'dialogue' && normalizedCharacterName(block.speaker ?? '') === normalizedCharacterName(exactName))
  const nameSource = locale === 'zh'
    ? new RegExp(`(?:叫|喊|称|名叫|名为|名字(?:是|叫)?|写着|签着|读作|自我介绍(?:说)?|我是)[^。！？\\n]{0,32}[“"']?${escapedName}|${escapedName}[^。！？\\n]{0,24}(?:这个名字|是(?:她|他|他们|这人)的名字)`, 'u').test(sourceWindow)
    : new RegExp(`(?:called|named|name is|reads|says|introduces? (?:himself|herself|themself|themselves)? ?as|i(?:'|’)m|i am)[^.!?\\n]{0,48}[“"']?${escapedName}|${escapedName}[^.!?\\n]{0,32}(?:is (?:her|his|their) name)`, 'i').test(sourceWindow)
  const recognisableBefore = locale === 'zh' ? before.replace(/\s/g, '').length >= 8 : before.replace(/\s/g, '').length >= 18
  const intentAfter = locale === 'zh'
    ? after.replace(/\s/g, '').length >= 6 && (hasNamedDialogue || /(?:说|问|看|递|指|愿意|打算|需要|想|让|请|帮|带|同行|工作|离开|留下|给|交|付|验|介绍|[“"])/u.test(after))
    : after.replace(/\s/g, '').length >= 14 && (hasNamedDialogue || /\b(?:say|ask|look|offer|point|will|want|need|help|guide|join|work|leave|stay|travel|pay|give|tell|introduce)\w*\b|[“"]/i.test(after))
  return nameSource && recognisableBefore && intentAfter
}

export function hasVisiblePartyJoin(parsed: ParsedScene, name: string, locale: Locale): boolean {
  const visible = visibleTurn(parsed)
  if (!visibleMentionsCharacter(visible, name)) return false
  return locale === 'zh'
    ? /(?:一起|同行|跟着|加入|陪(?:你|同)|带你|结伴|会合|共同的路|下一站|答应[^。！？\n]{0,24}(?:去|走|检查|工作|调查))/u.test(visible)
    : /\b(?:together|join|accompany|travel(?:ing)? with|come with|guide you|shared road|meet at|next stop|agree[^.!?\n]{0,48}(?:go|walk|inspect|work|survey))\b/i.test(visible)
}

export function validateCharacterContinuity(save: StorySave, parsed: ParsedScene, cartridge: StoryCartridge): string[] {
  const violations = new Set<string>()
  const staged: Pick<StorySave, 'characters'> = { characters: save.characters.map((character) => ({ ...character })) }
  for (const command of parsed.commands) {
    if (command.type === 'character_update') {
      if (characterIdentityConflict(staged, command, cartridge)) { violations.add('character.id_cannot_change_identity'); continue }
      const existing = matchingCharacter(staged, command)
      const definition = command.characterId ? cartridge.characters.find((character) => character.id === command.characterId) : undefined
      if (!existing) {
        if (!command.characterId) violations.add('character.new_character_requires_stable_id')
        if (!hasVisibleCharacterDebut(parsed, command.character, cartridge.locale)) violations.add('character.new_character_requires_visible_debut')
        if (!definition && (!command.visualAppearance?.trim() || !command.visualTraits?.length)) violations.add('character.generated_character_requires_visual_identity')
        if (command.characterId && hasVisibleCharacterDebut(parsed, command.character, cartridge.locale) && (definition || (command.visualAppearance?.trim() && command.visualTraits?.length))) {
          staged.characters.push({ id: command.characterId, name: command.character, role: command.role ?? '', vitality: 100, stress: 0, skills: [], status: 'known', origin: definition ? 'cartridge' : 'generated', updatedAtScene: save.scene + 1 })
        }
      }
    }
    if (command.type === 'party_change') {
      if (characterIdentityConflict(staged, command, cartridge)) { violations.add('character.id_cannot_change_identity'); continue }
      const existing = matchingCharacter(staged, command)
      if (!existing) violations.add('party.character_must_be_known')
      else if (command.change === 'add' && !hasVisiblePartyJoin(parsed, existing.name, cartridge.locale)) violations.add('party.join_must_be_visible')
    }
    if (command.type === 'reputation') {
      const known = staged.characters.some((character) => normalizedCharacterName(character.name) === normalizedCharacterName(command.npc))
      if (!known) violations.add('relationship.character_must_be_known')
    }
  }
  return [...violations]
}

