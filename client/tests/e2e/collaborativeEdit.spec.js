import { test, expect } from '@playwright/test';

// The single test that most directly proves this project's core claim:
// multiple real users, in real separate browser sessions, typing into the
// same document at the same time -- including at overlapping positions --
// converge to identical, complete content. Everything else in this project
// supports this one test being true.

const PASSWORD = 'correct horse battery staple';

async function registerUser(page, displayName, email) {
  await page.goto('/register');
  await page.fill('input[type="text"]', displayName);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page.getByText('Your documents')).toBeVisible();
}

async function loginUser(page, email) {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page.getByText('Your documents')).toBeVisible();
}

test.describe('collaborative editing convergence', () => {
  test('3 users editing the same document simultaneously converge to identical, complete content', async ({
    browser,
  }) => {
    const stamp = Date.now();
    const emailA = `e2e-alice-${stamp}@example.com`;
    const emailB = `e2e-bob-${stamp}@example.com`;
    const emailC = `e2e-carol-${stamp}@example.com`;

    // Register B and C first -- granting access requires the target email
    // to already belong to a registered user.
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await registerUser(pageB, 'Bob', emailB);

    const contextC = await browser.newContext();
    const pageC = await contextC.newPage();
    await registerUser(pageC, 'Carol', emailC);

    // Alice registers, creates the document, and grants Bob and Carol
    // editor access -- all through the real UI, not API shortcuts.
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await registerUser(pageA, 'Alice', emailA);

    await pageA.click('button:has-text("New document")');
    await expect(pageA.locator('a:has-text("Untitled Document")')).toBeVisible();
    await pageA.click('a:has-text("Untitled Document")');
    await expect(pageA.locator('.editor-surface')).toBeVisible();
    const docUrl = pageA.url();

    // Note: PermissionsPanel displays each grant by userId (a UUID), not
    // email -- a known, already-flagged limitation (see CLAUDE.md's Phase 5
    // notes), not something to silently work around in the product here.
    // Asserting on the permission list's item count instead of the email
    // text is what that means for this test.
    await expect(pageA.locator('.permission-list li')).toHaveCount(1); // owner's own row, once loaded
    for (const email of [emailB, emailC]) {
      const listItemsBefore = await pageA.locator('.permission-list li').count();
      await pageA.fill('input[placeholder="Email to grant access"]', email);
      await pageA.click('button:has-text("Grant access")');
      await expect(pageA.locator('.permission-list li')).toHaveCount(listItemsBefore + 1);
    }

    // Bob and Carol log in (separate browser contexts -- separate sessions,
    // exactly like three different people on three different computers) and
    // open the same document.
    await loginUser(pageB, emailB);
    await loginUser(pageC, emailC);

    await Promise.all([pageA.goto(docUrl), pageB.goto(docUrl), pageC.goto(docUrl)]);
    await Promise.all([
      expect(pageA.locator('.connection-badge--connected')).toBeVisible({ timeout: 10_000 }),
      expect(pageB.locator('.connection-badge--connected')).toBeVisible({ timeout: 10_000 }),
      expect(pageC.locator('.connection-badge--connected')).toBeVisible({ timeout: 10_000 }),
    ]);

    // All three click into the editor and type AT THE SAME TIME, at the
    // same starting position (the empty document) -- genuinely overlapping,
    // concurrent edits, not politely-staggered ones. Each user's text is a
    // distinct, easily-identifiable marker repeated several times, so data
    // loss (a dropped or corrupted character) is easy to detect.
    await Promise.all([
      pageA.click('.editor-surface'),
      pageB.click('.editor-surface'),
      pageC.click('.editor-surface'),
    ]);
    await Promise.all([
      pageA.type('.editor-surface', 'AAAAAAAAAA', { delay: 15 }),
      pageB.type('.editor-surface', 'BBBBBBBBBB', { delay: 15 }),
      pageC.type('.editor-surface', 'CCCCCCCCCC', { delay: 15 }),
    ]);

    // Poll until all three pages agree, rather than a fixed sleep -- the
    // final round of broadcasts can take a moment to settle.
    await expect
      .poll(
        async () => {
          const [textA, textB, textC] = await Promise.all([
            pageA.locator('.editor-surface').innerText(),
            pageB.locator('.editor-surface').innerText(),
            pageC.locator('.editor-surface').innerText(),
          ]);
          return textA === textB && textB === textC;
        },
        { timeout: 15_000, message: 'expected all three tabs to converge to identical content' }
      )
      .toBe(true);

    const finalA = await pageA.locator('.editor-surface').innerText();
    const finalB = await pageB.locator('.editor-surface').innerText();
    const finalC = await pageC.locator('.editor-surface').innerText();

    // Byte-identical across all three independent browser sessions.
    expect(finalA).toBe(finalB);
    expect(finalB).toBe(finalC);

    // No data loss: every character any of the three users typed is present
    // -- exactly 10 of each marker, not 9 (dropped) or 11 (duplicated).
    const countOf = (str, ch) => str.split('').filter((c) => c === ch).length;
    expect(countOf(finalA, 'A')).toBe(10);
    expect(countOf(finalA, 'B')).toBe(10);
    expect(countOf(finalA, 'C')).toBe(10);
    expect(finalA.length).toBe(30);

    await contextA.close();
    await contextB.close();
    await contextC.close();
  });
});
