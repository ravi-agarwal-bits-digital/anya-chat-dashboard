'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const productionFiles = ['index.html', 'admin/index.html'];
const requiredColumns = [
  'Chat Created At (IST)', 'Chat ID', 'Agent Messages',
  'Total Tokens', 'Summary', 'Full Conversation'
];

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function staticIds(html) {
  const markup = html.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  return [...markup.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]);
}

function unzip(entry) {
  const fixture = path.join(root, 'tests/fixtures/chat_analytics_fixture.xlsx');
  const result = childProcess.spawnSync('unzip', ['-p', fixture, entry], {encoding: 'utf8'});
  assert.equal(result.status, 0, `fixture could not read ${entry}: ${result.stderr}`);
  return result.stdout;
}

for (const file of productionFiles) {
  const html = read(file);
  const ids = staticIds(html);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  assert.deepEqual(duplicates, [], `${file}: duplicate static IDs: ${duplicates.join(', ')}`);
  assert.match(html, /integrity="sha384-[^"]+" crossorigin="anonymous"/, `${file}: SheetJS must be integrity pinned`);
  assert.match(html, /Content-Security-Policy/, `${file}: CSP is required`);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${file}: inline event handlers are not allowed`);
  assert.doesNotMatch(html, /script-src[^;]*'unsafe-inline'/i, `${file}: CSP must block inline scripts`);
}

const dashboard = read('index.html');
const admin = read('admin/index.html');
const dashboardScript = read('js/dashboard.js');
const adminScript = read('js/admin.js');
const dashboardHead = dashboard.slice(0, dashboard.indexOf('</head>'));
const dashboardCss = read('css/dashboard.css');

assert.match(dashboardHead, /href="css\/dashboard\.css"/, 'dashboard stylesheet link');
assert.doesNotMatch(dashboardHead, /<style\b/i, 'dashboard must not retain an inline head stylesheet');
assert.match(dashboardCss, /\.chat-exec-shell/, 'dashboard stylesheet content');
assert.match(dashboard, /src="js\/dashboard\.js"/, 'dashboard script link');
assert.doesNotMatch(dashboard, /<script>\s*[\s\S]*?<\/script>/i, 'dashboard must not retain inline application scripts');
assert.doesNotThrow(() => new Function(dashboardScript), 'dashboard JavaScript syntax');
assert.match(dashboard, /href="assets\/favicon\.png"/, 'dashboard shared favicon');
assert.match(dashboard, /src="assets\/bits-pilani-digital-logo\.jpg"/, 'dashboard shared logo');
assert.match(admin, /href="\.\.\/assets\/favicon\.png"/, 'admin shared favicon');
assert.match(admin, /src="\.\.\/assets\/bits-pilani-digital-logo\.jpg"/, 'admin shared logo');
assert.doesNotMatch(dashboard + admin, /data:image\//, 'production pages must not embed image data');
assert.doesNotMatch(dashboard + admin, /img-src 'self' data:/, 'production CSP must not allow embedded images');
for (const asset of ['assets/favicon.png', 'assets/bits-pilani-digital-logo.jpg']) {
  assert.equal(fs.existsSync(path.join(root, asset)), true, `${asset}: shared asset exists`);
}
assert.match(dashboardScript, /const ENC_MAGIC="AANYAENC1"/, 'dashboard encryption compatibility marker');
assert.match(admin, /href="\.\.\/css\/admin\.css"/, 'admin stylesheet link');
assert.match(admin, /src="\.\.\/js\/admin\.js"/, 'admin script link');
assert.doesNotMatch(admin, /<style\b/i, 'admin must not retain inline styles');
assert.doesNotMatch(admin, /<script>([\s\S]*?)<\/script>/i, 'admin must not retain inline application scripts');
assert.doesNotMatch(dashboardScript, /\son[a-z]+\s*=/i, 'dashboard script must not emit inline event handlers');
assert.doesNotMatch(adminScript, /\son[a-z]+\s*=/i, 'admin script must not emit inline event handlers');
assert.doesNotMatch(adminScript, /saveEncryptedToken|unlockSavedToken|TOKEN_VAULT_KEY/, 'admin token vault must not persist tokens');
assert.doesNotMatch(adminScript, /writeBackup|makeBackupPath|backupFolder/, 'admin must retain only the live workbook');
assert.match(adminScript, /const DATA_MAGIC='AANYAENC1'/, 'admin encryption compatibility marker');
assert.doesNotThrow(() => new Function(adminScript), 'admin JavaScript syntax');
for (const retiredFile of ['index-v1.html', 'index-claude.html', 'index-last-latest.html']) {
  assert.equal(fs.existsSync(path.join(root, retiredFile)), false, `${retiredFile} must remain retired`);
}

const dashboardSandbox = {
  ArrayBuffer, Blob, Date, Math, RegExp, Set, TextEncoder, Uint8Array,
  console,
  document: {addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; }},
  window: {addEventListener() {}, DATA_QUALITY: null}
};
dashboardSandbox.globalThis = dashboardSandbox;
vm.runInNewContext(dashboardScript, dashboardSandbox);
assert.equal(vm.runInNewContext("isEncrypted(new TextEncoder().encode('AANYAENC1payload'))", dashboardSandbox), true, 'encrypted payload detection');
assert.equal(vm.runInNewContext("isEncrypted(new TextEncoder().encode('PK\\x03\\x04plain-workbook'))", dashboardSandbox), false, 'plaintext workbook rejection');
assert.match(dashboardScript, /if\(!isEncrypted\(bytes\)\)\{show\('dataPlaceholder'\);return;\}/, 'dashboard must reject unencrypted live data before parsing');
const regression = vm.runInNewContext('runAnyaRegressionChecks()', dashboardSandbox);
assert.equal(regression.ok, true, 'built-in analytics regression fixture');

const adminSandbox = {
  Date, Math, RegExp, Set, TextEncoder, Uint8Array,
  console,
  document: {addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }},
  window: {addEventListener() {}}
};
adminSandbox.globalThis = adminSandbox;
vm.runInNewContext(adminScript, adminSandbox);
assert.equal(vm.runInNewContext("assessWorkbookQuality([{'Chat Created At (IST)':'10 Jul 2026, 10:30:00 AM','Chat ID':'chat-1','Full Conversation':'User: Hello'}]).usableRows", adminSandbox), 1, 'usable chat quality detection');
assert.equal(vm.runInNewContext("assessWorkbookQuality([{'Chat Created At (IST)':'10 Jul 2026, 10:30:00 AM IST','Chat ID':'chat-1','Full Conversation':'User: Hello'}]).usableRows", adminSandbox), 1, 'dashboard-compatible IST suffix detection');
assert.equal(vm.runInNewContext("assessWorkbookQuality([{'Chat Created At (IST)':'not a date','Chat ID':'chat-1','Full Conversation':''}]).usableRows", adminSandbox), 0, 'unusable chat quality detection');
assert.match(admin, /id="publishConfirm"/, 'admin must require publication confirmation');
assert.match(adminScript, /GitHub verification did not match the saved/, 'admin must verify published file metadata');
assert.match(adminScript, /MAX_FILE_BYTES=90\*1024\*1024/, 'admin must protect GitHub file-size limits');

for (const file of fs.readdirSync(path.join(root, 'data')).filter(name => name.endsWith('.xlsx'))) {
  const bytes = fs.readFileSync(path.join(root, 'data', file));
  assert.equal(bytes.subarray(0, 9).toString('utf8'), 'AANYAENC1', `${file}: encrypted data marker`);
}

const workbookXml = unzip('xl/workbook.xml');
assert.match(workbookXml, /name="Chats Export"/, 'fixture worksheet name');
const worksheetXml = unzip('xl/worksheets/sheet1.xml');
for (const column of requiredColumns) {
  const escaped = column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(worksheetXml, new RegExp(escaped), `fixture column: ${column}`);
}

console.log('dashboard smoke checks passed');
