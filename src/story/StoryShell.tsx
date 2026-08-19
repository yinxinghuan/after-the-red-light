import { useEffect, useMemo, useRef, useState } from 'react'
import alteruMark from './img/alteru.svg'
import { DEFAULT_CARTRIDGE_ID, listCartridges, resolveCartridge } from './cartridges'
import { Icon, type IconName } from './Icons'
import { detectLocale, detectTextLocale, rememberLocale, t } from './i18n'
import { ITEM_IMAGE_STYLE_VERSION, type DrawerId, type ImageBlockStatus, type InventoryItem, type Locale, type MapNode, type RelationshipEvent, type StatDefinition, type StoryBlock, type StoryCartridge, type StoryCharacter, type StoryMode } from './types'
import { useStoryEngine } from './useStoryEngine'
import { usePlayerProfile, type PlayerProfile } from './usePlayerProfile'
import { useStoryAudio } from './audio/useStoryAudio'
import { latestReadingAnchorId } from './engine/readingAnchor'
import { decodeChoiceRecord, resolveNumberedChoiceInput } from './engine/choiceInput'

function useInitialCartridge() {
  return new URLSearchParams(window.location.search).get('cartridge')
}

function setCssTheme(cartridge: StoryCartridge): React.CSSProperties {
  return {
    '--st-outer': cartridge.theme.outer, '--st-surface': cartridge.theme.surface, '--st-paper': cartridge.theme.paper,
    '--st-ink': cartridge.theme.ink, '--st-muted': cartridge.theme.muted, '--st-accent': cartridge.theme.accent,
    '--st-danger': cartridge.theme.danger, '--st-gold': cartridge.theme.gold,
  } as React.CSSProperties
}

function Entry({ cartridge, onEnter, onSelect, mode, setMode, hasSave, remoteAvailable }: {
  cartridge: StoryCartridge; onEnter: () => void; onSelect: (id: string) => void; mode: StoryMode; setMode: (mode: StoryMode) => void; hasSave: boolean; remoteAvailable: boolean
}) {
  const cartridges = listCartridges(cartridge.locale)
  const showSourceControls = cartridges.length > 1 || new URLSearchParams(window.location.search).get('story_debug') === '1'
  return <main className={`st-entry st-entry--${cartridge.theme.material}`} style={setCssTheme(cartridge)}>
    <div className="st-entry__folio">{t(cartridge.locale, 'folio')}</div>
    <div className="st-entry__rule" />
    <p className="st-entry__kicker">{t(cartridge.locale, 'kicker')}</p>
    <h1>{cartridge.copy.title}</h1>
    <p className="st-entry__subtitle">{cartridge.copy.subtitle}</p>
    <figure className="st-entry__scene"><img src={cartridge.entryImage ?? cartridge.coverImage} alt="" draggable={false} /></figure>
    <p className="st-entry__promise">{cartridge.copy.promise}</p>
    <button className="st-primary" onPointerDown={onEnter}>{hasSave ? cartridge.copy.continue : cartridge.copy.enter}<Icon name="arrow" /></button>
    {cartridges.length > 1 && <div className="st-entry__cartridges" aria-label={t(cartridge.locale, 'chooseWorld')}>
      {cartridges.map((item) => <button key={item.id} className={item.id === cartridge.id ? 'is-active' : ''} onClick={() => onSelect(item.id)}><img src={item.coverImage} alt="" draggable={false} /><span><small>{t(cartridge.locale, 'cartridge')}</small>{item.copy.title}</span></button>)}
    </div>}
    {showSourceControls && <div className="st-entry__source">
      <button className={mode === 'aigram' ? 'is-active' : ''} onClick={() => setMode('aigram')} title={t(cartridge.locale, 'aigramReady')}>{t(cartridge.locale, 'aigram')}</button>
      <button className={mode === 'demo' ? 'is-active' : ''} onClick={() => setMode('demo')}>{t(cartridge.locale, 'demo')}</button>
      <button className={mode === 'remote' ? 'is-active' : ''} onClick={() => setMode('remote')} disabled={!remoteAvailable} title={t(cartridge.locale, remoteAvailable ? 'remoteReady' : 'remoteUnavailable')}>{t(cartridge.locale, 'remote')}</button>
    </div>}
    <div className="st-entry__brand"><img src={alteruMark} alt="" /> ALTERU</div>
  </main>
}

function statPresentation(stat: StatDefinition, value: number) {
  const span = Math.max(1, stat.max - stat.min)
  const ratio = Math.max(0, Math.min(1, (value - stat.min) / span))
  const warningAt = stat.warningAt ?? (stat.inverse ? stat.min + span * .25 : stat.min + span * .6)
  const dangerAt = stat.dangerAt ?? (stat.inverse ? stat.min + span * .1 : stat.min + span * .85)
  const danger = stat.inverse ? value <= dangerAt : value >= dangerAt
  const warning = stat.inverse ? value <= warningAt : value >= warningAt
  return {
    percent: Math.round(ratio * 100),
    thresholdPercent: Math.round(Math.max(0, Math.min(1, (warningAt - stat.min) / span)) * 100),
    tone: danger ? 'danger' : warning ? 'warning' : 'steady',
  }
}

function HeaderStat({ stat, value, onOpen }: { stat: StatDefinition; value: number; onOpen: () => void }) {
  const previousValue = useRef(value)
  const [delta, setDelta] = useState(0)
  useEffect(() => {
    const change = value - previousValue.current
    previousValue.current = value
    if (!change) return
    setDelta(change)
    const timer = window.setTimeout(() => setDelta(0), 860)
    return () => window.clearTimeout(timer)
  }, [value])
  const presentation = statPresentation(stat, value)
  const direction = delta === 0 ? '' : (stat.inverse ? delta > 0 : delta < 0) ? 'gain' : 'loss'
  return <button type="button" className={`st-chat-stat st-chat-stat--${stat.display ?? 'number'} is-${presentation.tone}${delta ? ` has-delta is-delta-${direction}` : ''}`} onClick={onOpen} aria-label={`${stat.label} ${value}`}>
    <div className="st-chat-stat__reading"><span>{stat.label}</span><strong>{value}{stat.display === 'number' && <small> / {stat.max}</small>}</strong></div>
    {stat.display === 'bar' && <div className="st-chat-stat__track" role="progressbar" aria-label={stat.label} aria-valuemin={stat.min} aria-valuemax={stat.max} aria-valuenow={value}><i style={{ width: `${presentation.percent}%` }} /><b style={{ left: `${presentation.thresholdPercent}%` }} aria-hidden="true" /></div>}
    {delta !== 0 && <output className="st-chat-stat__delta" aria-live="polite">{delta > 0 ? '+' : ''}{delta}</output>}
    <Icon name="arrow" className="st-chat-stat__open" />
  </button>
}

