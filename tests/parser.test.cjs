const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('../js_parser.cjs');

test('TypeScript class, constructor, generic parameter, and typed method', () => {
  const result = parse('service.ts', `
    class Box<T> {
      constructor(public value: T) {}
      map<U>(fn: (value: T) => U): U { return fn(this.value); }
    }
  `);
  const names = result.symbols.map(symbol => symbol.name);
  assert.deepEqual(names, ['Box', 'constructor', 'map']);
  const constructor = result.symbols.find(symbol => symbol.name === 'constructor');
  assert.deepEqual(constructor.params.map(param => [param.name, param.type]), [['value', 'T']]);
  const method = result.symbols.find(symbol => symbol.name === 'map');
  assert.equal(method.params[0].name, 'fn');
  assert.equal(method.params[0].type, '(value: T) => U');
  assert.equal(method.returnType, 'U');
  assert.equal(method.classId, result.symbols[0].id);
});

test('interface and type alias become type symbols', () => {
  const result = parse('types.ts', `
    interface User { id: string; }
    type Result<T> = { value: T };
  `);
  assert.deepEqual(result.symbols.map(symbol => [symbol.kind, symbol.name]), [
    ['interface', 'User'], ['type', 'Result'],
  ]);
});

test('arrow function captures default and optional parameters', () => {
  const result = parse('arrows.ts', 'export const format = (value: string, width = 10, suffix?: string) => value;');
  const format = result.symbols.find(symbol => symbol.name === 'format');
  assert.equal(format.kind, 'function');
  assert.deepEqual(format.params.map(param => [param.name, param.type, param.default, param.mode]), [
    ['value', 'string', '', 'positional'],
    ['width', '', '10', 'positional'],
    ['suffix', 'string', '', 'optional'],
  ]);
});

test('function and arrow jsDoc symbols preserve documentation source range', () => {
  const result = parse('docs.ts', `
/**
 * Run the operation.
 * It returns the result.
 */
export function run(value: number) { return value; }

/** Format a value. */
export const format = (value: string) => value;
`);
  const run = result.symbols.find(symbol => symbol.name === 'run');
  const format = result.symbols.find(symbol => symbol.name === 'format');
  assert.equal(run.doc, 'Run the operation.\nIt returns the result.');
  assert.deepEqual([run.docLine, run.docEndLine], [2, 5]);
  assert.equal(format.doc, 'Format a value.');
  assert.deepEqual([format.docLine, format.docEndLine], [8, 8]);
});

test('TSX JSX syntax parses without a warning', () => {
  const result = parse('view.tsx', 'export const View = (name: string) => <span>{name}</span>;');
  assert.equal(result.warnings.length, 0);
  assert.equal(result.symbols[0].name, 'View');
  assert.equal(result.symbols[0].params[0].type, 'string');
});

test('default and aliased imports preserve imported names and local aliases', () => {
  const result = parse('consumer.ts', `
    import Main, { create as make, type User as Account } from './lib';
    import * as tools from './tools';
  `);
  assert.deepEqual(result.imports.map(item => [item.module, item.name, item.alias]), [
    ['./lib', 'default', 'Main'],
    ['./lib', 'create', 'make'],
    ['./lib', 'User', 'Account'],
    ['./tools', '*', 'tools'],
  ]);
});

test('syntax diagnostics are returned as warnings while symbols remain available', () => {
  const result = parse('broken.ts', 'const answer: number = ;\nfunction stillVisible() {}');
  assert.ok(result.warnings.length > 0);
  assert.ok(result.warnings.some(warning => warning.includes('broken.ts')));
  assert.ok(result.symbols.some(symbol => symbol.name === 'stillVisible'));
});
