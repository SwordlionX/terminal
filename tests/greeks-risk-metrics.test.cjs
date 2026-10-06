/* eslint-disable @typescript-eslint/no-require-imports -- Node component regression tests. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const source = fs.readFileSync(path.join(__dirname, '../src/features/pricing/greeks-risk-metrics.tsx'), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function fixture() {
  let state;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod,
    exports: mod.exports,
    require(id) {
      if (id === 'react')
        return {
          ...React,
          useState(initial) {
            state ??= initial;
            return [
              state,
              next => {
                state = typeof next === 'function' ? next(state) : next;
              },
            ];
          },
        };
      return require(id);
    },
  });
  return props => mod.exports.GreeksRiskMetrics(props);
}
const quote = { inputs: { contractSize: 100 }, delta: 45.422, gamma: -3.71723, vega: -12.03, theta: 2.22 };
const values = tree => {
  const html = renderToStaticMarkup(tree);
  return [...html.matchAll(/<strong>(.*?)<\/strong>/g)].map(match => match[1]);
};

test('unit view is the default, scales all Greeks and preserves customer signs', () => {
  const render = fixture();
  const tree = render({ quote, unit: 'ons' });
  assert.deepEqual(values(tree), ['0,4542', '-0,037172', '-0,1203', '0,0222']);
  const html = renderToStaticMarkup(tree);
  assert.match(html, /role="switch"[^>]*aria-checked="false"/);
  assert.ok(html.includes('Müşteri · 1 ons'));
  assert.ok(html.includes('1 / (USD/ons)'));
  assert.ok(html.includes('USD/ons'));
});

test('switch toggles both directions without changing the quote', () => {
  const render = fixture(),
    before = JSON.stringify(quote);
  let tree = render({ quote, unit: 'ons' });
  const button = node => node.props.children[0].props.children[0].props.children[1];
  button(tree).props.onClick();
  tree = render({ quote, unit: 'ons' });
  assert.deepEqual(values(tree), ['45,422', '-3,71723', '-12,03', '2,22']);
  assert.match(renderToStaticMarkup(tree), /aria-checked="true"/);
  assert.ok(renderToStaticMarkup(tree).includes('ons / (USD/ons)'));
  button(tree).props.onClick();
  assert.deepEqual(values(render({ quote, unit: 'ons' })), ['0,4542', '-0,037172', '-0,1203', '0,0222']);
  assert.equal(JSON.stringify(quote), before);
});

test('fractional quantities, zero Greeks and both position directions remain valid', () => {
  const render = fixture();
  const sample = { inputs: { contractSize: 2.5 }, delta: -1.25, gamma: 0, vega: 2.5, theta: -0.25 };
  assert.deepEqual(values(render({ quote: sample, unit: 'adet' })), ['-0,5000', '0,000000', '1,0000', '-0,1000']);
  assert.ok(renderToStaticMarkup(render({ quote: sample, unit: 'adet' })).includes('USD/adet'));
});

test('missing quotes or invalid quantities never produce NaN or Infinity', () => {
  for (const sample of [
    null,
    ...[0, -1, NaN, Infinity].map(contractSize => ({ ...quote, inputs: { contractSize } })),
  ]) {
    const tree = fixture()({ quote: sample, unit: 'ons' });
    assert.deepEqual(values(tree), ['—', '—', '—', '—']);
    assert.doesNotMatch(renderToStaticMarkup(tree), /NaN|Infinity/);
  }
});

test('workspace switch changes Greek presentation only, not pricing or payoff inputs', () => {
  const workspace = fs.readFileSync(path.join(__dirname, '../src/features/pricing/terminal-workspace.tsx'), 'utf8');
  assert.ok(workspace.includes('<GreeksRiskMetrics quote={q} unit={unit} />'));
  assert.ok(workspace.includes('expiryPayoffLimits([q], [q.premiumPerUnit])'));
  assert.doesNotMatch(source, /quoteOption|calculatePricing|fetch\(|localStorage/);
});
