import { useCallback, useEffect, useRef, useState } from 'react'
import { useGenImage } from '../shared/runtime/useGenImage'
import { createMediaRequestId, MediaServiceError } from '../shared/runtime/media'
import { useGameSave } from '../shared/save/useGameSave'
import { aigramAdapter } from './adapters/aigram'
import { mockAdapter } from './adapters/mock'
import { remoteAdapter } from './adapters/remote'
import { resolveCartridge } from './cartridges'
import { applyConsistencyRecovery, applyConsistencyRecoverySelection, applyDisplayedRouteFallback, applyParsedScene, createChoiceRecordBlock, createImageBlock, createInitialSave, createRecoveryChoices, localizeKnownState, normalizeCharacterState, repairLegacyConsistencyRecovery, repairLegacyObjectiveRecoveryChoices, resolveConsistencyRecoverySelection, restoreDeterministicRecoveryChoice, updateCharacterVisualIdentity, updateImageBlock, updateInventoryItemImage } from './engine/reducer'
import { isStoryProtocolResidue, parseStoryProtocol } from './engine/protocol'
import { bindChoiceDestinations, canCommitDisplayedChoiceWithoutGeneratedReplies, inferActionDestination, repairPersistedMapRouteHints } from './engine/turnConsistency'
import { prepareTurnCandidate } from './engine/turnPipeline'
import { shouldUsePlayerImageReference, upgradePendingSceneImagePrompts } from './engine/imageDirector'
import { buildDangerDirective, createDangerFallbackScene, normalizeDangerState, repairLegacyDangerLoopChoices, repairLegacyDangerMethodChoices } from './engine/dangerDirector'
import { activeStatFloorRule, domainSuppressesDanger, repairDomainRepeatState, repairEndedSessionChoices, repairLegacyDomainChoiceReset, resolveDomainAction, statFloorChoices, syncDomainDerivedState } from './engine/domainRules'
import { repairUnsettledContractPayment } from './engine/paymentConsistency'
import { resolveDeterministicChoiceTurn, resolveDeterministicOpeningTurn } from './engine/authoredTurns'
import { resolvePresetEventTurn } from './engine/presetEventDirector'
import { t } from './i18n'
import { ITEM_IMAGE_STYLE_VERSION, type AdapterProgress, type InventoryItem, type Locale, type StoryArchive, type StoryCartridge, type StoryMode, type StorySave } from './types'
import { recordAuthorityShadowSample } from './engine/authorityShadow'

type LegacyStorySave = Omit<StorySave, 'version' | 'locale' | 'characters' | 'partyMemberIds' | 'danger' | 'decisionContext' | 'jobs'> & {
  version?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
  decisionContext?: string
  locale?: Locale
  characters?: StorySave['characters']
  partyMemberIds?: StorySave['partyMemberIds']
  danger?: Partial<StorySave['danger']>
  jobs?: StorySave['jobs']
  imageUrl?: string
  imageStatus?: 'idle' | 'queued' | 'generating' | 'ready' | 'failed'
  imagePrompt?: string
}

type PersistedStoryData = StoryArchive | LegacyStorySave

function isArchive(candidate: PersistedStoryData | null | undefined): candidate is StoryArchive {
  return Boolean(candidate && 'worlds' in candidate && candidate.worlds && typeof candidate.worlds === 'object')
}

function readLegacyLocal(cartridgeId: string): LegacyStorySave | null {
  try {
    const raw = alteruLocalStorage.getItem(`stateful-story-${cartridgeId}-save`)
    return raw ? JSON.parse(raw) as LegacyStorySave : null
  } catch { return null }
}

