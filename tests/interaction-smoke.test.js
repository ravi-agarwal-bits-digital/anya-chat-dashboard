'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function makeNode(options = {}) {
  const listeners = new Map();
  return {
    value: options.value || '', checked: false, disabled: false, textContent: '', innerHTML: '', className: '', dataset: options.dataset || {}, style: {}, clickCount: 0,
    classList: {add() {}, remove() {}, toggle() {}},
    addEventListener(type, listener) { listeners.set(type, [...(listeners.get(type) || []), listener]); },
    async dispatch(type, event = {}) {
      for (const listener of listeners.get(type) || []) await listener({...event, target: event.target || this});
    },
    hasListener(type) { return (listeners.get(type) || []).length > 0; },
    click() { this.clickCount++; },
    getAttribute(name) { return options.attributes?.[name] || null; },
    setAttribute() {}
  };
}

function makeWindow() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) { listeners.set(type, [...(listeners.get(type) || []), listener]); },
    async dispatch(type) { for (const listener of listeners.get(type) || []) await listener(); }
  };
}

function makeDocument(nodes, selectors = {}) {
  const listeners = new Map();
  return {
    getElementById(id) { return nodes[id] || null; },
    querySelector(selector) { return selectors[selector] || null; },
    querySelectorAll(selector) { return selectors[selector + '[]'] || []; },
    addEventListener(type, listener) { listeners.set(type, [...(listeners.get(type) || []), listener]); }
  };
}

async function verifyDashboardBindings() {
  const loginPassword = makeNode();
  const loginError = makeNode();
  const unlockButton = makeNode();
  const retryButton = makeNode();
  const rangeChip = makeNode({dataset: {range: 'all'}});
  const applyRangeButton = makeNode();
  const globalSearch = makeNode();
  const drawerBackground = makeNode();
  const drawerClose = makeNode();
  const window = makeWindow();
  const document = makeDocument({loginPassword, loginError, unlockDashboardBtn: unlockButton, retryDataLoadBtn: retryButton, applyCustomRangeBtn: applyRangeButton, globalSearch}, {
    '.login-logo-img': makeNode({attributes: {src: 'assets/bits-pilani-digital-logo.jpg'}}),
    '[data-brand-logo][]': [], '.chip[data-range][]': [rangeChip], '.drawer-bg': drawerBackground, '.drawer-close': drawerClose
  });
  const sandbox = {
    ArrayBuffer, Blob, Date, Math, RegExp, Set, TextEncoder, Uint8Array, console, document, window,
    sessionStorage: {removeItem() {}}
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(read('js/dashboard.js'), sandbox);
  await window.dispatch('DOMContentLoaded');

  for (const node of [unlockButton, retryButton, rangeChip, applyRangeButton, globalSearch, drawerBackground, drawerClose]) assert.equal(node.hasListener('click') || node.hasListener('input') || node.hasListener('keydown') || node.hasListener('focus'), true, 'dashboard control has an external event listener');
  await unlockButton.dispatch('click');
  assert.equal(loginError.textContent, 'Enter the access password.', 'dashboard login click invokes external handler');
  await rangeChip.dispatch('click');
}

async function verifyAdminBindings() {
  const adminPassword = makeNode();
  const gateStatus = makeNode();
  const unlockButton = makeNode();
  const dropZone = makeNode();
  const fileInput = makeNode();
  const publishConfirm = makeNode();
  const nodes = {adminPassword, gateStatus, unlockAdminBtn: unlockButton, dropZone, fileInput, publishConfirm, sheet: makeNode(), path: makeNode(), configPath: makeNode(), publishBtn: makeNode(), saveConnectionSettingsBtn: makeNode(), clearSessionTokenBtn: makeNode()};
  const window = makeWindow();
  const document = makeDocument(nodes, {'#adminGate .logoBox img': makeNode({attributes: {src: '../assets/bits-pilani-digital-logo.jpg'}}), '[data-brand-logo][]': []});
  const sandbox = {
    Date, Math, RegExp, Set, TextEncoder, Uint8Array, console, document, window,
    sessionStorage: {removeItem() {}, getItem() { return null; }}, localStorage: {removeItem() {}}
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(read('js/admin.js'), sandbox);
  await window.dispatch('DOMContentLoaded');

  assert.equal(unlockButton.hasListener('click'), true, 'admin unlock uses an external click listener');
  assert.equal(dropZone.hasListener('click') && dropZone.hasListener('keydown'), true, 'admin upload zone keeps click and keyboard support');
  await unlockButton.dispatch('click');
  assert.match(gateStatus.innerHTML, /Please enter the admin password/, 'admin login click invokes external handler');
  let prevented = false;
  await dropZone.dispatch('keydown', {key: 'Enter', preventDefault() { prevented = true; }});
  assert.equal(prevented, true, 'admin upload-zone keyboard handler prevents default');
  assert.equal(fileInput.clickCount, 1, 'admin upload-zone keyboard handler opens file picker');
}

Promise.all([verifyDashboardBindings(), verifyAdminBindings()]).then(() => {
  console.log('interaction smoke checks passed');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
