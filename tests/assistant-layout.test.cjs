/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test runner. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const postcss = require('postcss');

const source = fs.readFileSync(path.join(__dirname, '../src/features/assistant/terminal-assistant.tsx'), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
const fixtureModule = { exports: {} };
vm.runInNewContext(code, {
  module: fixtureModule,
  exports: fixtureModule.exports,
  require(id) {
    if (id === 'next/dynamic') return { default: () => () => null };
    if (id === 'next/navigation') return { usePathname: () => '/' };
    if (id === '@/store/workspace') return { useWorkspace: selector => selector({ selection: null, prompt: null }) };
    if (id === '@/store/analysis-draft') return { useAnalysisDraft: {} };
    if (id === '@/store/marketData') return { useMarketData: {} };
    if (id === '@/lib/workspace') return { areaLabels: { pricing: 'Fiyatlama' }, workspaceArea: () => 'pricing' };
    if (id === './assistant-text') return { AssistantText: () => null };
    return require(id);
  },
});
const markup = renderToStaticMarkup(
  React.createElement(fixtureModule.exports.TerminalAssistant, {
    open: true,
    onOpenChange: () => {},
  }),
);

test('assistant removes the three marked explanations but preserves important controls', () => {
  for (const text of [
    'Terminal eğrisi · Manuel piyasa girdisi kullanılmaz.',
    'Enter ile gönder · Shift + Enter ile yeni satır',
    'Endikatif sonuçlar · Hesap anındaki veri ve varsayımlar',
  ])
    assert.ok(!markup.includes(text));
  for (const label of ['Terminal Asistanı', 'Yeni sohbet', 'Asistanı kapat', 'Asistana mesaj', 'Mesajı gönder'])
    assert.ok(markup.includes(label), label);
  assert.match(markup, /assistant-conversation min-h-0 flex-1 overflow-y-auto/);
});

test('compact composer keeps send beside the two-line input and preserves keyboard handling', () => {
  const form = markup.match(/<form[\s\S]*?<\/form>/)?.[0];
  assert.ok(form);
  assert.match(form, /assistant-composer flex items-end/);
  assert.match(form, /<textarea[^>]*rows="2"/);
  assert.match(form, /h-12 min-h-0 min-w-0 flex-1/);
  assert.match(form, /aria-label="Mesajı gönder"/);
  assert.match(source, /e\.key === 'Enter' && !e\.shiftKey && !e\.nativeEvent\.isComposing/);
  assert.match(source, /aria-label="İsteği durdur"/);
});

test('chat gets more desktop room while the mobile full-screen layout remains intact', () => {
  const css = postcss.parse(fs.readFileSync(path.join(__dirname, '../src/app/workspace.css'), 'utf8'));
  const rule = selector => css.nodes.find(node => node.type === 'rule' && node.selector === selector);
  const value = (node, property) => node.nodes.find(item => item.type === 'decl' && item.prop === property)?.value;
  assert.equal(value(rule('.assistant-context'), 'display'), 'flex');
  assert.equal(value(rule('.assistant-context'), 'flex-shrink'), '0');
  assert.equal(value(rule('.assistant-dock footer'), 'padding'), '10px 16px');
  const floating = rule('.sidebar-shell .assistant-dock');
  assert.equal(value(floating, 'top'), '16px');
  assert.equal(value(floating, 'bottom'), '82px');
  assert.equal(value(floating, 'height'), 'auto');
  const desktop = css.nodes.find(
    node => node.type === 'atrule' && node.name === 'media' && node.params === '(min-width: 1100px)',
  );
  assert.equal(
    value(
      desktop.nodes.find(node => node.selector === '.sidebar-shell'),
      '--assistant-width',
    ),
    '460px',
  );
  assert.equal(
    value(
      desktop.nodes.find(node => node.selector === '.sidebar-shell .assistant-dock'),
      'top',
    ),
    '16px',
  );
  const mobile = css.nodes
    .filter(node => node.type === 'atrule' && node.params === '(max-width: 900px)')
    .flatMap(node => node.nodes)
    .find(node => node.selector === '.sidebar-shell .assistant-dock');
  assert.equal(value(mobile, 'height'), '100dvh');
});
