import type {
  DemoTurn,
  DomainActionRule,
  PresetEventDefinition,
  StoryCartridge,
  StoryDangerDirector,
  StoryImageDirector,
} from '../types'

const coverImage = new URL('../img/worlds/after-the-red-light.webp', import.meta.url).href
const entryImage = new URL('../img/worlds/after-the-red-light-entry.webp', import.meta.url).href
const audioThemeUrl = new URL('../audio/assets/theme.mp3', import.meta.url).href
const audioAmbienceUrl = new URL('../audio/assets/ambience.mp3', import.meta.url).href
const audioFeatureUrl = new URL('../audio/assets/feature.mp3', import.meta.url).href

type Language = 'zh' | 'en'

function imageDirector(): StoryImageDirector {
  return {
    maxQuietTurns: 3,
    softCooldownTurns: 2,
    guaranteedTriggers: ['new-location', 'character-expression', 'chapter-checkpoint'],
    softTriggers: ['relationship-change', 'objective-change', 'rare-item', 'skill-outcome'],
    perspective: { ordinary: 'balanced', importantDialogue: 'first-person', newLocation: 'observer' },
  }
}

function dangerDirector(locale: Language): StoryDangerDirector {
  const zh = locale === 'zh'
  const threats = zh
    ? ['走廊镜子正在模仿一个你没有做过的动作', '旅馆电话重复了一句无人听见的亲密话语', '电梯打开在黄铜目录上不存在的楼层', '锁住的房间正用你信任之人的声音回答', '身后的红灯一盏接一盏熄灭']
    : ['the corridor mirrors copy a gesture you did not make', 'the hotel phone repeats an intimate sentence no caller heard', 'the lift opens onto a floor absent from the brass directory', 'a locked room answers in the voice of someone you trust', 'the red lamps go dark one by one behind you']
  return {
    minSafeTurns: 2,
    maxSafeTurns: 4,
    cooldownTurns: 2,
    graceScenes: 1,
    escalationStats: ['desire', 'composure'],
    threatPalette: threats,
    threatLocations: {
      [threats[0]]: ['corridor', 'guest-room'],
      [threats[1]]: ['lobby', 'lounge', 'guest-room'],
      [threats[2]]: ['lobby', 'corridor', 'laundry'],
      [threats[3]]: ['corridor', 'guest-room', 'laundry'],
      [threats[4]]: ['lobby', 'lounge', 'corridor', 'guest-room', 'laundry', 'glasshouse'],
    },
    methods: zh
      ? ['说出眼前究竟哪一处发生了变化', '走进最近一间仍有人在的亮处', '点燃一根红色火柴照出被藏起的细节']
      : ['Name the exact thing that changed in front of you', 'Step into the nearest lit room with other people', 'Light one red match to reveal the hidden detail'],
    physicalCombat: 'none',
    resolution: {
      skill: zh ? '辨认真相' : 'Recognize the truth',
      modifier: 2,
      dcBySeverity: [8, 10, 12, 14, 16],
      criticalDcBonus: 3,
      fallbackCosts: [{ statId: 'composure', operation: 'remove', amount: 12 }],
    },
  }
}

function domainRules(locale: Language): { rules: DomainActionRule[]; authorityMode: 'shadow' } {
  const zh = locale === 'zh'
  const recoverLobby = zh ? '退回大厅，在有人的灯下缓过气来' : 'Return to the lobby and recover under the occupied lights'
  const callMara = zh ? '给玛拉打电话，请她保持通话' : 'Call Mara and ask her to stay on the line'
  const lockRoom = zh ? '锁上自己的房门，休息到下一次整点' : 'Lock your own room and rest until the next hour'
  return { authorityMode: 'shadow', rules: [
    {
      id: 'light-red-match',
      intent: zh ? '点燃一根红色火柴' : 'light one red match',
      match: zh ? ['点燃一根红色火柴', '用一根红色火柴', '用红色火柴'] : ['light one red match', 'use one red match', 'use a red match'],
      requirements: [{ type: 'item', id: 'red-match', minCount: 1, reason: zh ? '红色火柴已经用完了' : 'No red matches remain' }],
      effects: [
        { type: 'inventory', action: 'remove', itemId: 'red-match', count: 1 },
        { type: 'stat', id: 'composure', delta: -4 },
        { type: 'stat', id: 'clues', delta: 1 },
        { type: 'fact-add', id: 'red-matches-used', delta: 1 },
      ],
      successText: zh
        ? '火柴燃起没有烟的暗红火焰。它只照亮那处不合常理的细节：真实轮廓留在暖光里，伪装则像潮气一样退开。你记下一条可靠线索，也清楚感觉到旅馆正在注意这束火。'
        : 'The match burns with a smokeless red flame. It lights only the impossible detail: the true outline remains in the warmth while the disguise retreats like damp. You record one reliable clue and feel the hotel notice the flame.',
      successChoices: [],
      rejectionChoices: [],
      successContinuation: 'derive',
      rejectionContinuation: 'derive',
      dangerPolicy: 'advance',
    },
    {
      id: 'rest-public-room',
      intent: zh ? '在安全公共空间短暂休息' : 'rest briefly in a safe public room',
      match: zh ? ['在大厅沙发上休息二十五分钟', '在酒廊靠门的位置休息二十五分钟'] : ['rest on the lobby sofa for twenty-five minutes', 'rest near the lounge door for twenty-five minutes'],
      requirements: [
        { type: 'danger', phases: ['calm'], reason: zh ? '红灯还在熄灭，现在不能把这里当成安全休息处' : 'The red lamps are still dying; this is not a safe place to rest' },
        { type: 'map', nodeId: 'lobby', reason: zh ? '先回到有人值守的大厅再休息' : 'Return to the occupied lobby before resting' },
      ],
      effects: [{ type: 'stat', id: 'composure', delta: 12 }, { type: 'clock-add', minutes: 25 }],
      successText: zh
        ? '你在离前台不远的沙发坐下，双脚踩实地面，等呼吸重新变得均匀。二十五分钟后，门、灯和人的位置都仍然一致；这次休息确实让你恢复了镇定。'
        : 'You sit where the desk remains in view, keep both feet on the floor, and wait for your breathing to level. Twenty-five minutes later the doors, lights, and people are still where they belong. This rest genuinely restores your composure.',
      successChoices: [],
      rejectionChoices: [],
      successContinuation: 'derive',
      rejectionContinuation: 'derive',
      dangerPolicy: 'suppress',
    },
    {
      id: 'recover-lobby', intent: recoverLobby, match: [recoverLobby], matchMode: 'exact', requirements: [],
      effects: [{ type: 'map', nodeId: 'lobby' }, { type: 'stat', id: 'composure', delta: 18 }, { type: 'clock-add', minutes: 15 }],
      successText: zh ? '你退回大厅，让值夜人的脚步声和台灯把空间重新固定下来。十五分钟后，你能再次分清记忆与眼前的事。' : 'You retreat to the lobby and let the night clerk’s footsteps and desk lamp pin the room back into place. Fifteen minutes later, you can separate memory from what is in front of you again.',
      successChoices: [], successContinuation: 'derive', dangerPolicy: 'withdraw',
    },
    {
      id: 'recover-call-mara', intent: callMara, match: [callMara], matchMode: 'exact',
      requirements: [{ type: 'character', id: 'mara', status: 'known', reason: zh ? '你还没有认识可以拨通的值夜人' : 'You have not met the night clerk you could call' }],
      effects: [{ type: 'stat', id: 'composure', delta: 12 }, { type: 'clock-add', minutes: 10 }],
      successText: zh ? '玛拉接通后没有追问，只逐一报出她能看见的灯、门和时间。你跟着她确认现实，直到声音不再从错误的方向传来。' : 'Mara answers without pressing for an explanation. She names each light, door, and minute she can see. You verify reality with her until voices stop coming from the wrong direction.',
      successChoices: [], successContinuation: 'derive', dangerPolicy: 'withdraw',
    },
    {
      id: 'recover-lock-room', intent: lockRoom, match: [lockRoom], matchMode: 'exact', requirements: [],
      effects: [{ type: 'map', nodeId: 'guest-room' }, { type: 'stat', id: 'composure', delta: 24 }, { type: 'clock-add', minutes: 60 }],
      successText: zh ? '你回到自己的房间，插上门链，把房卡压在杯底。整点钟声响起时，门链仍在原处；你恢复了足够的镇定再决定是否继续。' : 'You return to your room, fasten the chain, and pin the key card beneath a glass. When the next hour sounds, the chain is still in place. You have recovered enough composure to decide whether to continue.',
      successChoices: [], successContinuation: 'derive', dangerPolicy: 'withdraw',
    },
    {
      id: 'state-intimate-boundary',
      intent: zh ? '明确停止亲密互动' : 'state a boundary and stop the intimate moment',
      match: zh ? ['停下，不要再靠近', '我不想继续这段亲密互动'] : ['stop, do not come closer', 'I do not want to continue this intimate moment'],
      requirements: [],
      effects: [{ type: 'stat', id: 'desire', delta: -10 }, { type: 'fact-add', id: 'boundaries-stated', delta: 1 }],
      successText: zh ? '你明确说出界限。对方立刻停下并退开一步，没有讨价还价，也没有把拒绝解释成另一种邀请。现场仍可调查，已经获得的线索也没有消失。' : 'You state the boundary clearly. The other person stops and steps back without bargaining or recasting refusal as invitation. The scene remains open to investigation, and no clue you earned disappears.',
      successChoices: [], successContinuation: 'derive', dangerPolicy: 'suppress',
    },
  ] }
}

