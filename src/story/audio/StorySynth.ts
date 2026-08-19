import type { StoryAudioTheme } from '../types'

export type StoryAudioCue = 'open' | 'action' | 'success' | 'failure' | 'change' | 'discovery' | 'treasure' | 'image' | 'summary' | 'error'

type AudioContextConstructor = typeof AudioContext
type StoppableNode = AudioBufferSourceNode | OscillatorNode
const MAX_TRANSIENT_VOICES = 6

function contextConstructor(): AudioContextConstructor | undefined {
  return window.AudioContext ?? (window as Window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function frequency(root: number, semitones: number): number {
  return root * 2 ** (semitones / 12)
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
  private activeVoices = 0
  private stateListener: ((running: boolean) => void) | null = null

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

  configure(theme: StoryAudioTheme, tension: number): void {
    const changed = this.theme?.material !== theme.material
    this.theme = theme
    this.tension = clampUnit(tension)
    if (changed && this.unlocked) {
      this.stopMusic()
      this.stopAmbient()
      this.startAmbient()
      this.startMusic()
    }
    this.applyLevels(.16)
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
      if (!this.ambientNodes.length) this.startAmbient()
      if (this.musicTimer === null) this.startMusic()
      this.applyLevels(.08)
      return true
    } catch {
      return false
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    this.applyLevels(.12)
  }

  async setPageVisible(visible: boolean): Promise<void> {
    if (!this.context || !this.unlocked) return
    try {
      if (!visible && this.context.state === 'running') await this.context.suspend()
      const state = String(this.context.state)
      if (visible && !this.muted && state !== 'running' && state !== 'closed') await this.context.resume()
    } catch {
      // Audio is optional and must never affect the story.
    }
  }

  cue(cue: StoryAudioCue): void {
    const context = this.context
    const theme = this.theme
    if (!context || !theme || this.muted || context.state !== 'running') return
    const root = theme.rootHz
    const softer = theme.material === 'apartment'
    const woody = theme.material === 'wayfarer'
    if (cue === 'open') {
      this.tone('sfx', root * 2, root * 2.5, .22, softer ? 'sine' : 'triangle', .34)
      this.tone('sfx', root * 2.5, root * 3, .28, 'sine', .22, .09)
    }
    if (cue === 'action') {
      this.noise(.055, softer ? 950 : woody ? 720 : 1450, softer ? .15 : woody ? .12 : .22)
      this.tone('sfx', softer ? 460 : woody ? 220 : 520, softer ? 390 : woody ? 180 : 410, woody ? .09 : .075, 'triangle', woody ? .2 : .24)
    }
    if (cue === 'success') {
      ;[0, 4, 7].forEach((step, index) => this.tone('sfx', frequency(root * 3, step), frequency(root * 3, step), .16, 'sine', .2, index * .075))
    }
    if (cue === 'failure' || cue === 'error') {
      this.tone('sfx', root * 2.2, root * (cue === 'error' ? 1.25 : 1.45), cue === 'error' ? .14 : .24, 'triangle', cue === 'error' ? .14 : .22)
    }
    if (cue === 'change') {
      this.tone('sfx', root * 2.6, root * 2.78, .12, 'sine', .13)
    }
    if (cue === 'discovery') {
      ;[0, 7, 12].forEach((step, index) => this.tone('sfx', frequency(root * 2.4, step), frequency(root * 2.4, step), .42, 'sine', .16, index * .11))
    }
    if (cue === 'treasure') {
      ;[0, 2, 5, 7, 9].forEach((step, index) => this.tone('sfx', frequency(root * 2.4, step), frequency(root * 2.4, step), .42, index % 2 ? 'triangle' : 'sine', .13, index * .07))
    }
    if (cue === 'image') {
      this.tone('sfx', 760, 910, .18, 'sine', .14)
      this.tone('sfx', 1060, 1120, .3, 'sine', .1, .08)
    }
    if (cue === 'summary') {
      ;[0, theme.scale[2] ?? 4, theme.scale[4] ?? 9].forEach((step, index) => this.tone('sfx', frequency(root * 2, step), frequency(root * 2, step), .7, 'sine', .13, index * .1))
    }
  }

  dispose(): void {
    this.stopMusic()
    this.stopAmbient()
    const context = this.context
    this.context = null
    this.master = null
    this.music = null
    this.ambient = null
    this.sfx = null
    this.unlocked = false
    if (context) void context.close().catch(() => undefined)
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
    const duration = 4
    const buffer = context.createBuffer(1, context.sampleRate * duration, context.sampleRate)
    const samples = buffer.getChannelData(0)
    let smooth = 0
    for (let index = 0; index < samples.length; index += 1) {
      const white = Math.random() * 2 - 1
      smooth = theme.material === 'harbor' ? smooth * .986 + white * .014 : theme.material === 'wayfarer' ? smooth * .972 + white * .028 : smooth * .94 + white * .06
      samples[index] = smooth
    }
    const noise = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const gain = context.createGain()
    noise.buffer = buffer
    noise.loop = true
    filter.type = theme.material === 'harbor' ? 'bandpass' : 'lowpass'
    filter.frequency.value = theme.material === 'harbor' ? 590 : theme.material === 'wayfarer' ? 720 : 880
    filter.Q.value = theme.material === 'harbor' ? .55 : .3
    gain.gain.value = theme.material === 'harbor' ? .7 : theme.material === 'wayfarer' ? .5 : .42
    noise.connect(filter)
    filter.connect(gain)
    gain.connect(output)
    noise.start()

    const drone = context.createOscillator()
    const droneGain = context.createGain()
    drone.type = 'sine'
    drone.frequency.value = theme.material === 'harbor' ? 55 : theme.material === 'wayfarer' ? 73.42 : 60
    droneGain.gain.value = theme.material === 'harbor' ? .07 : theme.material === 'wayfarer' ? .018 : .025
    drone.connect(droneGain)
    droneGain.connect(output)
    drone.start()
    this.ambientNodes = [noise, drone]
  }

  private stopAmbient(): void {
    this.ambientNodes.forEach((node) => {
      try { node.stop() } catch { /* already stopped */ }
      node.disconnect()
    })
    this.ambientNodes = []
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
      this.musicStep = (this.musicStep + 1) % 8
      return
    }
    const beat = 60 / theme.bpm
    const step = this.musicStep % 8
    if (step === 0) {
      const cycle = Math.floor(this.musicStep / 8)
      const scale = theme.scale
      const rootStep = scale[[0, 3, 1, 4][cycle % 4] % scale.length] ?? 0
      const tenseShift = this.tension > .68 ? 1 : 0
      const chord = [rootStep, scale[(2 + tenseShift) % scale.length] ?? 4, scale[4] ?? 9]
      chord.forEach((interval, index) => {
        this.tone('music', frequency(theme.rootHz, interval + (index ? 12 : 0)), frequency(theme.rootHz, interval + (index ? 12 : 0)), beat * 7.2, theme.material === 'harbor' ? 'triangle' : 'sine', .055 - index * .008)
      })
    }
    const pulseEvery = this.tension > .62 ? 2 : 4
    if (step % pulseEvery === 2 % pulseEvery) {
      const interval = theme.scale[(step / 2 + Math.round(this.tension * 2)) % theme.scale.length] ?? 0
      this.tone('music', frequency(theme.rootHz * 2, interval), frequency(theme.rootHz * 2, interval), theme.material === 'harbor' ? .3 : .52, theme.material === 'harbor' ? 'triangle' : 'sine', .045)
    }
    if (theme.material === 'apartment' && step === 6 && this.tension < .55) {
      this.tone('music', frequency(theme.rootHz * 2, theme.scale[4] ?? 9), frequency(theme.rootHz * 2, theme.scale[4] ?? 9), .72, 'sine', .035)
    }
    this.musicStep += 1
  }

  private tone(bus: 'music' | 'sfx', from: number, to: number, duration: number, type: OscillatorType, level: number, delay = 0): void {
    const context = this.context
    const output = bus === 'music' ? this.music : this.sfx
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
    const context = this.context
    const output = this.sfx
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
    filter.Q.value = .8
    gain.gain.value = level
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
    source.start()
  }
}
