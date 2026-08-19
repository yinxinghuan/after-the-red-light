import { listCartridges } from '../src/story/cartridges/index'
import { actionAuthorizesCoinSpend, canonicalizePaymentMetadata, exactCoinAmount, repairUnsettledContractPayment, validatePaymentConsistency } from '../src/story/engine/paymentConsistency'
import { parseStoryProtocol } from '../src/story/engine/protocol'
import { applyParsedScene, createInitialSave } from '../src/story/engine/reducer'
import type { StoryCartridge } from '../src/story/types'

function ok(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
function equal(actual: unknown, expected: unknown, message: string) { if (actual !== expected) throw new Error(`${message}: ${String(actual)} !== ${String(expected)}`) }

const source = listCartridges('zh')[0]
const cartridge = {
  ...source,
  statDefinitions: [
    { ...source.statDefinitions[0], id: 'coin', label: '钱币', min: 0, max: 999, initial: 6, display: 'number', maxDelta: 30 },
    source.statDefinitions[1], source.statDefinitions[2],
  ],
} as StoryCartridge
const initial = createInitialSave(cartridge)
equal(actionAuthorizesCoinSpend('把钱全部花完', 'zh'), false, 'a budget without a purchase object is not payment consent')
equal(actionAuthorizesCoinSpend('把钱花在房费上', 'zh'), true, 'an explicit purchase object can authorize spending')
equal(actionAuthorizesCoinSpend('spend all my money', 'en'), false, 'English budget-only input is not payment consent')
equal(actionAuthorizesCoinSpend('spend 3 coins on a ticket', 'en'), true, 'English spending with an object can authorize a purchase')
const offer = parseStoryProtocol('她说：“再帮我把木箱送上车，我付你八枚钱币。”\n[job: action="offer" id="crate-job" label="送木箱上车" employer="雇主" wage="8"]', 'zh')
equal(validatePaymentConsistency(initial, offer, cartridge).length, 0, 'valid offer contract')
const offered = applyParsedScene(initial, offer, cartridge, 'ask')
equal(offered.stats.coin, 6, 'offer is not payment')
const rewrite = parseStoryProtocol('她改口说付九枚钱币。\n[job: action="offer" id="crate-job" label="changed job" employer="employer" wage="9"]', 'zh')
ok(validatePaymentConsistency(offered, rewrite, cartridge).includes('job.offer_cannot_rewrite_contract'), 'persisted contract cannot be rewritten')
equal(applyParsedScene(offered, rewrite, cartridge, 'rewrite').jobs[0]?.wage, 8, 'reducer keeps original wage')
const settle = parseStoryProtocol('你完成工作，她把八枚钱币递给你。\n[job: action="settle" id="crate-job"]', 'zh')
equal(validatePaymentConsistency(offered, settle, cartridge).length, 0, 'valid settlement')
const settled = applyParsedScene(offered, settle, cartridge, 'finish')
equal(settled.stats.coin, 14, 'reducer credits recorded wage')
ok(validatePaymentConsistency(settled, settle, cartridge).includes('job.settlement_cannot_repeat'), 'repeat is rejected')
const vague = parseStoryProtocol('你完成装箱，她掏出几枚铜板递给你。', 'zh')
ok(validatePaymentConsistency(initial, vague, cartridge).includes('payment.completed_payment_requires_exact_amount'), 'vague settlement is rejected')
const vagueCompensation = parseStoryProtocol('这份体力活让你疲惫，但也赚得了些报酬。搬运结束，负责人递给你们报酬。', 'zh')
const vagueCompensationViolations = validatePaymentConsistency(initial, vagueCompensation, cartridge, '完成搬运')
ok(vagueCompensationViolations.includes('payment.completed_payment_requires_exact_amount'), 'vague compensation synonyms require an exact amount')
ok(vagueCompensationViolations.includes('job.completed_work_requires_settlement'), 'vague compensation synonyms require settlement metadata')
for (const phrase of ['你收到了今天的薪水。', '工头把工资交给你。', '你的工钱已经到账。', '负责人给你发了报酬。']) {
  ok(validatePaymentConsistency(initial, parseStoryProtocol(phrase, 'zh'), cartridge).includes('payment.completed_payment_requires_exact_amount'), `Chinese income synonym requires exact amount: ${phrase}`)
}
for (const phrase of ['You received your salary.', 'You got paid for the shift.', 'The foreman hands you the wages.', 'Your compensation was settled.']) {
  ok(validatePaymentConsistency(initial, parseStoryProtocol(phrase, 'en'), { ...cartridge, locale: 'en' }).includes('payment.completed_payment_requires_exact_amount'), `English income synonym requires exact amount: ${phrase}`)
}
const exactSalary = canonicalizePaymentMetadata(initial, parseStoryProtocol('装货结束后，你收到了八枚钱币的工资。', 'zh'), cartridge, '完成装货')
equal(validatePaymentConsistency(initial, exactSalary, cartridge, '完成装货').length, 0, 'exact salary synonym validates as paid work')
equal(applyParsedScene(initial, exactSalary, cartridge, '完成装货').stats.coin, 14, 'exact salary synonym credits coin')
equal(validatePaymentConsistency(initial, parseStoryProtocol('询问不会替你接受工作，也不会提前获得报酬。', 'zh'), cartridge).length, 0, 'denied compensation is not a receipt')
equal(validatePaymentConsistency(initial, parseStoryProtocol('媛夕领到了她自己的工钱，你没有参与。', 'zh'), cartridge).length, 0, 'NPC compensation is not player income')
equal(validatePaymentConsistency(initial, parseStoryProtocol('No shift or payment is committed until you finish the work.', 'en'), { ...cartridge, locale: 'en' }, 'en').length, 0, 'shift must not trigger the substring if')

equal(exactCoinAmount('她递给你八枚铜币。', 'zh'), 8, '铜币 is recognized as a localized coin unit')
const implicitWorkPayment = canonicalizePaymentMetadata(initial, parseStoryProtocol('整理工作完成后，她从布袋里数出八枚铜币递给你。', 'zh'), cartridge, '整理药草箱')
equal(validatePaymentConsistency(initial, implicitWorkPayment, cartridge).length, 0, 'exact visible work payment receives deterministic metadata')
const paidWork = applyParsedScene(initial, implicitWorkPayment, cartridge, '整理药草箱')
equal(paidWork.stats.coin, 14, 'exact visible work payment is credited once')
equal(paidWork.jobs.filter((job) => job.status === 'settled').length, 1, 'implicit paid work persists a settled contract')

const implicitGift = canonicalizePaymentMetadata(initial, parseStoryProtocol('她感谢你的提醒，给了你四枚铜币。', 'zh'), cartridge, '提醒她检查账本')
equal(validatePaymentConsistency(initial, implicitGift, cartridge).length, 0, 'exact non-work receipt receives matching widget metadata')
equal(applyParsedScene(initial, implicitGift, cartridge, '提醒').stats.coin, 10, 'exact non-work receipt credits coin')

const implicitPurchase = canonicalizePaymentMetadata(initial, parseStoryProtocol('你当场支付了两枚铜币，收下船票。', 'zh'), cartridge, '购买船票')
equal(validatePaymentConsistency(initial, implicitPurchase, cartridge, '购买船票').length, 0, 'authorized purchase validates')
equal(applyParsedScene(initial, implicitPurchase, cartridge, '购买船票').stats.coin, 4, 'exact purchase removes coin')

const screenshotPurchase = parseStoryProtocol('你用这枚硬币支付了旅店房费。\n[widget: coin, add: 1]', 'zh')
const screenshotViolations = validatePaymentConsistency(initial, screenshotPurchase, cartridge, '寻找住宿')
ok(screenshotViolations.includes('payment.purchase_requires_player_authorization'), 'looking for lodging is not consent to pay')
ok(screenshotViolations.includes('payment.purchase_must_not_credit_coin'), 'a completed purchase can never credit coin')
const correctedScreenshot = canonicalizePaymentMetadata(initial, screenshotPurchase, cartridge, '支付房费')
equal(validatePaymentConsistency(initial, correctedScreenshot, cartridge, '支付房费').length, 0, 'authorized singular payment is canonicalized to a removal')
equal(applyParsedScene(initial, correctedScreenshot, cartridge, '支付房费').stats.coin, 5, 'authorized singular payment removes one coin')

const inventedRemoval = parseStoryProtocol('店主告诉你还有空房。\n[widget: coin, remove: 2]', 'zh')
ok(validatePaymentConsistency(initial, inventedRemoval, cartridge, '询问房价').includes('payment.coin_remove_requires_player_authorization'), 'metadata cannot spend without visible player consent')
ok(validatePaymentConsistency(initial, inventedRemoval, cartridge, '支付房费').includes('payment.coin_remove_requires_visible_purchase'), 'authorized action still needs a visible completed purchase')
const inventedIncome = parseStoryProtocol('人群仍在等待通知。\n[widget: coin, add: 1]', 'zh')
ok(validatePaymentConsistency(initial, inventedIncome, cartridge, '等待通知').includes('payment.coin_add_requires_visible_receipt'), 'metadata cannot mint coin without a visible receipt')
const underspecifiedSpend = parseStoryProtocol('你把身上的六枚钱币全部花完了。\n[widget: coin, remove: 6]', 'zh')
ok(validatePaymentConsistency(initial, underspecifiedSpend, cartridge, '把钱全部花完').includes('payment.purchase_requires_player_authorization'), 'budget-only spending prose is rejected before commit')

const promiseOnly = canonicalizePaymentMetadata(initial, parseStoryProtocol('等你搬完箱子后，我会付你八枚铜币。', 'zh'), cartridge, '询问短工')
equal(promiseOnly.commands.filter((command) => command.type === 'widget' && command.id === 'coin').length, 0, 'promise never credits coin')
ok(promiseOnly.commands.some((command) => command.type === 'job' && command.action === 'offer'), 'exact promise creates a persisted offer')

for (const phrase of [
  '你准备领取八枚钱币的工钱，但负责人还没有验收。',
  '负责人稍后会把八枚钱币递给你。',
  '八枚钱币将由负责人在明早支付给你。',
]) {
  const pending = canonicalizePaymentMetadata(offered, parseStoryProtocol(phrase, 'zh'), cartridge, '确认结算时间')
  equal(pending.commands.some((command) => command.type === 'job' && command.action === 'settle'), false, `future Chinese wage cannot settle early: ${phrase}`)
  equal(repairUnsettledContractPayment({ ...offered, blocks: [...offered.blocks, { id: 'action-pending', kind: 'event' as const, text: '确认结算时间' }, { id: 'pending-prose', kind: 'narration' as const, text: phrase }] }, cartridge).stats.coin, 6, `legacy repair cannot credit a future Chinese wage: ${phrase}`)
}

const englishCartridge = { ...cartridge, locale: 'en' as const }
const englishInitial = createInitialSave(englishCartridge)
const englishOffer = parseStoryProtocol('The supervisor says the completed packing work will pay you 8 coins.\n[job: action="offer" id="english-crates" label="Pack three cases" employer="Supervisor" wage="8"]', 'en')
const englishOffered = applyParsedScene(englishInitial, englishOffer, englishCartridge, 'Ask about packing work')
for (const phrase of [
  'The supervisor plans to hand you 8 coins as wages tomorrow.',
  'You are about to receive 8 coins as salary.',
  'She hands you 8 coins tomorrow after the ledger closes.',
]) {
  const pending = canonicalizePaymentMetadata(englishOffered, parseStoryProtocol(phrase, 'en'), englishCartridge, 'Confirm the settlement time')
  equal(pending.commands.some((command) => command.type === 'job' && command.action === 'settle'), false, `future English wage cannot settle early: ${phrase}`)
}

const legacyUnsettled = {
  ...offered,
  scene: offered.scene + 1,
  blocks: [
    ...offered.blocks,
    { id: `action-${offered.scene + 1}`, kind: 'event' as const, text: '完成送箱工作' },
    { id: 'legacy-visible-payment', kind: 'narration' as const, text: '你完成送箱工作，雇主把八枚钱币递给你作为工钱。' },
  ],
}
const repairedLegacyPayment = repairUnsettledContractPayment(legacyUnsettled, cartridge)
equal(repairedLegacyPayment.stats.coin, 14, 'one unambiguous legacy contract is settled from exact visible payment')
equal(repairedLegacyPayment.jobs[0]?.status, 'settled', 'legacy repair settles the matching contract')
equal(repairUnsettledContractPayment(repairedLegacyPayment, cartridge).stats.coin, 14, 'legacy payment repair is idempotent')

console.log('payment consistency ok · player consent required · spend direction enforced · exact receipts canonicalized · settlement atomic · legacy exact contract repaired')