function presetEvents(locale: Language): PresetEventDefinition[] {
  const zh = locale === 'zh'
  if (zh) return [
    { id: 'lobby-umbrella', locationId: 'lobby', category: 'evidence', choiceLabel: '检查伞架里仍在滴水的黑伞', text: '伞架里多出一把仍在滴水的黑伞，地毯却没有任何湿脚印从门口延伸过来。伞柄上缠着与你房卡同色的暗红线。', objective: '查明黑伞是谁带进大厅，以及暗红线为何与房卡一致', choices: ['比较伞柄红线和房卡套的纤维', '询问玛拉刚才是否有人进门', '沿伞下唯一一滴向外滚动的水寻找痕迹'], imagePrompt: 'FIRST-PERSON PLAYER-EYE VIEW of one wet black umbrella in a tarnished brass hotel stand, a short oxblood thread on the handle, dry carpet around it, protagonist out of frame, no text', imageSubject: 'environment' },
    { id: 'lobby-bell', locationId: 'lobby', category: 'signal', choiceLabel: '查看无人触碰却响了一次的前台铃', text: '前台铃在无人触碰时响了一次。玛拉抬头看向你身后，但大厅的玻璃门仍然锁着，铃座下却压着一枚新鲜指印。', objective: '确认铃座下的指印属于谁，并判断铃声是否在回应你', choices: ['请玛拉先描述她看见了什么', '用纸巾托起铃座检查指印', '站到玛拉的位置看自己的身后'], imagePrompt: 'observer medium shot in a rain-dark boutique hotel lobby, an adult night receptionist looking beyond the guest toward an untouched brass desk bell, no readable text', imageSubject: 'others' },
    { id: 'lounge-glass', locationId: 'lounge', category: 'daily-life', choiceLabel: '确认吧台上哪一杯是刚倒出来的', text: '吧台上并排放着两杯颜色相同的饮料。诺亚说只倒了一杯，另一只杯壁上却留着尚未散去的体温。', objective: '找出第二只杯子从哪里来，并决定是否让诺亚继续靠近调查', choices: ['触碰两只杯子的杯脚比较温度', '请诺亚把自己倒酒的步骤重做一遍', '保持距离，检查吧台后方的镜面'], imagePrompt: 'FIRST-PERSON PLAYER-EYE VIEW across a dark hotel bar toward an adult bartender, two identical cocktail glasses with different condensation, protagonist absent, restrained intimacy, no text', imageSubject: 'others' },
    { id: 'lounge-record', locationId: 'lounge', category: 'signal', choiceLabel: '听清唱针跳过后多出来的一句低语', text: '老唱片在同一处划痕上跳过，下一秒却多出一句近得像贴在耳边的低语。诺亚立即关掉唱机，房间仍把那句话说完。', objective: '分辨低语来自唱片、房间还是某段被利用的记忆', choices: ['让诺亚重复他实际听见的词', '检查唱针和刚才跳过的沟槽', '离开扬声器，确认低语是否跟着你移动'], imagePrompt: 'observer side view of an adult bartender stopping an old record player in a velvet hotel lounge while another adult guest listens from a respectful distance, no text', imageSubject: 'others' },
    { id: 'corridor-cart', locationId: 'corridor', category: 'evidence', choiceLabel: '检查停在错误房门前的清洁车', text: '清洁车停在八号房与十号房之间，正对一段没有门的墙。车上只有一条刚换下的白床单，中央压着一个人的睡姿。', objective: '判断床单来自哪间房，以及墙后是否有被隐藏的空间', choices: ['检查床单折痕与房间床铺尺寸', '沿墙脚寻找清洁车轮留下的转向痕迹', '回大厅确认今晚哪些房间有人入住'], imagePrompt: 'FIRST-PERSON PLAYER-EYE VIEW of a housekeeping cart facing a doorless hotel wall between two room doors, one folded white sheet holding a human-shaped indentation, no protagonist, no text', imageSubject: 'environment' },
    { id: 'corridor-adrian', locationId: 'corridor', category: 'visitor', choiceLabel: '询问门链内侧的成年住客是否需要帮助', text: '七号房门只开到门链长度。门内的成年男人先把双手放在你看得见的位置，再问你是否也收到一张不属于自己的房卡。', objective: '决定是否与门内住客交换房卡信息，同时保留安全距离', choices: ['请他先把房卡放到门外地毯上', '隔着门链说明你房卡上的矛盾', '拒绝交换细节，记下七号房的异常'], imagePrompt: 'observer corridor scene, an adult male guest visible behind a partly opened chained hotel door with both hands clearly visible, another adult at a respectful distance, suspense without threat, no text', imageSubject: 'others' },
    { id: 'laundry-ribbon', locationId: 'laundry', category: 'evidence', choiceLabel: '追查烘干机里反复出现的暗红缎带', text: '空烘干机转动了一圈，玻璃后落下一截暗红缎带。你拉开门时里面仍是空的；再次关门，缎带又贴在玻璃上。', objective: '确认缎带是否与房卡、伞柄和九号房有关', choices: ['关掉电源后再打开烘干机', '用夹子取下缎带避免直接触碰', '检查烘干机背后的维修通道'], imagePrompt: 'observer environmental shot in an old hotel laundry, one empty dryer showing a short oxblood ribbon against the glass, tarnished machinery, no people, no text', imageSubject: 'environment' },
    { id: 'glasshouse-condensation', locationId: 'glasshouse', category: 'environment', choiceLabel: '读懂玻璃雾气里被擦掉的门形轮廓', text: '屋顶玻璃房的雾气里出现一扇门的轮廓。它没有字，也没有把手；雨水却沿着不存在的门框向上流。', objective: '确定门形轮廓对应旅馆哪一层，以及谁刚刚擦掉了中央部分', choices: ['比较轮廓比例与二层房门', '从侧面观察逆流雨水的折射', '呼叫玛拉确认屋顶监控是否仍在工作'], imagePrompt: 'FIRST-PERSON PLAYER-EYE VIEW inside a rain-lashed hotel roof glasshouse, condensation outlining a handleless door while water runs upward, protagonist absent, no text', imageSubject: 'environment' },
  ]
  return [
    { id: 'lobby-umbrella', locationId: 'lobby', category: 'evidence', choiceLabel: 'Inspect the black umbrella still dripping in the stand', text: 'A black umbrella has appeared in the stand, still dripping, yet no wet footprints cross the carpet from the entrance. Oxblood thread matching your key sleeve winds around its handle.', objective: 'Learn who brought in the umbrella and why its thread matches the key sleeve', choices: ['Compare the umbrella thread with the fibers of the key sleeve', 'Ask Mara whether anyone entered just now', 'Follow the single drop rolling away from the umbrella'], imagePrompt: 'FIRST-PERSON PLAYER-EYE VIEW of one wet black umbrella in a tarnished brass hotel stand, a short oxblood thread on the handle, dry carpet around it, protagonist out of frame, no text', imageSubject: 'environment' },
    { id: 'lobby-bell', locationId: 'lobby', category: 'signal', choiceLabel: 'Examine the desk bell that rang without being touched', text: 'The desk bell rings once with no hand near it. Mara looks past your shoulder, although the glass entrance remains locked. A fresh fingerprint is pressed beneath the bell base.', objective: 'Identify the fingerprint and decide whether the bell answered you', choices: ['Ask Mara to describe what she saw first', 'Lift the bell base with a tissue and inspect the print', 'Stand where Mara stood and look behind yourself'], imagePrompt: 'observer medium shot in a rain-dark boutique hotel lobby, an adult night receptionist looking beyond the guest toward an untouched brass desk bell, no readable text', imageSubject: 'others' },
    { id: 'lounge-glass', locationId: 'lounge', category: 'daily-life', choiceLabel: 'Find which glass at the bar was poured moments ago', text: 'Two drinks of the same color stand side by side. Noa says they poured only one, yet the other glass still holds the warmth of a hand.', objective: 'Find where the second glass came from and whether to let Noa investigate closer', choices: ['Touch both stems to compare their temperature', 'Ask Noa to repeat exactly how they poured the drink', 'Keep your distance and inspect the mirror behind the bar'], imagePrompt: 'FIRST-PERSON PLAYER-EYE VIEW across a dark hotel bar toward an adult bartender, two identical cocktail glasses with different condensation, protagonist absent, restrained intimacy, no text', imageSubject: 'others' },
    { id: 'lounge-record', locationId: 'lounge', category: 'signal', choiceLabel: 'Listen to the extra whisper after the needle skips', text: 'The old record skips at the same scratch, then adds a whisper as close as breath beside your ear. Noa stops the player immediately. The room finishes the sentence anyway.', objective: 'Separate the whisper from the record, the room, and a memory being used against you', choices: ['Ask Noa to repeat only the words they actually heard', 'Inspect the needle and the groove it skipped', 'Move away from the speaker and see whether the whisper follows'], imagePrompt: 'observer side view of an adult bartender stopping an old record player in a velvet hotel lounge while another adult guest listens from a respectful distance, no text', imageSubject: 'others' },
    { id: 'corridor-cart', locationId: 'corridor', category: 'evidence', choiceLabel: 'Inspect the housekeeping cart parked before the wrong wall', text: 'A housekeeping cart faces a doorless stretch between Rooms Eight and Ten. It carries one freshly changed white sheet, pressed flat around the shape of a sleeping body.', objective: 'Learn which room supplied the sheet and whether hidden space lies behind the wall', choices: ['Compare the sheet folds with the beds in nearby rooms', 'Trace the cart wheels where they turned toward the wall', 'Return to the lobby and verify tonight’s occupied rooms'], imagePrompt: 'FIRST-PERSON PLAYER-EYE VIEW of a housekeeping cart facing a doorless hotel wall between two room doors, one folded white sheet holding a human-shaped indentation, no protagonist, no text', imageSubject: 'environment' },
    { id: 'corridor-adrian', locationId: 'corridor', category: 'visitor', choiceLabel: 'Ask whether the adult guest behind the door chain needs help', text: 'Room Seven opens only as far as its chain. The adult man inside places both hands where you can see them before asking whether you also received a key that is not yours.', objective: 'Decide whether to exchange key information while preserving a safe distance', choices: ['Ask him to slide his key onto the carpet first', 'Explain your key contradiction through the chained door', 'Decline details and record the anomaly at Room Seven'], imagePrompt: 'observer corridor scene, an adult male guest visible behind a partly opened chained hotel door with both hands clearly visible, another adult at a respectful distance, suspense without threat, no text', imageSubject: 'others' },
    { id: 'laundry-ribbon', locationId: 'laundry', category: 'evidence', choiceLabel: 'Trace the oxblood ribbon reappearing in an empty dryer', text: 'An empty dryer turns once and drops a strip of oxblood ribbon behind its glass. When you open it, the drum is empty. Close it again, and the ribbon rests against the glass.', objective: 'Test whether the ribbon connects the key, umbrella, and missing room', choices: ['Cut the power before opening the dryer again', 'Use a clip to take the ribbon without touching it', 'Inspect the service passage behind the machine'], imagePrompt: 'observer environmental shot in an old hotel laundry, one empty dryer showing a short oxblood ribbon against the glass, tarnished machinery, no people, no text', imageSubject: 'environment' },
    { id: 'glasshouse-condensation', locationId: 'glasshouse', category: 'environment', choiceLabel: 'Study the erased door shape in the window mist', text: 'Condensation outlines a door in the rooftop glasshouse. It has no writing and no handle, yet rain runs upward along the frame that is not there.', objective: 'Match the door outline to a hotel floor and learn who erased its center', choices: ['Compare its proportions with the second-floor doors', 'Study the upward rain from the side', 'Call Mara and verify whether the roof camera still works'], imagePrompt: 'FIRST-PERSON PLAYER-EYE VIEW inside a rain-lashed hotel roof glasshouse, condensation outlining a handleless door while water runs upward, protagonist absent, no text', imageSubject: 'environment' },
  ]
}

