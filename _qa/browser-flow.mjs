import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const baseUrl = process.env.QA_URL ?? 'http://127.0.0.1:4178/?story_mode=demo&lang=zh'
const evidenceDir = new URL('./ui/', import.meta.url)
const mediaUrl = 'https://cdn.aiwaves.tech/prod/telegram/avatar/1100736121/1786965226216910.png'
const evidencePath = (name) => fileURLToPath(new URL(name, evidenceDir))

await mkdir(evidenceDir, { recursive: true })

const browser = await chromium.launch({ headless: true })

async function configure(page, { mockMedia = true, url = baseUrl } = {}) {
  if (mockMedia) {
    await page.route('**/alteru-media/api/v1/images/generations', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          task_id: 'qa_static_scene', request_id: 'qa_static_request', type: 'image', status: 'succeeded',
          media: { type: 'image', url: mediaUrl, width: 1024, height: 640, format: 'png' },
        }),
      })
    })
    await page.route('**/alteru-media/api/v1/tasks/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          task_id: 'qa_static_scene', request_id: 'qa_static_request', type: 'image', status: 'succeeded',
          media: { type: 'image', url: mediaUrl, width: 1024, height: 640, format: 'png' },
        }),
      })
    })
  }
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => {
    window.alteruLocalStorage?.clear()
    window.alteruSessionStorage?.clear()
    localStorage.removeItem('game_locale')
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.st-entry')
}

// English browser path verifies that the same grounding contract survives
// localization instead of silently dropping the conversational choices.
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
  await configure(page, { url: 'http://127.0.0.1:4178/?story_mode=demo&lang=en' })
  await hideGuestBanner(page)
  await enter(page)
  await act(page, 'Ask why Mara denied Room Nine so quickly')
  assert.deepEqual(await choiceLabels(page), [
    'Ask about the second invitation',
    'Inspect the brass directory',
    'Take her warning upstairs to Room Eight',
  ])
  await act(page, 'Ask about the second invitation')
  await act(page, 'Go upstairs and verify the position of Room Eight')
  assert.deepEqual(await choiceLabels(page), [
    'Check the red lamps in room order',
    'Go to lit Room Seven',
    'Light one red match to reveal the door hidden by the wall',
  ])
  await page.screenshot({ path: evidencePath('platform-layout-en-danger-390x844.png'), fullPage: true })
  await assertNoOverflow(page, 'English danger 390x844')
  await page.close()
}

async function hideGuestBanner(page) {
  await page.addStyleTag({ content: '#alteru-guest-banner{display:none!important}' })
}

async function enter(page) {
  await page.locator('.st-primary').click()
  await page.waitForSelector('.st-composer')
  await page.waitForFunction(() => document.querySelectorAll('.st-quick-replies button').length > 0)
}

async function choiceLabels(page) {
  return page.locator('.st-quick-replies button span').allTextContents()
}

async function act(page, label) {
  const button = page.locator('.st-quick-replies button').filter({ hasText: label })
  assert.equal(await button.count(), 1, `expected one choice containing: ${label}`)
  await button.click()
  await page.waitForFunction(() => !document.querySelector('[data-pending-action]') && !document.querySelector('.st-typing'))
  // The product intentionally uses smooth reading-anchor motion. Wait for it
  // to settle before judging which story consequence is actually visible.
  await page.waitForTimeout(700)
  const errorCount = await page.locator('[data-story-error]').count()
  const errorText = errorCount ? await page.locator('[data-story-error]').innerText() : ''
  assert.equal(errorCount, 0, `story error after: ${label}: ${errorText}`)
}

async function assertNoOverflow(page, state) {
  const metrics = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }))
  assert.ok(metrics.scrollWidth <= metrics.width + 1, `${state} horizontally overflows: ${JSON.stringify(metrics)}`)
}

