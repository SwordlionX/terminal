/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test runner. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const test = require('node:test');

function load(file, imports = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(output, {
    module: loadedModule,
    exports: loadedModule.exports,
    require(id) {
      if (Object.hasOwn(imports, id)) return imports[id];
      throw new Error(`Unmocked dependency: ${id}`);
    },
  });
  return loadedModule.exports;
}

function loadMarketStore() {
  function create() {
    return initializer => {
      let state;
      const set = update => {
        const partial = typeof update === 'function' ? update(state) : update;
        if (partial !== state) state = { ...state, ...partial };
      };
      state = initializer(set, () => state);
      const hook = () => state;
      hook.getState = () => state;
      return hook;
    };
  }
  const store = load('src/store/marketData.ts', {
    zustand: { create },
    'zustand/middleware': { persist: initializer => initializer },
    '@/lib/dates': load('src/lib/dates.ts'),
  }).useMarketData;
  return store.getState;
}

test('market store initializes at ATM, then protects manual strikes across feed updates and remounts', () => {
  const get = loadMarketStore();
  const initial = get();
  assert.equal(initial.spot, initial.strike);
  initial.applyLiveSpot('XAU', 4000);
  assert.equal(get().spot, 4000);
  assert.equal(get().strike, 4000);

  get().setField('strike', 4125);
  get().applyLiveSpot('XAU', 4010); // a fresh hook mount invokes the same persisted store action
  assert.equal(get().spot, 4010);
  assert.equal(get().strike, 4125);
});

test('product change resets to that product ATM and ignores old-product quotes', () => {
  const get = loadMarketStore();
  get().setField('strike', 4200);
  get().setProduct('XAG', 30, 1, 20);
  assert.equal(get().strike, 30);
  assert.equal(get().strikeInitialized, false);
  get().applyLiveSpot('XAU', 4100);
  assert.equal(get().spot, 30);
  get().applyLiveSpot('XAG', 31);
  assert.equal(get().spot, 31);
  assert.equal(get().strike, 31);
});

test('manual spot is protected and invalid or mismatched quotes are ignored', () => {
  const get = loadMarketStore();
  get().setField('spot', 3800);
  get().setField('manualSpot', true);
  get().applyLiveSpot('XAU', 3900);
  assert.equal(get().spot, 3800);
  get().setField('manualSpot', false);
  for (const price of [0, -1, NaN, Infinity]) get().applyLiveSpot('XAU', price);
  assert.equal(get().spot, 3800);
  get().applyLiveSpot('XAG', 40);
  assert.equal(get().spot, 3800);
});

function makeReverseHarness() {
  const state = [];
  let cursor = 0;
  const solverCalls = [];
  const jsx = (type, props) => ({ type, props: props || {} });
  const ui = name =>
    function Component() {
      return name;
    };
  const Button = ui('Button');
  const Input = ui('Input');
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [
        state[index],
        value => {
          state[index] = typeof value === 'function' ? value(state[index]) : value;
        },
      ];
    },
  };
  const component = load('src/features/pricing/reverse-engineering.tsx', {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/components/ui/card': {
      Card: ui('Card'),
      CardContent: ui('CardContent'),
      CardHeader: ui('CardHeader'),
      CardTitle: ui('CardTitle'),
    },
    '@/components/ui/input': { Input },
    '@/components/ui/label': { Label: ui('Label') },
    '@/components/ui/button': { Button },
    '@/components/ui/select': {
      Select: ui('Select'),
      SelectContent: ui('SelectContent'),
      SelectItem: ui('SelectItem'),
      SelectTrigger: ui('SelectTrigger'),
      SelectValue: ui('SelectValue'),
    },
    '@/lib/math': {
      impliedVol(...args) {
        solverCalls.push(args);
        return { ok: true, vol: 0.3 };
      },
    },
  }).ReverseEngineering;
  function render(props) {
    cursor = 0;
    return component(props);
  }
  function flatten(node, acc = []) {
    if (node == null || typeof node === 'boolean') return acc;
    if (Array.isArray(node)) {
      for (const child of node) flatten(child, acc);
      return acc;
    }
    if (typeof node === 'string' || typeof node === 'number') {
      acc.push(String(node));
      return acc;
    }
    if (node.props) {
      acc.push(node);
      flatten(node.props.children, acc);
    }
    return acc;
  }
  return { render, flatten, Button, Input, solverCalls };
}

test('reverse result hides as stale after parent inputs change, then reruns for current inputs', () => {
  const h = makeReverseHarness();
  const props = { spot: 4000, strike: 4100, tYears: 0.5, rate: 0.05, lease: 0.01, contractSize: 100 };
  let tree = h.render(props);
  let nodes = h.flatten(tree);
  nodes.find(node => node.type === h.Input).props.onChange({ target: { value: '120' } });
  tree = h.render(props);
  nodes = h.flatten(tree);
  nodes.find(node => node.type === h.Button).props.onClick();
  tree = h.render(props);
  assert.ok(h.flatten(tree).includes('30.00'));
  assert.equal(h.solverCalls.length, 1);

  tree = h.render({ ...props, spot: 4050 });
  nodes = h.flatten(tree);
  assert.ok(nodes.some(node => node.props?.role === 'status'));
  assert.ok(!nodes.includes('30.00'));
  nodes.find(node => node.type === h.Button).props.onClick();
  tree = h.render({ ...props, spot: 4050 });
  assert.equal(h.solverCalls.length, 2);
  assert.ok(h.flatten(tree).includes('30.00'));
});

test('reverse solver does not run for non-finite or invalid inputs', () => {
  const h = makeReverseHarness();
  const props = { spot: Infinity, strike: 4100, tYears: 0.5, rate: 0.05, lease: 0.01, contractSize: 100 };
  const button = h.flatten(h.render(props)).find(node => node.type === h.Button);
  button.props.onClick();
  assert.equal(h.solverCalls.length, 0);
  assert.ok(
    h
      .flatten(h.render(props))
      .some(
        node =>
          node.props?.children ===
          'Pozitif spot, strike ve vade; sıfır veya pozitif prim girin. Tüm değerler sonlu olmalı.',
      ),
  );
});