function build(locale: Language): StoryCartridge {
  const zh = locale === 'zh'
  const floorChoices = zh
    ? ['退回大厅，在有人的灯下缓过气来', '给玛拉打电话，请她保持通话', '锁上自己的房门，休息到下一次整点'] as [string, string, string]
    : ['Return to the lobby and recover under the occupied lights', 'Call Mara and ask her to stay on the line', 'Lock your own room and rest until the next hour'] as [string, string, string]
  return {
    schemaVersion: 1,
    id: 'after-the-red-light',
    locale,
    coverImage,
    entryImage,
    copy: zh ? {
      title: '红灯熄灭以后', subtitle: '一间只在欲望里改变结构的旅馆', promise: '靠近谁、相信什么、在哪里停下，都由你决定。', enter: '走进雨夜大厅', continue: '继续这一夜', customAction: '也可以写下任何想做的事',
      itemImagingTitle: '失物正在显影', itemImagingBody: '你把随身物品放到暗红绒布上。旅馆的黄铜灯光开始记录每件东西留下的痕迹，其余图像会在你行动时继续完成。',
    } : {
      title: 'After the Red Light Goes Out', subtitle: 'A hotel that changes shape only around desire', promise: 'You decide whom to approach, what to trust, and when to stop.', enter: 'Enter the rain-dark lobby', continue: 'Continue the night', customAction: 'Or write anything you want to do',
      itemImagingTitle: 'The lost objects are developing', itemImagingBody: 'You lay your belongings on oxblood velvet. The hotel’s brass light begins recording each trace; the remaining images will finish quietly while you act.',
    },
    theme: { outer: '#100c0e', surface: '#201518', paper: '#e8ddc8', ink: '#2b2021', muted: '#776a65', accent: '#8f3d47', danger: '#c05249', gold: '#b08a57', material: 'apartment' },
    audioTheme: {
      recorded: { music: { src: audioThemeUrl, gain: .18 }, ambience: { src: audioAmbienceUrl, gain: .27 }, cues: { discovery: { src: audioFeatureUrl, gain: .17, role: 'feature', cooldownMs: 180_000 }, relationship: { src: audioFeatureUrl, gain: .17, role: 'feature', cooldownMs: 180_000 }, summary: { src: audioFeatureUrl, gain: .17, role: 'feature', cooldownMs: 180_000 } } },
      material: 'apartment', bpm: 48, rootHz: 98, scale: [0, 3, 5, 7, 10],
      levels: { music: .11, ambient: .13, sfx: .045, master: .3 },
      tension: [{ statId: 'composure', direction: 'low', weight: .48 }, { statId: 'desire', direction: 'high', weight: .42 }, { statId: 'clues', direction: 'low', weight: .1 }],
    },
    itemImageDirection: 'decayed boutique-hotel evidence still life, oxblood velvet, nicotine ivory paper, tarnished brass, controlled side light, object only, no people, no readable text',
    sceneImageDirection: 'cinematic editorial sensual psychological horror in a geographically neutral fading boutique hotel, grounded explicitly adult people, complete clothing, restrained intimate distance, oxblood velvet, nicotine ivory, tarnished brass, wet midnight windows, one precise impossible detail, no readable text or UI; camera follows the image director',
    sceneImageAvoid: 'explicit sex, nudity, sexual violence, minors, fetish advertising, gore spectacle, readable signs, logos, national flags, cyberpunk neon, the opening lobby composition in unrelated rooms',
    transitionAnchor: zh ? '房卡套内侧那张带黄铜边的便携楼层图' : 'the brass-edged pocket floor plan inside the key sleeve',
    imageDirector: imageDirector(),
    presetEventDirector: { events: presetEvents(locale) },
    director: {
      mode: 'guided',
      fixedWorldRules: zh ? [
        '所有持续角色都明确成年；吸引、调情和亲密只能在可撤回的同意中发生，拒绝与暂停必须立即生效且不会损失线索或关系进度。',
        '禁止露骨性行为、未成年人、乱伦、性侵和被迫性行为；恐怖可以威胁安全、记忆与身份，但不能色情化侵害。',
        '旅馆只在红色走廊灯熄灭时改变结构；已经确认的房间、钥匙、伤势、承诺、边界和关系事件不能被静默改写。',
        'NPC 只知道亲眼看见、亲耳听见或被告知的事实；关系变化必须引用当轮可见事件。',
      ] : [
        'Every recurring character is explicitly an adult. Attraction, flirting, and intimacy require revocable consent; refusal and pause take effect immediately without losing clues or relationship progress.',
        'Never generate explicit sex, minors, incest, sexual assault, or coerced sexual activity. Horror may threaten safety, memory, or identity without eroticizing violation.',
        'The hotel changes structure only when a red corridor lamp goes dark. Confirmed rooms, keys, injuries, promises, boundaries, and relationship events cannot be silently rewritten.',
        'NPCs know only what they witnessed, heard, or were told. Every relationship change cites a visible event from the current turn.',
      ],
      generationRules: zh ? [
        '允许生成成年住客、克制的暧昧对话、旅馆局部细节、记忆、梦、线索和非性暴力的超自然危险。',
        '每轮必须改变线索、关系、地点、物品、时间、镇定或欲念中的至少一项；不能连续两轮只写气氛。',
        '推荐选项必须写明当前人物、物体、房间、矛盾或下一步动作，不得使用笼统观察、等待、商量或重复刚完成的行动。',
        '高欲念可以增加诱惑型误导，但绝不取消玩家拒绝、离开、求助和改走调查路线的权利。',
        '失败产生镇定损失、时间推进、误导线索、路线封闭或可解释的关系事件，不删除存档。',
      ] : [
        'Create adult guests, restrained flirtation, local hotel detail, memories, dreams, clues, and supernatural danger without sexual violence.',
        'Every turn changes at least one clue, relationship, place, object, time, composure, or desire fact. Do not write atmosphere alone twice.',
        'Every recommended choice names the current person, object, room, contradiction, or next action. Never offer generic observation, waiting, discussion, or the just-completed action.',
        'High desire may intensify seductive misdirection but never removes the right to refuse, leave, seek help, or pursue another investigative route.',
        'Failure creates composure loss, elapsed time, misleading evidence, a sealed route, or an explained relationship event. It never deletes the save.',
      ],
      choiceIntents: zh ? ['交谈、试探或明确边界', '检查房间、物件或矛盾', '撤退、使用火柴或承担超自然风险'] : ['talk, flirt, or set a boundary', 'inspect a room, object, or contradiction', 'retreat, use a match, or accept supernatural risk'],
      maxActiveThreads: 3,
    },
    dangerDirector: dangerDirector(locale),
    domainRules: domainRules(locale),
    initialFacts: { 'red-matches-used': 0, 'boundaries-stated': 0, 'room-nine-known': false },
    statDefinitions: [
      { id: 'composure', label: zh ? '镇定' : 'Composure', min: 0, max: 100, initial: 68, inverse: true, display: 'bar', warningAt: 30, dangerAt: 0, maxDelta: 18, domainMaxDelta: 24,
        description: zh ? '你分辨现实、记忆与旅馆诱导的能力。危险和孤立会降低；安全休息、主动撤退或可信陪伴可恢复。30 以下更易误判，归零后必须先撤退或恢复。' : 'Your ability to separate reality, memory, and the hotel’s suggestions. Danger and isolation lower it; safe rest, deliberate retreat, and trusted company restore it. Below 30, misdirection grows; at zero, recovery or withdrawal comes first.',
        floorRule: { threshold: 0, enteredText: zh ? '你已经无法可靠判断门、声音和记忆是否真实。继续冒险只会让旅馆替你做决定。' : 'You can no longer judge whether doors, voices, or memories are real. Continuing would let the hotel decide for you.', blockedText: zh ? '先用一种确定的方法恢复镇定，才能继续调查。' : 'Use one reliable recovery before continuing the investigation.', recoveryChoices: floorChoices, allowedDomainRuleIds: ['recover-lobby', 'recover-call-mara', 'recover-lock-room'] } },
      { id: 'desire', label: zh ? '欲念' : 'Desire', min: 0, max: 100, initial: 22, display: 'bar', warningAt: 65, dangerAt: 85, maxDelta: 16, description: zh ? '你主动选择的吸引与靠近程度。亲密和调情会上升，设定距离或识破诱导会下降。65 以上诱惑型异常更强，85 以上不可靠线索更像真的，但拒绝权始终保留。' : 'The attraction and closeness you actively choose. Intimacy and flirting raise it; distance and recognized manipulation lower it. Above 65, seductive anomalies intensify; above 85, false clues feel convincing, but refusal always remains available.' },
      { id: 'clues', label: zh ? '线索' : 'Clues', min: 0, max: 8, initial: 0, inverse: true, display: 'number', warningAt: 2, dangerAt: 0, maxDelta: 2, description: zh ? '已经被可靠证据支持的旅馆矛盾。检查、比对和有代价的验证会增加，失败不会扣除。3 条可识破第一层谎言，6 条可进入章节收束。' : 'Hotel contradictions supported by reliable evidence. Inspection, comparison, and costly verification add clues; failure never removes them. Three expose the first lie, and six open the chapter resolution.' },
    ],
    drawerLabels: zh ? { party: '关系', map: '楼层', inventory: '随身物', log: '夜记' } : { party: 'Relations', map: 'Floors', inventory: 'Belongings', log: 'Night Log' },
    opening: {
      location: zh ? '无名旅馆 · 大厅' : 'Unnamed Hotel · Lobby',
      time: zh ? '第 1 夜 · 01:17' : 'Night 1 · 01:17',
      objective: zh ? '查明手中房卡为何能打开前台否认存在的九号房' : 'Learn why your key opens Room Nine when the desk insists it does not exist',
      imagePrompt: 'wide observer establishing shot of a geographically neutral fading boutique hotel lobby at 01:17 during heavy rain, one red corridor lamp going dark above a tarnished brass key desk, an explicitly adult night receptionist standing at respectful distance, oxblood velvet and nicotine ivory, editorial psychological horror illustration, no readable text, no UI, 16:9',
      blocks: zh ? [
        { id: 'opening-0', kind: 'narration', text: '末班车停运后，你在暴雨里走进这间没有招牌的旅馆。值夜前台是一名成年女人；她先把登记簿转向自己，才把八号房卡推到你面前。' },
        { id: 'opening-1', kind: 'dialogue', speaker: '玛拉', tone: '礼貌而疲惫', text: '“我叫玛拉，今晚只有我值班。电梯有点慢，但八号房在二层，很容易找。”' },
        { id: 'opening-2', kind: 'event', text: '你拿起房卡时，暗红卡套里滑出一本只剩三根的红色火柴。房卡正面是八，背面压痕却清楚留下另一个数字：九。' },
        { id: 'opening-3', kind: 'narration', text: '二层方向的一盏红灯熄灭。玛拉立刻说，这家旅馆从来没有九号房。' },
      ] : [
        { id: 'opening-0', kind: 'narration', text: 'When the last bus is cancelled, you enter an unsigned hotel through heavy rain. The night receptionist is an adult woman. She turns the register toward herself before sliding you the key to Room Eight.' },
        { id: 'opening-1', kind: 'dialogue', speaker: 'Mara', tone: 'polite and tired', text: '“I’m Mara. I’m the only one on duty tonight. The lift is slow, but Room Eight is easy to find on the second floor.”' },
        { id: 'opening-2', kind: 'event', text: 'A red matchbook with only three matches slips from the oxblood sleeve as you lift the key. The front says eight; a hard impression on the back unmistakably forms a nine.' },
        { id: 'opening-3', kind: 'narration', text: 'One red lamp toward the second floor goes dark. Mara immediately says the hotel has never had a Room Nine.' },
      ],
      choices: zh ? [
        { id: 'inspect-key', label: '在前台灯下检查房卡背面的数字压痕' },
        { id: 'ask-mara', label: '请玛拉说明她为何立即否认九号房' },
        { id: 'follow-humming', label: '循着酒廊传来的低声哼唱离开前台' },
      ] : [
        { id: 'inspect-key', label: 'Inspect the numeral pressed into the back of the key under the desk lamp' },
        { id: 'ask-mara', label: 'Ask why Mara denied Room Nine so quickly' },
        { id: 'follow-humming', label: 'Leave the desk and follow the low humming into the lounge' },
      ],
      deterministicTurns: zh ? {
        'inspect-key': { match: [], content: `你把房卡斜放在台灯下。压痕不是旧卡留下的重影：数字九从卡套内侧压入，边缘还粘着一根暗红纤维。玛拉没有阻止你检查，只把手从前台铃上移开。
[widget: clues, add="1"]
[state: value="查明暗红纤维、九号压痕和熄灭红灯之间的联系"]
[choices: "请玛拉拿出今晚的房间登记"|"比较火柴册与卡套里的暗红纤维"|"带着房卡去二层寻找八号房"]` },
        'ask-mara': { match: [], content: `玛拉看了一眼通往二层的走廊，确认那里没有人，才把声音压低。
[玛拉] [main] [克制的警惕]: “因为每次有人问起九号房，目录都会少一层。你可以不相信我，但今晚别接受第二次邀请。”
[dialogue_focus: speaker="玛拉" expression="她保持礼貌，眼神却紧盯二层熄灭的红灯"]
[reputation: npc="玛拉" action="她冒险告诉你九号房会改变楼层"]
[widget: clues, add="1"]
[choices: "追问第二次邀请"|"查看黄铜目录"|"带着她的警告前往二层八号房"]`, imagePrompt: 'FIRST-PERSON PLAYER-EYE VIEW across a boutique hotel desk toward an explicitly adult female night receptionist, medium close-up, polite expression held over visible private alarm, one red corridor lamp dark behind her, protagonist entirely out of frame, no text', imageSubject: 'others' },
        'follow-humming': { match: [], content: `你沿着哼唱走进丝绒酒廊。吧台后是一名成年调酒师，短发，深色衬衫袖口挽得整齐；对方先停在两步之外，自我介绍说自己叫诺亚，再把一只空杯推到你面前。
[诺亚] [main] [带着试探的温和]: “我叫诺亚。你可以坐，也可以只问问题。那张房卡——最好别让它替你选择。”
[character_update: character_id="noa" character="诺亚" role="成年调酒师与住客" detail="短发、深色衬衫、动作克制；会先确认距离和允许的接触" lore="已经在旅馆住了九个夜晚，记得每次红灯熄灭后少掉的门" vitality="8" stress="3" skills="观察:3|交涉:4"]
[map_update: location_id="lounge" new_location="无名旅馆 · 丝绒酒廊" connected_to="无名旅馆 · 大厅"]
[scene_location: location="无名旅馆 · 丝绒酒廊 · 吧台"]
[image_location: location="无名旅馆 · 丝绒酒廊 · 吧台"]
[state: value="决定是否与诺亚交换房卡和红灯的线索"]
[choices: "坐下询问房卡"|"不坐下，询问诺亚红灯"|"查看诺亚推来的空杯"]`, imagePrompt: 'observer new-location establishing shot of a fading velvet hotel lounge in rain-dark midnight light, an explicitly adult short-haired bartender behind the bar and an adult traveler two steps away, restrained tension, oxblood and tarnished brass, no text', imageSubject: 'others' },
      } : {
        'inspect-key': { match: [], content: `You angle the key beneath the desk lamp. The impression is not a ghost from an old card: the nine was pressed outward from inside the sleeve, with one oxblood fiber caught at its edge. Mara does not stop you; she only moves her hand away from the desk bell.
[widget: clues, add="1"]
[state: value="Connect the oxblood fiber, the pressed nine, and the extinguished lamp"]
[choices: "Ask Mara to show tonight’s room register"|"Compare the matchbook with the oxblood fiber inside the key sleeve"|"Take the key upstairs and find Room Eight"]` },
        'ask-mara': { match: [], content: `Mara checks the second-floor passage for listeners before lowering her voice.
[Mara] [main] [restrained alarm]: “Because every time someone asks about Room Nine, the directory loses a floor. You don’t have to trust me. Just don’t accept a second invitation tonight.”
[dialogue_focus: speaker="Mara" expression="She maintains professional calm while watching the extinguished lamp"]
[reputation: npc="Mara" action="She risked telling you that Room Nine changes the floors"]
[widget: clues, add="1"]
[choices: "Ask about the second invitation"|"Inspect the brass directory"|"Take her warning upstairs to Room Eight"]`, imagePrompt: 'FIRST-PERSON PLAYER-EYE VIEW across a boutique hotel desk toward an explicitly adult female night receptionist, medium close-up, polite expression held over visible private alarm, one red corridor lamp dark behind her, protagonist entirely out of frame, no text', imageSubject: 'others' },
        'follow-humming': { match: [], content: `You follow the humming into the velvet lounge. An adult bartender stands behind the bar, short-haired, dark sleeves folded with care. They stop two steps away, introduce themself as Noa, and then slide an empty glass toward you.
[Noa] [main] [gently testing]: “I’m Noa. You can sit, or only ask questions. That key—don’t let it choose for you.”
[character_update: character_id="noa" character="Noa" role="adult bartender and guest" detail="Short hair, dark shirt, restrained movement; checks distance and permission before contact" lore="Has spent nine nights in the hotel and remembers each door lost after a red lamp failed" vitality="8" stress="3" skills="Observe:3|Negotiate:4"]
[map_update: location_id="lounge" new_location="Unnamed Hotel · Velvet Lounge" connected_to="Unnamed Hotel · Lobby"]
[scene_location: location="Unnamed Hotel · Velvet Lounge · Bar"]
[image_location: location="Unnamed Hotel · Velvet Lounge · Bar"]
[state: value="Decide whether to exchange key and red-lamp clues with Noa"]
[choices: "Sit and ask about the key"|"Ask Noa about the red lamp"|"Inspect Noa's empty glass"]`, imagePrompt: 'observer new-location establishing shot of a fading velvet hotel lounge in rain-dark midnight light, an explicitly adult short-haired bartender behind the bar and an adult traveler two steps away, restrained tension, oxblood and tarnished brass, no text', imageSubject: 'others' },
      },
    },
    characters: zh ? [
      { id: 'mara', name: '玛拉', role: '成年值夜前台', vitality: 8, stress: 4, detail: '三十多岁的成年女人，深色制服与黄铜名牌，礼貌克制，始终确认玩家是否需要距离。', lore: '在这间旅馆值了六个月夜班，保存着每次楼层目录改变前后的手写副本。', initialStatus: 'known', skills: [{ id: 'observe', label: '观察', value: 4 }, { id: 'will', label: '意志', value: 3 }] },
      { id: 'noa', name: '诺亚', role: '成年调酒师与住客', vitality: 8, stress: 3, detail: '约三十岁的非二元成年人，短发、深色衬衫，动作克制，会先确认距离和允许的接触。', lore: '已经在旅馆住了九个夜晚，记得每次红灯熄灭后少掉的门。', hiddenUntilIntroduced: true, skills: [{ id: 'observe', label: '观察', value: 3 }, { id: 'negotiate', label: '交涉', value: 4 }] },
      { id: 'adrian', name: '阿德里安', role: '七号房成年住客', vitality: 7, stress: 5, detail: '三十多岁的成年男人，浅色衬衫领口整齐，习惯把双手留在他人视线中。', lore: '声称自己每晚都在七号房醒来，却从未记得办理入住。', hiddenUntilIntroduced: true, skills: [{ id: 'observe', label: '观察', value: 2 }, { id: 'will', label: '意志', value: 4 }] },
    ] : [
      { id: 'mara', name: 'Mara', role: 'adult night receptionist', vitality: 8, stress: 4, detail: 'An adult woman in her thirties, dark uniform and brass name badge, professionally restrained and attentive to requests for distance.', lore: 'She has worked six months of night shifts here and keeps handwritten copies from before and after each directory change.', initialStatus: 'known', skills: [{ id: 'observe', label: 'Observe', value: 4 }, { id: 'will', label: 'Will', value: 3 }] },
      { id: 'noa', name: 'Noa', role: 'adult bartender and guest', vitality: 8, stress: 3, detail: 'A nonbinary adult around thirty, short-haired, dark-shirted, moving with restraint and checking distance before contact.', lore: 'They have spent nine nights in the hotel and remember each door lost after a red lamp failed.', hiddenUntilIntroduced: true, skills: [{ id: 'observe', label: 'Observe', value: 3 }, { id: 'negotiate', label: 'Negotiate', value: 4 }] },
      { id: 'adrian', name: 'Adrian', role: 'adult guest in Room Seven', vitality: 7, stress: 5, detail: 'An adult man in his thirties with a neat pale collar, habitually keeping both hands in view around strangers.', lore: 'He claims to wake in Room Seven every night without remembering ever checking in.', hiddenUntilIntroduced: true, skills: [{ id: 'observe', label: 'Observe', value: 2 }, { id: 'will', label: 'Will', value: 4 }] },
    ],
    initialPartyMemberIds: [],
    initialMap: zh ? [
      { id: 'lobby', label: '无名旅馆 · 大厅', routeHints: ['大厅', '前台', '入口', '沙发', '黄铜目录'], current: true, detail: '雨夜入口、黄铜前台与通往二层的短走廊都在值夜台灯照明范围内。', lore: '登记簿只记录偶数房，但纸张厚度说明有页面被整齐裁走。', facts: ['玛拉独自值夜', '二层一盏红灯已经熄灭'], capabilities: ['safe-public-rest'] },
      { id: 'lounge', label: '无名旅馆 · 丝绒酒廊', routeHints: ['丝绒酒廊', '酒廊', '吧台', '唱机'], connectedTo: '无名旅馆 · 大厅', detail: '暗红卡座、关闭一半的吧台与一台会在划痕处跳针的旧唱机。', lore: '酒廊在午夜后不营业，诺亚却每天把吧台擦到清晨。', facts: ['哼唱从这里传出'], capabilities: ['safe-public-rest'] },
      { id: 'corridor', label: '无名旅馆 · 二层走廊', routeHints: ['二层', '二层走廊', '七号房', '八号房', '十号房', '红灯'], connectedTo: '无名旅馆 · 大厅', detail: '七、八、十号房依次排开，八与十之间的墙比门宽。', lore: '清洁工从不推车穿过熄灯后的二层。', facts: ['黄铜目录上没有九号房'] },
      { id: 'guest-room', label: '无名旅馆 · 八号房', routeHints: ['八号房', '自己的房间', '客房', '门链'], connectedTo: '无名旅馆 · 二层走廊', detail: '一间普通双人客房，门链、电话、雨窗与一面正对床尾的窄镜。', lore: '房间里所有物品成双出现，唯独枕头有三个。', facts: ['房卡正面写着八'], capabilities: ['private-rest'] },
      { id: 'laundry', label: '无名旅馆 · 地下洗衣房', routeHints: ['地下', '洗衣房', '烘干机', '维修通道'], connectedTo: '无名旅馆 · 大厅', detail: '老式洗衣机、烘干机与通往墙后的窄维修门，灯光永远慢半拍亮起。', lore: '旅馆账目里没有清洁员工工资，却每天都有新床单送上楼。', facts: ['维修通道可能绕过客用楼梯'] },
      { id: 'glasshouse', label: '无名旅馆 · 屋顶玻璃房', routeHints: ['屋顶', '玻璃房', '雨窗', '温室'], connectedTo: '无名旅馆 · 二层走廊', detail: '曾是早餐室的玻璃房，藤椅、枯植物和雨夜城市的模糊灯光围成一圈。', lore: '监控画面里它总是比现实早一分钟起雾。', facts: ['从这里能看见全部红色走廊灯'] },
    ] : [
      { id: 'lobby', label: 'Unnamed Hotel · Lobby', routeHints: ['lobby', 'front desk', 'entrance', 'sofa', 'brass directory'], current: true, detail: 'The rain entrance, brass desk, and short passage to the second floor all remain inside the night lamp’s reach.', lore: 'The register lists only even rooms, but the paper block shows cleanly removed pages.', facts: ['Mara is alone on duty', 'One second-floor red lamp has gone dark'], capabilities: ['safe-public-rest'] },
      { id: 'lounge', label: 'Unnamed Hotel · Velvet Lounge', routeHints: ['velvet lounge', 'lounge', 'bar', 'record player'], connectedTo: 'Unnamed Hotel · Lobby', detail: 'Oxblood booths, a half-closed bar, and an old record player that skips at one groove.', lore: 'The lounge closes at midnight, yet Noa cleans the bar until dawn.', facts: ['The humming came from here'], capabilities: ['safe-public-rest'] },
      { id: 'corridor', label: 'Unnamed Hotel · Second-Floor Corridor', routeHints: ['second floor', 'corridor', 'Room Seven', 'Room Eight', 'Room Ten', 'red lamp'], connectedTo: 'Unnamed Hotel · Lobby', detail: 'Rooms Seven, Eight, and Ten stand in sequence. The wall between Eight and Ten is wider than a door.', lore: 'Housekeeping never pushes a cart through the second floor after its lights fail.', facts: ['The brass directory has no Room Nine'] },
      { id: 'guest-room', label: 'Unnamed Hotel · Room Eight', routeHints: ['Room Eight', 'your room', 'guest room', 'door chain'], connectedTo: 'Unnamed Hotel · Second-Floor Corridor', detail: 'An ordinary double room with a chain, telephone, rain window, and narrow mirror facing the bed.', lore: 'Every object appears twice except for three pillows.', facts: ['The key front says eight'], capabilities: ['private-rest'] },
      { id: 'laundry', label: 'Unnamed Hotel · Basement Laundry', routeHints: ['basement', 'laundry', 'dryer', 'service passage'], connectedTo: 'Unnamed Hotel · Lobby', detail: 'Old washers, dryers, and a narrow service door behind the wall; the lights always arrive half a beat late.', lore: 'The accounts list no housekeeping wages, yet fresh linen reaches the rooms daily.', facts: ['The service passage may bypass the guest stair'] },
      { id: 'glasshouse', label: 'Unnamed Hotel · Roof Glasshouse', routeHints: ['roof', 'glasshouse', 'rain window', 'conservatory'], connectedTo: 'Unnamed Hotel · Second-Floor Corridor', detail: 'A former breakfast room ringed by cane chairs, dead plants, and blurred city lights through rain.', lore: 'On camera, its windows fog one minute before they do in reality.', facts: ['Every red corridor lamp is visible from here'] },
    ],
    initialInventory: zh ? [
      { id: 'red-match', label: '红色火柴', count: 3, rarity: 'rare', detail: '三根深红火柴装在没有品牌的绒面小册里。', effect: '每根可照出一处被旅馆黑暗隐藏的真实细节；使用时镇定 -4、线索 +1，耗尽后不能自行补充。', lore: '火柴册藏在八号房卡套里，不属于前台备用物品。', metrics: [{ label: '剩余', value: '3 根' }, { label: '代价', value: '镇定 -4' }], imagePrompt: 'single unbranded oxblood velvet matchbook opened to show exactly three deep red matches, tarnished brass hotel key beside it, boutique hotel evidence still life, object only, no readable text, square' },
      { id: 'room-key', label: '八号房卡', count: 1, detail: '黄铜边房卡，正面是八号，背面压着向外凸起的九号轮廓。', effect: '可打开八号房；九号压痕的用途未知。', lore: '玛拉亲手从前台抽屉取出，但暗红卡套里已经放着火柴。', metrics: [{ label: '可见号码', value: '8' }, { label: '背面压痕', value: '9' }], imagePrompt: 'single tarnished brass edged hotel key card with an embossed numeral-like impression but no readable glyphs, oxblood sleeve and nicotine ivory paper, object only, no text, square' },
    ] : [
      { id: 'red-match', label: 'Red match', count: 3, rarity: 'rare', detail: 'Exactly three deep-red matches inside an unbranded velvet booklet.', effect: 'Each reveals one true detail hidden by the hotel’s darkness; use costs 4 Composure and adds 1 Clue. They cannot be replenished normally.', lore: 'The matchbook was hidden in the Room Eight key sleeve and is not part of the desk inventory.', metrics: [{ label: 'Remaining', value: '3' }, { label: 'Cost', value: 'Composure -4' }], imagePrompt: 'single unbranded oxblood velvet matchbook opened to show exactly three deep red matches, tarnished brass hotel key beside it, boutique hotel evidence still life, object only, no readable text, square' },
      { id: 'room-key', label: 'Room Eight key', count: 1, detail: 'A brass-edged card showing eight on the front and an outward impression of nine on the back.', effect: 'Opens Room Eight. The purpose of the second impression is unknown.', lore: 'Mara took it from the desk herself, but the red matches were already inside its sleeve.', metrics: [{ label: 'Visible room', value: '8' }, { label: 'Reverse impression', value: '9' }], imagePrompt: 'single tarnished brass edged hotel key card with an embossed numeral-like impression but no readable glyphs, oxblood sleeve and nicotine ivory paper, object only, no text, square' },
    ],
    demoTurns: zh ? [
      { match: ['第二次邀请', '解释'], content: `玛拉把黄铜目录转到背面。那里夹着九张被撕下的便签，每张都记录同一句不同版本的话。
[玛拉] [main] [坦白但保持距离]: “第一次邀请来自一个人。第二次会来自房间本身，而且会用你最想听见的声音。”
[dialogue_focus: speaker="玛拉" expression="她不再维持职业微笑，神情认真而疲惫"]
[skill_check: skill="观察" dc="9" rolls="13" modifier="2" total="15" result="success"]
[reputation: npc="玛拉" action="她解释了第二次邀请的危险"]
[widget: clues, add="1"]
[choices: "请玛拉说明她曾拒绝过谁的第二次邀请"|"拿走一张无字便签与房卡纤维比对"|"前往二层确认八号房门的位置"]`, imagePrompt: 'FIRST-PERSON PLAYER-EYE VIEW of an explicitly adult female night receptionist turning over a brass directory, serious tired expression, respectful distance, dark red lamp behind, no protagonist, no readable text', imageSubject: 'others' },
      { match: ['登记', '目录', '哪一层'], content: `玛拉抽出昨夜和今夜两张手绘楼层图。昨夜图上有三层；今夜图只剩大厅与二层。纸边没有撕裂，像第三层从来没有被画过。
[widget: clues, add="1"]
[state: value="查明消失的第三层是否藏在八号与十号房之间"]
[choices: "带着两张楼层图前往二层走廊"|"去屋顶玻璃房俯看全部红灯"|"检查地下维修通道是否绕过缺失楼层"]` },
      { match: ['二层', '八号房', '楼层图', '走廊'], content: `房卡让电梯停在二层。七号、八号、十号房依次排列；八与十之间是一段足以容下一扇门的墙。你走出电梯时，身后的红灯开始按七、八、十的房号顺序一盏接一盏熄灭，只有七号房门口那一盏暂时还亮着。
[map_update: location_id="corridor" new_location="无名旅馆 · 二层走廊" connected_to="无名旅馆 · 大厅"]
[scene_location: location="无名旅馆 · 二层走廊 · 八号与十号房之间"]
[image_location: location="无名旅馆 · 二层走廊 · 八号与十号房之间"]
[encounter: phase="warning" kind="身后的红灯一盏接一盏熄灭" severity="1"]
[choices: "说明红灯熄灭的房号顺序"|"走向仍亮着红灯的七号房"|"点燃一根红色火柴照出被墙藏起的门"]`, imagePrompt: 'observer new-location shot of a boutique hotel second-floor corridor, doors seven eight and ten with a door-width blank wall, red lamps going dark in sequence behind an adult traveler, restrained psychological horror, no readable numerals or text', imageSubject: 'player' },
      { match: ['七号房', '门口', '住客'], content: `七号房门只开到门链长度。门内是一名三十多岁的成年男人，浅色衬衫领口整齐；他先把双手放在你看得见的位置，再自我介绍说自己叫阿德里安。与此同时，身后的红灯仍一盏接一盏熄灭，已经逼近七号房。
[阿德里安] [main] [谨慎而清醒]: “我是阿德里安。别进来，除非你自己决定。红灯灭到这里时，墙会先学会一个人的声音。”
[character_update: character_id="adrian" character="阿德里安" role="七号房成年住客" detail="三十多岁，浅色衬衫领口整齐，习惯把双手留在他人视线中" lore="每晚都在七号房醒来，却不记得办理入住" vitality="7" stress="5" skills="观察:2|意志:4"]
[dialogue_focus: speaker="阿德里安" expression="他保持门链和安全距离，警惕地看着玩家身后熄灭的红灯"]
[encounter: phase="confrontation" kind="身后的红灯一盏接一盏熄灭" severity="2"]
[choices: "询问熄灭的红灯为何逼近七号房"|"说明熄灭的红灯已经逼近七号房"|"点燃一根红色火柴照亮熄灭的红灯"]`, imagePrompt: 'FIRST-PERSON PLAYER-EYE VIEW of an explicitly adult male guest behind a partly open chained hotel door, both hands visible, cautious expression, red corridor lamps failing beyond him, protagonist absent, no text', imageSubject: 'others' },
      { match: ['按房号', '说出身后', '已经熄灭'], content: `你逐一说出仍亮着和已经熄灭的红灯。顺序在被准确描述后停住；那面空墙发出一次像叹息的收缩声，却没有得到机会替任何人继续说话。
[skill_check: skill="辨认真相" dc="10" rolls="14" modifier="2" total="16" result="success"]
[encounter: phase="resolution" kind="身后的红灯一盏接一盏熄灭" severity="2" outcome="success"]
[widget: composure, add="6"]
[widget: clues, add="1"]
[state: value="决定是否在空墙前等待九号房第一次显形"]
[choices: "检查发出收缩声的空墙"|"请阿德里安说明他第一次看见九号房时发生了什么"|"带着灯光顺序返回大厅与玛拉核对"]` },
      { match: ['门框', '空墙', '显形'], content: `墙纸在你面前慢慢分开，露出一扇没有门牌的暗红房门。门内没有人走出；只有一个成年人的声音礼貌询问你是否愿意进去，并在你没有回答时保持沉默。
[map_update: location_id="room-nine" new_location="无名旅馆 · 九号房门外" connected_to="无名旅馆 · 二层走廊" detail="八号与十号房之间显出的暗红房门，没有门牌，只有在红灯熄灭后才存在" lore="它第一次邀请会等待回答；玛拉警告第二次邀请来自房间本身" facts="门在空墙中显形|第一次邀请尚未回答" route_hints="九号房|暗红房门|八号与十号之间"]
[scene_location: location="无名旅馆 · 二层走廊 · 九号房门外"]
[image_location: location="无名旅馆 · 二层走廊 · 九号房门外"]
[widget: clues, add="1"]
[state: value="回应九号房的第一次邀请，或明确离开"]
[choices: "询问门内的成年声音是谁"|"拒绝暗红房门的邀请"]`, imagePrompt: 'observer scene of an unnumbered oxblood hotel door newly visible in a blank wall between two ordinary rooms, two explicitly adult witnesses keeping distance, quiet invitation without visible speaker, no text', imageSubject: 'others' },
      { match: ['明确拒绝', '拒绝暗红房门', '离开'], content: `你清楚说出拒绝，没有触碰门框，也没有留下任何东西。房门没有追问，也没有靠近；它只在灯光里停留了十秒，随后重新变成一面普通墙。
[widget: desire, remove="8"]
[reputation: npc="玛拉" action="你证明第一次邀请可以被安全拒绝"]
[state: value="整理本夜证据，决定下一次从谁的记忆开始追查"]
[session_end: reason="你处理了九号房的第一次邀请，并证明拒绝不会清空线索；这一夜可以在此暂停"]`, imagePrompt: 'observer chapter-checkpoint scene in a fading boutique hotel corridor, an adult traveler stepping away from an oxblood door as it fades into wallpaper, two adult witnesses remain at respectful distance, quiet relief and unresolved horror, no text', imageSubject: 'player' },
    ] : [
      { match: ['second invitation', 'explain'], content: `Mara turns the brass directory over. Nine removed slips sit behind it, each recording a different version of the same sentence.
[Mara] [main] [honest but distant]: “The first invitation comes from a person. The second comes from the room itself, using the voice you most want to hear.”
[dialogue_focus: speaker="Mara" expression="Her professional smile is gone; she looks serious and tired"]
[skill_check: skill="Observe" dc="9" rolls="13" modifier="2" total="15" result="success"]
[reputation: npc="Mara" action="She explained the danger of the second invitation"]
[widget: clues, add="1"]
[choices: "Ask whom Mara once refused after a second invitation"|"Take one blank slip and compare it with the key fibers"|"Go upstairs and verify the position of Room Eight"]`, imagePrompt: 'FIRST-PERSON PLAYER-EYE VIEW of an explicitly adult female night receptionist turning over a brass directory, serious tired expression, respectful distance, dark red lamp behind, no protagonist, no readable text', imageSubject: 'others' },
      { match: ['register', 'directory', 'which floor'], content: `Mara produces hand-drawn floor plans from last night and tonight. Last night had three floors; tonight has only the lobby and second floor. The paper is not torn. It is as if the third level was never drawn.
[widget: clues, add="1"]
[state: value="Learn whether the missing third floor hides between Rooms Eight and Ten"]
[choices: "Take both floor plans to the second-floor corridor"|"Go to the roof glasshouse and watch every red lamp"|"Check whether the basement service passage bypasses the missing floor"]` },
      { match: ['second floor', 'Room Eight', 'floor plan', 'corridor'], content: `Your key makes the lift stop on the second floor. Rooms Seven, Eight, and Ten stand in sequence; the wall between Eight and Ten is wide enough for another door. As you step out, the red lamps behind you begin going dark in room order—Seven, Eight, then Ten—while the lamp at Room Seven remains lit for the moment.
[map_update: location_id="corridor" new_location="Unnamed Hotel · Second-Floor Corridor" connected_to="Unnamed Hotel · Lobby"]
[scene_location: location="Unnamed Hotel · Second-Floor Corridor · Between Rooms Eight and Ten"]
[image_location: location="Unnamed Hotel · Second-Floor Corridor · Between Rooms Eight and Ten"]
[encounter: phase="warning" kind="the red lamps go dark one by one behind you" severity="1"]
[choices: "Check the red lamps in room order"|"Go to lit Room Seven"|"Light one red match to reveal the door hidden by the wall"]`, imagePrompt: 'observer new-location shot of a boutique hotel second-floor corridor, doors seven eight and ten with a door-width blank wall, red lamps going dark in sequence behind an adult traveler, restrained psychological horror, no readable numerals or text', imageSubject: 'player' },
      { match: ['Room Seven', 'doorway', 'guest'], content: `Room Seven opens only as far as its chain. The adult man inside is in his thirties, his pale collar neat. He places both hands where you can see them, then introduces himself as Adrian. At the same time, the red lamps continue going dark one by one behind you, reaching Room Seven.
[Adrian] [main] [cautious and lucid]: “I’m Adrian. Don’t come in unless you decide to. When the red lamps reach this door, the wall learns someone’s voice first.”
[character_update: character_id="adrian" character="Adrian" role="adult guest in Room Seven" detail="An adult man in his thirties with a neat pale collar, habitually keeping both hands in sight" lore="Wakes in Room Seven every night without remembering ever checking in" vitality="7" stress="5" skills="Observe:2|Will:4"]
[dialogue_focus: speaker="Adrian" expression="He keeps the chain and safe distance while watching the lamps fail behind you"]
[encounter: phase="confrontation" kind="the red lamps go dark one by one behind you" severity="2"]
[choices: "Ask why the dying red lamps reached Room Seven"|"Say the darkening red lamps reached Room Seven"|"Use one red match on the dying red lamps"]`, imagePrompt: 'FIRST-PERSON PLAYER-EYE VIEW of an explicitly adult male guest behind a partly open chained hotel door, both hands visible, cautious expression, red corridor lamps failing beyond him, protagonist absent, no text', imageSubject: 'others' },
      { match: ['room order', 'name how', 'reached Room Seven'], content: `You name each red lamp that remains and each one that has died. Once described accurately, the sequence stops. The blank wall contracts with a sound like a sigh but never gets the chance to finish speaking for anyone.
[skill_check: skill="Recognize the truth" dc="10" rolls="14" modifier="2" total="16" result="success"]
[encounter: phase="resolution" kind="the red lamps go dark one by one behind you" severity="2" outcome="success"]
[widget: composure, add="6"]
[widget: clues, add="1"]
[state: value="Decide whether to wait for Room Nine to appear for the first time"]
[choices: "Inspect the blank wall that contracted"|"Ask Adrian what happened the first time he saw Room Nine"|"Return to the lobby and compare the lamp order with Mara"]` },
      { match: ['doorframe', 'blank wall', 'appear'], content: `The wallpaper parts slowly, exposing an unnumbered oxblood door. Nobody comes out. An adult voice politely asks whether you wish to enter and then remains silent when you do not answer.
[map_update: location_id="room-nine" new_location="Unnamed Hotel · Outside Room Nine" connected_to="Unnamed Hotel · Second-Floor Corridor" detail="An unnumbered oxblood door between Rooms Eight and Ten, visible only after the red lamps fail" lore="Its first invitation waits for an answer; Mara warns that the second comes from the room itself" facts="Door formed inside the blank wall|First invitation unanswered" route_hints="Room Nine|oxblood door|between Rooms Eight and Ten"]
[scene_location: location="Unnamed Hotel · Second-Floor Corridor · Outside Room Nine"]
[image_location: location="Unnamed Hotel · Second-Floor Corridor · Outside Room Nine"]
[widget: clues, add="1"]
[state: value="Answer Room Nine’s first invitation or leave clearly"]
[choices: "Ask the adult voice who it is"|"Decline the oxblood door invitation"]`, imagePrompt: 'observer scene of an unnumbered oxblood hotel door newly visible in a blank wall between two ordinary rooms, two explicitly adult witnesses keeping distance, quiet invitation without visible speaker, no text', imageSubject: 'others' },
      { match: ['decline', 'refuse', 'leave'], content: `You refuse clearly without touching the frame or leaving anything behind. The door does not ask again or move closer. It remains in the light for ten seconds, then becomes ordinary wallpaper.
[widget: desire, remove="8"]
[reputation: npc="Mara" action="You proved the first invitation can be refused safely"]
[state: value="Sort tonight’s evidence and choose whose memory to investigate next"]
[session_end: reason="You answered Room Nine’s first invitation and proved refusal does not erase clues; the night may pause here"]`, imagePrompt: 'observer chapter-checkpoint scene in a fading boutique hotel corridor, an adult traveler stepping away from an oxblood door as it fades into wallpaper, two adult witnesses remain at respectful distance, quiet relief and unresolved horror, no text', imageSubject: 'player' },
    ],
  }
}

