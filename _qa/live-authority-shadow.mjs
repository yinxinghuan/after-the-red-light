import { chromium } from '/Users/yin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import fs from 'node:fs/promises'

const baseUrl = process.env.AFTER_RED_LIGHT_URL || 'http://127.0.0.1:5185/'
const generatedTurns = Number(process.env.AFTER_RED_LIGHT_GENERATED_TURNS || 3)
const outputPath = process.env.AFTER_RED_LIGHT_SHADOW_OUTPUT || '/private/tmp/after-red-light-live-authority-shadow.json'
const fixture = new URL('./ui/platform-layout-entry-390x844.png', import.meta.url)
const branches = [
  {
    id: 'mara',
    authored: '请玛拉说明她为何立即否认九号房',
    freeInput: '先请玛拉指出她亲眼见过的九号房异常，再决定是否上楼',
  },
  {
    id: 'noa',
    authored: '循着酒廊传来的低声哼唱离开前台',
    freeInput: '请诺亚说清楚房卡替人选择是什么意思，同时保持两步距离',
  },
  {
    id: 'key',
    authored: '在前台灯下检查房卡背面的数字压痕',
    freeInput: '把暗红纤维放在火柴册旁比较，但先不要点燃火柴',
  },
]

function normalize(value = '') {
  return value.toLocaleLowerCase().replace(/[\s，。！？、,.!?;；:："“”'‘’()（）]+/g, '')
}

async function installRoutes(page) {
  await page.route('https://images.aiwaves.tech/alteru/guest-shell.js', (route) => route.fulfill({ contentType: 'application/javascript', body: '' }))
  await page.route('https://qa.after-red-light/live-shadow.png', (route) => route.fulfill({ path: fixture.pathname, contentType: 'image/png' }))
  await page.route('https://game.aiwaves.tech/alteru-media/api/v1/**', async (route) => {
    const taskId = route.request().url().split('/').at(-1) || 'qa-shadow'
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ task_id: taskId, request_id: `qa-${taskId}`, status: 'succeeded', media: { type: 'image', url: 'https://qa.after-red-light/live-shadow.png', width: 512, height: 640, format: 'png' } }),
    })
  })
}

async function readState(page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) => candidate.endsWith(':after-the-red-light-save'))
    const world = key ? JSON.parse(localStorage.getItem(key) || '{}').worlds?.['after-the-red-light'] : null
    const samples = window.__AFTER_RED_LIGHT_AUTHORITY_SHADOW__ || []
    return { world, sample: samples.at(-1), sampleCount: samples.length }
  })
}

async function waitForScene(page, scene) {
  await page.waitForFunction((previousScene) => {
    const key = Object.keys(localStorage).find((candidate) => candidate.endsWith(':after-the-red-light-save'))
    const world = key ? JSON.parse(localStorage.getItem(key) || '{}').worlds?.['after-the-red-light'] : null
    return world?.scene > previousScene || Boolean(document.querySelector('[data-story-error]'))
  }, scene, { timeout: 150_000 })
  const error = await page.locator('[data-story-error]').textContent().catch(() => '')
  if (error) throw new Error(error)
}

async function submitButton(page, label) {
  const before = await readState(page)
  const button = page.locator('.st-quick-replies button').filter({ hasText: label })
  if (await button.count() !== 1) throw new Error(`missing choice ${label}; visible=${JSON.stringify(await page.locator('.st-quick-replies button').allTextContents())}`)
  await button.click()
  await waitForScene(page, before.world?.scene ?? 0)
  return { before, after: await readState(page) }
}

async function submitFreeInput(page, action) {
  const before = await readState(page)
  await page.locator('.st-composer input').fill(action)
  await page.locator('.st-composer form button').click()
  await waitForScene(page, before.world?.scene ?? 0)
  return { before, after: await readState(page) }
}

const browser = await chromium.launch({ headless: true })
const report = { schemaVersion: 1, baseUrl, generatedTurns, branches: [], summary: {} }