function checkPassed(block: StoryBlock): boolean {
  const outcome = String(block.data?.outcome ?? '')
  if (outcome) return outcome === 'critical-success' || outcome === 'success' || outcome === 'costly-success'
  return Number(block.data?.total) >= Number(block.data?.dc)
}

function StatChangeResult({ block, cartridge }: { block: StoryBlock; cartridge: StoryCartridge }) {
  const statId = String(block.data?.stat ?? '')
  const stat = cartridge.statDefinitions.find((definition) => definition.id === statId)
  const delta = Number(block.data?.delta)
  if (!stat || !Number.isFinite(delta)) return <div className="st-result st-result--change" data-block-id={block.id}><i /><span>{block.text}</span></div>
  const direction = delta === 0 ? 'steady' : (stat.inverse ? delta > 0 : delta < 0) ? 'gain' : 'loss'
  const range = Math.max(1, stat.maxDelta ?? stat.max - stat.min)
  const strength = `${Math.max(18, Math.min(100, Math.round(Math.abs(delta) / range * 100)))}%`
  return <div className={`st-result st-stat-change is-${direction}`} data-block-id={block.id} data-change-direction={direction} style={{ '--st-change-strength': strength } as React.CSSProperties}>
    <small>{t(cartridge.locale, 'valueChanged')}</small><span>{stat.label}</span><strong>{delta > 0 ? '+' : ''}{delta}</strong>
    <div className="st-stat-change__trace" aria-hidden="true"><i /></div>
  </div>
}

function PlayerAvatar({ profile, locale, large = false }: { profile: PlayerProfile; locale: Locale; large?: boolean }) {
  const fallback = new URL('./alteru-default-avatar.jpg', document.baseURI).href
  return <span className={`st-player-avatar${large ? ' st-player-avatar--large' : ''}`} title={profile.name}>
    <img src={profile.avatarUrl} alt={large ? t(locale, 'playerAvatarAlt', { name: profile.name }) : ''} draggable={false} onError={(event) => { if (event.currentTarget.src !== fallback) event.currentTarget.src = fallback }} />
  </span>
}

type TextSize = 'small' | 'standard' | 'large'

const TEXT_SIZE_KEY = 'alteru_story_text_size'
const textSizes: TextSize[] = ['small', 'standard', 'large']

function readTextSize(): TextSize {
  const saved = alteruLocalStorage.getItem(TEXT_SIZE_KEY)
  return textSizes.includes(saved as TextSize) ? saved as TextSize : 'standard'
}

function TextSizeControl({ locale, value, onChange }: { locale: Locale; value: TextSize; onChange: (size: TextSize) => void }) {
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const labelKey = (size: TextSize) => `textSize${size[0].toUpperCase()}${size.slice(1)}` as 'textSizeSmall' | 'textSizeStandard' | 'textSizeLarge'
  const close = () => detailsRef.current?.removeAttribute('open')
  return <details className="st-text-size" ref={detailsRef} onKeyDown={(event) => { if (event.key === 'Escape') close() }}>
    <summary aria-label={`${t(locale, 'textSize')}: ${t(locale, labelKey(value))}`} title={t(locale, 'textSize')}><span aria-hidden="true">Aa</span></summary>
    <div role="group" aria-label={t(locale, 'textSize')}>
      {textSizes.map((size) => <button type="button" className={`is-${size}`} aria-pressed={value === size} onClick={() => { onChange(size); close() }} key={size}><span aria-hidden="true">A</span><small>{t(locale, labelKey(size))}</small></button>)}
    </div>
  </details>
}

function ConversationHeader({ cartridge, engine, audio, openWorld, textSize, setTextSize }: {
  cartridge: StoryCartridge; engine: ReturnType<typeof useStoryEngine>; audio: ReturnType<typeof useStoryAudio>; openWorld: (active?: DrawerId, detail?: WorldDetail) => void; textSize: TextSize; setTextSize: (size: TextSize) => void
}) {
  const audioActive = audio.supported && audio.active
  return <header className="st-chat-header">
    <div className="st-chat-header__top">
      <div className="st-chat-header__identity">
        <div><span>{cartridge.copy.title}</span><i className={engine.mode !== 'demo' ? 'is-live' : ''} /><img src={alteruMark} alt="" /></div>
        <small>{engine.save.sceneLocation ?? engine.save.location} · {engine.save.time}</small>
      </div>
      <div className="st-chat-header__actions">
        <TextSizeControl locale={cartridge.locale} value={textSize} onChange={setTextSize} />
        <button
          type="button"
          className="st-audio-button"
          aria-label={t(cartridge.locale, audio.supported ? (audioActive ? 'audioMute' : 'audioEnable') : 'audioUnavailable')}
          title={t(cartridge.locale, audio.supported ? (audioActive ? 'audioMute' : 'audioEnable') : 'audioUnavailable')}
          aria-pressed={audioActive}
          onClick={audio.toggle}
          disabled={!audio.supported}
        ><Icon name={audioActive ? 'volume' : 'volumeOff'} /></button>
        <button className="st-world-button" onClick={() => openWorld('party')} aria-label={t(cartridge.locale, 'world')} title={t(cartridge.locale, 'world')}><Icon name="folio" /></button>
      </div>
    </div>
    <div className="st-chat-stats" aria-label={t(cartridge.locale, 'stats')}>
      {cartridge.statDefinitions.map((stat) => {
        const value = engine.save.stats[stat.id] ?? stat.initial
        return <HeaderStat stat={stat} value={value} onOpen={() => openWorld('party', { type: 'player', statId: stat.id })} key={stat.id} />
      })}
    </div>
  </header>
}