// Primary 390×844 path: deterministic opening through the chapter checkpoint.
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
  await configure(page)
  await hideGuestBanner(page)
  await page.screenshot({ path: evidencePath('platform-layout-entry-390x844.png'), fullPage: true })
  await enter(page)
  assert.deepEqual(await choiceLabels(page), [
    '在前台灯下检查房卡背面的数字压痕',
    '请玛拉说明她为何立即否认九号房',
    '循着酒廊传来的低声哼唱离开前台',
  ])
  await act(page, '请玛拉说明她为何立即否认九号房')
  const labelsAfterMara = await choiceLabels(page)
  assert.ok(labelsAfterMara.some((label) => label.includes('第二次邀请')))
  await act(page, '追问第二次邀请')
  await page.locator('.st-world-button').click()
  await page.waitForSelector('.st-drawer')
  await page.waitForTimeout(350)
  assert.ok((await page.locator('.st-drawer').innerText()).includes('玛拉'))
  await page.screenshot({ path: evidencePath('platform-layout-relationships-390x844.png'), fullPage: true })
  await page.locator('.st-drawer header button').last().click()
  await act(page, '前往二层确认八号房门的位置')
  assert.ok((await page.locator('.st-conversation').innerText()).includes('红灯开始按七、八、十的房号顺序'))
  await page.screenshot({ path: evidencePath('platform-layout-danger-390x844.png'), fullPage: true })
  await act(page, '走向仍亮着红灯的七号房')
  assert.ok((await page.locator('.st-conversation').innerText()).includes('阿德里安'))
  await act(page, '说明熄灭的红灯已经逼近七号房')
  await act(page, '检查发出收缩声的空墙')
  assert.ok((await page.locator('.st-conversation').innerText()).includes('没有门牌的暗红房门'))
  await act(page, '拒绝暗红房门的邀请')
  await page.waitForSelector('.st-result--summary')
  const checkpointLabels = await choiceLabels(page)
  assert.equal(checkpointLabels.length, 1)
  assert.equal(await page.locator('input[aria-label="自定义行动"]').isDisabled(), true)
  await page.screenshot({ path: evidencePath('platform-layout-checkpoint-390x844.png'), fullPage: true })
  await assertNoOverflow(page, 'checkpoint 390x844')
  await page.close()
}

// The resource-response branch previously entered an endless
// danger → consistency recovery → same danger menu loop.
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
  await configure(page)
  await hideGuestBanner(page)
  await enter(page)
  await act(page, '请玛拉说明她为何立即否认九号房')
  await act(page, '追问第二次邀请')
  await act(page, '前往二层确认八号房门的位置')
  await act(page, '点燃一根红色火柴照出被墙藏起的门')
  let labels = await choiceLabels(page)
  assert.equal(labels.length, 3)
  assert.ok(labels.every((label) => label.includes('身后的红灯')))
  const directResponse = labels.find((label) => label.startsWith('立即应对'))
  assert.ok(directResponse)
  await act(page, directResponse)
  labels = await choiceLabels(page)
  const aftermath = labels.find((label) => label.includes('结束后留下的痕迹'))
    ?? labels.find((label) => label.includes('检查发出收缩声的空墙'))
  assert.ok(aftermath)
  assert.equal(await page.locator('[data-block-id^="consistency-recovery-"]').count(), 0)
  await act(page, aftermath)
  assert.ok((await page.locator('.st-conversation').innerText()).includes('没有门牌的暗红房门'))
  assert.equal(await page.locator('[data-block-id^="consistency-recovery-"]').count(), 0)
  await page.screenshot({ path: evidencePath('platform-layout-red-light-loop-exit-390x844.png'), fullPage: true })
  await page.close()
}

