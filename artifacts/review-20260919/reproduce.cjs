// Diagnostic probes, not passing regression tests. See REVIEW_2026-09-19.md.
const {createModel} = require('../../web/graph-model.js');
const fs = require('node:fs');
const vm = require('node:vm');
const nodes = [
  {id:'root',kind:'repository'},
  {id:'a',kind:'file',parent:'root',path:'a.py'},
  {id:'f',name:'f',kind:'function',parent:'a',path:'a.py'},
  {id:'t',kind:'file',parent:'root',path:'test_a.py',isTest:true},
  {id:'test',kind:'function',parent:'t',path:'test_a.py',isTest:true},
  {id:'empty',kind:'file',parent:'root',path:'constants.py'},
];
for (const [label, edge] of [
  ['B01_hidden_test', {source:'test',target:'f',kind:'calls'}],
  ['B02_self_recursion', {source:'f',target:'f',kind:'calls'}],
]) {
  const graph = createModel({nodes,edges:[edge]}).explore(new Set(['root','a']));
  console.log(JSON.stringify({case:label, visible:graph.nodes.map(n=>n.id), calls:graph.edges.filter(e=>e.kind==='calls')}));
}
// Evaluate the actual treeVisible function, without a browser or a copy of its logic.
const model = createModel({nodes,edges:[]});
const source = fs.readFileSync(require.resolve('../../web/ui/state.js'),'utf8');
const treeFunction = source.slice(source.indexOf('function treeVisible('), source.indexOf('function pathFor('));
if (!treeFunction) throw new Error('treeVisible moved; update the review probe');
const sandbox = {state:{model},CodeGraph:require('../../web/graph-model.js'),children:id=>model.children(id)};
vm.createContext(sandbox);
vm.runInContext(treeFunction, sandbox);
console.log(JSON.stringify({case:'B05_file_without_symbols', treeVisible:sandbox.treeVisible(model.nodes.get('empty')), canvasVisible:model.explore().nodes.some(n=>n.id==='empty')}));