function repairMockLoop(candidate: LegacyStorySave, cartridge: StoryCartridge): LegacyStorySave {
  const fallbackIndexes = new Set<number>()
  candidate.blocks.forEach((block, index) => {
    if (block.kind === 'narration' && /世界没有关闭，只是把新的线索推到下一页|world does not close; it carries a new clue onto the next page/i.test(block.text)) fallbackIndexes.add(index)
  })
  if (fallbackIndexes.size === 0) return candidate
  const blocks = candidate.blocks.filter((block, index) => !fallbackIndexes.has(index) && !(block.kind === 'event' && block.id.startsWith('action-') && fallbackIndexes.has(index + 1)))
  return {
    ...candidate,
    blocks,
    scene: Math.max(0, candidate.scene - fallbackIndexes.size),
    choices: [{ id: `recovered-${candidate.scene}`, label: cartridge.copy.continue }],
    sessionEnded: false,
    lastActionId: undefined,
  }
}

function recoverPersistedChoices(candidate: LegacyStorySave, cartridge: StoryCartridge): LegacyStorySave {
  const existing = candidate.choices ?? []
  const isGenericFallback = existing.length === 1 && existing[0].label === cartridge.copy.continue
  if (existing.length > 1 || (existing.length === 1 && !isGenericFallback)) return candidate
  let lastActionIndex = -1
  candidate.blocks.forEach((block, index) => { if (block.kind === 'event' && block.id.startsWith('action-')) lastActionIndex = index })
  const tail = candidate.blocks.slice(lastActionIndex + 1).filter((block) => block.kind !== 'image' && block.kind !== 'choices').map((block) => block.text).join('\n')
  const parsed = parseStoryProtocol(tail, candidate.locale ?? cartridge.locale)
  const recovered = parsed.commands.find((command) => command.type === 'choices')
  if (!recovered || recovered.type !== 'choices' || recovered.choices.length < 1) return candidate
  const labels = new Set(recovered.choices)
  const optionLine = /^\s*(?:(?:选项|选择|行动)\s*[一二三四五\dA-Ea-e]+\s*[：:.、)]|(?:\d{1,2}|[A-Ea-e]|[一二三四五])\s*[.、:：)]|[①②③④⑤]|[-*•])\s*(.+?)\s*$/
  const blocks = candidate.blocks.filter((block, index) => {
    if (index <= lastActionIndex || block.kind !== 'narration') return true
    const label = block.text.match(optionLine)?.[1]?.replace(/[。.;；]+$/, '').trim()
    return !label || !labels.has(label)
  })
  return {
    ...candidate,
    blocks,
    choices: recovered.choices.map((label, index) => ({ id: `recovered-choice-${candidate.scene}-${index}`, label })),
  }
}

