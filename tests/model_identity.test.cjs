'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const identitySource = html.slice(html.indexOf('function describeModelIdentity('), html.indexOf('async function loadModel('));
const loadStart = html.indexOf('async function loadModel(');
const nextFunction = html.slice(loadStart + 1).search(/\n(?:async )?function /);
const loadSource = html.slice(loadStart, loadStart + 1 + nextFunction);
const current = JSON.parse(fs.readFileSync(path.join(root, 'model/model.json'), 'utf8'));

function setup(model = current, fetch = async () => ({active: model.version})) {
  const elements = new Map();
  const context = vm.createContext({
    trainedModel: model, document: {title: ''}, Date, Number, String,
    fetchJson: fetch, pct: value => String(value),
    $: id => {
      if (!elements.has(id)) elements.set(id, {textContent: '', innerHTML: '', className: ''});
      return elements.get(id);
    },
  });
  vm.runInContext(identitySource + '\n' + loadSource, context);
  return {context, elements};
}

test('matching versions show the actually loaded model', () => {
  const {context} = setup();
  const result = context.describeModelIdentity(current, {active: current.version});
  assert.equal(result.status, 'good');
  assert.match(result.title, /v9\.1/);
});

test('stale v12 manifest is disclosed and never selects a replacement', async () => {
  const {context, elements} = setup(current, async () => ({active: 'v12-old-manifest'}));
  const before = JSON.stringify(current);
  await context.updateModelIdentity(current);
  assert.equal(context.trainedModel, current);
  assert.equal(JSON.stringify(current), before);
  assert.match(elements.get('modelReleaseStatus').textContent, /不一致/);
  assert.match(context.document.title, /v9\.1/);
});

test('unknown model version is not relabeled as the manifest version', () => {
  const {context} = setup();
  const result = context.describeModelIdentity({}, {active: 'v12'});
  assert.equal(result.status, 'bad');
  assert.doesNotMatch(result.title, /v12/);
});

test('missing or malformed manifest preserves the actual identity', () => {
  const {context} = setup();
  for (const manifest of [null, {}, {active: 12}, {active: ''}]) {
    const result = context.describeModelIdentity(current, manifest);
    assert.match(result.title, /v9\.1/);
    assert.match(result.text, /確認できません/);
  }
});

test('manifest fetch failure leaves predictions and model object unchanged', async () => {
  const {context, elements} = setup(current, async () => { throw Error('unavailable'); });
  await context.updateModelIdentity(current);
  assert.equal(context.trainedModel, current);
  assert.match(elements.get('modelReleaseStatus').textContent, /確認できません/);
});

test('a delayed old lookup cannot overwrite the label of a newer model', async () => {
  let resolve;
  const pending = new Promise(r => { resolve = r; });
  const {context, elements} = setup(current, async () => pending);
  const old = context.updateModelIdentity(current);
  context.trainedModel = {version: 'new-model'};
  context.document.title = 'new label';
  elements.get('modelReleaseStatus').textContent = 'new label';
  resolve({active: current.version});
  await old;
  assert.equal(context.document.title, 'new label');
  assert.equal(elements.get('modelReleaseStatus').textContent, 'new label');
});

test('manifest labels use textContent, never HTML insertion', async () => {
  const {context, elements} = setup(current, async () => ({active: '<img src=x onerror=alert(1)>'}));
  await context.updateModelIdentity(current);
  assert.equal(elements.get('modelReleaseStatus').innerHTML, '');
  assert.match(elements.get('modelReleaseStatus').textContent, /<img/);
});

test('loadModel still succeeds with the same coefficients if identity lookup fails', async () => {
  const {context} = setup(null, async url => {
    if (url.startsWith('/model/model.json')) return current;
    throw Error('manifest unavailable');
  });
  assert.equal(await context.loadModel(), true);
  assert.equal(context.trainedModel, current);
  assert.deepEqual(context.trainedModel.coefficients, current.coefficients);
});

test('failed model load clears stale version labels', async () => {
  const {context, elements} = setup(current, async () => { throw Error('model unavailable'); });
  assert.equal(await context.loadModel(), false);
  assert.equal(context.trainedModel, null);
  assert.match(context.document.title, /読込失敗/);
  assert.match(elements.get('modelReleaseStatus').textContent, /確認できません/);
});
