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

function finalInlineScript(html, file) {
  const match = html.match(/<script>([\s\S]*)<\/script>\s*<\/body>/);
  assert(match, `${file}: final inline script was not found`);
  return match[1];
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
  assert.doesNotThrow(() => new Function(finalInlineScript(html, file)), `${file}: JavaScript syntax`);
  const ids = staticIds(html);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  assert.deepEqual(duplicates, [], `${file}: duplicate static IDs: ${duplicates.join(', ')}`);
  assert.match(html, /integrity="sha384-[^"]+" crossorigin="anonymous"/, `${file}: SheetJS must be integrity pinned`);
  assert.match(html, /Content-Security-Policy/, `${file}: CSP is required`);
}

const dashboard = read('index.html');
const admin = read('admin/index.html');
assert.match(dashboard, /const ENC_MAGIC="AANYAENC1"/, 'dashboard encryption compatibility marker');
assert.match(admin, /const DATA_MAGIC='AANYAENC1'/, 'admin encryption compatibility marker');
assert.doesNotMatch(admin, /saveEncryptedToken|unlockSavedToken|TOKEN_VAULT_KEY/, 'admin token vault must not persist tokens');
assert.doesNotMatch(admin, /writeBackup|makeBackupPath|backupFolder/, 'admin must retain only the live workbook');
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
vm.runInNewContext(finalInlineScript(dashboard, 'index.html'), dashboardSandbox);
const regression = vm.runInNewContext('runAnyaRegressionChecks()', dashboardSandbox);
assert.equal(regression.ok, true, 'built-in analytics regression fixture');

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