export function normalizeSave(candidate: LegacyStorySave | null | undefined, cartridge: StoryCartridge, incomingChatId?: string): StorySave {
  if (!candidate || candidate.cartridgeId !== cartridge.id || !Array.isArray(candidate.blocks)) return createInitialSave(cartridge, incomingChatId)
  if (incomingChatId && candidate.remoteChatId && candidate.remoteChatId !== incomingChatId) return createInitialSave(cartridge, incomingChatId)
  const consistencyRepaired = repairLegacyConsistencyRecovery(repairUnsettledContractPayment(
    recoverPersistedChoices(repairMockLoop(candidate, cartridge), cartridge), cartridge,
  ), cartridge)
  const repaired = repairLegacyDangerLoopChoices({
    ...consistencyRepaired,
    danger: normalizeDangerState(consistencyRepaired.danger),
  }, cartridge)
  let blocks = repaired.blocks.filter((block) => !(block.kind === 'narration' && isStoryProtocolResidue(block.text)))
  if (!blocks.some((block) => block.kind === 'image')) {
    const legacyPrompt = repaired.imagePrompt?.trim() ?? ''
    const canRestoreImage = repaired.scene === 0 || Boolean(legacyPrompt || repaired.imageUrl)
    if (canRestoreImage) {
      const prompt = legacyPrompt || (repaired.scene === 0 ? cartridge.opening.imagePrompt : '')
      const status = repaired.imageUrl
        ? 'ready'
        : repaired.imageStatus === 'generating'
          ? 'queued'
          : repaired.imageStatus || (repaired.entered && prompt ? 'queued' : 'idle')
      blocks = [...blocks, createImageBlock(`image-${repaired.scene}`, repaired.sceneLocation ?? repaired.location, prompt, status, repaired.imageUrl)]
    }
  }
  const initialItems = new Map(cartridge.initialInventory.map((item) => [item.id, item]))
  const inventory = (repaired.inventory ?? cartridge.initialInventory).map((item) => {
    const definition = initialItems.get(item.id)
    return {
      ...definition, ...item,
      detail: item.detail ?? definition?.detail, effect: item.effect ?? definition?.effect, lore: item.lore ?? definition?.lore,
      metrics: item.metrics ?? definition?.metrics, imagePrompt: item.imagePrompt ?? definition?.imagePrompt,
      imageStatus: item.imageStatus === 'generating' ? 'queued' : item.imageStatus ?? (item.imageUrl ? 'ready' : 'idle'),
    }
  })
  const initialPlaces = new Map(cartridge.initialMap.map((node) => [node.id, node]))
  const map = repairPersistedMapRouteHints((repaired.map ?? cartridge.initialMap).map((node) => {
    const definition = initialPlaces.get(node.id)
    return {
      ...definition, ...node,
      visited: node.visited ?? Boolean(node.current || node.id.startsWith('map-')),
      detail: node.detail ?? definition?.detail, lore: node.lore ?? definition?.lore, facts: node.facts ?? definition?.facts,
    }
  }), repaired.sceneLocation ?? repaired.location, repaired.blocks, cartridge)
  const characterState = normalizeCharacterState(repaired, cartridge)
  let normalized = repairLegacyDomainChoiceReset(repairEndedSessionChoices(repairDomainRepeatState({
    ...repaired, ...characterState, version: 10, locale: repaired.locale ?? cartridge.locale,
    sceneLocation: repaired.sceneLocation ?? repaired.location,
    decisionContext: repaired.version === 9 || repaired.version === 10 ? repaired.decisionContext ?? '' : '',
    remoteChatId: incomingChatId || repaired.remoteChatId, blocks, inventory, map,
    danger: normalizeDangerState(repaired.danger), jobs: (repaired.jobs ?? []).map((job) => ({ ...job })),
    facts: { ...(cartridge.initialFacts ?? {}), ...(repaired.facts ?? {}) },
  } as StorySave, cartridge)), cartridge)
  normalized = repairLegacyDangerMethodChoices(normalized, cartridge)
  normalized = restoreDeterministicRecoveryChoice(normalized, cartridge)
  normalized = repairLegacyObjectiveRecoveryChoices(normalized, cartridge)
  if (!normalized.sessionEnded && normalized.choices.length === 0) normalized.choices = createRecoveryChoices(normalized, cartridge)
  const floor = activeStatFloorRule(normalized, cartridge)
  if (!normalized.sessionEnded && floor) {
    normalized.choices = statFloorChoices(normalized, cartridge) ?? normalized.choices
    const noticeId = `stat-floor-${floor.definition.id}-restored`
    if (!normalized.blocks.some((block) => block.id === noticeId)) normalized.blocks = [
      ...normalized.blocks,
      { id: noticeId, kind: 'event', text: floor.rule.enteredText, data: { statFloor: floor.definition.id, restored: 'true' } },
    ]
    normalized.blocks = normalized.blocks.filter((block) => block.id !== `choices-${normalized.scene}`)
  }
  if (!normalized.sessionEnded && normalized.choices.length) normalized.choices = bindChoiceDestinations(normalized.choices, normalized, cartridge)
  if (!normalized.sessionEnded && normalized.choices.length && !normalized.blocks.some((block) => block.id === `choices-${normalized.scene}`)) {
    normalized.blocks = [...normalized.blocks, createChoiceRecordBlock(normalized.scene, normalized.choices)]
  }
  return upgradePendingSceneImagePrompts(syncDomainDerivedState(normalized, cartridge), cartridge)
}

