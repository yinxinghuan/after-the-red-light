import type { JobContract, ParsedCommand, ParsedScene, StoryCartridge, StorySave } from '../types'

type JobCommand = Extract<ParsedCommand, { type: 'job' }>
type WidgetCommand = Extract<ParsedCommand, { type: 'widget' }>

const currencyPattern = /(?:钱币|铜板|铜币|硬币|金币|银币|coins?|coppers?|crowns?|tokens?)/i
const compensationPattern = /(?:报酬|工钱|薪水|工资|酬劳|payment|pay|wages?|salary|compensation)/i

function visiblePaymentSignals(locale: StoryCartridge['locale']) {
  const received = locale === 'zh'
    ? /(?:递给你(?:们)?|交给你(?:们)?|付给你(?:们)?|支付给你(?:们)?|给了你(?:们)?|数给你(?:们)?|塞给你(?:们)?|(?:放进|放到|放入)你(?:们)?手里|当场付了|当场结清|已经结清|收到了?)/
    : /(?:paid you|pays you|handed you|hands you|gave you|passed you|counts? out|counted out|you received|places?.{0,32}(?:coins?|coppers?|crowns?|tokens?).{0,16}(?:in|into) your hand|payment (?:was|is) settled)/i
  const compensationReceived = locale === 'zh'
    ? /(?:你(?:们)?[^。！？]{0,36}(?:赚得|获得|拿到|领到|收到|挣到|结清|领取)(?:了|到)?[^。！？]{0,18}(?:报酬|工钱|薪水|工资|酬劳)|(?:递给|交给|付给|支付给|给了|数给|塞给|发给)你(?:们)?[^。！？]{0,18}(?:报酬|工钱|薪水|工资|酬劳)|(?:报酬|工钱|薪水|工资|酬劳)[^。！？]{0,14}(?:递给|交给|付给|支付给|发给)你(?:们)?|给你(?:们)?[^。！？]{0,12}(?:发了|结了)[^。！？]{0,12}(?:报酬|工钱|薪水|工资|酬劳)|你(?:们)?的(?:报酬|工钱|薪水|工资|酬劳)[^。！？]{0,14}(?:到账|到手|结清|发放|领到|收下))/
    : /(?:\byou\b.{0,36}(?:earned|received|collected|got).{0,24}(?:payment|pay|wages?|salary|compensation)|\byou\b.{0,24}(?:got paid|were paid|have been paid)|(?:hands?|handed|gives?|gave|passes?|passed|pays?|paid).{0,18}\byou\b.{0,18}(?:payment|pay|wages?|salary|compensation)|\byour\b.{0,12}(?:payment|pay|wages?|salary|compensation).{0,18}(?:arrived|was settled|were settled|was received|were received))/i
  const deniedReceipt = locale === 'zh'
    ? /(?:不|没有|未|不会|不能|并未|尚未|无需)[^。！？]{0,16}(?:赚得|获得|拿到|领到|收到|挣到|结清|发放|领取|递给|交给|付给|支付给|给了|数给|塞给|到账|到手)/
    : /(?:did not|didn't|have not|haven't|has not|hasn't|was not|were not|will not|won't|cannot|can't|no).{0,24}(?:earn|receive|collect|get paid|pay|wage|salary|compensation)/i
  // Future plans can reuse transfer verbs without completing a receipt.
  const pendingReceipt = locale === 'zh'
    ? /(?:(?:下一步|接下来|之后|以后|稍后|待会|准备|打算|计划|正要|即将|可以|将|会在|明早|明天|尚未|还没|仍待|等待)[^。！？]{0,64}(?:领取|收到|拿到|领到|结算|发放|递给|交给|付给|支付给|数给|塞给|到账|到手)|(?:领取|收到|拿到|领到|结算|发放|递给|交给|付给|支付给|数给|塞给|到账|到手)[^。！？]{0,32}(?:稍后|待会|明早|明天|以后|之后)|(?:仍要|还要|尚要|仍需|还需|需要|需)?等[^。！？]{0,40}(?:结算|领取|收到|拿到|领到|发放))/
    : /(?:(?:next(?: step)?|tomorrow|plans? to|intends? to|about to|will|shall|scheduled to|can|may)[^.!?]{0,80}(?:hand|give|pay|collect|receive|get paid|be paid|settle|payment|wages?|salary|compensation)|(?:hands?|gives?|pays?|paid|collects?|receives?)[^.!?]{0,40}(?:later|tomorrow|afterwards|next (?:day|morning|week))|(?:remains?|is|are|still)[^.!?]{0,24}(?:due|unpaid|to be paid))/i
  return { received, compensationReceived, deniedReceipt, pendingReceipt }
}

function chineseInteger(value: string): number | undefined {
  if (/^\d{1,3}$/.test(value)) return Number(value)
  const digits: Record<string, number> = { '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 }
  if (!/^[零〇一二两三四五六七八九十百]+$/.test(value)) return undefined
  let total = 0
  let current = 0
  for (const character of value) {
    if (character === '十' || character === '百') {
      const unit = character === '十' ? 10 : 100
      total += (current || 1) * unit
      current = 0
    } else current = digits[character]
  }
  return total + current
}

export function exactCoinAmount(text: string, locale: StoryCartridge['locale']): number | undefined {
  if (locale === 'zh' && /(?:这|该|那)\s*枚\s*(?:钱币|铜板|铜币|硬币|金币|银币)/.test(text)) return 1
  const match = locale === 'zh'
    ? text.match(/(\d{1,3}|[零〇一二两三四五六七八九十百]{1,5})\s*(?:枚|个)?\s*(?:钱币|铜板|铜币|硬币|金币|银币)/)
    : text.match(/(\d{1,3})\s+(?:coins?|coppers?|crowns?|tokens?)/i)
  if (!match) return undefined
  const amount = locale === 'zh' ? chineseInteger(match[1]) : Number(match[1])
  return amount && amount > 0 ? Math.min(30, amount) : undefined
}

/** A price in generated prose is not permission to spend. Only an explicit
 * player action may authorize a purchase; asking or looking never does. */
export function actionAuthorizesCoinSpend(action: string, locale: StoryCartridge['locale']): boolean {
  const source = action.trim()
  if (!source) return false
  if (locale === 'zh') {
    const denied = /(?:不|不要|别|暂不|先不|尚未|没有|拒绝)[^。！？]{0,8}(?:支付|付款|付钱|付房费|花钱|购买|买下|买票|订房|预订|租房|结账)/
    if (denied.test(source)) return false
    const direct = /(?:支付|付款|付钱|付房费|花(?:掉|费|完)?(?:钱|这|那|一|\d|[零〇一二两三四五六七八九十百])|(?:把|将)[^。！？]{0,12}钱(?:币)?花|购买|买下|买票|订房|预订房间|租(?:一间|个)?房|住一晚|要一间房|结账|买一顿饭)/
    if (!direct.test(source)) return false
    const genericSpend = /(?:把|将)?(?:身上|手里|剩下|剩余|所有|全部|这些|这点)?(?:的)?钱(?:币)?(?:(?:全|都)部|都)?花(?:掉|完)|花(?:掉|完)(?:身上|手里|剩下|剩余|所有|全部|这些|这点)?(?:的)?钱(?:币)?/
    const purchaseObject = /(?:房费|房间|住宿|旅店|车票|船票|票价|饭|餐|食物|饮料|药|装备|工具|物品|礼物|捐款|小费|账单)|(?:购买|买下|买票|订房|预订|租房|结账)/
    if (genericSpend.test(source) && !purchaseObject.test(source)) return false
    const exploratory = /(?:询问|问问|了解|打听|查看|看看|考虑|寻找|比较)[^。！？]{0,20}(?:房费|价格|费用|住宿|交通|车票|饭)/
    const explicitAfterExploration = /(?:并|然后|随后|确认后)[^。！？]{0,10}(?:支付|付款|付钱|买下|购买|订房|买票|结账)/
    return !exploratory.test(source) || explicitAfterExploration.test(source)
  }
  const denied = /(?:do not|don't|refuse to|not yet|without)\s+(?:pay|spend|buy|book|rent)/i
  if (denied.test(source)) return false
  const direct = /\b(?:pay|spend|buy|purchase|book|reserve|rent|check out|stay (?:for )?the night)\b/i
  if (!direct.test(source)) return false
  const genericSpend = /\bspend\b.{0,24}\b(?:all|every|remaining|rest of)?\s*(?:my|the)?\s*(?:money|coins?)\b/i
  const purchaseObject = /\b(?:on|for|buy|purchase|book|reserve|rent|room|lodging|hotel|ticket|fare|meal|food|drink|medicine|gear|tool|gift|donation|tip|bill)\b/i
  if (genericSpend.test(source) && !purchaseObject.test(source.replace(/\bspend\b/i, ''))) return false
  const exploratory = /\b(?:ask|inquire|learn|check|consider|look for|compare)\b.{0,32}\b(?:price|cost|fare|room|lodging|transport|ticket|meal)\b/i
  const explicitAfterExploration = /\b(?:and|then|after confirming)\b.{0,16}\b(?:pay|buy|purchase|book|reserve|rent)\b/i
  return !exploratory.test(source) || explicitAfterExploration.test(source)
}

function commandDelta(command: WidgetCommand): number {
  const value = Number(command.value)
  if (!Number.isFinite(value)) return 0
  return command.operation === 'remove' ? -Math.abs(value) : command.operation === 'add' ? Math.abs(value) : 0
}

function jobForCommand(save: StorySave, offers: JobCommand[], command: JobCommand): JobContract | undefined {
  const persisted = save.jobs.find((job) => job.id === command.id)
  if (persisted) return persisted
  const offered = offers.find((offer) => offer.id === command.id && offer.action === 'offer' && offer.wage)
  return offered?.wage ? {
    id: offered.id, label: offered.label ?? offered.id, employer: offered.employer,
    wage: offered.wage, status: 'offered', offeredAtScene: save.scene + 1,
  } : undefined
}

function stableJobId(save: StorySave, action: string): string {
  let hash = 2166136261
  for (const character of `${save.scene + 1}:${action}`) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return `story-job-${save.scene + 1}-${(hash >>> 0).toString(36)}`
}

/** Add deterministic transaction commands only when the exact transfer is
 * already explicit in visible prose. Promises never credit money. */
export function canonicalizePaymentMetadata(
  save: StorySave,
  parsed: ParsedScene,
  cartridge: StoryCartridge,
  action: string,
): ParsedScene {
  if (!cartridge.statDefinitions.some((definition) => definition.id === 'coin')) return parsed
  const prose = parsed.blocks.filter((block) => block.kind === 'narration' || block.kind === 'dialogue').map((block) => block.text).join('\n')
  const sentences = prose.split(/(?<=[。！？.!?])|\n+/).map((sentence) => sentence.trim()).filter(Boolean)
  const { received, compensationReceived, deniedReceipt, pendingReceipt } = visiblePaymentSignals(cartridge.locale)
  const spent = cartridge.locale === 'zh'
    ? /(?:你(?:当场)?(?:支付|付了|交了|付清|结清)|你(?:用|拿出|掏出|交出)[^。！？]{0,28}(?:支付|付了|交了|付清|结清|全部花掉|全部花完|投入)|你[^。！？]{0,24}钱(?:币)?(?:(?:全|都)部|都)(?:花掉|花完|用光)|从你[^。！？]{0,16}扣除)/
    : /(?:you paid|you (?:used|took out|handed over).{0,32}(?:to pay|as payment|spent it all)|you spent.{0,32}(?:coins?|money)|was deducted from you)/i
  const promise = cartridge.locale === 'zh'
    ? /(?:如果|等你?|(?:完成|做完|搬完|送完|修完)[^。！？]{0,12}(?:(?:之后|以后)|后(?=[，,\s我你她他会将再])|再)|再?帮(?:我|忙)?)[^。！？]{0,48}(?:会|将|给你|付你|报酬|工钱)/
    : /(?:(?:\bif\b|\bwhen\b|\bafter\b).{0,64}(?:will pay|pay you|(?:wage|payment).{0,16}(?:will be|is due|becomes due))|\bhelp\b.{0,64}(?:i(?:'ll| will) pay|pay you)|\b(?:will|shall)\s+pay\b|\bwill\s+(?:receive|collect|get paid)\b)/i
  const completedTransfer = /(?:工作|任务|整理|搬运|装箱|修理|运送)[^。！？]{0,12}(?:完成|做完|搬完|送完|修完)后[，,][^。！？]{0,36}(?:递给你|交给你|付给你|给了你|塞给你|结清|收到)/
  const workContext = /(?:工作|短工|帮忙|干活|这份活|任务|报酬|工钱|薪水|工资|酬劳|搬|修|送|封好|装箱|work|job|shift|help|task|payment|pay|wages?|salary|compensation|repair|carry|deliver|pack)/i.test(prose)
  const receivedSentence = sentences.find((sentence) => (
    (currencyPattern.test(sentence) && received.test(sentence)) || compensationReceived.test(sentence)
  ) && !deniedReceipt.test(sentence) && !pendingReceipt.test(sentence)
    && (!promise.test(sentence) || (completedTransfer.test(sentence) && !/(?:等你|如果|会|将)/.test(sentence))))
  const spentSentence = sentences.find((sentence) => currencyPattern.test(sentence) && spent.test(sentence) && !promise.test(sentence))
  const promisedSentence = sentences.find((sentence) => (currencyPattern.test(sentence) || compensationPattern.test(sentence)) && promise.test(sentence))
  let commands = parsed.commands
  const jobs = () => commands.filter((command): command is JobCommand => command.type === 'job')
  const widgets = () => commands.filter((command): command is WidgetCommand => command.type === 'widget' && command.id === 'coin')
  const label = action.trim().slice(0, 80) || (cartridge.locale === 'zh' ? '本次工作' : 'Current work')
  const employer = [...parsed.blocks].reverse().find((block) => block.kind === 'dialogue' && block.speaker)?.speaker
  const addOffer = (amount: number): JobCommand => ({
    type: 'job', action: 'offer', id: stableJobId(save, action), label,
    employer: employer || (cartridge.locale === 'zh' ? '当前雇主' : 'Current employer'), wage: amount,
  })

  if (promisedSentence) {
    const amount = exactCoinAmount(promisedSentence, cartridge.locale)
    const active = amount ? save.jobs.find((job) => job.wage === amount && (job.status === 'offered' || job.status === 'accepted')) : undefined
    if (amount && !active && !jobs().some((command) => command.action === 'offer')) commands = [...commands, addOffer(amount)]
    commands = commands.filter((command) => command.type !== 'widget' || command.id !== 'coin' || commandDelta(command) <= 0)
  }

  if (receivedSentence) {
    const amount = exactCoinAmount(receivedSentence, cartridge.locale)
    if (amount && workContext && !jobs().some((command) => command.action === 'settle')) {
      const active = save.jobs.find((job) => job.wage === amount && (job.status === 'offered' || job.status === 'accepted'))
      if (active) commands = [...commands, { type: 'job', action: 'settle', id: active.id }]
      else {
        const offer = addOffer(amount)
        commands = [...commands, offer, { type: 'job', action: 'settle', id: offer.id }]
      }
    } else if (amount && !workContext && !jobs().some((command) => command.action === 'settle') && !widgets().some((command) => commandDelta(command) === amount)) {
      commands = [...commands, { type: 'widget', id: 'coin', operation: 'add', value: amount }]
    }
  }

  if (spentSentence) {
    const amount = exactCoinAmount(spentSentence, cartridge.locale)
    if (amount && actionAuthorizesCoinSpend(action, cartridge.locale)) {
      commands = commands.filter((command) => command.type !== 'widget' || command.id !== 'coin')
      commands = [...commands, { type: 'widget', id: 'coin', operation: 'remove', value: amount }]
    }
  }

  if (jobs().some((command) => command.action === 'settle')) {
    commands = commands.filter((command) => command.type !== 'widget' || command.id !== 'coin' || commandDelta(command) <= 0)
  }
  return commands === parsed.commands ? parsed : { ...parsed, commands }
}

export function validatePaymentConsistency(save: StorySave, parsed: ParsedScene, cartridge: StoryCartridge, action = ''): string[] {
  if (!cartridge.statDefinitions.some((definition) => definition.id === 'coin')) return []
  const violations = new Set<string>()
  const prose = parsed.blocks.filter((block) => block.kind === 'narration' || block.kind === 'dialogue').map((block) => block.text).join('\n')
  const sentences = prose.split(/(?<=[。！？.!?])|\n+/).map((sentence) => sentence.trim()).filter(Boolean)
  const { received, compensationReceived, deniedReceipt, pendingReceipt } = visiblePaymentSignals(cartridge.locale)
  const spent = cartridge.locale === 'zh'
    ? /(?:你(?:当场)?(?:支付|付了|交了|付清|结清)|你(?:用|拿出|掏出|交出)[^。！？]{0,28}(?:支付|付了|交了|付清|结清|全部花掉|全部花完|投入)|你[^。！？]{0,24}钱(?:币)?(?:(?:全|都)部|都)(?:花掉|花完|用光)|从你[^。！？]{0,16}扣除)/
    : /(?:you paid|you (?:used|took out|handed over).{0,32}(?:to pay|as payment|spent it all)|you spent.{0,32}(?:coins?|money)|was deducted from you)/i
  const promise = cartridge.locale === 'zh'
    ? /(?:如果|等你?|(?:完成|做完|搬完|送完|修完)[^。！？]{0,12}(?:(?:之后|以后)|后(?=[，,\s我你她他会将再])|再)|再?帮(?:我|忙)?)[^。！？]{0,48}(?:会|将|给你|付你|报酬|工钱)/
    : /(?:(?:\bif\b|\bwhen\b|\bafter\b).{0,64}(?:will pay|pay you|(?:wage|payment).{0,16}(?:will be|is due|becomes due))|\bhelp\b.{0,64}(?:i(?:'ll| will) pay|pay you)|\b(?:will|shall)\s+pay\b|\bwill\s+(?:receive|collect|get paid)\b)/i
  const completedTransfer = /(?:工作|任务|整理|搬运|装箱|修理|运送)[^。！？]{0,12}(?:完成|做完|搬完|送完|修完)后[，,][^。！？]{0,36}(?:递给你|交给你|付给你|给了你|塞给你|结清|收到)/
  const workContext = /(?:工作|短工|帮忙|干活|这份活|任务|报酬|工钱|薪水|工资|酬劳|搬|修|送|封好|装箱|work|job|shift|help|task|payment|pay|wages?|salary|compensation|repair|carry|deliver|pack)/i.test(prose)
  const receivedSentence = sentences.find((sentence) => (
    (currencyPattern.test(sentence) && received.test(sentence)) || compensationReceived.test(sentence)
  ) && !deniedReceipt.test(sentence) && !pendingReceipt.test(sentence)
    && (!promise.test(sentence) || (completedTransfer.test(sentence) && !/(?:等你|如果|会|将)/.test(sentence))))
  const spentSentence = sentences.find((sentence) => currencyPattern.test(sentence) && spent.test(sentence) && !promise.test(sentence))
  const promisedSentence = sentences.find((sentence) => (currencyPattern.test(sentence) || compensationPattern.test(sentence)) && promise.test(sentence))
  const widgets = parsed.commands.filter((command): command is WidgetCommand => command.type === 'widget' && command.id === 'coin')
  const additions = widgets.filter((command) => commandDelta(command) > 0)
  const removals = widgets.filter((command) => commandDelta(command) < 0)
  const jobs = parsed.commands.filter((command): command is JobCommand => command.type === 'job')
  const offers = jobs.filter((command) => command.action === 'offer')
  const settlements = jobs.filter((command) => command.action === 'settle')

  offers.forEach((offer) => {
    if (!offer.wage || !offer.label) violations.add('job.offer_requires_id_label_and_wage')
    const persisted = save.jobs.find((job) => job.id === offer.id)
    if (persisted && (persisted.wage !== offer.wage || persisted.label !== offer.label || persisted.status === 'settled' || persisted.status === 'cancelled')) violations.add('job.offer_cannot_rewrite_contract')
    const visibleAmount = promisedSentence ? exactCoinAmount(promisedSentence, cartridge.locale) : receivedSentence ? exactCoinAmount(receivedSentence, cartridge.locale) : undefined
    if (!visibleAmount || visibleAmount !== offer.wage) violations.add('job.offer_wage_must_be_visible_and_exact')
  })
  const promisedAmount = promisedSentence ? exactCoinAmount(promisedSentence, cartridge.locale) : undefined
  const matchingActiveContract = promisedAmount
    ? save.jobs.some((job) => job.wage === promisedAmount && (job.status === 'offered' || job.status === 'accepted'))
    : false
  if (promisedSentence && offers.length === 0 && !matchingActiveContract) violations.add('job.visible_offer_requires_contract')
  if (promisedSentence && additions.length) violations.add('payment.promise_must_not_credit_coin')
  if (receivedSentence) {
    const visibleAmount = exactCoinAmount(receivedSentence, cartridge.locale)
    if (!visibleAmount) violations.add('payment.completed_payment_requires_exact_amount')
    if (workContext && settlements.length === 0) violations.add('job.completed_work_requires_settlement')
    if (!workContext && settlements.length === 0 && (!visibleAmount || !additions.some((command) => commandDelta(command) === visibleAmount))) violations.add('payment.receipt_requires_matching_coin_add')
  } else if (settlements.length) violations.add('job.settlement_must_be_visible')
  settlements.forEach((settlement) => {
    const contract = jobForCommand(save, offers, settlement)
    if (!contract) violations.add('job.settlement_requires_contract')
    if (contract?.status === 'settled' || contract?.status === 'cancelled') violations.add('job.settlement_cannot_repeat')
    const visibleAmount = receivedSentence ? exactCoinAmount(receivedSentence, cartridge.locale) : undefined
    if (contract && visibleAmount !== contract.wage) violations.add('job.settlement_amount_must_match_contract')
  })
  if (settlements.length && additions.length) violations.add('job.settlement_must_not_duplicate_widget_credit')
  if (additions.length && !receivedSentence && settlements.length === 0) violations.add('payment.coin_add_requires_visible_receipt')
  if (spentSentence) {
    const visibleAmount = exactCoinAmount(spentSentence, cartridge.locale)
    if (!actionAuthorizesCoinSpend(action, cartridge.locale)) violations.add('payment.purchase_requires_player_authorization')
    if (!visibleAmount) violations.add('payment.completed_purchase_requires_exact_amount')
    if (!visibleAmount || !removals.some((command) => commandDelta(command) === -visibleAmount)) violations.add('payment.purchase_requires_matching_coin_remove')
    if (additions.length) violations.add('payment.purchase_must_not_credit_coin')
  }
  if (removals.length && !spentSentence) violations.add('payment.coin_remove_requires_visible_purchase')
  if (removals.length && !actionAuthorizesCoinSpend(action, cartridge.locale)) violations.add('payment.coin_remove_requires_player_authorization')
  return [...violations]
}

/** Recover a persisted turn that visibly completed payment but omitted the
 * settlement command, only when exactly one active exact-wage contract exists.
 * The repair is idempotent and never infers an amount from vague prose. */
export function repairUnsettledContractPayment<T extends {
  scene: number
  stats: Record<string, number>
  facts?: StorySave['facts']
  blocks: StorySave['blocks']
  jobs?: StorySave['jobs']
}>(candidate: T, cartridge: StoryCartridge): T {
  const jobs = candidate.jobs ?? []
  const active = jobs.filter((job) => job.status === 'offered' || job.status === 'accepted')
  const definition = cartridge.statDefinitions.find((stat) => stat.id === 'coin')
  if (!definition || active.length !== 1) return candidate
  let lastActionIndex = -1
  candidate.blocks.forEach((block, index) => { if (block.kind === 'event' && block.id.startsWith('action-')) lastActionIndex = index })
  if (lastActionIndex < 0) return candidate
  const tail = candidate.blocks.slice(lastActionIndex + 1)
  if (tail.some((block) => block.kind === 'change' && block.data?.stat === 'coin' && Number(block.data.delta) > 0)) return candidate
  const visible = tail
    .filter((block) => block.kind === 'narration' || block.kind === 'dialogue')
    .map((block) => block.text).join('\n')
  const { received, compensationReceived, deniedReceipt, pendingReceipt } = visiblePaymentSignals(cartridge.locale)
  const completedPaymentVisible = visible.split(/(?<=[。！？.!?])|\n+/).some((sentence) => (
    (currencyPattern.test(sentence) && received.test(sentence)) || compensationReceived.test(sentence)
  ) && !deniedReceipt.test(sentence) && !pendingReceipt.test(sentence))
  if (!completedPaymentVisible) return candidate
  const contract = active[0]
  const marker = `legacy-unsettled-contract-${contract.id}`
  if (candidate.facts?.[marker]) return candidate
  const before = Number(candidate.stats.coin ?? definition.initial)
  const wage = Math.min(contract.wage, definition.maxDelta ?? contract.wage)
  const coin = Math.min(definition.max, before + wage)
  const delta = coin - before
  return {
    ...candidate,
    stats: { ...candidate.stats, coin },
    facts: { ...(candidate.facts ?? {}), [marker]: true, jobs_completed: Number(candidate.facts?.jobs_completed ?? 0) + 1 },
    blocks: delta ? [...candidate.blocks, {
      id: `repair-payment-${candidate.scene}-${contract.id}`,
      kind: 'change' as const,
      text: `${definition.label} +${delta}`,
      data: { stat: 'coin', delta, jobId: contract.id },
    }] : candidate.blocks,
    jobs: jobs.map((job) => job.id === contract.id ? { ...job, status: 'settled' as const, settledAtScene: candidate.scene } : { ...job }),
  } as T
}