function InlineSceneImage({ block, cartridge, retry }: { block: StoryBlock; cartridge: StoryCartridge; retry: (id: string) => void }) {
  const status = String(block.data?.status ?? 'idle') as ImageBlockStatus
  const url = String(block.data?.url ?? '')
  return <figure className={`st-message-image st-message-image--${cartridge.theme.material} is-${status}`} data-block-id={block.id}>
    {url && status === 'ready'
      ? <img src={url} alt={t(cartridge.locale, 'imageAlt', { name: block.text })} draggable={false} />
      : <div className="st-message-image__placeholder" aria-label={t(cartridge.locale, status === 'failed' ? 'imageFailedAria' : 'imageGeneratingAria')}><img src={cartridge.coverImage} alt="" draggable={false} /><span aria-hidden="true" /></div>}
    <figcaption>
      <div><Icon name="image" /><span>{block.text}</span></div>
      <small>{t(cartridge.locale, status === 'idle' ? 'imageIdle' : status === 'queued' ? 'imageQueued' : status === 'generating' ? 'imageGenerating' : status === 'failed' ? 'imageFailed' : 'imageReady')}</small>
      {status === 'failed' && <button onClick={() => retry(block.id)}><Icon name="refresh" />{t(cartridge.locale, 'retry')}</button>}
    </figcaption>
  </figure>
}

function StoryBlockView({ block, cartridge, retryImage, player }: { block: StoryBlock; cartridge: StoryCartridge; retryImage: (id: string) => void; player: PlayerProfile }) {
  if (block.kind === 'image') return <InlineSceneImage block={block} cartridge={cartridge} retry={retryImage} />
  if (block.kind === 'choices') {
    const labels = decodeChoiceRecord(block.text)
    return labels.length ? <section className="st-choice-record" data-block-id={block.id}><ol>{labels.map((label, index) => <li key={`${block.id}-${index}`}><small>{String(index + 1).padStart(2, '0')}</small><span>{label}</span></li>)}</ol></section> : null
  }
  if (block.kind === 'dialogue') return <div className="st-message st-message--character" data-block-id={block.id}><div className="st-message__avatar">{block.speaker?.slice(0, 1)}</div><div className="st-message__body"><header><span>{block.speaker}</span><small>{block.tone}</small></header><p>{block.text}</p></div></div>
  if (block.kind === 'check') return <div className="st-result st-result--check" data-block-id={block.id}><div><span>{checkPassed(block) ? 'PASS' : 'MISS'}</span><p>{block.text}</p></div><section><b>{block.data?.roll}</b><i>+</i><b>{block.data?.modifier}</b><i>=</i><strong>{block.data?.total}</strong><small>DC {block.data?.dc}</small></section></div>
  if (block.kind === 'change') return <StatChangeResult block={block} cartridge={cartridge} />
  if (block.kind === 'summary') return <section className="st-result st-result--summary" data-block-id={block.id}><small>{t(cartridge.locale, 'summary')}</small><h2>{block.text}</h2><p>{t(cartridge.locale, 'notEnding')}</p></section>
  if (block.kind === 'event' && block.id.startsWith('action-')) return <div className="st-message st-message--player" data-block-id={block.id}><div className="st-message__body"><small>{t(cartridge.locale, 'yourAction')}</small><p>{block.text}</p></div><PlayerAvatar profile={player} locale={cartridge.locale} /></div>
  if (block.kind === 'event') return <div className={`st-system-line${block.data?.dangerPhase ? ' st-system-line--danger' : ''}`} data-block-id={block.id} data-danger-phase={block.data?.dangerPhase}><span>{block.text}</span></div>
  return <div className="st-narration" data-block-id={block.id}><p>{block.text}</p></div>
}

function ConversationFeed({ cartridge, engine, feedRef, endRef, onScroll, player }: {
  cartridge: StoryCartridge; engine: ReturnType<typeof useStoryEngine>;
  feedRef: React.RefObject<HTMLDivElement>; endRef: React.RefObject<HTMLDivElement>; onScroll: () => void; player: PlayerProfile
}) {
  return <div className="st-conversation" ref={feedRef} onScroll={onScroll}>
    <div className="st-conversation__day"><span>{engine.save.sceneLocation ?? engine.save.location}</span><small>{engine.save.objective}</small></div>
    {engine.save.blocks.map((block) => <StoryBlockView block={block} cartridge={cartridge} retryImage={engine.retryImage} player={player} key={block.id} />)}
    {engine.pendingAction && <div className="st-message st-message--player is-pending" data-pending-action><div className="st-message__body"><small>{t(cartridge.locale, 'yourAction')}</small><p>{engine.pendingAction}</p></div><PlayerAvatar profile={player} locale={cartridge.locale} /></div>}
    {engine.progress && <div className="st-typing"><span><i /><i /><i /></span><p>{engine.progress.label}</p></div>}
    {engine.error && <div className="st-inline-error" data-story-error><p>{engine.error}</p><div>{engine.canRetry && <button onClick={engine.retryAction}>{t(cartridge.locale, 'retryAction')}</button>}{engine.mode === 'remote' && <button onClick={engine.useAigramFallback}>{t(cartridge.locale, 'aigramFallback')}</button>}</div></div>}
    <div className={`st-conversation__end${engine.pendingAction || engine.error || engine.save.scene > 0 ? ' is-active' : ''}`} ref={endRef} />
  </div>
}

function Composer({ cartridge, engine, onAct }: { cartridge: StoryCartridge; engine: ReturnType<typeof useStoryEngine>; onAct: (action: string) => void }) {
  const [custom, setCustom] = useState('')
  const repliesRef = useRef<HTMLDivElement>(null)
  useEffect(() => { repliesRef.current?.scrollTo({ left: 0, behavior: 'auto' }) }, [engine.save.scene])
  const submit = () => {
    const value = custom.trim()
    if (!value || engine.busy) return
    onAct(resolveNumberedChoiceInput(value, choices)); setCustom('')
  }
  const hasStoryChoices = engine.save.choices.length > 0
  const closedCheckpoint = engine.save.sessionEnded && !hasStoryChoices
  const choices = hasStoryChoices ? engine.save.choices : closedCheckpoint ? [{ id: `continue-${engine.save.scene}`, label: cartridge.copy.continue }] : []
  return <section className="st-composer" aria-label={t(cartridge.locale, 'reply')}>
    {engine.save.scene > 0 && choices.length > 0 && engine.save.decisionContext && <div className="st-decision-context"><small>{t(cartridge.locale, 'currentSituation')}</small><p>{engine.save.decisionContext}</p></div>}
    <div className="st-quick-replies" ref={repliesRef}>
      {choices.map((choice, index) => {
        const visualUnits = Array.from(choice.label).reduce((total, character) => total + (/[^\u0000-\u00ff]/.test(character) ? 2 : 1), 0)
        const adaptiveWidth = `${Math.min(310, Math.max(148, Math.round(132 + visualUnits * 2.5)))}px`
        return <button key={choice.id} style={{ '--st-choice-width': adaptiveWidth } as React.CSSProperties} disabled={engine.busy} onClick={() => onAct(choice.label)}><small>{String(index + 1).padStart(2, '0')}</small><span>{choice.label}</span><Icon name="arrow" /></button>
      })}
    </div>
    <form onSubmit={(event) => { event.preventDefault(); submit() }}>
      <Icon name="pen" />
      <input aria-label={t(cartridge.locale, 'customAction')} value={custom} onChange={(event) => setCustom(event.target.value)} placeholder={cartridge.copy.customAction} disabled={engine.busy || closedCheckpoint} maxLength={240} />
      <button type="button" onPointerDown={submit} disabled={!custom.trim() || engine.busy || closedCheckpoint} aria-label={t(cartridge.locale, 'sendAction')}><Icon name="arrow" /></button>
    </form>
  </section>
}

