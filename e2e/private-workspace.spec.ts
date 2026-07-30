import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('private student completes multi-file review, weekly planning, approval, and reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Your name').fill('E2E Student')
  await page.getByLabel('Email').fill(`student-${Date.now()}@example.test`)
  await page.locator('input[type="password"]').fill('private-e2e-password')
  await page.getByRole('button', { name: 'Create account' }).last().click()

  await expect(page.getByRole('heading', { name: 'Add data -> Review -> Build first plan' })).toBeVisible()
  await page.getByRole('button', { name: 'Add data' }).first().click()
  await page.locator('input[type=file]').first().setInputFiles([
    {
      name: 'semester.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from([
        'course_code,course_name,task_title,due_date,grade_weight',
        'CS304,Programming,Review service integration,2027-08-15T23:59:00Z,20',
      ].join('\n')),
    },
    {
      name: 'writing.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from([
        'course_code,course_name,task_title,due_date,grade_weight',
        'ENG201,Academic Writing,Draft research outline,2027-08-18T23:59:00Z,15',
      ].join('\n')),
    },
  ])
  await expect(page.locator('.import-queue-row')).toHaveCount(2)
  await expect(page.getByText('Review extracted study data', { exact: true })).toBeVisible()
  await expect(page.getByText('Structured import')).toBeVisible()
  for (let review = 0; review < 2; review += 1) {
    await expect(page.getByRole('button', { name: 'Confirm reviewed data' })).toBeVisible()
    const warningBoxes = page.locator('.review-warnings input[type="checkbox"]')
    for (let index = 0; index < await warningBoxes.count(); index += 1) await warningBoxes.nth(index).check()
    await page.getByRole('button', { name: 'Confirm reviewed data' }).click()
    if (review === 0) await expect(page.locator('.import-queue-row.confirmed')).toHaveCount(1)
    else await expect(page.getByRole('heading', { name: 'When are you free this week?' })).toBeVisible()
  }

  await page.getByRole('button', { name: 'Today', exact: true }).click()
  await page.getByRole('button', { name: 'Start a 45-minute session' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Finish session' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.getByText('Focus session saved. The task stays in your queue until you complete it.')).toBeVisible()

  await page.getByRole('button', { name: 'Plan', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'When are you free this week?' })).toBeVisible()
  await page.locator('.planning-day-toggle input').first().check()
  await page.getByRole('button', { name: 'Save availability' }).click()
  await page.getByRole('button', { name: 'Build weekly plan' }).click()
  await expect(page.getByText(/Proposal version 1/)).toBeVisible()
  await expect(page.getByRole('region', { name: 'Seven-day plan' })).toBeVisible()
  await page.getByRole('button', { name: 'Approve plan' }).click()
  await expect(page.getByText('Approved').first()).toBeVisible()

  await page.reload()
  await expect(page.getByText('Approved').first()).toBeVisible()

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Privacy and data' })).toBeVisible()
  await expect(page.getByLabel('Email digest')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Device reminders' })).toBeVisible()
  await expect(page.getByLabel('Notifications on this browser')).toBeDisabled()
  await page.getByLabel('Aggregate research').check()
  await expect(page.getByLabel('Aggregate research')).toBeChecked()
  await page.getByRole('button', { name: 'Add signal' }).click()
  await page.getByLabel('Focus length value').fill('25 minutes')
  await page.getByRole('button', { name: 'Save profile' }).click()
  await expect(page.getByText('Learner profile saved. Coach only uses it when you request a proposal.')).toBeVisible()
  await expect(page.getByLabel('Focus length value')).toHaveValue('25 minutes')
  await expect(page.getByRole('button', { name: 'Download export' })).toBeVisible()
})

