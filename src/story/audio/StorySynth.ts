import type { StoryAudioCueName, StoryAudioTheme, StoryRecordedTrack } from '../types'

export type StoryAudioCue = StoryAudioCueName

type AudioContextConstructor = typeof AudioContext
type StoppableNode = AudioBufferSourceNode | OscillatorNode
const MAX_TRANSIENT_VOICES = 14

export const SYNTH_AMBIENT_PROFILE = {
  textureSeconds: 19,
  crossfadeSeconds: 1.4,
  detailDelaySeconds: [7, 17] as const,
} as const

export const RECORDED_SOUND_PROFILE = {
  musicRepeatDelayMs: 5_000,
  ambienceRepeatDelayMs: 7_000,
  maxCueVoices: 4,
} as const

export function resolveRecordedAmbience(theme: StoryAudioTheme, locationId?: string): StoryRecordedTrack | undefined {
  return (locationId ? theme.recorded?.ambienceByLocationId?.[locationId] : undefined) ?? theme.recorded?.ambience
}

function safeTrackGain(track: StoryRecordedTrack | undefined): number {
  return clampUnit(track?.gain ?? 0)
}

function contextConstructor(): AudioContextConstructor | undefined {
  return window.AudioContext ?? (window as Window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function frequency(root: number, semitones: number): number {
  return root * 2 ** (semitones / 12)
}

/** Creates a seamless stereo noise texture without a short prerecorded loop. */
export function createAmbientTexture(
  sampleRate: number,
  material: StoryAudioTheme['material'],
  random: () => number = Math.random,
): [Float32Array, Float32Array] {
  const outputLength = Math.floor(sampleRate * SYNTH_AMBIENT_PROFILE.textureSeconds)
  const overlap = Math.floor(sampleRate * SYNTH_AMBIENT_PROFILE.crossfadeSeconds)
  const channels = ([0, 1] as const).map(() => {
    const source = new Float32Array(outputLength + overlap)
    const smoothing = material === 'harbor' ? .972 : material === 'wayfarer' ? .958 : .94
    let fast = 0
    let slow = 0
    for (let index = 0; index < source.length; index += 1) {
      const white = random() * 2 - 1
      fast = fast * smoothing + white * (1 - smoothing)
      slow = slow * .9987 + white * .0013
      source[index] = fast * .84 + slow * .16
    }
    const output = new Float32Array(outputLength)
    output.set(source.subarray(0, outputLength))
    // The tail precedes source[outputLength]; blend that continuation into the
    // head so the loop boundary and the end of the overlap both stay continuous.
    for (let index = 0; index < overlap; index += 1) {
      const phase = index / Math.max(1, overlap - 1)
      const eased = phase * phase * (3 - 2 * phase)
      output[index] = source[outputLength + index] * (1 - eased) + source[index] * eased
    }
    return output
  })
  return [channels[0], channels[1]]
}

export class StorySynth {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private music: GainNode | null = null
  private ambient: GainNode | null = null
  private sfx: GainNode | null = null
  private theme: StoryAudioTheme | null = null
  private tension = .25
  private muted = false
  private unlocked = false
  private musicTimer: number | null = null
  private musicStep = 0
  private ambientNodes: StoppableNode[] = []
  private ambientConnections: AudioNode[] = []
  private ambientDetailTimer: number | null = null
  private activeVoices = 0
  private stateListener: ((running: boolean) => void) | null = null
  private locationId = ''
  private recordedMusic: HTMLAudioElement | null = null
  private recordedAmbience: HTMLAudioElement | null = null
  private recordedMusicTrack: StoryRecordedTrack | undefined
  private recordedAmbienceTrack: StoryRecordedTrack | undefined
  private recordedMusicTimer: number | null = null
  private recordedAmbienceTimer: number | null = null
  private recordedCueVoices = new Set<HTMLAudioElement>()

  get supported(): boolean {
    return Boolean(contextConstructor())
  }

  get running(): boolean {
    return Boolean(this.unlocked && this.context?.state === 'running')
  }

  setStateListener(listener: ((running: boolean) => void) | null): void {
    this.stateListener = listener
    listener?.(this.running)
  }

  configure(theme: StoryAudioTheme, tension: number, locationId?: string): void {
    const changed = this.theme?.material !== theme.material
    const locationChanged = this.locationId !== (locationId ?? '')
    this.theme = theme
    this.tension = clampUnit(tension)
    this.locationId = locationId ?? ''
    this.syncRecordedMusic(theme.recorded?.music)
    if (locationChanged || !this.recordedAmbience) this.syncRecordedAmbience(resolveRecordedAmbience(theme, locationId))
    if (changed && this.unlocked) {
      this.stopMusic()
      this.stopAmbient()
      if (!this.recordedAmbienceTrack) this.startAmbient()
      if (!this.recordedMusicTrack) this.startMusic()
    }
    this.applyLevels(.16)
    this.applyRecordedLevels()
  }

  async unlock(): Promise<boolean> {
    if (!this.supported || !this.theme) return false
    if (!this.context) this.createGraph()
    const context = this.context
    if (!context) return false
    try {
      const state = String(context.state)
      if (state !== 'running' && state !== 'closed') await context.resume()
      if (context.state !== 'running') return false
      this.primeOutput()
      this.unlocked = true
      this.stateListener?.(true)
      if (this.recordedAmbienceTrack) this.playRecordedBed('ambient')
      else if (!this.ambientNodes.length) this.startAmbient()
      if (this.recordedMusicTrack) this.playRecordedBed('music')
      else if (this.musicTimer === null) this.startMusic()
      this.applyLevels(.08)
      this.applyRecordedLevels()
      return true
    } catch {
      return false
    }
  }

  setMuted(muted: boolean): void {
    const changed = this.muted !== muted
    this.muted = muted
    this.applyLevels(.12)
    this.applyRecordedLevels()
    if (!changed) return
    if (muted) this.pauseRecordedBeds()
    else if (this.unlocked && this.context?.state === 'running') this.resumeRecordedBeds()
  }

  async setPageVisible(visible: boolean): Promise<void> {
    if (!this.context || !this.unlocked) return
    try {
      if (!visible && this.context.state === 'running') await this.context.suspend()
      const state = String(this.context.state)
      if (visible && !this.muted && state !== 'running' && state !== 'closed') await this.context.resume()
      if (!visible) this.pauseRecordedBeds()
      else if (!this.muted) this.resumeRecordedBeds()
    } catch {
      // Audio is optional and must never affect the story.
    }
  }

  cue(cue: StoryAudioCue): void {
    const context = this.context
    const theme = this.theme
    if (!context || !theme || this.muted || context.state !== 'running') return
    if (this.playRecordedCue(cue)) return
    this.playSynthCue(cue)
  }

  private playSynthCue(cue: StoryAudioCue): void {
    const theme = this.theme
    if (!theme) return
    const softer = theme.material === 'apartment'
    const woody = theme.material === 'wayfarer'
    if (cue === 'open') {
      this.woodKnock(.15)
      this.metalStrike(.075, .11, true)
      this.tone('sfx', 92, 72, .62, 'sine', .055, .04)
    }
    if (cue === 'action') {
      this.paperFlick(woody ? .12 : softer ? .095 : .14)
      this.woodKnock(woody ? .075 : .065, .055)
    }
    if (cue === 'success') {
      this.woodKnock(.14)
      this.tone('sfx', 294, 292, .42, 'sine', .07, .035)
      this.tone('sfx', 438, 434, .34, 'sine', .042, .035)
    }
    if (cue === 'failure' || cue === 'error') {
      this.woodKnock(cue === 'error' ? .12 : .09)
      this.tone('sfx', cue === 'error' ? 118 : 104, cue === 'error' ? 69 : 78, cue === 'error' ? .18 : .34, 'triangle', cue === 'error' ? .07 : .052, .025)
      if (cue === 'error') this.woodKnock(.06, .115)
    }
    if (cue === 'change') {
      this.woodKnock(.065)
    }
    if (cue === 'discovery') {
      this.filteredNoise('sfx', .26, 1850, .07, 0, .55)
      this.woodKnock(.08, .08)
      this.tone('sfx', 132, 96, .72, 'sine', .038, .04)
    }
    if (cue === 'treasure') {
      this.paperFlick(.095)
      this.metalStrike(.11, .07)
      this.woodKnock(.07, .18)
    }
    if (cue === 'image') {
      // Dry brush across cold-press paper; avoid the old electronic two-note ping.
      this.filteredNoise('sfx', .22, 2600, .085, 0, .48)
      this.filteredNoise('sfx', .12, 5100, .038, .09, .65)
      this.woodKnock(.038, .18)
    }
    if (cue === 'summary') {
      this.paperFlick(.075)
      this.woodKnock(.09, .12)
      this.tone('sfx', 110, 82, .84, 'sine', .035, .08)
    }
    if (cue === 'coinGain') {
      this.metalStrike(.13)
      this.woodKnock(.048, .045)
    }
    if (cue === 'coinSpend') {
      this.metalStrike(.08, 0, true)
      this.woodKnock(.07, .025)
    }
    if (cue === 'energy') {
      this.filteredNoise('sfx', .16, 980, .06, 0, .45)
      this.tone('sfx', 132, 94, .32, 'triangle', .038, .015)
    }
    if (cue === 'standing') {
      this.metalStrike(.065, 0, true)
      this.woodKnock(.045, .06)
    }
    if (cue === 'relationship') {
      this.woodKnock(.06)
      this.woodKnock(.05, .12)
      this.tone('sfx', 196, 194, .48, 'sine', .032, .08)
    }
    if (cue === 'travel') {
      this.railJoint(0)
      this.railJoint(.34)
      this.tone('sfx', 86, 61, 1.05, 'sine', .052, .06)
    }
    if (cue === 'item') {
      this.paperFlick(.08)
      this.woodKnock(.07, .09)
    }
  }

  dispose(): void {
    this.stopMusic()
    this.stopAmbient()
    this.stopRecordedAudio()
    const context = this.context
    this.context = null
    this.master = null
    this.music = null
    this.ambient = null
    this.sfx = null
    this.unlocked = false
    if (context) void context.close().catch(() => undefined)
  }

  private createRecordedElement(track: StoryRecordedTrack): HTMLAudioElement | null {
    if (typeof Audio === 'undefined') return null
    const element = new Audio(track.src)
    element.preload = 'auto'
    return element
  }

  private syncRecordedMusic(track: StoryRecordedTrack | undefined): void {
    if (this.recordedMusicTrack?.src === track?.src) {
      this.recordedMusicTrack = track
      return
    }
    this.clearRecordedTimer('music')
    this.recordedMusic?.pause()
    this.recordedMusic = track ? this.createRecordedElement(track) : null
    this.recordedMusicTrack = track
    if (this.recordedMusic) this.recordedMusic.onended = () => this.scheduleRecordedReplay('music')
    if (this.unlocked && track && !this.muted) this.playRecordedBed('music')
    else if (this.unlocked && !track) this.startMusic()
  }

  private syncRecordedAmbience(track: StoryRecordedTrack | undefined): void {
    if (this.recordedAmbienceTrack?.src === track?.src) {
      this.recordedAmbienceTrack = track
      return
    }
    this.clearRecordedTimer('ambient')
    this.recordedAmbience?.pause()
    this.recordedAmbience = track ? this.createRecordedElement(track) : null
    this.recordedAmbienceTrack = track
    if (this.recordedAmbience) this.recordedAmbience.onended = () => this.scheduleRecordedReplay('ambient')
    if (this.unlocked && track && !this.muted) this.playRecordedBed('ambient')
    else if (this.unlocked && !track) this.startAmbient()
  }

  private playRecordedBed(kind: 'music' | 'ambient'): void {
    const element = kind === 'music' ? this.recordedMusic : this.recordedAmbience
    const track = kind === 'music' ? this.recordedMusicTrack : this.recordedAmbienceTrack
    if (!element || !track || this.muted || document.hidden) return
    this.clearRecordedTimer(kind)
    this.applyRecordedLevels()
    void element.play()
      .then(() => {
        // A previous network/autoplay failure may already have started the
        // synthesized fallback. Keep only one bed once the recorded asset works.
        if (kind === 'music') this.stopMusic()
        else this.stopAmbient()
      })
      .catch(() => {
        if (kind === 'music' && this.musicTimer === null) this.startMusic()
        if (kind === 'ambient' && !this.ambientNodes.length) this.startAmbient()
      })
  }

  private scheduleRecordedReplay(kind: 'music' | 'ambient'): void {
    if (this.muted || document.hidden) return
    this.clearRecordedTimer(kind)
    const delay = kind === 'music' ? RECORDED_SOUND_PROFILE.musicRepeatDelayMs : RECORDED_SOUND_PROFILE.ambienceRepeatDelayMs
    const timer = window.setTimeout(() => {
      const element = kind === 'music' ? this.recordedMusic : this.recordedAmbience
      if (element) element.currentTime = 0
      this.playRecordedBed(kind)
    }, delay)
    if (kind === 'music') this.recordedMusicTimer = timer
    else this.recordedAmbienceTimer = timer
  }

  private clearRecordedTimer(kind: 'music' | 'ambient'): void {
    const timer = kind === 'music' ? this.recordedMusicTimer : this.recordedAmbienceTimer
    if (timer !== null) window.clearTimeout(timer)
    if (kind === 'music') this.recordedMusicTimer = null
    else this.recordedAmbienceTimer = null
  }

  private pauseRecordedBeds(): void {
    this.clearRecordedTimer('music')
    this.clearRecordedTimer('ambient')
    this.recordedMusic?.pause()
    this.recordedAmbience?.pause()
  }

  private resumeRecordedBeds(): void {
    if (this.recordedMusicTrack) this.playRecordedBed('music')
    if (this.recordedAmbienceTrack) this.playRecordedBed('ambient')
  }

  private applyRecordedLevels(): void {
    const master = this.muted ? 0 : clampUnit(this.theme?.levels.master ?? 0)
    if (this.recordedMusic) this.recordedMusic.volume = master * safeTrackGain(this.recordedMusicTrack)
    if (this.recordedAmbience) this.recordedAmbience.volume = master * safeTrackGain(this.recordedAmbienceTrack)
  }

  private playRecordedCue(cue: StoryAudioCue): boolean {
    const track = this.theme?.recorded?.cues?.[cue]
    if (!track || typeof Audio === 'undefined' || this.recordedCueVoices.size >= RECORDED_SOUND_PROFILE.maxCueVoices) return false
    const element = this.createRecordedElement(track)
    if (!element) return false
    element.volume = clampUnit(this.theme?.levels.master ?? 0) * safeTrackGain(track)
    this.recordedCueVoices.add(element)
    const cleanup = () => { element.pause(); this.recordedCueVoices.delete(element) }
    element.onended = cleanup
    void element.play().catch(() => { cleanup(); this.playSynthCue(cue) })
    return true
  }

  private stopRecordedAudio(): void {
    this.pauseRecordedBeds()
    this.recordedMusic = null
    this.recordedAmbience = null
    this.recordedMusicTrack = undefined
    this.recordedAmbienceTrack = undefined
    this.recordedCueVoices.forEach((element) => element.pause())
    this.recordedCueVoices.clear()
  }

  private createGraph(): void {
    const Constructor = contextConstructor()
    if (!Constructor || !this.theme) return
    const context = new Constructor()
    context.onstatechange = () => this.stateListener?.(this.running)
    const master = context.createGain()
    const music = context.createGain()
    const ambient = context.createGain()
    const sfx = context.createGain()
    const limiter = context.createDynamicsCompressor()
    limiter.threshold.value = -12
    limiter.knee.value = 8
    limiter.ratio.value = 12
    limiter.attack.value = .003
    limiter.release.value = .18
    music.connect(master)
    ambient.connect(master)
    sfx.connect(master)
    master.connect(limiter)
    limiter.connect(context.destination)
    this.context = context
    this.master = master
    this.music = music
    this.ambient = ambient
    this.sfx = sfx
    this.applyLevels(0)
  }

  private primeOutput(): void {
    const context = this.context
    const output = this.master
    if (!context || !output) return
    const buffer = context.createBuffer(1, 1, context.sampleRate)
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(output)
    source.onended = () => source.disconnect()
    source.start()
  }

  private applyLevels(seconds: number): void {
    if (!this.context || !this.theme || !this.master || !this.music || !this.ambient || !this.sfx) return
    const now = this.context.currentTime
    const ramp = (param: AudioParam, value: number) => {
      param.cancelScheduledValues(now)
      param.setValueAtTime(param.value, now)
      param.linearRampToValueAtTime(value, now + seconds)
    }
    ramp(this.master.gain, this.muted ? 0 : this.theme.levels.master)
    ramp(this.music.gain, this.theme.levels.music)
    ramp(this.ambient.gain, this.theme.levels.ambient)
    ramp(this.sfx.gain, this.theme.levels.sfx)
  }

  private startAmbient(): void {
    const context = this.context
    const output = this.ambient
    const theme = this.theme
    if (!context || !output || !theme || this.ambientNodes.length) return
    const texture = createAmbientTexture(context.sampleRate, theme.material)
    const buffer = context.createBuffer(2, texture[0].length, context.sampleRate)
    buffer.getChannelData(0).set(texture[0])
    buffer.getChannelData(1).set(texture[1])
    const noise = context.createBufferSource()
    noise.buffer = buffer
    noise.loop = true

    const rainFilter = context.createBiquadFilter()
    const rainGain = context.createGain()
    rainFilter.type = 'bandpass'
    rainFilter.frequency.value = theme.material === 'wayfarer' ? 2850 : theme.material === 'harbor' ? 2300 : 3250
    rainFilter.Q.value = .42
    rainGain.gain.value = theme.material === 'wayfarer' ? .34 : .27
    noise.connect(rainFilter)
    rainFilter.connect(rainGain)
    rainGain.connect(output)

    const bodyFilter = context.createBiquadFilter()
    const bodyGain = context.createGain()
    bodyFilter.type = 'lowpass'
    bodyFilter.frequency.value = theme.material === 'wayfarer' ? 310 : theme.material === 'harbor' ? 220 : 380
    bodyFilter.Q.value = .35
    bodyGain.gain.value = theme.material === 'wayfarer' ? .22 : .16
    noise.connect(bodyFilter)
    bodyFilter.connect(bodyGain)
    bodyGain.connect(output)

    const rainLfo = context.createOscillator()
    const rainLfoDepth = context.createGain()
    rainLfo.frequency.value = .018
    rainLfoDepth.gain.value = .055
    rainLfo.connect(rainLfoDepth)
    rainLfoDepth.connect(rainGain.gain)

    const bodyLfo = context.createOscillator()
    const bodyLfoDepth = context.createGain()
    bodyLfo.frequency.value = .027
    bodyLfoDepth.gain.value = .035
    bodyLfo.connect(bodyLfoDepth)
    bodyLfoDepth.connect(bodyGain.gain)

    noise.start()
    rainLfo.start()
    bodyLfo.start()
    this.ambientNodes = [noise, rainLfo, bodyLfo]
    this.ambientConnections = [rainFilter, rainGain, bodyFilter, bodyGain, rainLfoDepth, bodyLfoDepth]
    this.scheduleAmbientDetail()
  }

  private stopAmbient(): void {
    if (this.ambientDetailTimer !== null) window.clearTimeout(this.ambientDetailTimer)
    this.ambientDetailTimer = null
    this.ambientNodes.forEach((node) => {
      try { node.stop() } catch { /* already stopped */ }
      node.disconnect()
    })
    this.ambientConnections.forEach((node) => node.disconnect())
    this.ambientNodes = []
    this.ambientConnections = []
  }

  private scheduleAmbientDetail(): void {
    if (!this.context || !this.theme || this.ambientDetailTimer !== null) return
    const [minimum, maximum] = SYNTH_AMBIENT_PROFILE.detailDelaySeconds
    const delay = (minimum + Math.random() * (maximum - minimum)) * 1000
    this.ambientDetailTimer = window.setTimeout(() => {
      this.ambientDetailTimer = null
      if (!this.muted && this.context?.state === 'running') this.playAmbientDetail()
      this.scheduleAmbientDetail()
    }, delay)
  }

  private playAmbientDetail(): void {
    const roll = Math.random()
    if (roll < .5) {
      // One or two drops on glass/canvas, kept below the narrative foreground.
      this.filteredNoise('ambient', .022, 3300 + Math.random() * 1500, .055, 0, 1.1)
      if (Math.random() > .58) this.filteredNoise('ambient', .018, 2600 + Math.random() * 1200, .038, .11, 1.2)
      return
    }
    if (roll < .82) {
      // A distant rail joint: short broadband contact plus a restrained wooden body.
      this.filteredNoise('ambient', .032, 1250, .028, 0, .72)
      this.tone('ambient', 118, 91, .28, 'triangle', .014)
      return
    }
    // Carriage or awning settling; deliberately non-melodic and very rare.
    this.tone('ambient', 82, 67, .62, 'sine', .011)
  }

  private startMusic(): void {
    if (this.musicTimer !== null || !this.theme) return
    this.musicStep = 0
    const tick = () => {
      if (!this.theme || !this.context) return
      this.playMusicStep()
      const beatMs = 60000 / this.theme.bpm
      this.musicTimer = window.setTimeout(tick, beatMs)
    }
    tick()
  }

  private stopMusic(): void {
    if (this.musicTimer !== null) window.clearTimeout(this.musicTimer)
    this.musicTimer = null
    this.musicStep = 0
  }

  private playMusicStep(): void {
    const theme = this.theme
    if (!theme || this.muted || !this.context || this.context.state !== 'running') {
      this.musicStep = (this.musicStep + 1) % 16
      return
    }
    const beat = 60 / theme.bpm
    const step = this.musicStep % 16
    if (step === 0) {
      const cycle = Math.floor(this.musicStep / 16)
      const scale = theme.scale
      const rootStep = scale[[0, 3, 1, 4][cycle % 4] % scale.length] ?? 0
      const tenseShift = this.tension > .68 ? 1 : 0
      const chord = [rootStep, scale[(2 + tenseShift) % scale.length] ?? 4, scale[4] ?? 9]
      chord.forEach((interval, index) => {
        this.tone('music', frequency(theme.rootHz, interval + (index ? 12 : 0)), frequency(theme.rootHz, interval + (index ? 12 : 0)), beat * 13.5, theme.material === 'harbor' ? 'triangle' : 'sine', .032 - index * .005)
      })
    }
    const sparseSteps = this.tension > .62 ? [4, 9, 13] : [6, 13]
    if (sparseSteps.includes(step)) {
      const interval = theme.scale[(step + Math.round(this.tension * 3)) % theme.scale.length] ?? 0
      this.tone('music', frequency(theme.rootHz * 2, interval), frequency(theme.rootHz * 2, interval), theme.material === 'harbor' ? .28 : .48, theme.material === 'harbor' ? 'triangle' : 'sine', .024)
    }
    if (theme.material === 'apartment' && step === 11 && this.tension < .55) {
      this.tone('music', frequency(theme.rootHz * 2, theme.scale[4] ?? 9), frequency(theme.rootHz * 2, theme.scale[4] ?? 9), .72, 'sine', .035)
    }
    this.musicStep += 1
  }

  private tone(bus: 'music' | 'ambient' | 'sfx', from: number, to: number, duration: number, type: OscillatorType, level: number, delay = 0): void {
    const context = this.context
    const output = bus === 'music' ? this.music : bus === 'ambient' ? this.ambient : this.sfx
    if (!context || !output || this.activeVoices >= MAX_TRANSIENT_VOICES) return
    const start = context.currentTime + delay
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(Math.max(20, from), start)
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + duration)
    gain.gain.setValueAtTime(.0001, start)
    gain.gain.exponentialRampToValueAtTime(Math.max(.0001, level), start + Math.min(.08, duration * .2))
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration)
    oscillator.connect(gain)
    gain.connect(output)
    this.activeVoices += 1
    oscillator.onended = () => {
      oscillator.disconnect()
      gain.disconnect()
      this.activeVoices = Math.max(0, this.activeVoices - 1)
    }
    oscillator.start(start)
    oscillator.stop(start + duration + .02)
  }

  private noise(duration: number, centerFrequency: number, level: number): void {
    this.filteredNoise('sfx', duration, centerFrequency, level)
  }

  private paperFlick(level: number, delay = 0): void {
    this.filteredNoise('sfx', .09, 1850, level, delay, .52)
    this.filteredNoise('sfx', .045, 4100, level * .42, delay + .025, .72)
  }

  private woodKnock(level: number, delay = 0): void {
    this.filteredNoise('sfx', .024, 880, level * .75, delay, .65)
    this.tone('sfx', 154, 108, .18, 'triangle', level, delay)
  }

  private metalStrike(level: number, delay = 0, muted = false): void {
    const base = muted ? 610 : 760
    const duration = muted ? .22 : .42
    ;[1, 1.47, 2.13, 2.76].forEach((ratio, index) => {
      const partial = base * ratio
      this.tone('sfx', partial, partial * (muted ? .985 : .997), duration * (1 - index * .11), 'sine', level * (1 - index * .2), delay + index * .004)
    })
  }

  private railJoint(delay: number): void {
    this.filteredNoise('sfx', .035, 1180, .065, delay, .68)
    this.tone('sfx', 126, 88, .29, 'triangle', .045, delay)
  }

  private filteredNoise(bus: 'ambient' | 'sfx', duration: number, centerFrequency: number, level: number, delay = 0, q = .8): void {
    const context = this.context
    const output = bus === 'ambient' ? this.ambient : this.sfx
    if (!context || !output || this.activeVoices >= MAX_TRANSIENT_VOICES) return
    const buffer = context.createBuffer(1, Math.max(1, Math.floor(context.sampleRate * duration)), context.sampleRate)
    const samples = buffer.getChannelData(0)
    for (let index = 0; index < samples.length; index += 1) samples[index] = (Math.random() * 2 - 1) * (1 - index / samples.length)
    const source = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const gain = context.createGain()
    source.buffer = buffer
    filter.type = 'bandpass'
    filter.frequency.value = centerFrequency
    filter.Q.value = q
    const start = context.currentTime + delay
    gain.gain.setValueAtTime(.0001, start)
    gain.gain.exponentialRampToValueAtTime(Math.max(.0001, level), start + Math.min(.012, duration * .22))
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration)
    source.connect(filter)
    filter.connect(gain)
    gain.connect(output)
    this.activeVoices += 1
    source.onended = () => {
      source.disconnect()
      filter.disconnect()
      gain.disconnect()
      this.activeVoices = Math.max(0, this.activeVoices - 1)
    }
    source.start(start)
  }
}