const drawerIcons: Record<DrawerId, IconName> = { party: 'people', map: 'map', inventory: 'bag', log: 'book' }

type WorldDetail =
  | { type: 'player'; statId?: string }
  | { type: 'character'; id: string }
  | { type: 'map'; id: string }
  | { type: 'inventory'; id: string }
  | { type: 'objective' }
  | { type: 'relationship'; id: string }
  | { type: 'system' }

function DetailSection({ label, children }: { label: string; children: React.ReactNode }) {
  return <section className="st-world-detail__section"><small>{label}</small>{children}</section>
}

function DetailMetrics({ rows }: { rows: Array<{ label: string; value: string | number }> }) {
  return <dl className="st-world-detail__metrics">{rows.map((row, index) => <div key={`${row.label}-${index}`}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
}

function PlayerDetail({ player, save, cartridge, focusedStatId, openSection }: {
  player: PlayerProfile; save: ReturnType<typeof useStoryEngine>['save']; cartridge: StoryCartridge; focusedStatId?: string; openSection: (id: DrawerId) => void
}) {
  const itemCount = save.inventory.reduce((total, item) => total + item.count, 0)
  return <div className="st-world-detail st-player-detail">
    <div className="st-world-detail__hero"><PlayerAvatar profile={player} locale={cartridge.locale} large /><div><h3>{player.name}</h3><p>{t(cartridge.locale, 'protagonist')}</p></div></div>
    <DetailSection label={t(cartridge.locale, 'currentStatus')}>
      <div className="st-player-status-list">{cartridge.statDefinitions.map((stat) => {
        const value = save.stats[stat.id] ?? stat.initial
        const presentation = statPresentation(stat, value)
        return <section className={`st-player-status-card is-${presentation.tone}${focusedStatId === stat.id ? ' is-focused' : ''}`} key={stat.id}>
          <div><span>{stat.label}</span><strong>{value}{stat.display === 'number' ? <small>{stat.unit}</small> : <small> / {stat.max}</small>}</strong></div>
          {stat.display !== 'number' && <><div className="st-player-status-card__track" role="progressbar" aria-label={stat.label} aria-valuemin={stat.min} aria-valuemax={stat.max} aria-valuenow={value}><i style={{ width: `${presentation.percent}%` }} /><b style={{ left: `${presentation.thresholdPercent}%` }} /></div><small>{stat.min} — {stat.max}</small></>}
          {stat.description && <p className="st-player-status-card__description">{stat.description}</p>}
        </section>
      })}</div>
    </DetailSection>
    <DetailSection label={t(cartridge.locale, 'journeyOverview')}><DetailMetrics rows={[
      { label: t(cartridge.locale, 'here'), value: save.sceneLocation ?? save.location },
      { label: t(cartridge.locale, 'system'), value: save.time },
      { label: t(cartridge.locale, 'storySegments'), value: save.scene + 1 },
      { label: t(cartridge.locale, 'companion'), value: save.partyMemberIds.length },
      { label: t(cartridge.locale, 'inventoryItems'), value: itemCount },
    ]} /></DetailSection>
    <DetailSection label={t(cartridge.locale, 'currentObjective')}><p>{save.objective}</p></DetailSection>
    <nav className="st-world-detail__links" aria-label={t(cartridge.locale, 'openWorldSection')}>
      {(['map', 'inventory', 'log'] as DrawerId[]).map((id) => <button type="button" onClick={() => openSection(id)} key={id}><Icon name={drawerIcons[id]} /><span>{cartridge.drawerLabels[id]}</span><Icon name="arrow" /></button>)}
    </nav>
  </div>
}

function characterStatusLabel(character: StoryCharacter, cartridge: StoryCartridge) {
  return t(cartridge.locale, character.status === 'companion' ? 'partyStatusCompanion' : character.status === 'departed' ? 'partyStatusDeparted' : 'partyStatusKnown')
}

function CharacterDetail({ character, relationships, cartridge }: { character: StoryCharacter; relationships: RelationshipEvent[]; cartridge: StoryCartridge }) {
  const history = relationships.filter((event) => event.characterId === character.id || (!event.characterId && event.actor === character.name))
  return <div className="st-world-detail">
    <div className="st-world-detail__hero"><div className="st-roster__initial">{character.name.slice(0, 1)}</div><div><h3>{character.name}</h3><p>{character.role}</p></div></div>
    <DetailSection label={t(cartridge.locale, 'currentStatus')}><DetailMetrics rows={[{ label: t(cartridge.locale, 'currentStatus'), value: characterStatusLabel(character, cartridge) }, { label: t(cartridge.locale, 'vitality'), value: character.vitality }, { label: t(cartridge.locale, 'stress'), value: character.stress }]} /></DetailSection>
    <DetailSection label={t(cartridge.locale, 'abilities')}><DetailMetrics rows={character.skills.map((skill) => ({ label: skill.label, value: `${skill.value >= 0 ? '+' : ''}${skill.value}` }))} /></DetailSection>
    <DetailSection label={t(cartridge.locale, 'itemDescription')}><p>{character.detail ?? t(cartridge.locale, 'noDetails')}</p></DetailSection>
    {character.lore && <DetailSection label={t(cartridge.locale, 'background')}><p>{character.lore}</p></DetailSection>}
    <DetailSection label={t(cartridge.locale, 'relationshipHistory')}>{history.length ? <ul>{history.map((event) => <li key={event.id}>{event.axis} · {t(cartridge.locale, event.delta > 0 ? 'warmer' : 'colder')}</li>)}</ul> : <p>{t(cartridge.locale, 'noRelationshipHistory')}</p>}</DetailSection>
  </div>
}

function MapDetail({ node, map, cartridge }: { node: MapNode; map: MapNode[]; cartridge: StoryCartridge }) {
  const connections = Array.from(new Set([node.connectedTo, ...map.filter((candidate) => candidate.connectedTo === node.label).map((candidate) => candidate.label)].filter((value): value is string => Boolean(value))))
  return <div className="st-world-detail">
    <div className="st-world-detail__hero"><div className="st-world-detail__glyph"><Icon name="map" /></div><div><h3>{node.label}</h3><p>{node.current ? t(cartridge.locale, 'here') : t(cartridge.locale, 'worldRecord')}</p></div></div>
    <DetailSection label={t(cartridge.locale, 'placeOverview')}><p>{node.detail ?? t(cartridge.locale, 'noDetails')}</p></DetailSection>
    <DetailSection label={t(cartridge.locale, 'connections')}>{connections.length ? <ul>{connections.map((label) => <li key={label}>{label}</li>)}</ul> : <p>{t(cartridge.locale, 'noKnownFacts')}</p>}</DetailSection>
    <DetailSection label={t(cartridge.locale, 'knownFacts')}>{node.facts?.length ? <ul>{node.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul> : <p>{t(cartridge.locale, 'noKnownFacts')}</p>}</DetailSection>
    {node.lore && <DetailSection label={t(cartridge.locale, 'background')}><p>{node.lore}</p></DetailSection>}
  </div>
}

function ItemDetail({ item, cartridge }: { item: InventoryItem; cartridge: StoryCartridge }) {
  const status = item.imageStatus ?? (item.imageUrl ? 'ready' : 'idle')
  const currentImageUrl = item.imageStyleVersion === ITEM_IMAGE_STYLE_VERSION ? item.imageUrl : undefined
  const rarity = item.rarity ?? 'common'
  const statusKey = `itemImage${status[0].toUpperCase()}${status.slice(1)}` as 'itemImageIdle' | 'itemImageQueued' | 'itemImageGenerating' | 'itemImageFailed' | 'itemImageReady'
  const metrics = [{ label: t(cartridge.locale, 'quantity'), value: `× ${item.count}` }, { label: t(cartridge.locale, 'rarity'), value: t(cartridge.locale, rarity === 'legendary' ? 'rarityLegendary' : rarity === 'rare' ? 'rarityRare' : 'rarityCommon') }, ...(item.metrics ?? [])]
  return <div className={`st-world-detail st-world-detail--item is-${rarity}`}>
    <figure className={`st-item-illustration is-${status}`}>
      {currentImageUrl ? <img src={currentImageUrl} alt={item.label} draggable={false} /> : <div><Icon name="bag" /><span>{item.label}</span></div>}
      <figcaption><small>{t(cartridge.locale, 'itemIllustration')}</small><p>{t(cartridge.locale, statusKey)}</p></figcaption>
    </figure>
    <DetailSection label={t(cartridge.locale, 'itemMetrics')}><DetailMetrics rows={metrics} /></DetailSection>
    <DetailSection label={t(cartridge.locale, 'itemDescription')}><p>{item.detail ?? t(cartridge.locale, 'noDetails')}</p></DetailSection>
    <DetailSection label={t(cartridge.locale, 'itemEffect')}><p>{item.effect ?? t(cartridge.locale, 'noDetails')}</p></DetailSection>
    <DetailSection label={t(cartridge.locale, 'itemLore')}><p>{item.lore ?? t(cartridge.locale, 'noDetails')}</p></DetailSection>
  </div>
}

function SystemDetail({ cartridge, engine, restart }: {
  cartridge: StoryCartridge; engine: ReturnType<typeof useStoryEngine>; restart: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  return <div className="st-world-detail">
    <DetailSection label={t(cartridge.locale, 'system')}><p>{t(cartridge.locale, 'segmentSaved', { n: engine.save.scene + 1 })}</p></DetailSection>
    <DetailMetrics rows={[{ label: t(cartridge.locale, 'here'), value: engine.save.sceneLocation ?? engine.save.location }, { label: t(cartridge.locale, 'system'), value: engine.save.time }]} />
    <section className="st-world-restart">
      <small>{t(cartridge.locale, 'startOver')}</small>
      <p>{t(cartridge.locale, 'startOverDescription')}</p>
      {engine.busy && <p className="st-world-restart__busy" role="status">{t(cartridge.locale, 'startOverBusy')}</p>}
      {!confirming
        ? <button className="st-world-restart__open" onClick={() => setConfirming(true)} disabled={engine.busy}>{t(cartridge.locale, 'startOver')}</button>
        : <div className="st-world-restart__confirm" role="alert">
          <p>{t(cartridge.locale, 'startOverWarning')}</p>
          <div><button onClick={() => setConfirming(false)}>{t(cartridge.locale, 'startOverCancel')}</button><button className="is-danger" onClick={restart}>{t(cartridge.locale, 'startOverConfirm')}</button></div>
        </div>}
    </section>
  </div>
}

function WorldDrawer({ active, setActive, detail, setDetail, cartridge, engine, close, player }: {
  active: DrawerId; setActive: (id: DrawerId) => void; detail: WorldDetail | null; setDetail: (detail: WorldDetail | null) => void; cartridge: StoryCartridge; engine: ReturnType<typeof useStoryEngine>; close: () => void; player: PlayerProfile
}) {
  const save = engine.save
  const character = detail?.type === 'character' ? save.characters.find((entry) => entry.id === detail.id) : undefined
  const roster = [...save.characters].sort((left, right) => {
    const rank = { companion: 0, known: 1, departed: 2 }
    return rank[left.status] - rank[right.status] || right.updatedAtScene - left.updatedAtScene || left.name.localeCompare(right.name)
  })
  const activeCompanions = roster.filter((entry) => entry.status === 'companion')
  const knownPeople = roster.filter((entry) => entry.status !== 'companion')
  const relationshipEventCount = save.relationships.length
  const travelerRow = (entry: StoryCharacter) => <button className={`st-entity-row is-${entry.status}`} onClick={() => setDetail({ type: 'character', id: entry.id })} key={entry.id}><div className="st-roster__initial">{entry.name.slice(0, 1)}</div><div><h3>{entry.name}</h3><p>{entry.role} · {characterStatusLabel(entry, cartridge)}</p><small>{t(cartridge.locale, 'vitality')} {entry.vitality} · {t(cartridge.locale, 'stress')} {entry.stress}</small></div><ul>{entry.skills.slice(0, 2).map((skill) => <li key={skill.id}>{skill.label}<b>{skill.value >= 0 ? '+' : ''}{skill.value}</b></li>)}</ul><Icon name="arrow" /></button>
  const mapNode = detail?.type === 'map' ? save.map.find((entry) => entry.id === detail.id) : undefined
  const item = detail?.type === 'inventory' ? save.inventory.find((entry) => entry.id === detail.id) : undefined
  const relationship = detail?.type === 'relationship' ? save.relationships.find((entry) => entry.id === detail.id) : undefined
  const revealingItems = save.inventory.some((entry) => entry.imageStatus === 'queued' || entry.imageStatus === 'generating')
  const hasCurrentItemImage = save.inventory.some((entry) => entry.imageUrl && entry.imageStyleVersion === ITEM_IMAGE_STYLE_VERSION)
  const detailTitle = detail?.type === 'player' ? player.name : character?.name ?? mapNode?.label ?? item?.label ?? (detail?.type === 'objective' ? t(cartridge.locale, 'currentObjective') : detail?.type === 'system' ? t(cartridge.locale, 'system') : relationship?.actor)
  useEffect(() => {
    if (active === 'inventory') engine.prepareInventoryImages()
  }, [active, engine.prepareInventoryImages])
  return <div className="st-drawer" role="dialog" aria-modal="true" aria-label={t(cartridge.locale, 'worldData')}><button className="st-drawer__scrim" onClick={close} aria-label={t(cartridge.locale, 'closeWorldData')} /><section>
    <header className={detail ? 'is-detail' : ''}>{detail ? <button onClick={() => setDetail(null)} aria-label={t(cartridge.locale, 'back')} title={t(cartridge.locale, 'back')}><Icon name="back" /></button> : <span className="st-drawer__header-spacer" />}<div><small>{detail ? t(cartridge.locale, 'openDetails') : t(cartridge.locale, 'worldRecord')}</small><h2>{detailTitle ?? cartridge.copy.title}</h2></div><button onClick={close} aria-label={t(cartridge.locale, 'close')}><Icon name="close" /></button></header>
    {!detail && <nav className="st-drawer-tabs">{(Object.keys(cartridge.drawerLabels) as DrawerId[]).map((id) => <button className={active === id ? 'is-active' : ''} onClick={() => { setDetail(null); setActive(id) }} key={id}><Icon name={drawerIcons[id]} /><span>{cartridge.drawerLabels[id]}</span></button>)}</nav>}
    {!detail && active === 'party' && <div className="st-roster"><aside className="st-relationship-overview"><Icon name="people" /><div><strong>{t(cartridge.locale, 'relationshipOverview')}</strong><span>{t(cartridge.locale, 'relationshipOverviewSummary', { people: roster.length, events: relationshipEventCount })}</span><p>{t(cartridge.locale, 'relationshipOverviewHint')}</p></div></aside>{activeCompanions.length > 0 && <p className="st-roster__group">{t(cartridge.locale, 'activeCompanions')}</p>}{activeCompanions.map(travelerRow)}{knownPeople.length > 0 && <p className="st-roster__group">{t(cartridge.locale, 'peopleEncountered')}</p>}{knownPeople.map(travelerRow)}<p className="st-roster__group">{t(cartridge.locale, 'ownJourney')}</p><button className="st-entity-row st-roster__player" onClick={() => setDetail({ type: 'player' })}><PlayerAvatar profile={player} locale={cartridge.locale} large /><div><h3>{player.name}</h3><p>{t(cartridge.locale, 'protagonist')}</p></div><strong>{t(cartridge.locale, 'you')}</strong><Icon name="arrow" /></button></div>}
    {!detail && active === 'map' && <div className="st-map">{save.map.map((node, index) => <button className={`st-entity-row${node.current ? ' is-current' : ''}`} data-connected={Boolean(node.connectedTo)} onClick={() => setDetail({ type: 'map', id: node.id })} key={node.id}><small>{String(index + 1).padStart(2, '0')}</small><span>{node.label}{node.connectedTo && <i>{node.connectedTo}</i>}</span>{node.current && <b>{t(cartridge.locale, 'here')}</b>}<Icon name="arrow" /></button>)}</div>}
    {!detail && active === 'inventory' && <div className="st-inventory">{revealingItems && !hasCurrentItemImage && <aside className="st-inventory-reveal" aria-live="polite"><Icon name="image" /><div><strong>{cartridge.copy.itemImagingTitle}</strong><p>{cartridge.copy.itemImagingBody}</p></div><i aria-hidden="true" /></aside>}{save.inventory.map((entry) => <button className={`st-entity-row${entry.rarity ? ` is-${entry.rarity}` : ''}`} onClick={() => setDetail({ type: 'inventory', id: entry.id })} key={entry.id}><div><span>{entry.label}</span>{entry.effect && <small>{entry.effect}</small>}</div><b>× {entry.count}</b><Icon name="arrow" /></button>)}</div>}
    {!detail && active === 'log' && <div className="st-log"><button className="st-entity-row" onClick={() => setDetail({ type: 'objective' })}><div><small>{t(cartridge.locale, 'currentObjective')}</small><p>{save.objective}</p></div><Icon name="arrow" /></button>{save.relationships.map((event) => <button className="st-entity-row" onClick={() => setDetail({ type: 'relationship', id: event.id })} key={event.id}><div><small>{event.actor}</small><p>{event.axis} · {t(cartridge.locale, event.delta > 0 ? 'warmer' : 'colder')}</p></div><Icon name="arrow" /></button>)}<button className="st-entity-row" onClick={() => setDetail({ type: 'system' })}><div><small>{t(cartridge.locale, 'system')}</small><p>{t(cartridge.locale, 'segmentSaved', { n: save.scene + 1 })}</p></div><Icon name="arrow" /></button></div>}
    {detail?.type === 'player' && <PlayerDetail player={player} save={save} cartridge={cartridge} focusedStatId={detail.statId} openSection={(id) => { setDetail(null); setActive(id) }} />}
    {character && <CharacterDetail character={character} relationships={save.relationships} cartridge={cartridge} />}
    {mapNode && <MapDetail node={mapNode} map={save.map} cartridge={cartridge} />}
    {item && <ItemDetail item={item} cartridge={cartridge} />}
    {detail?.type === 'objective' && <div className="st-world-detail"><DetailSection label={t(cartridge.locale, 'currentObjective')}><p>{save.objective}</p></DetailSection><DetailSection label={t(cartridge.locale, 'currentStatus')}><DetailMetrics rows={[{ label: t(cartridge.locale, 'here'), value: save.sceneLocation ?? save.location }, { label: t(cartridge.locale, 'system'), value: save.time }]} /></DetailSection></div>}
    {relationship && <div className="st-world-detail"><DetailSection label={t(cartridge.locale, 'journalDetail')}><p>{relationship.actor} · {relationship.axis}</p></DetailSection><DetailMetrics rows={[{ label: t(cartridge.locale, 'currentStatus'), value: t(cartridge.locale, relationship.delta > 0 ? 'warmer' : 'colder') }, { label: t(cartridge.locale, 'yourAction'), value: relationship.source }]} /></div>}
    {detail?.type === 'system' && <SystemDetail cartridge={cartridge} engine={engine} restart={() => { close(); engine.restartWorld() }} />}
  </section></div>
}

function Game({ cartridge, mode, chatId, onSelect, onLocaleChange }: { cartridge: StoryCartridge; mode: StoryMode; chatId?: string; onSelect: (id: string) => void; onLocaleChange: (locale: Locale) => void }) {
  const player = usePlayerProfile()
  const engine = useStoryEngine(cartridge, mode, chatId, { ready: player.loaded, refUrl: player.imageRefUrl })
  const audio = useStoryAudio(cartridge, engine.save)
  const [worldOpen, setWorldOpen] = useState(false)
  const [worldTab, setWorldTab] = useState<DrawerId>('party')
  const [worldDetail, setWorldDetail] = useState<WorldDetail | null>(null)
  const [hasUnread, setHasUnread] = useState(false)
  const [showResumeLatest, setShowResumeLatest] = useState(false)
  const [confirmResumeRestart, setConfirmResumeRestart] = useState(false)
  const [textSize, setTextSizeState] = useState<TextSize>(() => readTextSize())
  const feedRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const responseAnchor = useRef<{ from: number } | null>(null)
  const lastResponseAnchorId = useRef<string | null>(null)
  const wasEntered = useRef(engine.save.entered)
  const hydratedLocale = useRef(false)
  const restoredSaveChecked = useRef(false)
  const audioInitialized = useRef(false)
  const audioBlockCount = useRef(0)
  const readyAudioImages = useRef<Set<string>>(new Set())
  const lastAudioError = useRef('')
  const setTextSize = (size: TextSize) => { alteruLocalStorage.setItem(TEXT_SIZE_KEY, size); setTextSizeState(size) }
  const openWorld = (active: DrawerId = worldTab, detail: WorldDetail | null = null) => {
    setWorldTab(active)
    setWorldDetail(detail)
    setWorldOpen(true)
  }

  useEffect(() => {
    if (!engine.loaded || hydratedLocale.current) return
    hydratedLocale.current = true
    const explicit = new URLSearchParams(window.location.search).get('lang')
    if (explicit !== 'zh' && explicit !== 'en' && engine.save.locale !== cartridge.locale) onLocaleChange(engine.save.locale)
  }, [cartridge.locale, engine.loaded, engine.save.locale, onLocaleChange])

  useEffect(() => {
    if (!engine.loaded || restoredSaveChecked.current) return
    restoredSaveChecked.current = true
    setShowResumeLatest(engine.save.scene > 0)
  }, [engine.loaded, engine.save.scene])

  const scrollBlockToReadingStart = (element: HTMLElement | null, behavior: ScrollBehavior = 'smooth') => {
    const feed = feedRef.current
    if (!feed || !element) return
    const top = feed.scrollTop + element.getBoundingClientRect().top - feed.getBoundingClientRect().top - 10
    const previousScrollBehavior = feed.style.scrollBehavior
    if (behavior === 'auto') feed.style.scrollBehavior = 'auto'
    feed.scrollTo({ top: Math.max(0, top), behavior })
    if (behavior === 'auto') requestAnimationFrame(() => { feed.style.scrollBehavior = previousScrollBehavior })
    setHasUnread(false)
  }

  const scrollToLatestReadingContext = (force = false, behavior: ScrollBehavior = 'smooth') => {
    if (!force && !follow.current) { setHasUnread(true); return }
    requestAnimationFrame(() => {
      const feed = feedRef.current
      if (!feed) return
      const anchorId = latestReadingAnchorId(engine.save.blocks)
      const anchor = anchorId
        ? feed.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(anchorId)}"]`)
        : feed.querySelector<HTMLElement>('[data-block-id]:last-of-type')
      scrollBlockToReadingStart(anchor, behavior)
    })
  }

  useEffect(() => {
    if (!wasEntered.current && engine.save.entered) {
      requestAnimationFrame(() => feedRef.current?.scrollTo({ top: 0, behavior: 'auto' }))
      setHasUnread(false)
    }
    wasEntered.current = engine.save.entered
  }, [engine.save.entered])

  useEffect(() => {
    if (!engine.pendingAction) return
    requestAnimationFrame(() => scrollBlockToReadingStart(feedRef.current?.querySelector<HTMLElement>('[data-pending-action]') ?? null))
  }, [engine.pendingAction])

  useEffect(() => {
    if (!engine.error) return
    if (engine.error !== lastAudioError.current) audio.cue('error')
    lastAudioError.current = engine.error
    requestAnimationFrame(() => scrollBlockToReadingStart(feedRef.current?.querySelector<HTMLElement>('[data-story-error]') ?? null))
  }, [audio.cue, engine.error])

  useEffect(() => {
    if (!engine.loaded) return
    const readyImages = new Set(engine.save.blocks.filter((block) => block.kind === 'image' && block.data?.status === 'ready').map((block) => block.id))
    if (!audioInitialized.current) {
      audioInitialized.current = true
      audioBlockCount.current = engine.save.blocks.length
      readyAudioImages.current = readyImages
      return
    }
    const newlyReadyImages = [...readyImages].filter((id) => !readyAudioImages.current.has(id))
    const added = engine.save.blocks.slice(audioBlockCount.current)
    if (added.length) {
      const summary = added.some((block) => block.kind === 'summary')
      const check = added.find((block) => block.kind === 'check')
      const discovery = added.some((block) => block.kind === 'event' && !block.id.startsWith('action-'))
      const treasure = added.some((block) => block.kind === 'change' && (block.data?.rarity === 'rare' || block.data?.rarity === 'legendary'))
      const change = added.some((block) => block.kind === 'change')
      if (summary) audio.cue('summary')
      else if (treasure) audio.cue('treasure')
      else if (check) audio.cue(checkPassed(check) ? 'success' : 'failure')
      else if (discovery) audio.cue('discovery')
      else if (change) audio.cue('change')
      else audio.cue('change')
    }
    newlyReadyImages.forEach(() => audio.cue('image'))
    audioBlockCount.current = engine.save.blocks.length
    readyAudioImages.current = readyImages
    // A late image above the latest reply changes the feed geometry after the
    // first reading-anchor scroll. Re-anchor only while the player is still
    // following the live edge; never steal position from someone reviewing
    // earlier prose.
    if (newlyReadyImages.length && follow.current) requestAnimationFrame(() => {
      const feed = feedRef.current
      const response = lastResponseAnchorId.current
        ? feed?.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(lastResponseAnchorId.current)}"]`) ?? null
        : null
      if (response) scrollBlockToReadingStart(response, 'auto')
      else scrollToLatestReadingContext(true, 'auto')
    })
  }, [audio.cue, engine.loaded, engine.save.blocks])

  useEffect(() => {
    const anchor = responseAnchor.current
    if (!anchor || engine.save.blocks.length <= anchor.from) return
    const response = engine.save.blocks.slice(anchor.from).find((block) => block.kind !== 'image' && !(block.kind === 'event' && block.id.startsWith('action-')))
    if (!response) return
    responseAnchor.current = null
    lastResponseAnchorId.current = response.id
    requestAnimationFrame(() => {
      const escapedId = CSS.escape(response.id)
      // The response must win over the earlier smooth scroll to the pending
      // action. An immediate anchor prevents two concurrent scroll animations
      // from leaving the consequence below the fixed composer.
      scrollBlockToReadingStart(feedRef.current?.querySelector<HTMLElement>(`[data-block-id="${escapedId}"]`) ?? null, 'auto')
    })
  }, [engine.save.blocks.length])

  const onScroll = () => {
    const node = feedRef.current
    if (!node) return
    follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 140
    if (follow.current) setHasUnread(false)
  }

  const act = (action: string) => {
    const nextLocale = detectTextLocale(action, cartridge.locale)
    if (nextLocale !== cartridge.locale) onLocaleChange(nextLocale)
    follow.current = true
    responseAnchor.current = { from: engine.save.blocks.length }
    audio.cue('action')
    engine.act(action, nextLocale)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (showResumeLatest) return
      if (event.key === 'Escape') setWorldOpen(false)
      if (event.key.toLowerCase() === 'w' && !(event.target instanceof HTMLInputElement)) setWorldOpen(true)
      const index = Number(event.key) - 1
      if (index >= 0 && index < engine.save.choices.length && !(event.target instanceof HTMLInputElement)) act(engine.save.choices[index].label)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [engine.save.choices, engine.busy, showResumeLatest])

  if (!engine.loaded) return <div className="st-loading" style={setCssTheme(cartridge)}><i /><span>{t(cartridge.locale, 'restoring')}</span></div>
  if (!engine.save.entered) return <Entry cartridge={cartridge} onEnter={() => { audio.cue('open'); engine.enter() }} onSelect={onSelect} mode={engine.mode} setMode={engine.setMode} hasSave={engine.save.scene > 0} remoteAvailable={Boolean(engine.save.remoteChatId)} />
  return <main className={`st-shell st-shell--${cartridge.theme.material}`} data-text-size={textSize} style={setCssTheme(cartridge)}>
    <ConversationHeader cartridge={cartridge} engine={engine} audio={audio} openWorld={openWorld} textSize={textSize} setTextSize={setTextSize} />
    <ConversationFeed cartridge={cartridge} engine={engine} feedRef={feedRef} endRef={endRef} onScroll={onScroll} player={player} />
    {showResumeLatest && <div className="st-resume-dialog" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="st-resume-title">
      <small>{t(cartridge.locale, confirmResumeRestart ? 'startOver' : 'resumeLatestTitle')}</small><h2 id="st-resume-title">{cartridge.copy.title}</h2><p>{t(cartridge.locale, confirmResumeRestart ? 'startOverWarning' : 'resumeLatestDescription')}</p>
      {!confirmResumeRestart ? <><button type="button" className="st-resume-dialog__primary" autoFocus onClick={() => { setShowResumeLatest(false); follow.current = true; scrollToLatestReadingContext(true, 'auto') }}>{t(cartridge.locale, 'resumeLatestAction')}<Icon name="arrow" /></button>
      <button type="button" className="st-resume-dialog__review" onClick={() => setConfirmResumeRestart(true)}>{t(cartridge.locale, 'resumeFromStart')}</button></> : <><button type="button" className="st-resume-dialog__danger" onClick={() => { setShowResumeLatest(false); setConfirmResumeRestart(false); engine.restartWorld() }}>{t(cartridge.locale, 'startOverConfirm')}</button>
      <button type="button" className="st-resume-dialog__review" autoFocus onClick={() => setConfirmResumeRestart(false)}>{t(cartridge.locale, 'startOverCancel')}</button></>}
    </section></div>}
    {hasUnread && <button className="st-new-content" onClick={() => { follow.current = true; scrollToLatestReadingContext(true) }}>{t(cartridge.locale, 'newContent')}<Icon name="arrow" /></button>}
    <Composer cartridge={cartridge} engine={engine} onAct={act} />
    {worldOpen && <WorldDrawer active={worldTab} setActive={setWorldTab} detail={worldDetail} setDetail={setWorldDetail} cartridge={cartridge} engine={engine} close={() => setWorldOpen(false)} player={player} />}
  </main>
}

export default function StoryShell() {
  const initial = useInitialCartridge()
  const [cartridgeId, setCartridgeId] = useState(initial ?? DEFAULT_CARTRIDGE_ID)
  const [locale, setLocale] = useState<Locale>(() => detectLocale())
  const cartridge = useMemo(() => resolveCartridge(cartridgeId, locale), [cartridgeId, locale])
  const params = new URLSearchParams(window.location.search)
  const chatId = params.get('chat_id') || undefined
  const mode: StoryMode = chatId ? 'remote' : params.get('story_mode') === 'demo' ? 'demo' : 'aigram'
  useEffect(() => { document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en' }, [locale])
  const select = (id: string) => {
    const url = new URL(window.location.href); url.searchParams.set('cartridge', id); url.searchParams.delete('chat_id'); window.history.replaceState({}, '', url)
    setCartridgeId(id)
  }
  const changeLocale = (next: Locale) => { rememberLocale(next); setLocale(next) }
  return <Game key={cartridge.id} cartridge={cartridge} mode={mode} chatId={chatId} onSelect={select} onLocaleChange={changeLocale} />
}
