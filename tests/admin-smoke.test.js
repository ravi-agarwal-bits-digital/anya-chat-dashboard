'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const admin = read('admin/index.html');
const adminScript = read('js/admin.js');

assert.match(admin, /href="\.\.\/css\/admin\.css"/, 'admin stylesheet link');
assert.match(admin, /src="\.\.\/js\/admin\.js"/, 'admin script link');
assert.doesNotMatch(admin, /<style\b/i, 'admin must not retain inline styles');
assert.doesNotMatch(admin, /<script>([\s\S]*?)<\/script>/i, 'admin must not retain inline application scripts');
assert.doesNotMatch(adminScript, /saveEncryptedToken|unlockSavedToken|TOKEN_VAULT_KEY/, 'admin token vault must not persist tokens');
assert.doesNotMatch(adminScript, /writeBackup|makeBackupPath|backupFolder/, 'admin must retain only the live workbook');
assert.match(adminScript, /const DATA_MAGIC='AANYAENC1'/, 'admin encryption compatibility marker');
assert.match(adminScript, /GitHub verification did not match the saved/, 'admin must verify published file metadata');
assert.match(adminScript, /MAX_FILE_BYTES=90\*1024\*1024/, 'admin must protect GitHub file-size limits');
assert.doesNotThrow(() => new Function(adminScript), 'admin JavaScript syntax');

const ids = [...admin.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]);
const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
assert.deepEqual(duplicates, [], 'admin duplicate static IDs: ' + duplicates.join(', '));

const sandbox = {
  Date, Math, RegExp, Set, TextEncoder, Uint8Array,
  console,
  document: {addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; }},
  window: {addEventListener() {}}
};
sandbox.globalThis = sandbox;
vm.runInNewContext(adminScript, sandbox);
assert.equal(vm.runInNewContext("assessWorkbookQuality([{'Chat Created At (IST)':'10 Jul 2026, 10:30:00 AM IST','Chat ID':'chat-1','Full Conversation':'User: Hello'}]).usableRows", sandbox), 1, 'dashboard-compatible usable chat quality detection');
assert.equal(vm.runInNewContext("assessWorkbookQuality([{'Chat Created At (IST)':'not a date','Chat ID':'chat-1','Full Conversation':''}]).usableRows", sandbox), 0, 'unusable chat quality detection');

console.log('admin smoke checks passed');
