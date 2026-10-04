/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS tests. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToString } = require('react-dom/server');
const test = require('node:test');

test('responsive layout server markup remains identical when a mobile browser is present', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/hooks/use-mobile.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const render = browser => {
    const fixtureModule = { exports: {} };
    vm.runInNewContext(code, {
      module: fixtureModule,
      exports: fixtureModule.exports,
      require,
      ...(browser ? { window: browser } : {}),
    });
    const View = () => React.createElement('div', null, fixtureModule.exports.useIsMobile() ? 'mobile' : 'desktop');
    return renderToString(React.createElement(View));
  };
  const server = render();
  const mobile = render({ innerWidth: 390, matchMedia: () => ({ matches: true }) });
  assert.equal(mobile, server);
});
