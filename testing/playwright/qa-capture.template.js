async (page) => {
  const outDir = '__OUT_DIR__';
  const baseUrl = '__BASE_URL__';

  function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function formatOrdinal(day) {
    const remainder = day % 10;
    const teen = day % 100;
    if (teen >= 11 && teen <= 13) return `${day}th`;
    if (remainder === 1) return `${day}st`;
    if (remainder === 2) return `${day}nd`;
    if (remainder === 3) return `${day}rd`;
    return `${day}th`;
  }

  function formatDayAriaLabel(year, monthIndex, day) {
    const date = new Date(Date.UTC(year, monthIndex, day));
    const weekday = date.toLocaleString('en-US', { weekday: 'long', timeZone: 'UTC' });
    const month = date.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
    return `${weekday}, ${month} ${formatOrdinal(day)}, ${year}`;
  }

  async function chooseFromSearchable(placeholder, index, query, optionPattern) {
    const input = page.getByPlaceholder(placeholder).nth(index);
    await input.click();
    await input.fill('');
    await input.fill(query);
    const option = page.getByRole('option', { name: optionPattern }).first();
    await option.waitFor({ state: 'visible', timeout: 30000 });
    await option.click();
  }

  async function setDateRange(range) {
    const trigger = page
      .locator('button[aria-haspopup="dialog"]')
      .filter({ hasText: /->|Select date range|Pick end date/ })
      .last();
    await trigger.click();

    const captions = page.locator('.rdp-caption_label');
    await captions.first().waitFor({ state: 'visible', timeout: 10000 });

    for (let i = 0; i < 24; i += 1) {
      const visibleCaptions = (await captions.allTextContents()).map((text) => text.trim()).filter(Boolean);
      if (visibleCaptions.includes(range.monthLabel)) break;
      const currentDate = new Date(`${visibleCaptions[0]} 1 UTC`);
      const targetDate = new Date(`${range.monthLabel} 1 UTC`);
      if (currentDate > targetDate) {
        await page.locator('.rdp-button_previous').click();
      } else {
        await page.locator('.rdp-button_next').click();
      }
      await page.waitForTimeout(120);
    }

    const [yearText, monthText] = range.label.split('-');
    const year = Number(yearText);
    const monthIndex = Number(monthText) - 1;

    for (const targetDay of [1, range.lastDay]) {
      const label = formatDayAriaLabel(year, monthIndex, targetDay);
      const dayButton = page.getByLabel(label).last();
      await dayButton.waitFor({ state: 'visible', timeout: 10000 });
      await dayButton.click();
      await page.waitForTimeout(150);
    }

    await captions.first().waitFor({ state: 'hidden', timeout: 10000 });
  }

  const username = '__USERNAME__';
  const password = '__PASSWORD__';
  const settings = {
    githubToken: '__GITHUB_TOKEN__',
    githubOrg: '__GITHUB_ORG__',
    jiraBaseUrl: '__JIRA_BASE_URL__',
    jiraEmail: '__JIRA_EMAIL__',
    jiraToken: '__JIRA_API_TOKEN__',
    jiraStoryPointsField: '__JIRA_STORY_POINTS_FIELD__',
    testRailBaseUrl: '__TESTRAIL_BASE_URL__',
    testRailEmail: '__TESTRAIL_EMAIL__',
    testRailToken: '__TESTRAIL_API_TOKEN__',
  };
  const stored = { username, ...settings };
  const cookieValue = encodeURIComponent(JSON.stringify(stored));

  const projectName = '__QA_PROJECT__';
  const comparisons = __COMPARISONS_JSON__;
  const months = __MONTHS_JSON__;

  await page.setViewportSize({ width: 1600, height: 1400 });

  await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
  const signInButton = page.getByRole('button', { name: 'Sign in' });
  if (await signInButton.isVisible().catch(() => false)) {
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(password);
    await Promise.all([
      page.waitForURL(/\/settings|\/individual|\/qa/, { timeout: 30000 }),
      signInButton.click(),
    ]);
  }

  await page.evaluate(({ username: activeUser, settings: runtimeSettings, cookie }) => {
    window.localStorage.setItem(`dpd-runtime-settings:${activeUser}`, JSON.stringify(runtimeSettings));
    document.cookie = `dpd_runtime_settings=${cookie}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, { username, settings, cookie: cookieValue });

  await page.goto(`${baseUrl}/qa`, { waitUntil: 'networkidle' });
  await page.keyboard.press('Meta+0').catch(() => {});
  await page.getByText('QA resource performance').waitFor({ state: 'visible', timeout: 30000 });

  await chooseFromSearchable('Select project…', 0, projectName, new RegExp(escapeRegex(projectName), 'i'));
  await page.waitForResponse(
    (resp) => resp.url().includes('/api/qa/catalog?projectId=') && resp.ok(),
    { timeout: 30000 },
  );
  await page.waitForTimeout(1000);

  const screenshots = [];

  for (const comparison of comparisons) {
    await chooseFromSearchable('Select QA…', 0, comparison.leftQa, new RegExp(escapeRegex(comparison.leftQa), 'i'));
    await chooseFromSearchable('Select QA…', 1, comparison.rightQa, new RegExp(escapeRegex(comparison.rightQa), 'i'));
    await chooseFromSearchable(
      'Select GitHub user…',
      0,
      comparison.leftGithub,
      new RegExp(escapeRegex(comparison.leftGithub), 'i'),
    );
    await chooseFromSearchable(
      'Select GitHub user…',
      1,
      comparison.rightGithub,
      new RegExp(escapeRegex(comparison.rightGithub), 'i'),
    );

    for (const month of months) {
      await setDateRange(month);
      await Promise.all([
        page.waitForResponse(
          (resp) => resp.url().includes('/api/qa/compare') && resp.ok(),
          { timeout: 300000 },
        ),
        page.getByRole('button', { name: /^Compare$/ }).click(),
      ]);

      await page.waitForTimeout(2500);

      const fileName = `${month.label}-${comparison.slug}.png`;
      await page.screenshot({
        path: `${outDir}/${fileName}`,
        fullPage: true,
      });
      screenshots.push({
        fileName,
        title: `${month.label} · ${comparison.leftQa} vs ${comparison.rightQa}`,
      });
    }
  }

  return { outDir, screenshots };
}