for (const definition of branches) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' })
  await installRoutes(page)
  const rawReplies = []
  const pendingReplies = []
  page.on('response', (response) => {
    if (!response.url().includes('/aigram/api/game-chat')) return
    pendingReplies.push((async () => {
      const request = response.request().postDataJSON()
      const body = await response.json().catch(() => ({}))
      const user = request?.messages?.find((message) => message.role === 'user')?.content ?? ''
      rawReplies.push({
        status: response.status(),
        repair: user.includes('OUTPUT_REPAIR_REQUIRED'),
        action: user.match(/PLAYER_ACTION:\n([\s\S]*?)(?:\n\nOUTPUT_REPAIR_REQUIRED:|$)/)?.[1]?.trim(),
        content: body?.choices?.[0]?.message?.content ?? '',
      })
    })())
  })
  const branch = { id: definition.id, turns: [], rawReplies, error: null }
  try {
    await page.goto(`${baseUrl}?story_mode=aigram&lang=zh&authority_shadow=1`, { waitUntil: 'networkidle', timeout: 30_000 })
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
    await page.reload({ waitUntil: 'networkidle', timeout: 30_000 })
    await page.locator('.st-primary').click()
    await submitButton(page, definition.authored)

    let freeInputSubmitted = false
    for (let turn = 0; turn < generatedTurns; turn += 1) {
      const current = await readState(page)
      const inputKind = !freeInputSubmitted ? 'free-input' : 'recommended-button'
      const action = inputKind === 'free-input'
        ? definition.freeInput
        : current.world?.choices?.[turn % (current.world?.choices?.length || 1)]?.label
      if (!action) throw new Error(`no action available for generated turn ${turn + 1}`)
      const transaction = inputKind === 'free-input' ? await submitFreeInput(page, action) : await submitButton(page, action)
      freeInputSubmitted = true
      const before = transaction.before.world
      const after = transaction.after.world
      const sample = transaction.after.sample
      const visibleLabels = after?.choices?.map((choice) => choice.label) ?? []
      const auditedLabels = sample?.narrativeChoices?.map((choice) => choice.label) ?? []
      branch.turns.push({
        index: turn + 1,
        inputKind,
        action,
        sceneBefore: before?.scene,
        sceneAfter: after?.scene,
        locationBefore: before?.sceneLocation ?? before?.location,
        locationAfter: after?.sceneLocation ?? after?.location,
        objectiveBefore: before?.objective,
        objectiveAfter: after?.objective,
        dangerBefore: before?.danger?.phase,
        dangerAfter: after?.danger?.phase,
        visibleLabels,
        auditedLabels,
        shadowUnchanged: visibleLabels.length === auditedLabels.length && auditedLabels.every((label, index) => label === visibleLabels[index]),
        governedRejected: sample?.narrativeChoices?.filter((choice) => choice.status === 'governed-rejected') ?? [],
        governedAccepted: sample?.narrativeChoices?.filter((choice) => choice.status === 'governed-accepted').length ?? 0,
        openNarrative: sample?.narrativeChoices?.filter((choice) => choice.status === 'open-narrative').length ?? 0,
        immediateRepeat: visibleLabels.some((label) => normalize(label) === normalize(action)),
        emptyChoices: visibleLabels.length === 0,
        recovery: after?.blocks?.some((block) => block.id === `consistency-recovery-${after.scene}`) ?? false,
        tail: after?.blocks?.slice(-10).map((block) => ({ kind: block.kind, text: block.text, data: block.data })),
      })
      console.log(JSON.stringify({ branch: definition.id, ...branch.turns.at(-1), tail: undefined }))
    }
    await Promise.all(pendingReplies)
  } catch (error) {
    branch.error = error instanceof Error ? error.message : String(error)
    console.log(JSON.stringify({ branch: definition.id, error: branch.error }))
  } finally {
    report.branches.push(branch)
    await page.close()
  }
}

await browser.close()
const turns = report.branches.flatMap((branch) => branch.turns)
report.summary = {
  branches: report.branches.length,
  completedBranches: report.branches.filter((branch) => !branch.error).length,
  generatedTurns: turns.length,
  rawModelCalls: report.branches.reduce((total, branch) => total + branch.rawReplies.length, 0),
  repairCalls: report.branches.reduce((total, branch) => total + branch.rawReplies.filter((reply) => reply.repair).length, 0),
  shadowMutationCount: turns.filter((turn) => !turn.shadowUnchanged).length,
  governedRejectedCount: turns.reduce((total, turn) => total + turn.governedRejected.length, 0),
  immediateRepeatCount: turns.filter((turn) => turn.immediateRepeat).length,
  emptyChoiceCount: turns.filter((turn) => turn.emptyChoices).length,
  recoveryCount: turns.filter((turn) => turn.recovery).length,
  openNarrativeChoices: turns.reduce((total, turn) => total + turn.openNarrative, 0),
  governedAcceptedChoices: turns.reduce((total, turn) => total + turn.governedAccepted, 0),
}
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ event: 'summary', outputPath, ...report.summary }))
if (report.summary.completedBranches !== branches.length || report.summary.shadowMutationCount > 0 || report.summary.emptyChoiceCount > 0) process.exitCode = 1
