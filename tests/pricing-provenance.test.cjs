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

const jsxRuntime = {
  jsx: (type, props) => ({ type, props }),
  jsxs: (type, props) => ({ type, props }),
};

function collectText(node, output = []) {
  if (node == null || typeof node === 'boolean') return output;
  if (typeof node === 'string' || typeof node === 'number') {
    output.push(String(node));
    return output;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, output);
    return output;
  }
  if (node.props) collectText(node.props.children, output);
  return output;
}

test('manual IV smile chart is reference-only and identifies the effective manual IV', () => {
  const { SmileChart } = load('src/features/pricing/smile-chart.tsx', {
    react: { useMemo: callback => callback() },
    'react/jsx-runtime': jsxRuntime,
    '@/components/ui/card': {
      Card: 'Card',
      CardContent: 'CardContent',
      CardHeader: 'CardHeader',
      CardTitle: 'CardTitle',
    },
    '@/lib/format': load('src/lib/format.ts'),
    '@/lib/vol/surface': {
      rebasedExpiryDays: (_surface, expiry) => expiry.days,
      surfaceVolEstimate: () => ({ vol: 0.25, mode: 'model' }),
    },
  });

  const chart = SmileChart({
    surface: {
      symbol: 'TEST',
      expiries: [
        {
          days: 90,
          date: '2026-12-31',
          points: [
            { m: 0.9, iv: 0.24 },
            { m: 1.1, iv: 0.26 },
          ],
        },
      ],
    },
    fwd: 100,
    strike: 100,
    daysToExpiry: 90,
    manualVol: true,
    effectiveVol: 40,
  });
  const text = collectText(chart).join(' ');
  const svg = (() => {
    const pending = [chart];
    while (pending.length) {
      const node = pending.pop();
      if (!node || typeof node !== 'object') continue;
      if (node.type === 'svg') return node;
      if (node.props) pending.push(node.props.children);
      if (Array.isArray(node)) pending.push(...node);
    }
    return null;
  })();

  assert.ok(text.includes('Referans yüzey (fiyatlamada kullanılmıyor)'), text);
  assert.ok(text.includes('%40'), text);
  assert.ok(text.includes('yalnız referans yüzeyi gösterir'), text);
  assert.ok(!text.includes('fiyatlama eğrisidir'), text);
  assert.match(svg.props['aria-label'], /Referans smile grafiği/);
});

function makeBarrierHook() {
  const state = [];
  let cursor = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [
        state[index],
        next => {
          state[index] = typeof next === 'function' ? next(state[index]) : next;
        },
      ];
    },
    useMemo: callback => callback(),
  };
  const imports = {
    react,
    'react/jsx-runtime': jsxRuntime,
    '@/components/ui/input': { Input: 'Input' },
    '@/components/ui/label': { Label: 'Label' },
    '@/components/ui/button': { Button: 'Button' },
    '@/components/ui/select': {
      Select: 'Select',
      SelectContent: 'SelectContent',
      SelectItem: 'SelectItem',
      SelectTrigger: 'SelectTrigger',
      SelectValue: 'SelectValue',
    },
    '@/lib/math': {
      barrierPrice: () => 1,
      barrierGreeks: () => ({ delta: 0, gamma: 0, theta: 0, vega: 0 }),
      spotFiniteDiff: () => ({ delta: 0, gamma: 0 }),
    },
    '@/lib/math/vanna-volga': {
      vannaVolgaBarrier(_spot, _strike, _barrier, _rebate, _time, _rate, _lease, _code, smile) {
        smile(100);
        smile(120);
        return { price: 1, bsPrice: 0.9, correction: 0.1, survival: 0.8, atmVol: 0.25 };
      },
    },
  };
  const engine = load('src/lib/pricing/barrier.ts', {
    '../math': imports['@/lib/math'],
    '../math/vanna-volga': imports['@/lib/math/vanna-volga'],
  });
  const component = load('src/features/pricing/barrier-options.tsx', {
    ...imports,
    '@/lib/pricing/barrier': engine,
  });

  return {
    ...component,
    render(props) {
      cursor = 0;
      return component.useBarrierPricing(props);
    },
  };
}

test('barrier VV tracks modeled and extrapolated helper vols and warns about the SSVI wing', () => {
  const barrierModule = makeBarrierHook();
  const queriedLevels = [];
  const props = {
    spot: 100,
    strike: 100,
    tYears: 1,
    rate: 0,
    lease: 0,
    vol: 25,
    volAtLevel(level) {
      queriedLevels.push(level);
      return level === 120 ? 40 : 25;
    },
    volModeAtLevel(level) {
      return level === 120 ? 'extrapolated' : 'model';
    },
  };

  let state = barrierModule.render(props);
  state.calculate();
  state = barrierModule.render(props);

  assert.ok(queriedLevels.includes(100));
  assert.ok(queriedLevels.includes(120));
  assert.ok(state.calcResult.smileModes.includes('model'));
  assert.ok(state.calcResult.smileModes.includes('extrapolated'));

  const result = barrierModule.BarrierResult({ state });
  const text = collectText(result).join(' ');
  assert.match(text, /Seçili strike kote aralıkta olsa bile/);
  assert.match(text, /piyasa kotasyonu değildir/);
});
