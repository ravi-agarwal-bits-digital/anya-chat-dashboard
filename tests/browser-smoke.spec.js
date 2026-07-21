'use strict';

const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const mime = {'.css':'text/css', '.html':'text/html', '.jpg':'image/jpeg', '.js':'application/javascript', '.json':'application/json', '.png':'image/png', '.xlsx':'application/octet-stream'};
let server;
let baseURL;

function serve(req, res) {
  const requested = decodeURIComponent((req.url || '/').split('?')[0]);
  const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '');
  const candidate = path.resolve(root, relative);
  const file = fs.existsSync(candidate) && fs.statSync(candidate).isDirectory() ? path.join(candidate, 'index.html') : candidate;
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, {'content-type': mime[path.extname(file)] || 'application/octet-stream'});
  fs.createReadStream(file).pipe(res);
}

test.beforeAll(async () => {
  server = http.createServer(serve);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => new Promise(resolve => server.close(resolve)));

async function expectNoHorizontalOverflow(page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('dashboard and admin gates remain keyboard-accessible at desktop and mobile widths', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto(`${baseURL}/`);
  await expect(page).toHaveTitle('Anya Chat Intelligence');
  const dashboardPassword = page.getByLabel('Dashboard access password');
  await dashboardPassword.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', {name: 'Unlock dashboard'})).toBeFocused();
  await page.getByRole('button', {name: 'Unlock dashboard'}).click();
  await expect(page.locator('#loginError')).toHaveText('Enter the access password.');
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({width: 390, height: 844});
  await page.goto(`${baseURL}/admin/`);
  await expect(page).toHaveTitle('Anya Chat Data Upload Console');
  const adminPassword = page.getByLabel('Admin password');
  await adminPassword.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', {name: 'Unlock console'})).toBeFocused();
  await page.getByRole('button', {name: 'Unlock console'}).click();
  await expect(page.locator('#gateStatus')).toContainText('Please enter the admin password');
  await expectNoHorizontalOverflow(page);
});

test('programme drill-down opens and restores keyboard focus in a real browser', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto(`${baseURL}/`);
  await page.evaluate(() => {
    const record = {
      idx: 1, id: 'browser-fixture-1', title: 'Programme prospect', programs: ['Data Science & AI'],
      questions: [{text: 'Tell me about Data Science', themes: ['Program'], gated: false, deflected: false}], gapCount: 0,
      contactCaptured: true, callbackBooked: true, highIntent: true, depth: 2, summary: 'Browser fixture', conv: 'User: Hello\nAgent: Hi',
      created: {day: 1, mon: 6, year: 2026, hour: 10, min: 0, sec: 0}, key: 20260701
    };
    VIEW = [record];
    RECORDS = [record];
    document.getElementById('dashboardContent').style.display = 'block';
    document.getElementById('mainWrap').style.display = 'block';
    document.getElementById('report').innerHTML = '<table id="explTable"></table>';
    bindInteractions();
    document.getElementById('report').innerHTML = secPrograms();
  });
  const programmeRow = page.getByRole('button', {name: /Data Science & AI/});
  await programmeRow.focus();
  await programmeRow.click();
  await expect(page.locator('#drawer')).toHaveClass(/open/);
  await expect(page.locator('#drawer')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('.drawer-panel')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#drawer')).not.toHaveClass(/open/);
  await expect(programmeRow).toBeFocused();
  await expectNoHorizontalOverflow(page);
});
