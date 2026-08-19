import type { Choice, StoryBlock, StoryCartridge, StorySave } from '../types'

function clean(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s，。！？、,.!?;；:："“”'‘’()（）\-—_/]+/g, '')
}

export function authoredDecisionContext(value: string, visibleTurnText: string, locale: StoryCartridge['locale']): string {
  const normalized = value.replace(/[\n\r\t]+/g, ' ').replace(/^[“”"'‘’]+|[“”"'‘’]+$/g, '').replace(/\s+/g, ' ').trim()
  const maxLength = locale === 'zh' ? 28 : 96
  if (!normalized || normalized.length > maxLength) return ''
  if (/请(?:做出|作出)?选择|接下来(?:怎么|如何)做|what (?:will|do) you do|make (?:a|your) choice/i.test(normalized)) return ''
  if (clean(visibleTurnText).includes(clean(normalized))) return ''
  return normalized
}

export function createTransitionBlock(
  save: Pick<StorySave, 'scene' | 'location'>,
  destination: string | undefined,
  cartridge: StoryCartridge,
): StoryBlock | undefined {
  const anchor = cartridge.transitionAnchor?.trim()
  if (!anchor || !destination || clean(destination) === clean(save.location)) return undefined
  const text = cartridge.locale === 'zh'
    ? `前往${destination}之前，你先借${anchor}回望${save.location}留下的行动与线索。确认上一段路已经结束后，你才继续，随后抵达${destination}。`
    : `Before heading to ${destination}, you use ${anchor} to review the actions and clues left at ${save.location}. Only after closing that leg do you continue and arrive at ${destination}.`
  return { id: `transition-${save.scene + 1}`, kind: 'narration', text, data: { transitionAnchor: anchor, destination } }
}

function chineseTerms(value: string): string[] {
  const generic = /(?:为什么|有什么用|尚未|当前|现在|原地|这里|那里|周围|四处|附近|下一步|具体|详细|详情|细节|进一步|更多|关于|信息|情况|局面|方式|事情|行动|工作|线索|变化|消息|原因|警告|通知|计划|机会|代价|保证|考虑|准备|建议|提出|追问|是否|如何|能否|一起|自己|这些|那个|那位|这个|其他|别的|哪条|那张|那场|一个|一份|一条|一段|今晚|明晚|明早|明天|清晨|下一站|到站后|暂时|早点|早早|先|再来|再|也|就|仍然|仍|已经|正在|即将|重新|还在|可能|需要|必须|只|请|不去|不|去|前往|前进|靠近|沿着?|循着?|跟随|跟|返回|回到|留下|留在|等待|观察|查看|看看|检查|调查|探索|搜索|询问|问问|问|聊聊|谈谈|搭话|商量|告诉|介绍|了解|说明|帮助|帮忙|帮|拒绝|接受|接下|答应|承诺|邀请|负责|保护|努力|撤退|专注|理会|进入|使用|换取|带着?|把|将|让|与|和|继续|尝试|绕到?|登上|走向|停下|休息|闭眼|坐到?|坐|陪|拿|收好|离开|加入|开始|完成|做完|整理|搬运|搬|寻找|找|追查|放弃|改走|送上|送去|送到|带去|唱给|压平|摆好|拦住|推到?|顶住?|堵住?|锁住?|守住?|选择|决定|谁|听|最|突然|紧急|临时|当地|额外|特别|背后|应对|解决|办法|方案|调整|规划|行程|交通|住宿|住处|房间|便宜|选项|安排|收入|保存|保留|突发|状况|不确定|全程|正式|时间|间隔|报酬|招工牌|招工|数据|记录|测量|管理方|赚点|环境|活|钱|处|她|他|它|对方|的|了|后|人|在|为|以|或)/gu
  const stripped = value.replace(generic, ' ')
  return [...new Set((stripped.match(/[\u3400-\u9fff]{2,8}/gu) ?? [])
    .map((term) => term.replace(/[上旁边里内外中前后]$/u, ''))
    .filter((term) => term.length >= 2))]
}

function englishTerms(value: string): string[] {
  const generic = new Set(['with', 'from', 'into', 'about', 'around', 'again', 'next', 'current', 'situation', 'continue', 'inspect', 'observe', 'check', 'ask', 'tell', 'help', 'return', 'follow', 'leave', 'wait', 'take', 'make', 'try', 'use', 'look', 'move', 'alone', 'join', 'finish', 'decline', 'accept', 'agree', 'choose', 'rent', 'stay', 'begin', 'start', 'flatten', 'pocket', 'trace', 'discuss', 'investigate', 'survey', 'push', 'brace', 'block', 'lock', 'guard', 'hold'])
  return [...new Set(value.toLocaleLowerCase().match(/[a-z]{4,}/g) ?? [])].filter((term) => !generic.has(term))
}

function choiceIsGrounded(
  choice: Choice,
  sources: string[],
  locale: StoryCartridge['locale'],
  stableEntities: string[],
): boolean {
  const source = sources.join(' ')
  let termSource = choice.label
  let groundedStableReference = false
  if (locale === 'zh') {
    for (const entity of stableEntities.sort((left, right) => right.length - left.length)) {
      if (entity.length < 2 || !clean(termSource).includes(clean(entity))) continue
      if (!clean(source).includes(clean(entity))) return false
      groundedStableReference = true
      termSource = termSource.replaceAll(entity, ' ')
    }
  } else {
    for (const entity of stableEntities.sort((left, right) => right.length - left.length)) {
      if (entity.length < 3 || !clean(termSource).includes(clean(entity))) continue
      if (!clean(source).includes(clean(entity))) return false
      groundedStableReference = true
      termSource = termSource.replace(new RegExp(entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ')
    }
  }
  const terms = locale === 'zh' ? chineseTerms(termSource) : englishTerms(termSource)
  if (!terms.length) return true
  const normalizedSource = clean(source)
  if (normalizedSource.includes(clean(choice.label))) return true
  const canSegmentFromSources = (term: string) => {
    const normalized = clean(term)
    const normalizedSources = sources.map(clean)
    const reachable = new Set([0])
    for (let start = 0; start < normalized.length; start += 1) {
      if (!reachable.has(start)) continue
      for (let end = normalized.length; end >= start + 2; end -= 1) {
        const piece = normalized.slice(start, end)
        if (normalizedSources.some((candidate) => candidate.includes(piece))) reachable.add(end)
      }
    }
    return reachable.has(normalized.length)
  }
  const matches = terms.filter((term) => sources.some((candidate) => clean(candidate).includes(clean(term))) || canSegmentFromSources(term))
  // A future action naturally introduces verbs and manner words that need not
  // have appeared verbatim in the preceding prose. Keep an open narrative
  // choice when it names at least one established entity/place/item, or when
  // at least one remaining concrete term is grounded. Domain rules, route
  // checks and character continuity still reject choices that are provably
  // impossible; this filter must not delete valid exploration merely because
  // a model paraphrased it.
  return groundedStableReference || matches.length > 0
}

export function filterGroundedChoices(
  choices: Choice[],
  save: StorySave,
  cartridge: StoryCartridge,
  immediateBlocks: StoryBlock[] = save.blocks,
): Choice[] {
  let lastActionIndex = -1
  for (let index = save.blocks.length - 1; index >= 0; index -= 1) {
    const block = save.blocks[index]
    if (block.kind === 'event' && /^action-\d+$/.test(block.id)) {
      lastActionIndex = index
      break
    }
  }
  const recentCommittedBlocks = save.blocks.slice(lastActionIndex >= 0 ? lastActionIndex + 1 : 0)
  const visibleTurn = [...recentCommittedBlocks, ...immediateBlocks]
    .filter((block) => block.kind !== 'image' && !block.id.startsWith('action-'))
    .map((block) => `${block.speaker ?? ''} ${block.text}`)
  const knownPeople = save.characters.filter((character) => character.status !== 'departed').map((character) => character.name)
  const knownPlaces = save.map.filter((node) => node.visited || node.current).flatMap((node) => [node.label, node.detail ?? '', node.lore ?? '', ...(node.facts ?? [])])
  const knownItems = save.inventory.flatMap((item) => [
    item.label, item.detail ?? '', item.effect ?? '', item.lore ?? '',
    ...(item.metrics ?? []).flatMap((metric) => [metric.label, metric.value]),
  ])
  const activeJobs = save.jobs.filter((job) => job.status === 'offered' || job.status === 'accepted').flatMap((job) => [job.label, job.employer ?? ''])
  const knownStats = cartridge.statDefinitions.flatMap((definition) => [definition.label, definition.description ?? '', String(save.stats[definition.id] ?? '')])
  const sources = [...visibleTurn, save.sceneLocation ?? save.location, save.location, save.objective, ...knownPeople, ...knownPlaces, ...knownItems, ...activeJobs, ...knownStats]
  const stableEntities = [...knownPeople, save.sceneLocation ?? save.location, save.location, ...knownPlaces, ...knownItems, ...activeJobs, ...knownStats].filter(Boolean)
  const quarantined = typeof save.facts.consistency_quarantined_action === 'string'
    && save.facts.consistency_quarantined_location === save.location
    ? clean(save.facts.consistency_quarantined_action)
    : ''
  return choices.filter((choice) => (!quarantined || clean(choice.label) !== quarantined)
    && choiceIsGrounded(choice, sources, cartridge.locale, stableEntities))
}

export function choicesAreGrounded(choices: Choice[], save: StorySave, cartridge: StoryCartridge): boolean {
  return filterGroundedChoices(choices, save, cartridge).length === choices.length
}