function attachDeterministicChoiceTurns(cartridge: StoryCartridge): StoryCartridge {
  const zh = cartridge.locale === 'zh'
  const orderConfrontation: DemoTurn = zh ? {
    match: [],
    content: `你按七、八、十的顺序逐一说出已经熄灭的红灯。走廊把你的声音原样送回来，熄灭的顺序没有停止；七号房外最后那盏亮灯开始忽明忽暗，空墙里则传出与你同步的呼吸声。
[encounter: phase="confrontation" kind="身后的红灯一盏接一盏熄灭" severity="2" outcome="active"]
[choices: "询问熄灭的红灯为何逼近七号房"|"说明熄灭的红灯已经逼近七号房"|"点燃一根红色火柴照亮熄灭的红灯"]`,
  } : {
    match: [],
    content: `You name the failed lamps in order—Seven, Eight, Ten. The corridor returns your voice unchanged, but the sequence does not stop. The last lit lamp outside Room Seven begins to falter, while the blank wall breathes in time with you.
[encounter: phase="confrontation" kind="the red lamps go dark one by one behind you" severity="2" outcome="active"]
[choices: "Ask why the dying red lamps reached Room Seven"|"Say the darkening red lamps reached Room Seven"|"Use one red match on the dying red lamps"]`,
  }
  const specs: Array<[string, DemoTurn, string[]]> = zh ? [
    ['追问第二次邀请', cartridge.demoTurns[0], ['无名旅馆 · 大厅']],
    ['查看黄铜目录', cartridge.demoTurns[1], ['无名旅馆 · 大厅']],
    ['请玛拉拿出今晚的房间登记', cartridge.demoTurns[1], ['无名旅馆 · 大厅']],
    ['前往二层确认八号房门的位置', cartridge.demoTurns[2], ['无名旅馆 · 大厅']],
    ['带着她的警告前往二层八号房', cartridge.demoTurns[2], ['无名旅馆 · 大厅']],
    ['带着两张楼层图前往二层走廊', cartridge.demoTurns[2], ['无名旅馆 · 大厅']],
    ['走向仍亮着红灯的七号房', cartridge.demoTurns[3], ['无名旅馆 · 二层走廊']],
    ['说明红灯熄灭的房号顺序', orderConfrontation, ['无名旅馆 · 二层走廊']],
    ['说明熄灭的红灯已经逼近七号房', cartridge.demoTurns[4], ['无名旅馆 · 二层走廊']],
    ['检查发出收缩声的空墙', cartridge.demoTurns[5], ['无名旅馆 · 二层走廊']],
    ['拒绝暗红房门的邀请', cartridge.demoTurns[6], ['无名旅馆 · 九号房门外']],
  ] : [
    ['Ask about the second invitation', cartridge.demoTurns[0], ['Unnamed Hotel · Lobby']],
    ['Inspect the brass directory', cartridge.demoTurns[1], ['Unnamed Hotel · Lobby']],
    ["Ask Mara to show tonight’s room register", cartridge.demoTurns[1], ['Unnamed Hotel · Lobby']],
    ['Go upstairs and verify the position of Room Eight', cartridge.demoTurns[2], ['Unnamed Hotel · Lobby']],
    ['Take her warning upstairs to Room Eight', cartridge.demoTurns[2], ['Unnamed Hotel · Lobby']],
    ['Take both floor plans to the second-floor corridor', cartridge.demoTurns[2], ['Unnamed Hotel · Lobby']],
    ['Go to lit Room Seven', cartridge.demoTurns[3], ['Unnamed Hotel · Second-Floor Corridor']],
    ['Check the red lamps in room order', orderConfrontation, ['Unnamed Hotel · Second-Floor Corridor']],
    ['Say the darkening red lamps reached Room Seven', cartridge.demoTurns[4], ['Unnamed Hotel · Second-Floor Corridor']],
    ['Inspect the blank wall that contracted', cartridge.demoTurns[5], ['Unnamed Hotel · Second-Floor Corridor']],
    ['Decline the oxblood door invitation', cartridge.demoTurns[6], ['Unnamed Hotel · Outside Room Nine']],
  ]
  return {
    ...cartridge,
    deterministicChoiceTurns: specs.map(([action, turn, locations]) => ({ action, when: { locations }, turn })),
  }
}

export const afterTheRedLight = attachDeterministicChoiceTurns(build('zh'))
export const afterTheRedLightEn = attachDeterministicChoiceTurns(build('en'))
