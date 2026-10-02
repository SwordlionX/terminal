/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test runner. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const test = require("node:test");

const sourcePath = path.join(__dirname, "../src/lib/number-input-parser.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const parserModule = { exports: {} };
vm.runInNewContext(javascript, { exports: parserModule.exports, module: parserModule });
const { parseNumberInput } = parserModule.exports;

const componentSource = fs.readFileSync(
  path.join(__dirname, "../src/components/ui/number-input.tsx"),
  "utf8",
);
const componentJavascript = ts.transpileModule(componentSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;

function makeNumberInputHarness() {
  const state = [];
  let cursor = 0;
  let rendering = false;
  let needsRender = false;
  let renderCount = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], (next) => {
        const resolved = typeof next === "function" ? next(state[index]) : next;
        if (!Object.is(state[index], resolved)) {
          state[index] = resolved;
          if (rendering) needsRender = true;
        }
      }];
    },
  };
  const jsxRuntime = {
    jsx: (type, props) => ({ type, props }),
    jsxs: (type, props) => ({ type, props }),
  };
  const componentModule = { exports: {} };
  const imports = {
    react,
    "react/jsx-runtime": jsxRuntime,
    "@/components/ui/input": { Input: function Input() {} },
    "@/lib/number-input-parser": { parseNumberInput },
  };
  vm.runInNewContext(componentJavascript, {
    exports: componentModule.exports,
    module: componentModule,
    require: (name) => imports[name],
  });

  function render(props) {
    let element;
    do {
      needsRender = false;
      cursor = 0;
      rendering = true;
      renderCount++;
      if (renderCount > 20) throw new Error("NumberInput render loop");
      element = componentModule.exports.NumberInput(props);
      rendering = false;
    } while (needsRender);
    return element.props;
  }
  return { render, get renderCount() { return renderCount; } };
}

test("parses comma decimals, grouped Turkish numbers, and dot decimals", () => {
  assert.equal(parseNumberInput("72,5"), 72.5);
  assert.equal(parseNumberInput(",5"), 0.5);
  assert.equal(parseNumberInput("-,5"), -0.5);
  assert.equal(parseNumberInput("1.250,50"), 1250.5);
  assert.equal(parseNumberInput("72.5"), 72.5);
  assert.equal(parseNumberInput("1.250"), 1.25);
});

test("accepts signed and scientific notation", () => {
  assert.equal(parseNumberInput("-72,5"), -72.5);
  assert.equal(parseNumberInput("1.2e+21"), 1.2e21);
  assert.equal(parseNumberInput("1,2e-3"), 0.0012);
});

test("rejects empty, partial, non-finite, and malformed values", () => {
  for (const input of ["", "-", ".", "72abc", "Infinity", "NaN", "1,", ".,5", "1.25,50", "12.50,00", "1,,2", "1e9999"]) {
    assert.equal(parseNumberInput(input), null, input);
  }
});

test("NumberInput emits parsed comma decimals and rejects junk until blur", () => {
  const harness = makeNumberInputHarness();
  const values = [];
  const base = { value: 72.5, onValueChange: (value) => values.push(value) };
  let input = harness.render(base);
  input.onChange({ target: { value: "72,5" } });
  assert.deepEqual(values, [72.5]);
  input = harness.render(base);
  input.onChange({ target: { value: "72abc" } });
  assert.deepEqual(values, [72.5]);
  input = harness.render(base);
  assert.equal(input["aria-invalid"], true);
  input.onBlur({});
  input = harness.render(base);
  assert.equal(input.value, "72.5");
  assert.notEqual(input["aria-invalid"], true);
});

test("empty input emits zero and remains blank after blur", () => {
  const harness = makeNumberInputHarness();
  const values = [];
  const props = { value: 0, onValueChange: (value) => values.push(value) };
  let input = harness.render(props);
  input.onChange({ target: { value: "" } });
  assert.deepEqual(values, [0]);
  input = harness.render(props);
  input.onBlur({});
  input = harness.render(props);
  assert.equal(input.value, "");
});

test("external values synchronize and caller onBlur is preserved", () => {
  const harness = makeNumberInputHarness();
  let blurCalls = 0;
  const onBlur = () => blurCalls++;
  const input = harness.render({ value: 1, onValueChange() {}, onBlur });
  input.onBlur({});
  const updated = harness.render({ value: 9, onValueChange() {}, onBlur });
  assert.equal(updated.value, "9");
  assert.equal(blurCalls, 1);
});

test("NaN props do not trigger repeated render-phase state updates", () => {
  const harness = makeNumberInputHarness();
  harness.render({ value: Number.NaN, onValueChange() {} });
  assert.equal(harness.renderCount, 1);
  harness.render({ value: Number.NaN, onValueChange() {} });
  assert.equal(harness.renderCount, 2);
});