test('desktop workspace keeps controls named, traps dialog focus, and passes WCAG checks', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await page.getByRole('button', { name: 'Use demo workspace' }).click()
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Today', exact: true })).toBeVisible()

  const unnamedControls = await page.locator('button, input, select, textarea').evaluateAll((controls) =>
    controls
      .filter((control) => {
        const element = control as HTMLInputElement
        if (element instanceof HTMLInputElement && element.type === 'hidden') return false
        const labels = 'labels' in element ? element.labels : null
        return !element.getAttribute('aria-label')
          && !element.getAttribute('aria-labelledby')
          && !element.getAttribute('title')
          && !element.textContent?.trim()
          && (!labels || labels.length === 0)
      })
      .map((control) => control.outerHTML.slice(0, 160)),
  )
  expect(unnamedControls).toEqual([])

  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze()
  expect(accessibility.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target),
  }))).toEqual([])

  await page.getByRole('button', { name: 'Data', exact: true }).click()
  await page.getByRole('button', { name: 'Add task', exact: true }).click()
  const dialog = page.locator('[role="dialog"][aria-modal="true"]')
  await expect(dialog).toBeVisible()
  for (let press = 0; press < 12; press += 1) await page.keyboard.press('Tab')
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')

  await page.setViewportSize({ width: 1280, height: 800 })
  const overflow = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }))
  expect(overflow.content).toBeLessThanOrEqual(overflow.viewport + 1)
})

test('system copy follows the selected Vietnamese or English mode', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await page.getByRole('button', { name: 'Use demo workspace' }).click()
  await page.getByRole('button', { name: 'VI', exact: true }).click()
  await page.getByRole('button', { name: 'Tại sao là việc này?', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Điều gì khiến việc này quan trọng?' })).toBeVisible()
  await expect(page.getByText('Academic impact')).toHaveCount(0)
  await expect(page.getByText('Cost of delay')).toHaveCount(0)

  await page.reload()
  await expect(page.getByRole('button', { name: 'Hôm nay', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Tại sao là việc này?', exact: true }).click()

  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Why does this matter now?' })).toBeVisible()
  await expect(page.getByText('Tác động học tập')).toHaveCount(0)
  await expect(page.getByText('Chi phí trì hoãn')).toHaveCount(0)
})

test('an expired session keeps the current-tab task draft through sign-in', async ({ page }) => {
  const email = `session-draft-${Date.now()}@example.test`
  const password = 'private-e2e-password'

  await page.goto('/')
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Your name').fill('Session Draft Student')
  await page.getByLabel('Email').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: 'Create account' }).last().click()

  await page.getByRole('button', { name: 'Data', exact: true }).click()
  await page.getByRole('button', { name: 'Add task', exact: true }).click()
  await page.getByLabel('Course code').fill('BIO202')
  await page.getByLabel('Course name').fill('Biology')
  await page.getByLabel('Task', { exact: true }).fill('Keep this draft after re-authentication')

  const logoutStatus = await page.evaluate(async () => {
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    return response.status
  })
  expect(logoutStatus).toBe(204)

  await page.getByRole('button', { name: 'Add task', exact: true }).last().click()
  await expect(page.getByText('Your session expired. Sign in again to continue the current draft.')).toBeVisible()
  await page.getByLabel('Email').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click()

  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByLabel('Course code')).toHaveValue('BIO202')
  await expect(page.getByLabel('Course name')).toHaveValue('Biology')
  await expect(page.getByLabel('Task', { exact: true })).toHaveValue('Keep this draft after re-authentication')
})

test('a failed upload remains visible and succeeds when retried', async ({ page }) => {
  let failedUpload = false

  await page.goto('/')
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await page.getByRole('button', { name: 'Use demo workspace' }).click()
  await page.getByRole('button', { name: 'Data', exact: true }).click()
  await page.route('**/api/documents', async (route) => {
    if (route.request().method() === 'POST' && !failedUpload) {
      failedUpload = true
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UPLOAD_FAILED', message: 'Temporary upload failure.' } }),
      })
      return
    }
    await route.continue()
  })

  await page.getByRole('button', { name: 'Upload study files' }).click()
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'retry.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from([
      'course_code,course_name,task_title,due_date,grade_weight',
      'MAT210,Discrete Mathematics,Retry import workflow,2027-08-20T23:59:00Z,10',
    ].join('\n')),
  })

  await expect(page.locator('.import-queue-row.error')).toContainText('retry.csv')
  await expect(page.getByText('Needs retry', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Retry', exact: true }).click()

  await expect(page.getByText('Review extracted study data', { exact: true })).toBeVisible()
  await expect(page.locator('.import-queue-row.review')).toContainText('retry.csv')
})