// The authored room-order choice previously skipped warning straight to a
// resolution draft. It now owns a real confrontation step before settlement.
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
  await configure(page)
  await hideGuestBanner(page)
  await enter(page)
  await act(page, '请玛拉说明她为何立即否认九号房')
  await act(page, '追问第二次邀请')
  await act(page, '前往二层确认八号房门的位置')
  await act(page, '说明红灯熄灭的房号顺序')
  const labels = await choiceLabels(page)
  assert.deepEqual(labels, [
    '询问熄灭的红灯为何逼近七号房',
    '说明熄灭的红灯已经逼近七号房',
    '点燃一根红色火柴照亮熄灭的红灯',
  ])
  assert.equal(await page.locator('[data-block-id^="consistency-recovery-"]').count(), 0)
  await act(page, '说明熄灭的红灯已经逼近七号房')
  assert.equal(await page.locator('[data-block-id^="consistency-recovery-"]').count(), 0)
  assert.ok((await choiceLabels(page)).length >= 1)
  await page.close()
}

// Narrow path verifies the second adult character debut and scrolling layout.
{
  const page = await browser.newPage({ viewport: { width: 320, height: 568 }, deviceScaleFactor: 1 })
  await configure(page)
  await hideGuestBanner(page)
  await enter(page)
  await act(page, '循着酒廊传来的低声哼唱离开前台')
  const body = await page.locator('.st-conversation').innerText()
  assert.ok(body.includes('自我介绍说自己叫诺亚'))
  assert.ok(body.includes('我叫诺亚'))
  const noaLabels = await choiceLabels(page)
  assert.equal(noaLabels.length, 3)
  await page.screenshot({ path: evidencePath('platform-layout-noa-debut-320x568.png'), fullPage: true })
  await assertNoOverflow(page, 'Noa debut 320x568')
  await page.close()
}

// Free input uses a local atomic boundary rule and must preserve clue progress.
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
  await configure(page)
  await hideGuestBanner(page)
  await enter(page)
  const input = page.locator('input[aria-label="自定义行动"]')
  await input.fill('停下，不要再靠近')
  await page.locator('button[aria-label="发送行动"]').click()
  await page.waitForFunction(() => !document.querySelector('[data-pending-action]') && !document.querySelector('.st-typing'))
  const story = await page.locator('.st-conversation').innerText()
  assert.ok(story.includes('对方立刻停下并退开一步'))
  assert.ok(story.includes('线索也没有消失'))
  const boundaryBlock = page.locator('[data-block-id^="domain-"]').filter({ hasText: '对方立刻停下并退开一步' }).first()
  const boundaryBox = await boundaryBlock.boundingBox()
  assert.ok(boundaryBox && boundaryBox.y >= 110 && boundaryBox.y < 520, `boundary response not anchored in reading viewport: ${JSON.stringify(boundaryBox)}`)
  await page.screenshot({ path: evidencePath('platform-layout-boundary-390x844.png'), fullPage: true })
  await page.close()
}

// Media failure is non-blocking and exposes a retry action.
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
  await page.route('**/alteru-media/api/**', (route) => route.abort('failed'))
  await configure(page, { mockMedia: false })
  await hideGuestBanner(page)
  await enter(page)
  await act(page, '请玛拉说明她为何立即否认九号房')
  await page.waitForSelector('.st-message-image.is-failed')
  assert.ok((await choiceLabels(page)).length > 0)
  assert.equal(await page.locator('.st-message-image.is-failed button').count(), 1)
  await page.locator('.st-message-image.is-failed').scrollIntoViewIfNeeded()
  await page.waitForTimeout(100)
  await page.screenshot({ path: evidencePath('platform-layout-media-failure-390x844.png'), fullPage: true })
  await page.close()
}

// External composition check keeps the production visitor extension enabled.
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
  await configure(page)
  await page.waitForTimeout(1200)
  await page.screenshot({ path: evidencePath('external-guest-entry-390x844.png'), fullPage: true })
  await page.close()
}

await browser.close()
console.log(JSON.stringify({
  ok: true,
  paths: ['checkpoint-chain', 'red-light-loop-exit', 'warning-stage-continuity', 'Noa-debut', 'English-danger', 'free-input-boundary', 'media-failure', 'external-guest'],
  viewports: ['390x844', '320x568'],
}))
