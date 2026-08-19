import { t } from '../i18n'
import type { EntityMetric, Locale, ParsedCommand, ParsedScene, SceneImageSubject, SkillDefinition, StoryBlock } from '../types'

const commandNames = new Set([
  'choices', 'situation', 'widget', 'skill_check', 'state', 'clock', 'map_update', 'inventory',
  'job', 'scene_location', 'image_location', 'dialogue_focus', 'reputation', 'character_update', 'party_change', 'encounter', 'session_end',
])

const commandNameAlternation = [...commandNames].join('|')
const completeProtocolResidue = new RegExp(`^\\s*\\[(?:${commandNameAlternation})(?:\\s*:|\\s+(?=[a-z_]+\\s*=))[\\s\\S]*\\]\\s*$`, 'i')

export function isStoryProtocolResidue(value: string): boolean {
  return completeProtocolResidue.test(value)
}

function uid(prefix: string, index: number, text: string): string {
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `${prefix}-${index}-${(hash >>> 0).toString(36)}`
}

function attrs(source: string): Record<string, string> {
  const output: Record<string, string> = {}
  const quoted = /([\w_]+)\s*=\s*(["'])(.*?)\2/g
  let match: RegExpExecArray | null
  while ((match = quoted.exec(source))) output[match[1]] = match[3]
  const bare = /([\w_]+)\s*[:=]\s*([^,\]\s]+)/g
  while ((match = bare.exec(source))) if (output[match[1]] == null) output[match[1]] = match[2]
  return output
}

function number(value: string | undefined, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function stableCharacterId(value: string | undefined): string | undefined {
  const clean = value?.trim().toLowerCase()
  return clean && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(clean) && clean.length <= 64 ? clean : undefined
}

function stableLocationId(value: string | undefined): string | undefined {
  const clean = value?.trim().toLowerCase()
  return clean && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(clean) && clean.length <= 80 ? clean : undefined
}

function parseChoices(source: string): string[] {
  const body = source.replace(/^\s*choices\s*:/i, '').replace(/\]\s*$/, '').trim()
  const quoted = [...body.matchAll(/["'“”‘’]([^"'“”‘’]+)["'“”‘’]/g)].map((match) => match[1].trim()).filter(Boolean)
  if (quoted.length) return quoted
  return body.replace(/^\[/, '').replace(/\]$/, '').split(/[|｜]/).map((choice) => choice.replace(/^["'“”‘’]|["'“”‘’]$/g, '').trim()).filter(Boolean)
}

function extractNaturalChoices(source: string): { prose: string; choices: string[] } {
  const lines = source.split('\n')
  const nonEmptyIndexes = lines.map((line, index) => line.trim() ? index : -1).filter((index) => index >= 0)
  if (!nonEmptyIndexes.length) return { prose: source, choices: [] }
  const optionLine = /^\s*(?:(?:选项|选择|行动)\s*[一二三四五\dA-Ea-e]+\s*[：:.、)]|(?:\d{1,2}|[A-Ea-e]|[一二三四五])\s*[.、:：)]|[①②③④⑤]|[-*•])\s*(.+?)\s*$/
  const choices: string[] = []
  const choiceIndexes: number[] = []
  let cursor = nonEmptyIndexes.at(-1)!
  while (cursor >= 0 && choices.length < 5) {
    if (!lines[cursor].trim()) { cursor -= 1; continue }
    const match = lines[cursor].match(optionLine)
    if (!match) break
    const label = match[1].replace(/[。.;；]+$/, '').trim()
    if (label.length < 2 || label.length > 96) break
    choices.unshift(label)
    choiceIndexes.unshift(cursor)
    cursor -= 1
  }
  if (choices.length < 1) {
    choices.length = 0
    choiceIndexes.length = 0
    const cue = /^(?:你准备|准备采取的行动|可选行动|your actions?|you prepare|options?)\s*[：:]\s*$/i
    const cueIndex = [...nonEmptyIndexes].reverse().find((index) => cue.test(lines[index].trim()))
    const tailIndexes = cueIndex == null ? [] : nonEmptyIndexes.filter((index) => index > cueIndex)
    const beginsLikeBareAction = /^(?:跟随|观察|询问|陪同|开始|继续|前往|返回|留下|等待|检查|调查|搜索|告诉|帮助|拒绝|接受|进入|使用|带|把|让|与|尝试|绕|登|走|停|休息|follow|observe|ask|accompany|begin|start|continue|go|return|stay|wait|inspect|investigate|search|tell|help|refuse|accept|enter|use|take|try|walk|leave)/i
    if (cueIndex != null && tailIndexes.length >= 1 && tailIndexes.length <= 5 && tailIndexes.every((index) => {
      const value = lines[index].trim()
      return value.length >= 2 && value.length <= 96 && beginsLikeBareAction.test(value)
    })) {
      tailIndexes.forEach((index) => { choices.push(lines[index].trim()); choiceIndexes.push(index) })
    }
  }
  if (choices.length < 1 || choices.length > 5 || new Set(choices).size !== choices.length) return { prose: source, choices: [] }
  const previous = lines.slice(0, choiceIndexes[0]).reverse().find((line) => line.trim())?.trim() ?? ''
  const hasChoiceCue = /(?:你(?:现在)?可以|你准备|准备采取的行动|可选行动|可选择|选项|下一步|接下来|决定|打算|choose|choice|options?|next|you can|what (?:will|do) you)/i.test(previous)
  const beginsLikeAction = /^(?:先|去|前往|沿|循|跟随|返回|留下|等待|观察|检查|调查|搜索|询问|告诉|帮助|拒绝|接受|进入|使用|带|把|让|与|继续|尝试|绕|登|走|停|休息|follow|ask|return|stay|wait|watch|inspect|investigate|search|tell|help|refuse|accept|enter|use|take|continue|try|climb|walk|go|leave)/i
  if (!hasChoiceCue && (choices.length !== 3 || !choices.every((choice) => beginsLikeAction.test(choice)))) return { prose: source, choices: [] }
  choiceIndexes.forEach((index) => { lines[index] = '' })
  if (hasChoiceCue) {
    const cueIndex = lines.slice(0, choiceIndexes[0]).map((line) => line.trim()).lastIndexOf(previous)
    if (cueIndex >= 0 && /^(?:你(?:现在)?可以|你准备|准备采取的行动|可选行动|可选择|选项|下一步|接下来|choose|choices?|options?|next|you can|what (?:will|do) you)[^。.!?！？]{0,32}[：:]?$/i.test(previous)) lines[cueIndex] = ''
  }
  return { prose: lines.join('\n'), choices }
}

function parseList(value: string | undefined, maxItems = 12, maxItemLength = 180): string[] | undefined {
  const items = value?.split('|').map((item) => item.trim().slice(0, maxItemLength)).filter(Boolean).slice(0, maxItems)
  return items?.length ? items : undefined
}

function parseMetrics(value: string | undefined): EntityMetric[] | undefined {
  const metrics = parseList(value)?.map((entry) => {
    const divider = entry.search(/[:=]/)
    return divider > 0 ? { label: entry.slice(0, divider).trim(), value: entry.slice(divider + 1).trim() } : null
  }).filter((entry): entry is EntityMetric => Boolean(entry?.label && entry.value))
  return metrics?.length ? metrics : undefined
}

function optionalNumber(value: string | undefined): number | undefined {
  if (value == null || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseSkills(value: string | undefined): SkillDefinition[] | undefined {
  const skills = parseList(value)?.map((entry, index) => {
    const divider = entry.search(/[:=]/)
    if (divider <= 0) return null
    const label = entry.slice(0, divider).trim()
    const skillValue = optionalNumber(entry.slice(divider + 1).trim())
    if (!label || skillValue == null) return null
    return { id: `skill-${index}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || index}`, label, value: skillValue }
  }).filter((entry): entry is SkillDefinition => Boolean(entry))
  return skills?.length ? skills : undefined
}

function parseCommand(name: string, source: string, locale: Locale): ParsedCommand | null {
  const data = attrs(source)
  switch (name) {
    case 'choices': return { type: 'choices', choices: parseChoices(source) }
    case 'situation': {
      const text = (data.value ?? source.replace(/^\s*situation\s*:/i, '')).replace(/^["'“”‘’]|["'“”‘’]$/g, '').trim()
      return text ? { type: 'situation', text } : null
    }
    case 'widget': {
      const head = source.replace(/^\s*widget\s*:/i, '').split(',')[0].trim()
      const operation = (['value', 'count', 'add', 'remove'] as const).find((key) => data[key] != null) ?? 'value'
      return head ? { type: 'widget', id: head, operation, value: operation === 'add' || operation === 'remove' ? number(data[operation]) : number(data[operation]) } : null
    }
    case 'skill_check': return {
      type: 'skill_check', skill: data.skill ?? t(locale, 'unknownAbility'), dc: number(data.dc),
      roll: number(data.rolls ?? data.roll), modifier: number(data.modifier), total: number(data.total), result: data.result ?? 'unknown',
    }
    case 'state': return { type: 'state', value: data.value ?? source.replace(/^\s*state\s*:/i, '').trim() }
    case 'clock': return { type: 'clock', value: data.value ?? source.replace(/^\s*clock\s*:/i, '').trim() }
    case 'map_update': return data.new_location || data.location ? {
      type: 'map_update', location: (data.new_location ?? data.location).trim().slice(0, 80),
      locationId: stableLocationId(data.location_id ?? data.id), connectedTo: data.connected_to?.trim().slice(0, 80),
      detail: data.detail?.trim().slice(0, 300), lore: data.lore?.trim().slice(0, 600), facts: parseList(data.facts, 8, 180),
      routeHints: parseList(data.route_hints ?? data.aliases, 8, 48),
    } : null
    case 'inventory': {
      const rarity = data.rarity === 'rare' || data.rarity === 'legendary' ? data.rarity : data.rarity === 'common' ? 'common' : undefined
      return data.item ? {
        type: 'inventory', action: data.action === 'remove' ? 'remove' : 'add', item: data.item,
        count: Math.max(1, number(data.count, 1)), rarity, detail: data.detail, effect: data.effect,
        lore: data.lore, metrics: parseMetrics(data.metrics), imagePrompt: data.image_prompt,
      } : null
    }
    case 'job': {
      const action = data.action === 'accept' || data.action === 'settle' || data.action === 'cancel' ? data.action : 'offer'
      const id = data.id?.trim().toLowerCase()
      const stableId = id && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) && id.length <= 64 ? id : undefined
      if (!stableId) return null
      return {
        type: 'job', action, id: stableId,
        label: data.label?.trim().slice(0, 120), employer: data.employer?.trim().slice(0, 80),
        wage: data.wage == null ? undefined : Math.max(1, Math.min(30, Math.floor(number(data.wage)))),
      }
    }
    case 'scene_location': {
      const location = (data.location ?? data.value ?? source.replace(/^\s*scene_location\s*:/i, '')).trim().slice(0, 80)
      return location ? { type: 'scene_location', location } : null
    }
    case 'image_location': {
      const location = (data.location ?? data.value ?? source.replace(/^\s*image_location\s*:/i, '')).trim().slice(0, 80)
      return location ? { type: 'image_location', location } : null
    }
    case 'dialogue_focus': {
      const speaker = (data.speaker ?? data.character ?? '').trim().slice(0, 80)
      const expression = data.expression?.trim().slice(0, 160)
      return speaker ? { type: 'dialogue_focus', speaker, expression } : null
    }
    case 'reputation': return data.npc ? { type: 'reputation', npc: data.npc, action: data.action ?? 'changed' } : null
    case 'character_update': return data.character ? {
      type: 'character_update', characterId: stableCharacterId(data.character_id), character: data.character, role: data.role,
      detail: data.detail, lore: data.lore, vitality: optionalNumber(data.vitality), stress: optionalNumber(data.stress), skills: parseSkills(data.skills),
      visualAppearance: data.visual_appearance, visualTraits: parseList(data.visual_traits, 6, 120), visualWardrobe: parseList(data.visual_wardrobe, 4, 160), visualForbidden: parseList(data.visual_forbidden, 6, 120),
    } : null
    case 'party_change': return data.character ? {
      type: 'party_change', characterId: stableCharacterId(data.character_id), character: data.character, change: data.change === 'remove' ? 'remove' : 'add',
      role: data.role, detail: data.detail, lore: data.lore, vitality: optionalNumber(data.vitality), stress: optionalNumber(data.stress), skills: parseSkills(data.skills),
    } : null
    case 'encounter': {
      const phase = data.phase === 'warning' || data.phase === 'confrontation' ? data.phase : data.phase === 'resolution' ? 'resolution' : null
      const outcomes = ['none', 'critical-success', 'success', 'costly-success', 'failure', 'critical-failure'] as const
      const outcome = outcomes.find((value) => value === data.outcome)
      return phase ? { type: 'encounter', phase, kind: data.kind, severity: optionalNumber(data.severity), outcome } : null
    }
    case 'session_end': return { type: 'session_end', reason: data.reason ?? t(locale, 'chapterPaused') }
    default: return null
  }
}

function commandSpans(raw: string, locale: Locale): Array<{ start: number; end: number; command: ParsedCommand }> {
  const spans: Array<{ start: number; end: number; command: ParsedCommand }> = []
  // Models sometimes omit the colon before an attribute list, for example
  // [dialogue_focus speaker="..." expression="..."]. Parse that as a
  // command instead of leaking machine protocol into visible prose.
  const pattern = /\[([a-z_]+)(?:\s*:|\s+(?=[a-z_]+\s*=))/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(raw))) {
    const name = match[1].toLowerCase()
    if (!commandNames.has(name)) continue
    let cursor = pattern.lastIndex
    let quote = ''
    let depth = 1
    for (; cursor < raw.length; cursor += 1) {
      const char = raw[cursor]
      if (quote) {
        if (char === quote && raw[cursor - 1] !== '\\') quote = ''
      } else if (char === '"' || char === "'") quote = char
      else if (char === '[') depth += 1
      else if (char === ']') {
        depth -= 1
        if (depth === 0) break
      }
    }
    if (cursor >= raw.length) continue
    const source = raw.slice(match.index + 1, cursor).replace(new RegExp(`^\\s*${name}\\s+(?=[a-z_]+\\s*=)`, 'i'), `${name}: `)
    const command = parseCommand(name, source, locale)
    if (command) spans.push({ start: match.index, end: cursor + 1, command })
    pattern.lastIndex = cursor + 1
  }
  return spans
}

function removeNarratedStatusDump(value: string): string {
  const marker = /^[\s【\[]*(?:当前)?(?:状态|数值)(?:更新|变化|报告)?[\s】\]]*[:：]?\s*$|^\s*(?:current\s+)?(?:status|stat|value)(?:\s+update|\s+report|\s+changes?)?\s*[:：]?\s*$/i
  const field = /^\s*(?:[-*•]\s*)?(?:体力|补给|名望|声望|位置|地点|时间|角色身份|身份|当前目标|目标|生命|活力|压力|关系|物品|行囊|vitality|health|supplies|supply|reputation|renown|location|place|time|role|identity|objective|stress|relationship|inventory)\s*[:：][^\n]*$/i
  let dropping = false
  return value.split('\n').map((line) => {
    if (marker.test(line.trim())) { dropping = true; return '' }
    if (dropping && (!line.trim() || field.test(line))) return ''
    dropping = false
    return line
  }).join('\n')
}

export function parseStoryProtocol(raw: string, locale: Locale = 'zh'): ParsedScene {
  const spans = commandSpans(raw, locale)
  let prose = raw
  for (const span of [...spans].reverse()) prose = prose.slice(0, span.start) + '\n' + prose.slice(span.end)
  prose = prose.replace(/\[[a-z_]+\s*:[^\]\n]*\]/gi, '\n')
  // Remove a protocol line that was cut off before its closing bracket. It is
  // machine residue, and leaving it at the tail prevents natural-choice scan.
  prose = prose.replace(/^\s*\[[a-z_]+\s*:.*$/gim, '\n')
  prose = prose.replace(new RegExp(`^\\s*\\[(?:${commandNameAlternation})\\s+(?=[a-z_]+\\s*=)[^\\]\\n]*\\]\\s*$`, 'gim'), '\n')
  prose = removeNarratedStatusDump(prose)
  // A visible tail option list is part of the witnessed scene. Recover and
  // remove it even when the model also emitted a stale structured choice set;
  // the appended natural command becomes the reducer's authoritative set.
  const natural = extractNaturalChoices(prose)
  prose = natural.prose

  const blocks: StoryBlock[] = []
  const dialogue = /^\[([^\]]+)]\s*\[([^\]]+)](?:\s*\[([^\]]+)])?\s*:\s*["“]?(.*?)["”]?\s*$/
  const lenientDialogue = /^([^\[\]:]{1,40})\s+\[([^\]]+)](?:\s*\[([^\]]+)])?\s*:\s*["“]?(.*?)["”]?\s*$/
  const bareChannelDialogue = /^\[([^\]]+)]\s+([^:\s]+)\s+([^:\s]+)\s*:\s*["“]?(.*?)["”]?\s*$/
  prose.split(/\n+/).map((line) => line.trim()).filter(Boolean).forEach((line, index) => {
    const match = line.match(dialogue) ?? line.match(lenientDialogue) ?? line.match(bareChannelDialogue)
    if (match) {
      blocks.push({ id: uid('line', index, line), kind: 'dialogue', speaker: match[1], tone: match[3] ?? match[2], text: match[4].replace(/["”]$/, '') })
    } else {
      blocks.push({ id: uid('line', index, line), kind: 'narration', text: line })
    }
  })
  return {
    blocks,
    commands: [...spans.map((span) => span.command), ...(natural.choices.length ? [{ type: 'choices' as const, choices: natural.choices }] : [])],
    raw,
  }
}

export function extractSceneImagePrompt(content: string): string | undefined {
  const match = content.match(/\[image_prompt:\s*(?:"([^"]+)"|'([^']+)'|([^\]\n]+))\s*\]/i)
  return (match?.[1] ?? match?.[2] ?? match?.[3])?.trim()
}

export function extractSceneImageSubject(content: string): SceneImageSubject | undefined {
  const match = content.match(/\[image_subject:\s*(?:"([^"]+)"|'([^']+)'|([^\]\n]+))\s*\]/i)
  const value = (match?.[1] ?? match?.[2] ?? match?.[3])?.trim().toLowerCase()
  return value === 'player' || value === 'environment' || value === 'others' ? value : undefined
}

export function extractSceneImageCharacterId(content: string): string | undefined {
  const match = content.match(/\[image_character_id:\s*(?:"([^"]+)"|'([^']+)'|([^\]\n]+))\s*\]/i)
  const value = (match?.[1] ?? match?.[2] ?? match?.[3])?.trim()
  return value && /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(value) ? value : undefined
}
