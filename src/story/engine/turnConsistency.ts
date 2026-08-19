import { encodeChoiceRecord } from './choiceInput'
import { filterGroundedChoices } from './continuity'
import { resolveDomainAction } from './domainRules'
import { validateCharacterContinuity } from './characterContinuity'
import { dangerDirectiveEstablished, dangerTextGrounded } from './dangerDirector'
import type { Choice, DangerDirective, MapNode, ParsedCommand, ParsedScene, StoryCartridge, StorySave } from '../types'

function clean(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s，。！？、,.!?;；:："“”'‘’()（）\-—_/]+/g, '')
}

function effectiveLocation(save: StorySave, parsed: ParsedScene): string {
  const update = [...parsed.commands].reverse().find((command) => command.type === 'map_update')
  return update?.type === 'map_update' ? update.location : save.location
}

function sceneBelongsToMapLocation(sceneLocation: string, mapLocation: string, save: StorySave, cartridge: StoryCartridge, proposedHints: string[] = []): boolean {
  const scene = clean(sceneLocation)
  const map = clean(mapLocation)
  if (scene === map || scene.includes(map)) return true
  const node = mapNodes(save, cartridge).find((candidate) => clean(candidate.label) === map)
  return [...(node?.routeHints ?? []), ...proposedHints].some((hint) => {
    const normalized = clean(hint)
    return normalized.length >= 2 && scene.includes(normalized)
  })
}

function mapNodes(save: Pick<StorySave, 'map'>, cartridge: Pick<StoryCartridge, 'initialMap'>): MapNode[] {
  const definitions = new Map(cartridge.initialMap.map((node) => [node.id, node]))
  const merged: MapNode[] = save.map.map((node) => {
    const definition = definitions.get(node.id)
    return { ...definition, ...node, routeHints: node.routeHints ?? definition?.routeHints }
  })
  cartridge.initialMap.forEach((node) => {
    if (!merged.some((candidate) => candidate.id === node.id || clean(candidate.label) === clean(node.label))) merged.push(node)
  })
  return merged
}

function routeMovementCue(value: string, locale: StoryCartridge['locale']): boolean {
  return locale === 'zh'
    ? /(?:前往|去往|赶往|返回|回到|进入|走进|走到|抵达|到达|下车|离开|往[^。！？\n]{0,28}(?:走|去|检查|干活|工作|修补)|沿[^。！？\n]{0,28}(?:走|前进)|跟随|带着|陪同)/.test(value)
    : /\b(?:travel|go|head|return|enter|walk|reach|arrive|get off|leave|follow|accompany)\b/i.test(value)
}

function routeMatchScore(value: string, node: MapNode): number {
  const normalized = clean(value)
  const label = clean(node.label)
  let score = normalized.includes(label) ? 100 + label.length : 0
  const matches = new Set((node.routeHints ?? []).map(clean).filter((hint) => hint.length >= 2 && normalized.includes(hint)))
  matches.forEach((hint) => { score += 10 + Math.min(hint.length, 12) })
  return score
}

const genericRouteHint = /^(?:这里|那里|附近|周围|地点|地方|区域|场景|当前地点|新地点|here|there|nearby|around|place|location|area|scene|current place|new place)$/i

/** A deterministic id for model-created places. Existing saved ids always win;
 * this fallback prevents retry/reload from creating a second node for the same
 * canonical label. */
export function stableDynamicLocationId(location: string): string {
  const normalized = clean(location) || 'place'
  let hash = 2166136261
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `dynamic-location-${(hash >>> 0).toString(36)}`
}

/** Keep only aliases proved by the visible turn or its structured public map
 * description. Hidden prompt-only aliases are discarded. */
export function validatedDynamicRouteHints(command: Extract<ParsedCommand, { type: 'map_update' }>, parsed: ParsedScene): string[] {
  const visible = [
    visibleProse(parsed), command.location, command.detail, command.lore,
    ...(command.facts ?? []),
    ...parsed.commands.filter((entry): entry is Extract<ParsedCommand, { type: 'scene_location' }> => entry.type === 'scene_location').map((entry) => entry.location),
  ].filter(Boolean).join('\n')
  const visibleClean = clean(visible)
  const seen = new Set<string>()
  return [command.location, ...(command.routeHints ?? [])]
    .map((hint) => hint.trim())
    .filter((hint) => {
      const normalized = clean(hint)
      if (normalized.length < 2 || normalized.length > 48 || genericRouteHint.test(hint.trim()) || seen.has(normalized)) return false
      if (clean(command.location) !== normalized && !visibleClean.includes(normalized)) return false
      seen.add(normalized)
      return true
    })
    .slice(0, 8)
}