function inventoryImagePrompt(item: InventoryItem, cartridge: StoryCartridge): string {
  const direction = cartridge.itemImageDirection ?? 'elegant in-world artifact study with tactile natural materials and restrained directional light'
  const content = item.imagePrompt ?? `A single inventory object from ${cartridge.copy.title}: ${item.label}. ${item.detail ?? ''} ${item.effect ?? ''} ${item.lore ?? ''}`
  return `Create an inventory artifact plate for ${cartridge.copy.title}. Content brief: ${content}. Art direction: ${direction}. Follow only this text-defined medium, line treatment, palette, surface texture, lighting contrast, and degree of realism. Do not borrow any location, landmark, character, composition, or prop from the game's cover or opening scene. One object or one tightly grouped item set only, centered still life, square composition, no people, no hands, no text, no letters, no labels, no logo, no UI.`
}

export function useStoryEngine(cartridge: StoryCartridge, initialMode: StoryMode, incomingChatId?: string, imageIdentity: { ready: boolean; refUrl?: string } = { ready: true }) {
  const cloud = useGameSave<PersistedStoryData>('after-the-red-light')
  const [save, setSave] = useState<StorySave>(() => createInitialSave(cartridge, incomingChatId))
  const [mode, setMode] = useState<StoryMode>(initialMode)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<AdapterProgress | null>(null)
  const [error, setError] = useState('')
  const [pendingAction, setPendingAction] = useState('')
  const [failedAction, setFailedAction] = useState<{ action: string; locale: Locale } | null>(null)
  const seeded = useRef(false)
  const imageAttempt = useRef('')
  const imageBusy = useRef(false)
  const lastImageCallAt = useRef(0)
  const [imageWorkerTick, setImageWorkerTick] = useState(0)
  const saveRef = useRef(save)
  const archiveRef = useRef<StoryArchive>({ version: 1, worlds: {} })
  const { generate, resolveTaskUrl } = useGenImage()
  const persist = cloud.persist

  useEffect(() => {
    recordAuthorityShadowSample(save, cartridge)
  }, [cartridge, save])

  useEffect(() => {
    if (!cloud.loaded || seeded.current) return
    seeded.current = true
    const stored = cloud.savedData
    const archive: StoryArchive = isArchive(stored)
      ? { ...stored, worlds: { ...stored.worlds } }
      : { version: 1, worlds: stored?.cartridgeId ? { [stored.cartridgeId]: stored as StorySave } : {} }
    const legacyLocal = archive.worlds[cartridge.id] ? null : readLegacyLocal(cartridge.id)
    const next = normalizeSave(archive.worlds[cartridge.id] as LegacyStorySave | undefined || legacyLocal, cartridge, incomingChatId)
    const nextArchive: StoryArchive = { ...archive, version: 1, worlds: { ...archive.worlds, [cartridge.id]: next } }
    archiveRef.current = nextArchive
    saveRef.current = next
    setSave(next)
    if (next.remoteChatId) {
      setMode('remote')
      const url = new URL(window.location.href)
      if (url.searchParams.get('chat_id') !== next.remoteChatId) {
        url.searchParams.set('chat_id', next.remoteChatId)
        window.history.replaceState({}, '', url)
      }
    }
    if (stored || legacyLocal || incomingChatId) persist(nextArchive)
  }, [cartridge, cloud.loaded, cloud.savedData, incomingChatId, persist])

  const commit = useCallback((recipe: StorySave | ((current: StorySave) => StorySave)) => {
    setSave((current) => {
      const next = typeof recipe === 'function' ? recipe(current) : recipe
      saveRef.current = next
      const archive = archiveRef.current
      const nextArchive: StoryArchive = { ...archive, version: 1, worlds: { ...archive.worlds, [cartridge.id]: next } }
      archiveRef.current = nextArchive
      persist(nextArchive)
      return next
    })
  }, [cartridge.id, persist])

  const queuedSceneImage = save.blocks.find((block) => block.kind === 'image' && block.data?.status === 'queued')
  const queuedItemImage = save.inventory.find((item) => item.imageStatus === 'queued')
  const queuedImageKey = queuedSceneImage ? `scene:${queuedSceneImage.id}` : queuedItemImage ? `item:${queuedItemImage.id}` : ''

  useEffect(() => {
    if (!save.entered || !queuedImageKey || imageBusy.current || imageAttempt.current === queuedImageKey) return
    const isScene = Boolean(queuedSceneImage)
    if (isScene && !imageIdentity.ready) return
    const prompt = queuedSceneImage ? String(queuedSceneImage.data?.prompt ?? '') : queuedItemImage ? inventoryImagePrompt(queuedItemImage, cartridge) : ''
    if (!prompt) return
    imageBusy.current = true
    imageAttempt.current = queuedImageKey
    const entityId = queuedSceneImage?.id ?? queuedItemImage!.id
    const identityCharacterId = isScene ? String(queuedSceneImage?.data?.identityCharacterId ?? '') : ''
    const identityCharacter = identityCharacterId ? save.characters.find((character) => character.id === identityCharacterId) : undefined
    const identity = identityCharacter?.visualIdentity
    const anchoringIdentity = Boolean(identityCharacter && identity && !identity.anchorTaskId)
    if (anchoringIdentity) commit((current) => updateCharacterVisualIdentity(current, identityCharacterId, { status: 'generating' }))
    commit((current) => isScene
      ? updateImageBlock(current, entityId, { status: 'generating' })
      : updateInventoryItemImage(current, entityId, { status: 'generating' }))
    ;(async () => {
      let anchorSucceeded = Boolean(identity?.anchorTaskId)
      const generateWithRetry = async (input: { prompt: string; ref_url?: string; width?: number; height?: number }, stableRequestId: string) => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const gap = Math.max(0, 3000 - (Date.now() - lastImageCallAt.current))
            if (gap) await new Promise((resolve) => window.setTimeout(resolve, gap))
            lastImageCallAt.current = Date.now()
            return await generate({ ...input, requestId: stableRequestId })
          } catch (cause) {
            const retryable = cause instanceof MediaServiceError && cause.retryable
            if (!retryable || attempt === 2) throw cause
            await new Promise((resolve) => window.setTimeout(resolve, (cause.retryAfterSeconds ?? (attempt === 0 ? 3 : 8)) * 1000))
          }
        }
        throw new Error('media retry loop exhausted')
      }
      try {
        const visibility = queuedSceneImage?.data?.playerVisible
        const usePlayerReference = Boolean(isScene && imageIdentity.refUrl && (visibility === 'true' || (visibility !== 'false' && shouldUsePlayerImageReference(prompt))))
        const npcIdentityContract = identityCharacter && identity
          ? `HARD FULL-VISUAL-IDENTITY CAST MAP. REFERENCE IMAGE OVERRIDES ALL GENERIC CHARACTER WORDS. SUBJECT A is ${identityCharacter.name}, the one dominant named adult in this frame. Preserve SUBJECT A's complete visible identity, facial geometry, age presentation, silhouette, proportions, skin tone, hairstyle, signature palette, clothing language and distinguishing details. Immutable traits: ${identity.immutableTraits.join('; ')}. Wardrobe language: ${identity.wardrobe.join('; ')}. Forbidden drift: ${identity.forbiddenDrift.join('; ')}. Do not transfer SUBJECT A's traits to any other person, reflection, animal or object.`
          : ''
        let npcReferenceUrl = identity?.anchorTaskId ? await resolveTaskUrl(identity.anchorTaskId) : ''
        if (anchoringIdentity && identityCharacter && identity && !usePlayerReference) {
          const anchorPrompt = `${identity.appearance}. CANONICAL IDENTITY ANCHOR: exactly one clearly adult person, waist-up three-quarter view, simple quiet background, complete hairstyle and signature accessories visible, neutral reserved posture, no story action, no props in hands, no other people, no lettering, no signs, no logos, no UI.`
          const anchor = await generateWithRetry({ prompt: anchorPrompt, width: 512, height: 640 }, createMediaRequestId())
          npcReferenceUrl = anchor.url
          anchorSucceeded = true
          if (imageAttempt.current === queuedImageKey) commit((current) => updateCharacterVisualIdentity(current, identityCharacterId, { status: 'anchored', anchorTaskId: anchor.taskId }))
        }
        const useNpcReference = Boolean(identityCharacter && identity && npcReferenceUrl && !usePlayerReference)
        const identityPrompt = usePlayerReference
          ? `HARD FULL-VISUAL-IDENTITY CAST MAP. REFERENCE IMAGE OVERRIDES ALL GENERIC CHARACTER WORDS. SUBJECT A is the one and only player protagonist and the dominant visible actor performing the scene's main action. Preserve SUBJECT A's complete visible reference identity—not merely the face—including silhouette, form or species, body proportions, material, head shape, face visibility, covering, mask, costume, colors, patterns and accessories. Any face, skin, hair, hands, arms or legs not visible in the reference MUST NOT be invented and MUST remain hidden. Do not transfer SUBJECT A's traits to other people, animals or objects. CURRENT SCENE: ${prompt}`
          : useNpcReference ? `${npcIdentityContract} CURRENT SCENE: ${prompt}` : prompt
        const generated = await generateWithRetry(usePlayerReference
          ? { prompt: identityPrompt, ref_url: imageIdentity.refUrl }
          : useNpcReference ? { prompt: identityPrompt, ref_url: npcReferenceUrl } : { prompt: identityPrompt }, createMediaRequestId())
        if (imageAttempt.current === queuedImageKey) commit((current) => isScene
          ? updateImageBlock(current, entityId, { status: 'ready', url: generated.url })
          : updateInventoryItemImage(current, entityId, { status: 'ready', url: generated.url, styleVersion: ITEM_IMAGE_STYLE_VERSION }))
      } catch {
        if (imageAttempt.current === queuedImageKey) commit((current) => isScene
          ? updateImageBlock(identityCharacterId && anchoringIdentity && !anchorSucceeded ? updateCharacterVisualIdentity(current, identityCharacterId, { status: 'failed' }) : current, entityId, { status: 'failed' })
          : updateInventoryItemImage(current, entityId, { status: 'failed' }))
      } finally {
        imageBusy.current = false
        setImageWorkerTick((tick) => tick + 1)
      }
    })()
  }, [cartridge, commit, generate, imageIdentity.ready, imageIdentity.refUrl, imageWorkerTick, queuedImageKey, queuedItemImage, queuedSceneImage, resolveTaskUrl, save.characters, save.entered])

  const enter = useCallback(() => commit((current) => {
    const openingImage = current.blocks.find((block) => block.kind === 'image')
    const entered = { ...current, locale: cartridge.locale, entered: true }
    return openingImage && openingImage.data?.status === 'idle' ? updateImageBlock(entered, openingImage.id, { status: 'queued' }) : entered
  }), [cartridge.locale, commit])

  const act = useCallback(async (action: string, actionLocale: Locale = cartridge.locale) => {
    if (!action.trim() || busy) return
    const normalizedAction = action.trim()
    const activeCartridge = resolveCartridge(cartridge.id, actionLocale)
    setBusy(true); setError(''); setFailedAction(null); setPendingAction(normalizedAction); setProgress({ label: t(actionLocale, 'actionWritten'), percent: 8 })
    try {
      const adapter = mode === 'remote' ? remoteAdapter : mode === 'aigram' ? aigramAdapter : mockAdapter
      const base = localizeKnownState(saveRef.current, cartridge, activeCartridge)
      const selectedDisplayedChoice = base.choices.find((choice) => choice.label.trim() === normalizedAction)
      const displayedRouteDestination = selectedDisplayedChoice
        ? (selectedDisplayedChoice.targetLocationId
            ? base.map.find((node) => node.id === selectedDisplayedChoice.targetLocationId)
              ?? activeCartridge.initialMap.find((node) => node.id === selectedDisplayedChoice.targetLocationId)
            : undefined)
          ?? inferActionDestination(base, activeCartridge, normalizedAction)
        : undefined
      const recoverySelection = resolveConsistencyRecoverySelection(base, activeCartridge, normalizedAction)
      if (recoverySelection) {
        commit((current) => applyConsistencyRecoverySelection(
          localizeKnownState(current, cartridge, activeCartridge), activeCartridge, normalizedAction, recoverySelection,
        ))
        setPendingAction('')
        setProgress(null)
        return
      }
      const domainResolution = resolveDomainAction(base, activeCartridge, normalizedAction)
      const authoredOpeningTurn = domainResolution ? undefined : resolveDeterministicOpeningTurn(base, activeCartridge, normalizedAction)
      const authoredChoiceTurn = domainResolution || authoredOpeningTurn ? undefined : resolveDeterministicChoiceTurn(base, activeCartridge, normalizedAction)
      const authoredOwnsCalmTurn = base.danger.phase === 'calm' && Boolean(authoredOpeningTurn || authoredChoiceTurn)
      const scheduledDanger = domainResolution?.status === 'rejected'
        || domainSuppressesDanger(domainResolution)
        || authoredOwnsCalmTurn
        ? undefined
        : buildDangerDirective(base, activeCartridge, normalizedAction)
      const presetEventResolution = domainResolution || authoredOpeningTurn || authoredChoiceTurn || scheduledDanger
        ? undefined
        : resolvePresetEventTurn(base, activeCartridge, normalizedAction)
      const authoredTurn = authoredOpeningTurn ?? authoredChoiceTurn ?? presetEventResolution?.turn
      const dangerDirective = presetEventResolution ? undefined : scheduledDanger
      let result = domainResolution
        ? { content: domainResolution.status === 'accepted' ? domainResolution.successText : domainResolution.reasons.join(activeCartridge.locale === 'zh' ? '；' : '; ') }
        : authoredTurn
          ? { content: authoredTurn.content, imagePrompt: authoredTurn.imagePrompt, imageSubject: authoredTurn.imageSubject, imageCharacterId: authoredTurn.imageCharacterId }
        : await adapter.send(normalizedAction, { cartridge: activeCartridge, save: base, actionId: normalizedAction, locale: actionLocale, dangerDirective }, setProgress)
      let parsed = domainResolution?.status === 'accepted'
        && domainResolution.dangerPolicy === 'advance'
        && dangerDirective
        ? createDangerFallbackScene(base, activeCartridge, dangerDirective)
        : parseStoryProtocol(result.content, actionLocale)
      if (!domainResolution) {
        let prepared = prepareTurnCandidate({
          save: base, parsed, cartridge: activeCartridge, action: normalizedAction,
          imagePrompt: result.imagePrompt, dangerDirective, trustedAuthored: Boolean(authoredTurn), skipTurnValidation: mode === 'demo',
        })
        parsed = prepared.parsed
        if (prepared.discardedImage) result = { ...result, imagePrompt: undefined, imageSubject: undefined, imageCharacterId: undefined }
        const violations = prepared.violations
        if (violations.length) {
          setProgress({ label: t(actionLocale, 'checkingState'), percent: 82 })
          if (authoredTurn) throw new Error(`invalid deterministic turn: ${violations.join(', ')}`)
          if (prepared.canCommitWithoutReplies) {
            commit((current) => applyParsedScene(
              localizeKnownState(current, cartridge, activeCartridge), parsed, activeCartridge, normalizedAction,
              result.imagePrompt, result.imageSubject, dangerDirective, undefined, result.imageCharacterId, presetEventResolution,
            ))
            setPendingAction('')
            setProgress(null)
            return
          }
          result = await adapter.send(normalizedAction, {
            cartridge: activeCartridge, save: base, actionId: normalizedAction, locale: actionLocale, dangerDirective,
            repair: { draft: result.content, violations },
          }, setProgress)
          parsed = parseStoryProtocol(result.content, actionLocale)
          prepared = prepareTurnCandidate({
            save: base, parsed, cartridge: activeCartridge, action: normalizedAction,
            imagePrompt: result.imagePrompt, dangerDirective, skipTurnValidation: mode === 'demo',
          })
          parsed = prepared.parsed
          if (prepared.discardedImage) result = { ...result, imagePrompt: undefined, imageSubject: undefined, imageCharacterId: undefined }
          const remaining = prepared.violations
          if (remaining.length) {
            if (prepared.canCommitWithoutReplies
              || canCommitDisplayedChoiceWithoutGeneratedReplies(base, activeCartridge, normalizedAction, remaining)) {
              commit((current) => applyParsedScene(
                localizeKnownState(current, cartridge, activeCartridge), parsed, activeCartridge, normalizedAction,
                result.imagePrompt, result.imageSubject, dangerDirective, undefined, result.imageCharacterId, presetEventResolution,
              ))
              setPendingAction('')
              setProgress(null)
              return
            }
            if (dangerDirective) {
              commit((current) => applyParsedScene(
                localizeKnownState(current, cartridge, activeCartridge),
                createDangerFallbackScene(base, activeCartridge, dangerDirective),
                activeCartridge,
                normalizedAction,
                undefined,
                undefined,
                dangerDirective,
              ))
              setPendingAction('')
              setProgress(null)
              return
            }
            if (displayedRouteDestination && base.danger.phase === 'calm') {
              commit((current) => applyDisplayedRouteFallback(
                localizeKnownState(current, cartridge, activeCartridge), activeCartridge, normalizedAction, displayedRouteDestination,
              ))
              setPendingAction('')
              setProgress(null)
              return
            }
            commit((current) => applyConsistencyRecovery(localizeKnownState(current, cartridge, activeCartridge), activeCartridge, normalizedAction))
            setPendingAction('')
            setProgress(null)
            return
          }
        }
      }
      commit((current) => applyParsedScene(localizeKnownState(current, cartridge, activeCartridge), parsed, activeCartridge, normalizedAction, result.imagePrompt, result.imageSubject, dangerDirective, domainResolution, result.imageCharacterId, presetEventResolution))
      setPendingAction('')
      setProgress(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setFailedAction({ action: normalizedAction, locale: actionLocale })
      setPendingAction('')
      setProgress(null)
    } finally { setBusy(false) }
  }, [busy, cartridge, commit, mode])

  const retryAction = useCallback(() => { if (failedAction) void act(failedAction.action, failedAction.locale) }, [act, failedAction])
  const useAigramFallback = useCallback(() => { setMode('aigram'); setError('') }, [])
  const retryImage = useCallback((blockId: string) => { imageAttempt.current = ''; commit((current) => updateImageBlock(current, blockId, { status: 'queued' })) }, [commit])
  const prepareInventoryImages = useCallback(() => {
    imageAttempt.current = ''
    commit((current) => {
      const needsPreparation = current.inventory.some((item) => !item.imageUrl || item.imageStyleVersion !== ITEM_IMAGE_STYLE_VERSION || item.imageStatus === 'failed')
      if (!needsPreparation) return current
      return {
        ...current,
        inventory: current.inventory.map((item) => {
          const needsImage = !item.imageUrl || item.imageStyleVersion !== ITEM_IMAGE_STYLE_VERSION || item.imageStatus === 'failed'
          return needsImage ? { ...item, imageStyleVersion: undefined, imageStatus: 'queued' as const } : item
        }),
      }
    })
  }, [commit])
  const restartWorld = useCallback(() => {
    if (busy) return
    imageAttempt.current = `restart:${Date.now()}`
    setError(''); setFailedAction(null); setPendingAction(''); setProgress(null)
    const fresh = createInitialSave(cartridge)
    const archive = archiveRef.current
    const nextArchive: StoryArchive = { ...archive, version: 1, worlds: { ...archive.worlds, [cartridge.id]: fresh } }
    archiveRef.current = nextArchive
    saveRef.current = fresh
    setSave(fresh)
    persist(nextArchive)
    const url = new URL(window.location.href)
    url.searchParams.delete('chat_id')
    window.history.replaceState({}, '', url)
    setMode(url.searchParams.get('story_mode') === 'demo' ? 'demo' : 'aigram')
  }, [busy, cartridge, persist])
  return { save, mode, setMode, busy, progress, error, pendingAction, canRetry: Boolean(failedAction), enter, act, retryAction, useAigramFallback, retryImage, prepareInventoryImages, restartWorld, loaded: cloud.loaded && seeded.current, clear: cloud.clear }
}