export function mergeRouteHints(...groups: Array<string[] | undefined>): string[] | undefined {
  const seen = new Set<string>()
  const merged = groups.flatMap((group) => group ?? []).map((hint) => hint.trim()).filter((hint) => {
    const normalized = clean(hint)
    if (normalized.length < 2 || genericRouteHint.test(hint) || seen.has(normalized)) return false
    seen.add(normalized)
    return true
  }).slice(0, 8)
  return merged.length ? merged : undefined
}

export function repairPersistedMapRouteHints(
  map: MapNode[],
  sceneLocation: string | undefined,
  blocks: StorySave['blocks'],
  cartridge: Pick<StoryCartridge, 'initialMap'>,
): MapNode[] {
  const definitions = new Map(cartridge.initialMap.map((node) => [node.id, node]))
  const recent = blocks.slice(-80).filter((block) => block.kind === 'narration' || block.kind === 'dialogue').map((block) => clean(block.text)).join('\n')
  return map.map((node) => {
    const definition = definitions.get(node.id)
    let currentSceneHint: string | undefined
    if (node.current && sceneLocation && clean(sceneLocation) !== clean(node.label)) {
      const scene = clean(sceneLocation)
      const label = clean(node.label)
      if (scene.includes(label) || (recent.includes(label) && recent.includes(scene))) currentSceneHint = sceneLocation
    }
    return { ...node, routeHints: mergeRouteHints(definition?.routeHints, node.routeHints, [node.label], currentSceneHint ? [currentSceneHint] : undefined) }
  })
}

/** Resolve a system/free-input route to a stable map id before generation.
 * The route must contain both an actual movement/commitment cue and a unique
 * destination fingerprint; merely discussing a remote place does not move. */
export function inferActionDestination(save: StorySave, cartridge: StoryCartridge, action: string): MapNode | undefined {
  if (!routeMovementCue(action, cartridge.locale)) return undefined
  const candidates = mapNodes(save, cartridge)
    .filter((node) => clean(node.label) !== clean(save.location))
    .map((node) => ({ node, score: routeMatchScore(action, node) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
  if (!candidates.length || candidates[0].score === candidates[1]?.score) return undefined
  return candidates[0].node
}

export function bindChoiceDestinations(choices: Choice[], save: StorySave, cartridge: StoryCartridge): Choice[] {
  return choices.map((choice) => {
    const destination = inferActionDestination(save, cartridge, choice.label)
    return destination ? { ...choice, targetLocationId: destination.id } : { ...choice, targetLocationId: undefined }
  })
}

export function playerDeclaredLocationAlias(action: string, locale: StoryCartridge['locale']): string | undefined {
  const match = locale === 'zh'
    ? action.match(/(?:我(?:要|决定|以后)?|从现在起)?把这里(?:正式)?(?:叫作|叫做|命名为|称为)[“"']?([^”"'，。！？]{2,24})/)
    : action.match(/\bI\s+(?:(?:will|want to|decide to)\s+)?(?:call|name)\s+(?:this place|this area|here)\s+["']?([^"'.!?]{2,40})/i)
  const alias = match?.[1]?.trim()
  return alias && !genericRouteHint.test(alias) ? alias : undefined
}

function inferVisibleDestination(save: StorySave, cartridge: StoryCartridge, parsed: ParsedScene): MapNode | undefined {
  const prose = visibleProse(parsed)
  const embodied = cartridge.locale === 'zh'
    ? /(?:你|你们)[^。！？\n]{0,24}(?:已经在|正在|开始|走进|进入|抵达|到达|下车|穿过)/.test(prose)
    : /\b(?:you|your group)\b.{0,60}\b(?:are now|begin|enter|reach|arrive|get off|cross)\b/i.test(prose)
  if (!embodied) return undefined
  const candidates = mapNodes(save, cartridge)
    .filter((node) => clean(node.label) !== clean(save.location))
    .map((node) => ({ node, score: routeMatchScore(prose, node) }))
    .filter(({ node, score }) => score >= 100 || (score > 0 && (node.routeHints ?? []).filter((hint) => clean(hint).length >= 2 && clean(prose).includes(clean(hint))).length >= 2))
    .sort((a, b) => b.score - a.score)
  if (!candidates.length || candidates[0].score === candidates[1]?.score) return undefined
  return candidates[0].node
}

function explicitlyRemainsAtCurrentLocation(save: StorySave, cartridge: StoryCartridge, parsed: ParsedScene): boolean {
  const current = mapNodes(save, cartridge).find((node) => clean(node.label) === clean(save.location))
  const labels = [current?.label ?? save.location, ...(current?.routeHints ?? [])].filter((value) => clean(value).length >= 2)
  return visibleProse(parsed).split(/(?<=[。！？.!?])|\n+/).some((sentence) => {
    const mentionsCurrent = labels.some((label) => clean(sentence).includes(clean(label)))
    const remains = cartridge.locale === 'zh'
      ? /(?:仍在|还在|依然在|仍留在|没有离开|暂时留在)/.test(sentence)
      : /\b(?:still|remain|stays?|have not left|has not left)\b/i.test(sentence)
    return mentionsCurrent && remains
  })
}

function visibleProse(parsed: ParsedScene): string {
  return parsed.blocks
    .filter((block) => block.kind === 'narration' || block.kind === 'dialogue')
    .map((block) => block.text).join('\n')
}

function immediateThreatSentence(prose: string, locale: StoryCartridge['locale']): string | undefined {
  const sentences = prose.split(/(?<=[。！？.!?])|\n+/).map((sentence) => sentence.trim()).filter(Boolean)
  const resolved = locale === 'zh'
    ? /(?:已经|已|终于)?(?:被)?(?:击退|制服|赶走|阻止|化解|解除|撤退|逃走|离开|投降|结束)|威胁(?:已经|已)?消失/
    : /\b(?:was|were|has been|have been)?\s*(?:repelled|captured|stopped|resolved|defused|defeated)|\b(?:retreated|withdrew|fled|surrendered|ended)\b/i
  const active = locale === 'zh'
    ? /(?:(?:袭击者|攻击者|敌人|追兵|援兵|守卫|同伴|帮手)[^。！？]{0,30}(?:赶来|冲来|逼近|包围|围攻|袭击|攻击|闯入|营救|解救|救走|救人|抢人|劫走)|(?:突然|此时|这时|正在|正要|试图|准备|开始)[^。！？]{0,36}(?:袭击|攻击|包围|围攻|闯入|营救|解救|救走|救人|抢人|劫走))/
    : /\b(?:attackers?|enemies|pursuers?|reinforcements?|guards?|companions?|allies?)\b.{0,80}\b(?:arrive|charge|approach|surround|attack|assault|raid|break in|rescue|free|seize|take back)\b|\b(?:suddenly|now|currently|trying to|preparing to|begin(?:s|ning)? to)\b.{0,80}\b(?:attack|assault|surround|raid|break in|rescue|free|seize|take back)\b/i
  return sentences.find((sentence) => active.test(sentence) && !resolved.test(sentence))
}

function threadTerms(value: string, locale: StoryCartridge['locale']): string[] {
  if (locale === 'en') {
    const stop = new Set(['about', 'after', 'again', 'against', 'before', 'being', 'could', 'their', 'there', 'these', 'those', 'would'])
    return [...new Set(value.toLocaleLowerCase().match(/[a-z]{4,}/g) ?? [])].filter((word) => !stop.has(word)).slice(0, 12)
  }
  const known = value.match(/(?:袭击者|攻击者|敌人|追兵|援兵|守卫|同伴|帮手|俘虏|人质|营救|解救|救走|抢人|劫走|围攻|包围|闯入|取消|封路|拒付)/g) ?? []
  const compact = clean(value)
  const pairs = Array.from({ length: Math.max(0, compact.length - 1) }, (_, index) => compact.slice(index, index + 2))
  return [...new Set([...known, ...pairs])].slice(0, 18)
}

function threadGroundedInProse(thread: string, prose: string, locale: StoryCartridge['locale']): boolean {
  const normalizedProse = clean(prose)
  return threadTerms(thread, locale).some((term) => normalizedProse.includes(clean(term)))
}

function newTaskCue(locale: StoryCartridge['locale']): RegExp {
  return locale === 'zh'
    ? /你(?:现在)?(?:的)?(?:新|下一项|接下来(?:的)?)任务(?:是|为|：|:)|(?:接受|接下|领取|承担|受命执行|开始执行)[^。！？\n]{0,18}(?:任务|委托)|(?:交给|委托给|安排给)你[^。！？\n]{0,18}(?:任务|委托)/
    : /your (?:new|next) (?:task|assignment) (?:is|:)|(?:accept|take on|receive|begin executing).{0,48}(?:task|assignment)|(?:assign|entrust).{0,32}(?:task|assignment).{0,24}you/i
}

function inferredObjective(parsed: ParsedScene, cartridge: StoryCartridge): string | undefined {
  const cue = newTaskCue(cartridge.locale)
  const sentence = visibleProse(parsed).split(/(?<=[。！？.!?])|\n+/).map((value) => value.trim()).find((value) => cue.test(value))
  return sentence ? sentence.replace(/^[“”"']+|[“”"']+$/g, '').slice(0, 120) : undefined
}

/**
 * Canonicalize protocol-only metadata when the authoritative answer is already
 * known locally. Missing scene_location must not turn an otherwise playable
 * response into a dead end, and an unbound image proposal is safer to discard
 * than to reject the whole story turn.
 */
export function canonicalizeTurnMetadata(
  save: StorySave,
  parsed: ParsedScene,
  cartridge: StoryCartridge,
  imagePrompt?: string,
  action?: string,
  trustedAuthored = false,
): { parsed: ParsedScene; imagePrompt?: string; discardedImage: boolean } {
  let commands = parsed.commands
  let originalSceneLocations = commands.filter((command): command is Extract<ParsedCommand, { type: 'scene_location' }> => command.type === 'scene_location')
  // Models occasionally repeat an otherwise identical response during a
  // repair. Collapse equivalent location metadata before sublocation
  // canonicalization; doing this afterwards leaves one duplicated
  // "Quay hotel" label looking like a teleport away from "Quay".
  if (originalSceneLocations.length > 1 && originalSceneLocations.every((command) => clean(command.location) === clean(originalSceneLocations[0].location))) {
    let retained = false
    commands = commands.filter((command) => {
      if (command.type !== 'scene_location') return true
      if (retained) return false
      retained = true
      return true
    })
    originalSceneLocations = commands.filter((command): command is Extract<ParsedCommand, { type: 'scene_location' }> => command.type === 'scene_location')
  }
  let hasMapUpdate = commands.some((command) => command.type === 'map_update')
  if (!hasMapUpdate && originalSceneLocations.length === 1 && clean(originalSceneLocations[0].location) !== clean(save.location)) {
    const destination = save.map.find((node) => clean(node.label) === clean(originalSceneLocations[0].location))
      ?? cartridge.initialMap.find((node) => clean(node.label) === clean(originalSceneLocations[0].location))
    const prose = visibleProse(parsed)
    const visiblyArrived = destination && prose.split(/(?<=[。！？.!?])|\n+/).some((sentence) => clean(sentence).includes(clean(destination.label))
      && /(?:抵达|到达|来到|走进|进入|已经在|身处|下车|穿过.+(?:走进|进入)|arriv|reach|enter|step into|now in|get off|cross.+into)/i.test(sentence))
    if (destination && visiblyArrived) {
      commands = [...commands, {
        type: 'map_update', location: destination.label, locationId: destination.id, connectedTo: destination.connectedTo,
        detail: destination.detail, lore: destination.lore, facts: destination.facts, routeHints: destination.routeHints,
      }]
      hasMapUpdate = true
    }
  }

  if (!hasMapUpdate) {
    const destination = (action ? inferActionDestination(save, cartridge, action) : undefined)
      ?? inferVisibleDestination(save, cartridge, { ...parsed, commands })
    if (destination && !explicitlyRemainsAtCurrentLocation(save, cartridge, { ...parsed, commands })) {
      commands = commands.filter((command) => command.type !== 'scene_location'
        || sceneBelongsToMapLocation(command.location, destination.label, save, cartridge))
      commands = [...commands, {
        type: 'map_update', location: destination.label, locationId: destination.id, connectedTo: destination.connectedTo,
        detail: destination.detail, lore: destination.lore, facts: destination.facts, routeHints: destination.routeHints,
      }]
      hasMapUpdate = true
    }
  }

  const location = effectiveLocation(save, { ...parsed, commands })
  const sceneLocations = commands.filter((command): command is Extract<ParsedCommand, { type: 'scene_location' }> => command.type === 'scene_location')
  const imageLocations = commands.filter((command): command is Extract<ParsedCommand, { type: 'image_location' }> => command.type === 'image_location')

  if (sceneLocations.length === 0) commands = [...commands, { type: 'scene_location', location: hasMapUpdate ? location : save.sceneLocation ?? location }]
  else if (sceneLocations.length > 1 && sceneLocations.every((command) => clean(command.location) === clean(sceneLocations[0].location))) {
    let retained = false
    commands = commands.filter((command) => {
      if (command.type !== 'scene_location') return true
      if (retained) return false
      retained = true
      return true
    })
  }

  if (!commands.some((command) => command.type === 'state')) {
    const objective = inferredObjective(parsed, cartridge)
    if (objective) commands = [...commands, { type: 'state', value: objective }]
  }

  let safeImagePrompt = imagePrompt
  let discardedImage = false
  if (imagePrompt && imageLocations.length === 0) {
    const boundSceneLocation = commands.find((command): command is Extract<ParsedCommand, { type: 'scene_location' }> => command.type === 'scene_location')?.location ?? location
    if (trustedAuthored) commands = [...commands, { type: 'image_location', location: boundSceneLocation }]
    else {
      safeImagePrompt = undefined
      discardedImage = true
    }
  } else if (!imagePrompt && imageLocations.length) {
    commands = commands.filter((command) => command.type !== 'image_location')
  } else if (imagePrompt && imageLocations.length > 1 && imageLocations.every((command) => clean(command.location) === clean(imageLocations[0].location))) {
    let retained = false
    commands = commands.filter((command) => {
      if (command.type !== 'image_location') return true
      if (retained) return false
      retained = true
      return true
    })
  }

  let choiceIndex = -1
  commands.forEach((command, index) => { if (command.type === 'choices') choiceIndex = index })
  if (choiceIndex >= 0) {
    const command = commands[choiceIndex]
    if (command.type === 'choices') {
      const seen = new Set<string>()
      const candidates = command.choices
        .map((label) => label.trim())
        .filter((label) => label.length >= 2 && label.length <= 96 && !seen.has(label) && Boolean(seen.add(label)))
        .filter((label) => !isGenericSuggestedChoice(label, cartridge.locale))
        .filter((label) => !repeatsCurrentAction(label, action, cartridge.locale))
        .filter((label) => !stalePlaceChoice(label, location, save))
        .slice(0, 5)
        .map((label, index) => ({ id: `candidate-${index}`, label }))
      const mapUpdate = commands.find((entry): entry is Extract<ParsedCommand, { type: 'map_update' }> => entry.type === 'map_update')
      const objectiveUpdate = [...commands].reverse().find((entry): entry is Extract<ParsedCommand, { type: 'state' }> => entry.type === 'state')
      const sceneLocationUpdate = [...commands].reverse().find((entry): entry is Extract<ParsedCommand, { type: 'scene_location' }> => entry.type === 'scene_location')
      const offeredJobs = commands.filter((entry): entry is Extract<ParsedCommand, { type: 'job' }> => entry.type === 'job' && entry.action === 'offer')
      const groundedMap = mapUpdate
        ? (() => {
            const hints = validatedDynamicRouteHints(mapUpdate, { ...parsed, commands })
            const map = save.map.map((node) => (node.id === mapUpdate.locationId || clean(node.label) === clean(mapUpdate.location))
              ? { ...node, current: true, visited: true, detail: mapUpdate.detail ?? node.detail, lore: mapUpdate.lore ?? node.lore, facts: mapUpdate.facts ?? node.facts, routeHints: mergeRouteHints(node.routeHints, hints) }
              : { ...node, current: false })
            if (!map.some((node) => node.current)) map.push({
              id: mapUpdate.locationId ?? stableDynamicLocationId(mapUpdate.location), label: mapUpdate.location,
              connectedTo: mapUpdate.connectedTo, current: true, visited: true, detail: mapUpdate.detail,
              lore: mapUpdate.lore, facts: mapUpdate.facts, routeHints: hints,
            })
            return map
          })()
        : save.map
      const candidateSave = {
        ...save,
        location,
        sceneLocation: sceneLocationUpdate?.location ?? save.sceneLocation ?? location,
        objective: objectiveUpdate?.value ?? save.objective,
        map: groundedMap,
        jobs: [
          ...save.jobs,
          ...offeredJobs.map((job) => ({
            id: job.id, label: job.label ?? job.id, employer: job.employer, wage: job.wage ?? 0,
            status: 'offered' as const, offeredAtScene: save.scene + 1,
          })),
        ],
        blocks: [...save.blocks, ...parsed.blocks],
      }
      const textGrounded = new Set(filterGroundedChoices(candidates, candidateSave, cartridge, parsed.blocks).map((choice) => choice.label))
      const grounded = candidates.filter((choice) => {
        const domain = resolveDomainAction(candidateSave, cartridge, choice.label)
        return domain ? domain.status === 'accepted' : Boolean(inferActionDestination(candidateSave, cartridge, choice.label)) || textGrounded.has(choice.label)
      }).map((choice) => choice.label)
      if (grounded.length !== command.choices.length || grounded.some((label, index) => label !== command.choices[index])) {
        commands = commands.map((entry, index) => index === choiceIndex ? { type: 'choices' as const, choices: grounded } : entry)
      }
    }
  }

  return { parsed: commands === parsed.commands ? parsed : { ...parsed, commands }, imagePrompt: safeImagePrompt, discardedImage }
}

function validChoices(parsed: ParsedScene): string[] {
  const command = [...parsed.commands].reverse().find((entry) => entry.type === 'choices')
  if (command?.type !== 'choices') return []
  const labels = command.choices.map((label) => label.trim()).filter((label) => label.length >= 2 && label.length <= 96)
  return labels.length >= 1 && labels.length <= 5 && new Set(labels).size === labels.length ? labels : []
}

/** Generated replies must name a concrete in-world action. These labels are
 * placeholders: selecting one gives the model no commitment to resolve and
 * commonly causes abrupt thread switches or a same-menu loop. The reducer's
 * deliberate last-resort observation fallback is created later and does not
 * pass through this generated-choice filter. */
export function isGenericSuggestedChoice(label: string, locale: StoryCartridge['locale']): boolean {
  const value = label.replace(/[“”"'‘’。.!！?？；;：:]+/g, '').replace(/\s+/g, ' ').trim()
  if (!value) return true
  return locale === 'zh'
    ? /^(?:(?:和|与|找|问)(?:同伴|同行者|其他人|大家|他们|她们|他|她)?(?:商量|讨论|聊聊|问问)(?:一下)?(?:怎么办|如何处理|如何应对|接下来|下一步)?|(?:观察|查看|看看)(?:周围|附近|这里|现场|当前)?(?:的)?(?:新变化|变化|情况|局势|动静)|(?:等待|先等等|观望|看看再说|静观其变)|(?:继续|推进|处理|应对|解决)(?:当前|眼前)?(?:任务|事情|情况|局面|问题)|(?:换一种方式|换个方式|另想办法|尝试别的办法)(?:处理当前局面)?|(?:放弃原计划|改走别的路))$/u.test(value)
    : /^(?:(?:ask|talk to|discuss with|consult)(?: the)?(?: companion| companions| others| everyone| them)?(?: what to do| about what to do| about the next step| next steps?)?|discuss what to do with(?: the)?(?: companion| companions| others| everyone| them)|(?:observe|check|see|watch)(?: what)?(?: changed| is new)(?: around here)?|(?:observe|check|see|watch)(?: the)?(?: situation| surroundings)|(?:wait|wait and see|hold back|see what happens)|(?:continue|advance|handle|address|resolve)(?: the)?(?: current| immediate)?(?: task| matter| situation| problem)|(?:try another way|find another way|do something else|set the original plan aside|take another route))$/i.test(value)
}

function withoutRetryPrefix(value: string, locale: StoryCartridge['locale']): string {
  if (locale === 'zh') {
    const normalized = value.replace(/[“”"'‘’。.!！?？；;：:，,\s]+/g, '').toLocaleLowerCase()
    return normalized.replace(/^(?:继续|再次|再|重新|还是|仍然|接着|进一步)+/u, '')
  }
  const words = value.toLocaleLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(?:(?:continue|again|retry|reattempt|resume|keep|once more)\s+)+/i, '')
    .split(' ').filter(Boolean)
    .map((word) => word.length > 5 && word.endsWith('ing') ? word.slice(0, -3) : word)
  return words.join('')
}

/** Never immediately recommend the action that has just completed. Players
 * may still type a deliberate retry after a visible failure, but the system
 * tray must not create that loop for them. */
export function repeatsCurrentAction(label: string, action: string | undefined, locale: StoryCartridge['locale']): boolean {
  if (!action?.trim()) return false
  const candidate = withoutRetryPrefix(label, locale)
  const current = withoutRetryPrefix(action, locale)
  return Boolean(candidate && current && candidate === current)
}

export function canCommitDisplayedChoiceWithoutGeneratedReplies(
  save: Pick<StorySave, 'choices' | 'sessionEnded'>,
  cartridge: Pick<StoryCartridge, 'copy'>,
  action: string,
  violations: string[],
): boolean {
  const selected = clean(action)
  return Boolean(selected)
    && (save.choices.some((choice) => clean(choice.label) === selected)
      || (save.sessionEnded && clean(cartridge.copy.continue) === selected))
    && violations.length > 0
    && violations.every((violation) => violation === 'turn.requires_actionable_choices')
}

/** A generated consequence is still safe to commit when only its suggested
 * replies were filtered out. Payment, location, objective, and other state
 * violations must still repair or reject the whole draft. */
export function canCommitGeneratedTurnWithoutReplies(violations: string[]): boolean {
  return violations.length > 0 && violations.every((violation) => violation === 'turn.requires_actionable_choices')
}

function stalePlaceChoice(choice: string, location: string, save: StorySave): boolean {
  const destinationVerb = /(?:前往|去往|去|返回|回到|搭乘|乘坐|乘车到|坐到|陪.+到|买票|离开|赶往|送去|送到|带去|护送|通往|检查.+支线|travel|go to|head to|return|ride|take .* to|leave for|deliver .* to|bring .* to|escort .* to)/i
  const mapChanged = clean(location) !== clean(save.location)
  return save.map.some((node) => (mapChanged || !node.current)
    && clean(node.label) !== clean(location)
    && clean(choice).includes(clean(node.label))
    && !destinationVerb.test(choice))
}

export function validateTurnConsistency(
  save: StorySave,
  parsed: ParsedScene,
  cartridge: StoryCartridge,
  imagePrompt?: string,
  action?: string,
  dangerDirective?: DangerDirective,
): string[] {
  const violations = new Set<string>()
  const location = effectiveLocation(save, parsed)
  const sceneLocations = parsed.commands.filter((command): command is Extract<ParsedCommand, { type: 'scene_location' }> => command.type === 'scene_location')
  const imageLocations = parsed.commands.filter((command): command is Extract<ParsedCommand, { type: 'image_location' }> => command.type === 'image_location')
  const mapUpdates = parsed.commands.filter((command) => command.type === 'map_update')
  const choices = validChoices(parsed)
  const prose = visibleProse(parsed)
  const encounters = parsed.commands.filter((command): command is Extract<ParsedCommand, { type: 'encounter' }> => command.type === 'encounter')
  const emergingThreat = immediateThreatSentence(prose, cartridge.locale)

  validateCharacterContinuity(save, parsed, cartridge).forEach((violation) => violations.add(violation))

  if (sceneLocations.length !== 1) violations.add('turn.requires_one_scene_location')
  else if (!sceneBelongsToMapLocation(
    sceneLocations[0].location,
    location,
    save,
    cartridge,
    mapUpdates.length === 1 && mapUpdates[0].type === 'map_update' ? validatedDynamicRouteHints(mapUpdates[0], parsed) : [],
  )) violations.add('turn.scene_location_must_match_state')
  if (mapUpdates.length > 1) violations.add('turn.allows_one_map_update')
  if (mapUpdates.length === 1 && mapUpdates[0].type === 'map_update' && mapUpdates[0].locationId) {
    const existing = mapNodes(save, cartridge).find((node) => node.id === mapUpdates[0].locationId)
    if (existing && clean(existing.label) !== clean(mapUpdates[0].location)) violations.add('turn.location_id_cannot_rename_place')
  }

  if (imagePrompt) {
    if (imageLocations.length !== 1) violations.add('image.requires_one_image_location')
    else if (sceneLocations.length !== 1 || clean(imageLocations[0].location) !== clean(sceneLocations[0].location)) violations.add('image.location_must_match_scene')
  } else if (imageLocations.length) violations.add('image.location_without_image')

  if (!parsed.commands.some((command) => command.type === 'session_end') && !choices.length) violations.add('turn.requires_actionable_choices')
  if (choices.some((choice) => stalePlaceChoice(choice, location, save))) violations.add('choices.cannot_act_in_stale_location')

  if (emergingThreat && !encounters.length) violations.add('turn.visible_immediate_threat_requires_encounter')
  if (encounters.some((encounter) => encounter.phase !== 'resolution'
    && (!encounter.kind || !threadGroundedInProse(encounter.kind, prose, cartridge.locale)))) {
    violations.add('turn.encounter_must_match_visible_threat')
  }
  if (save.danger.phase !== 'calm') {
    if (!encounters.length) violations.add('turn.active_threat_requires_continuation')
    else {
      const activeThreat = save.danger.currentThreat ?? ''
      const sameThread = Boolean(activeThreat) && encounters.some((encounter) => Boolean(encounter.kind)
        && threadGroundedInProse(activeThreat, encounter.kind ?? '', cartridge.locale))
      if (!sameThread || !threadGroundedInProse(activeThreat, prose, cartridge.locale)) {
        violations.add('turn.active_threat_cannot_disappear')
      }
    }
  }
  if (dangerDirective) {
    if (!dangerDirectiveEstablished(parsed, dangerDirective, cartridge.locale)) {
      violations.add('turn.scheduled_threat_requires_visible_establishment')
    }
    if (dangerDirective.phase !== 'resolution'
      && choices.length
      && choices.some((choice) => !dangerTextGrounded(dangerDirective.threat, choice, cartridge.locale))) {
      violations.add('turn.scheduled_threat_choices_must_address_threat')
    }
  }

  if (newTaskCue(cartridge.locale).test(prose) && !parsed.commands.some((command) => command.type === 'state')) violations.add('turn.new_task_requires_objective_state')

  const actionDestination = action ? inferActionDestination(save, cartridge, action) : undefined
  if (actionDestination && clean(location) !== clean(actionDestination.label)) violations.add('turn.displayed_route_requires_destination')

  const arrivedAtOtherKnownPlace = mapNodes(save, cartridge).some((node) => clean(node.label) !== clean(save.location)
    && prose.split(/(?<=[。！？.!?])|\n+/).some((sentence) => clean(sentence).includes(clean(node.label))
      && /(?:抵达|到达|来到|走进|进入|已经在|身处|下车|arriv|reach|enter|step into|now in|get off)/i.test(sentence)))
  if (arrivedAtOtherKnownPlace && !mapUpdates.length) violations.add('turn.visible_arrival_requires_map_update')
  if (inferVisibleDestination(save, cartridge, parsed) && !mapUpdates.length) violations.add('turn.visible_arrival_requires_map_update')

  return [...violations]
}

export function repairKnownForestSceneDivergence<T extends {
  scene: number
  location: string
  objective: string
  facts?: StorySave['facts']
  blocks: StorySave['blocks']
  choices: StorySave['choices']
  map: StorySave['map']
}>(candidate: T, cartridge: StoryCartridge): T {
  const repairId = 'legacy-forest-patrol-choice-image-v1'
  if (candidate.facts?.[repairId] || clean(candidate.location) !== clean(cartridge.opening.location)) return candidate
  const visible = candidate.blocks
    .filter((block) => block.kind === 'narration' || block.kind === 'dialogue')
    .slice(-30).map((block) => block.text).join('\n')
  const exactEvidence = /你准备/.test(visible)
    && /跟随护林人开始巡逻/.test(visible)
    && /观察周围环境，留意可能的异常动静/.test(visible)
    && /询问林薇是否愿意一起制定应对突发状况的计划/.test(visible)
  const staleChoices = candidate.choices.some((choice) => /灯湾码头|末班月线/.test(choice.label))
  const target = candidate.map.find((node) => node.id === 'mistpine-forest')
    ?? cartridge.initialMap.find((node) => node.id === 'mistpine-forest')
  if (!exactEvidence || !staleChoices || !target) return candidate

  const labels = [
    '跟随护林人开始巡逻，尽快完成任务',
    '观察周围环境，留意可能的异常动静',
    '询问林薇是否愿意一起制定应对突发状况的计划',
  ]
  const choices = labels.map((label, index) => ({ id: `${candidate.scene}-${index}`, label }))
  const optionText = new Set(['你准备：', '你准备:', ...labels])
  const map = candidate.map.map((node) => ({ ...node, current: node.id === target.id, visited: node.id === target.id ? true : node.visited }))
  if (!map.some((node) => node.id === target.id)) map.push({ ...target, current: true, visited: true })
  const blocks = candidate.blocks
    .filter((block) => !(block.kind === 'narration' && optionText.has(block.text.trim())))
    .map((block) => {
      if (block.id === `choices-${candidate.scene}` && block.kind === 'choices') return { ...block, text: encodeChoiceRecord(choices) }
      if (block.id === `image-${candidate.scene}` && block.kind === 'image') return {
        ...block,
        text: target.label,
        data: { ...block.data, status: 'queued', url: '', promptVersion: '0', source: 'director', reason: 'cadence' },
      }
      return block
    })
  return {
    ...candidate,
    location: target.label,
    objective: '跟随护林人完成今晚的巡逻任务',
    facts: { ...(candidate.facts ?? {}), [repairId]: true },
    blocks,
    choices,
    map,
  }
}
