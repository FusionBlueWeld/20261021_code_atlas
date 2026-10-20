const test = require('node:test');
const assert = require('node:assert/strict');
const { createModel, layout } = require('../web/graph-model.js');

const fixture = {
  nodes: [
    { id: 'root', kind: 'repository', name: 'demo', parent: null },
    { id: 'dir:src', kind: 'folder', name: 'src', parent: 'root' },
    { id: 'file:src/a.py', kind: 'file', name: 'a.py', parent: 'dir:src' },
    { id: 'class:A', kind: 'class', name: 'A', parent: 'file:src/a.py' },
    { id: 'method:A.run', kind: 'method', name: 'run', parent: 'class:A', params: [{ name: 'value', type: 'int', default: '' }] },
    { id: 'file:src/b.py', kind: 'file', name: 'b.py', parent: 'dir:src' },
    { id: 'class:B', kind: 'class', name: 'B', parent: 'file:src/b.py' },
    { id: 'method:B.save', kind: 'method', name: 'save', parent: 'class:B' },
    { id: 'function:helper', kind: 'function', name: 'helper', parent: 'file:src/b.py' },
  ],
  edges: [
    { source: 'method:A.run', target: 'method:B.save', kind: 'calls' },
    { source: 'class:A', target: 'class:B', kind: 'inherits' },
  ],
};

test('root structure contains only code nodes, never repository, folder, or file nodes', () => {
  const graph = createModel(fixture).structure();
  assert.ok(graph.nodes.length > 0);
  assert.equal(graph.nodes.some(node => ['repository', 'folder', 'file'].includes(node.kind)), false);
});

test('selecting a file returns code definitions and omits the selected file node', () => {
  const graph = createModel(fixture).structure('file:src/a.py');
  assert.deepEqual(graph.nodes.map(node => node.id), ['class:A']);
  assert.equal(graph.nodes.some(node => node.kind === 'file'), false);
});

test('class structure contains its methods and method parameters', () => {
  const graph = createModel(fixture).structure('class:A');
  assert.deepEqual(graph.nodes.map(node => node.id), ['class:A', 'method:A.run']);
  assert.ok(graph.edges.some(edge => edge.source === 'class:A' && edge.target === 'method:A.run' && edge.kind === 'contains'));
});

test('function parameters are represented as contains children', () => {
  const model = createModel({ nodes: [{ id: 'root', kind: 'repository', parent: null }, { id: 'file:f.py', kind: 'file', parent: 'root' }, { id: 'fn', kind: 'function', name: 'f', parent: 'file:f.py', params: [{ name: 'x', type: 'str', default: '' }] }], edges: [] });
  const graph = model.structure('fn');
  assert.equal(graph.nodes.at(-1).kind, 'parameter');
  assert.deepEqual(graph.edges.map(edge => [edge.source, edge.target, edge.kind]), [['fn', 'fn:param:0', 'contains']]);
});

test('progressive explorer starts with the repository skeleton and reveals only requested branches', () => {
  const model = createModel(fixture);
  const skeleton = model.explore(new Set(['root']));
  assert.deepEqual(skeleton.nodes.map(node => node.id), ['root', 'dir:src']);
  const files = model.explore(new Set(['root', 'dir:src']));
  assert.deepEqual(files.nodes.map(node => node.id), ['root', 'dir:src', 'file:src/a.py', 'file:src/b.py']);
  assert.ok(files.edges.some(edge => edge.source === 'file:src/a.py' && edge.target === 'file:src/b.py' && edge.kind === 'calls'));
  const oneFile = model.explore(new Set(['root', 'dir:src', 'file:src/a.py']));
  assert.ok(oneFile.nodes.some(node => node.id === 'class:A'));
  assert.equal(oneFile.nodes.some(node => node.id === 'class:B'), false);
});

test('explorer drops calls whose raw endpoint is excluded by filters before ancestor aggregation', () => {
  const model = createModel({nodes: [
    {id:'root', kind:'repository', parent:null},
    {id:'src', kind:'folder', parent:'root'},
    {id:'file:a', kind:'file', parent:'src', path:'a.py'},
    {id:'a', kind:'function', name:'a', parent:'file:a', path:'a.py'},
    {id:'tests', kind:'folder', parent:'root'},
    {id:'file:t', kind:'file', parent:'tests', path:'test_a.py', isTest:true},
    {id:'t', kind:'function', name:'test_a', parent:'file:t', path:'test_a.py', isTest:true},
  ], edges:[{source:'t', target:'a', kind:'calls'}]});
  const graph = model.explore(new Set(['root','src','file:a','tests','file:t']));
  assert.equal(graph.edges.some(e => e.kind === 'calls'), false);
});

test('explorer keeps direct self-recursion but drops collapsed inter-symbol self edges', () => {
  const model = createModel({nodes: [
    {id:'root', kind:'repository', parent:null}, {id:'file:a', kind:'file', parent:'root', path:'a.py'},
    {id:'a', kind:'function', name:'a', parent:'file:a', path:'a.py'},
    {id:'b', kind:'function', name:'b', parent:'file:a', path:'a.py'},
  ], edges:[
    {source:'a', target:'a', kind:'calls'}, {source:'a', target:'b', kind:'calls'},
  ]});
  const graph = model.explore(new Set(['root']));
  const selfEdge = graph.edges.find(e => e.source === 'file:a' && e.target === 'file:a' && e.kind === 'calls');
  assert.ok(selfEdge && selfEdge.source === selfEdge.target);
  assert.equal(selfEdge.occurrences, 1);
});

test('file endpoints respect test filtering and do not become repository-root calls', () => {
  const model = createModel({nodes: [
    {id:'root', kind:'repository', parent:null},
    {id:'src', kind:'folder', parent:'root'}, {id:'file:a', kind:'file', parent:'src', path:'a.py'},
    {id:'a', kind:'function', name:'a', parent:'file:a', path:'a.py'},
    {id:'file:t', kind:'file', parent:'root', path:'test_a.py', isTest:true},
  ], edges:[{source:'file:t', target:'a', kind:'calls'}]});
  const graph = model.explore(new Set(['root','src']));
  assert.equal(graph.edges.some(e => e.kind === 'calls'), false);
  assert.equal(graph.edges.some(e => e.source === 'root' && e.kind === 'calls'), false);
});

test('empty files remain visible and selectable under project and module filters', () => {
  const model = createModel({defaultProject:'p1', projects:[{id:'p1'}], nodes:[
    {id:'root', kind:'repository', parent:null}, {id:'file:empty', kind:'file', parent:'root', path:'empty.py', projectId:'p1'},
  ], edges:[]}, {module:'empty.py'});
  assert.equal(model.isFileVisible(model.nodes.get('file:empty')), true);
  assert.deepEqual(model.explorableChildren('root').map(n => n.id), ['file:empty']);
});

test('root call graph aggregates calls from methods to their owning classes', () => {
  const graph = createModel(fixture).calls();
  assert.ok(graph.nodes.every(node => ['class', 'function', 'method', 'interface', 'type', 'parameter'].includes(node.kind)));
  assert.ok(graph.edges.some(edge => edge.source === 'class:A' && edge.target === 'class:B' && edge.kind === 'calls'));
});

test('both public graph views retain direct recursion in a structural scope', () => {
  const model = createModel({nodes:[
    {id:'root',kind:'repository',parent:null},
    {id:'file:a',kind:'file',parent:'root',path:'a.py'},
    {id:'a',kind:'function',name:'a',parent:'file:a',path:'a.py'},
  ],edges:[{source:'a',target:'a',kind:'calls'}]});
  for (const graph of [model.calls(), model.explore(new Set(['root','file:a']))]) {
    assert.ok(graph.edges.some(edge=>edge.source==='a'&&edge.target==='a'&&edge.kind==='calls'));
  }
});

test('scoped calls include only directly related code nodes and relations', () => {
  const graph = createModel(fixture).calls('class:A');
  assert.ok(graph.nodes.some(node => node.id === 'class:A'));
  assert.ok(graph.nodes.some(node => node.id === 'class:B'));
  assert.ok(graph.edges.every(edge => ['calls', 'inherits'].includes(edge.kind)));
});

test('layout condenses recursive cycles and gives every node a unique position', () => {
  const graph = { nodes: [{ id: 'a', kind: 'function', name: 'a' }, { id: 'b', kind: 'function', name: 'b' }, { id: 'c', kind: 'function', name: 'c' }], edges: [
    { source: 'a', target: 'b', kind: 'calls' }, { source: 'b', target: 'a', kind: 'calls' }, { source: 'b', target: 'c', kind: 'calls' },
  ] };
  const result = layout(graph);
  assert.equal(result.positions.length, graph.nodes.length);
  assert.equal(new Set(result.positions.map(position => `${position.x},${position.y}`)).size, graph.nodes.length);
  assert.ok(Number.isFinite(result.width) && Number.isFinite(result.height));
});

test('layout of an empty file graph is empty', () => {
  const result = layout({ nodes: [], edges: [] });
  assert.deepEqual(result.positions, []);
  assert.ok(result.width >= 300 && result.height >= 40);
});

test('parameter nodes retain signature order in either layout direction', () => {
  const graph = {nodes: [
    {id:'fn',name:'f',kind:'function'},
    {id:'self',name:'self',kind:'parameter'},
    {id:'z',name:'z',kind:'parameter'},
    {id:'a',name:'a',kind:'parameter'},
  ], edges:['self','z','a'].map(target=>({source:'fn',target,kind:'contains'}))};
  for(const direction of ['LR','TB']) {
    const positions=layout(graph,direction).positions.filter(p=>p.node.kind==='parameter');
    positions.sort((a,b)=>direction==='LR'?a.y-b.y:a.x-b.x);
    assert.deepEqual(positions.map(p=>p.node.id),['self','z','a']);
  }
});

test('left-to-right layout accepts a dynamic vertical row gap', () => {
  const graph = {nodes: [
    {id:'a',name:'a',kind:'function'},
    {id:'b',name:'b',kind:'function'},
    {id:'c',name:'c',kind:'function'},
  ], edges: []};
  const result=layout(graph,'LR',{rowGap:200});
  const ys=result.positions.map(position=>position.y).sort((a,b)=>a-b);
  assert.deepEqual(ys,[34,234,434]);
  assert.equal(result.rowGap,200);
  assert.equal(result.height,640);
});

test('wide row gaps up to 640px are preserved and cannot overlap 128px cards', () => {
  const { metrics } = require('../web/graph-model.js');
  const graph = {nodes:[{id:'a',name:'a',kind:'function'},{id:'b',name:'b',kind:'function'}],edges:[]};
  const wide = layout(graph,'LR',{rowGap:640});
  assert.equal(Math.abs(wide.positions[1].y-wide.positions[0].y),640);
  const compact = layout(graph,'LR',{rowGap:0});
  assert.ok(compact.rowGap > metrics.cardHeight);
  assert.equal(layout(graph,'LR',{rowGap:9999}).rowGap,640);
});

test('structural columns and branch order stay fixed when relations change', () => {
  const nodes = [
    {id:'root',name:'repo',kind:'repository'},
    {id:'a',name:'alpha',kind:'folder',parent:'root'},
    {id:'a-file',name:'a.py',kind:'file',parent:'a'},
    {id:'a-fn',name:'a',kind:'function',parent:'a-file'},
    {id:'b',name:'beta',kind:'folder',parent:'root'},
    {id:'b-file',name:'b.py',kind:'file',parent:'b'},
    {id:'b-fn',name:'b',kind:'function',parent:'b-file'},
  ];
  const contains = nodes.filter(node=>node.parent).map(node=>({source:node.parent,target:node.id,kind:'contains'}));
  const relations = [
    {source:'b-fn',target:'a-fn',kind:'calls'},
    {source:'a-fn',target:'b',kind:'calls'},
    {source:'a',target:'b-fn',kind:'inherits'},
  ];
  for (const direction of ['LR','TB']) {
    const original=layout({nodes,edges:contains},direction);
    const changed=layout({nodes,edges:[...contains,...relations]},direction);
    assert.deepEqual(changed.positions,original.positions);
    const positions=new Map(original.positions.map(position=>[position.node.id,position]));
    const depthAxis=direction==='LR'?'x':'y';
    assert.equal(positions.get('a-file')[depthAxis],positions.get('b-file')[depthAxis]);
    assert.equal(positions.get('a-fn')[depthAxis],positions.get('b-fn')[depthAxis]);
  }
});

test('each structural subtree occupies a consecutive band with its parent centered', () => {
  const nodes=[
    {id:'root',kind:'repository'},
    {id:'a',name:'a',kind:'folder',parent:'root'},
    {id:'a1',name:'1.py',kind:'file',parent:'a'},
    {id:'a2',name:'2.py',kind:'file',parent:'a'},
    {id:'a3',name:'3.py',kind:'file',parent:'a'},
    {id:'b',name:'b',kind:'folder',parent:'root'},
    {id:'b1',name:'1.py',kind:'file',parent:'b'},
    {id:'b2',name:'2.py',kind:'file',parent:'b'},
  ];
  const edges=nodes.filter(node=>node.parent).map(node=>({source:node.parent,target:node.id,kind:'contains'}));
  for (const direction of ['LR','TB']) {
    const positions=new Map(layout({nodes,edges},direction).positions.map(position=>[position.node.id,position]));
    const bandAxis=direction==='LR'?'y':'x';
    const at=id=>positions.get(id)[bandAxis];
    assert.ok(Math.max(...['a','a1','a2','a3'].map(at))<Math.min(...['b','b1','b2'].map(at)));
    assert.equal(at('a'),(at('a1')+at('a3'))/2);
    assert.equal(at('b'),(at('b1')+at('b2'))/2);
    assert.equal(at('root'),(at('a1')+at('b2'))/2);
  }
});

test('structural siblings use folders first, natural filenames, and source definition order', () => {
  const nodes=[
    {id:'root',kind:'repository'},
    {id:'file10',name:'file10.py',kind:'file',parent:'root'},
    {id:'folder',name:'z-directory',kind:'folder',parent:'root'},
    {id:'file2',name:'file2.py',kind:'file',parent:'root'},
    {id:'late',name:'aardvark',kind:'function',line:20,path:'file2.py',parent:'file2'},
    {id:'early',name:'zeta',kind:'function',line:2,path:'file2.py',parent:'file2'},
    {id:'middle',name:'middle',kind:'class',line:10,path:'file2.py',parent:'file2'},
  ];
  const edges=nodes.filter(node=>node.parent).map(node=>({source:node.parent,target:node.id,kind:'contains'}));
  for (const direction of ['LR','TB']) {
    const result=layout({nodes,edges},direction), axis=direction==='LR'?'y':'x';
    const ordered=ids=>result.positions.filter(position=>ids.includes(position.node.id))
      .sort((a,b)=>a[axis]-b[axis]).map(position=>position.node.id);
    assert.deepEqual(ordered(['folder','file2','file10']),['folder','file2','file10']);
    assert.deepEqual(ordered(['early','middle','late']),['early','middle','late']);
  }
});

test('column pitch is bounded, configurable, and stays horizontal in both directions', () => {
  const {metrics}=require('../web/graph-model.js');
  const nodes=[{id:'root',kind:'repository'},{id:'a',kind:'file',name:'a'},{id:'b',kind:'file',name:'b'}];
  const edges=['a','b'].map(target=>({source:'root',target,kind:'contains'}));
  for (const [requested,expected] of [[0,292],[700,700],[10000,900],[undefined,338]]) {
    for (const direction of ['LR','TB']) {
      const result=layout({nodes,edges},direction,{columnGap:requested,rowGap:240});
      const positions=new Map(result.positions.map(position=>[position.node.id,position]));
      assert.equal(result.columnGap,expected);
      assert.equal(result.rowGap,240);
      const pitch=direction==='LR'?positions.get('a').x-positions.get('root').x:positions.get('b').x-positions.get('a').x;
      assert.equal(pitch,expected);
      if (direction==='TB') assert.equal(positions.get('a').y-positions.get('root').y,240);
      assert.ok(expected>metrics.cardWidth);
    }
  }
  const relation=layout({nodes:nodes.slice(1),edges:[{source:'a',target:'b',kind:'calls'}]},'LR',{columnGap:720});
  assert.equal(Math.abs(relation.positions[0].x-relation.positions[1].x),720);
});

test('cyclic, duplicate, multiple-parent, and invalid containment keeps every card separate', () => {
  const nodes=['a','b','c','isolated'].map(id=>({id,name:id,kind:'folder'}));
  const edges=[
    {source:'a',target:'b',kind:'contains'}, {source:'b',target:'a',kind:'contains'},
    {source:'b',target:'c',kind:'contains'}, {source:'a',target:'c',kind:'contains'},
    {source:'a',target:'c',kind:'contains'}, {source:'c',target:'c',kind:'contains'},
    {source:'missing',target:'c',kind:'contains'}, {source:'c',target:'missing',kind:'contains'},
  ];
  for (const direction of ['LR','TB']) {
    const result=layout({nodes,edges},direction,{rowGap:152,columnGap:292});
    assert.equal(result.positions.length,nodes.length);
    assert.deepEqual(new Set(result.positions.map(position=>position.node.id)),new Set(nodes.map(node=>node.id)));
    for (const [index,a] of result.positions.entries()) {
      assert.ok(Number.isFinite(a.x)&&Number.isFinite(a.y));
      assert.ok(a.x+244<=result.width&&a.y+128<=result.height);
      for (const b of result.positions.slice(index+1))
        assert.ok(Math.abs(a.x-b.x)>=244||Math.abs(a.y-b.y)>=128,`${a.node.id} overlaps ${b.node.id}`);
    }
  }
});

test('project filters default from schema and exclude tests until enabled', () => {
  const data = {
    defaultProject: 'v003', projects: [{id: 'v003', name: 'V003'}, {id: 'v004', name: 'V004'}],
    nodes: [
      {id: 'root', kind: 'repository', parent: null},
      {id: 'a', kind: 'function', name: 'a', parent: 'root', path: 'src/a.py', projectId: 'v003'},
      {id: 'b', kind: 'function', name: 'b', parent: 'root', path: 'tests/test_a.py', projectId: 'v003', isTest: true},
      {id: 'c', kind: 'function', name: 'c', parent: 'root', path: 'src/c.py', projectId: 'v004'},
    ], edges: [],
  };
  const model = createModel(data);
  assert.equal(model.getFilters().projectId, 'v003');
  assert.deepEqual(model.structure().nodes.map(n => n.id), ['a']);
  model.setFilters({includeTests: true});
  assert.deepEqual(model.structure().nodes.map(n => n.id), ['a', 'b']);
  model.setFilters({projectId: 'v004'});
  assert.deepEqual(model.structure().nodes.map(n => n.id), ['c']);
});

test('module filter limits structure to a file while keeping code nodes only', () => {
  const model = createModel({nodes: [
    {id: 'root', kind: 'repository', parent: null},
    {id: 'a', kind: 'function', name: 'a', parent: 'root', path: 'one.py'},
    {id: 'b', kind: 'function', name: 'b', parent: 'root', path: 'two.py'},
  ], edges: []}, {module: 'one.py'});
  assert.deepEqual(model.structure().nodes.map(n => n.id), ['a']);
  assert.equal(model.structure().nodes.some(n => ['file', 'folder'].includes(n.kind)), false);
});

test('projected edges deduplicate evidence and preserve occurrences', () => {
  const evidence = {kind: 'inline', text: 'worker()', path: 'a.py', line: 8, endLine: 8, callLine: 8};
  const model = createModel({nodes: [
    {id: 'root', kind: 'repository', parent: null},
    {id: 'a', kind: 'function', name: 'a', parent: 'root', path: 'a.py'},
    {id: 'b', kind: 'function', name: 'b', parent: 'root', path: 'b.py'},
  ], edges: [
    {source: 'a', target: 'b', kind: 'calls', evidence: [evidence]},
    {source: 'a', target: 'b', kind: 'calls', evidence: [evidence, {...evidence, line: 12, callLine: 12}]},
  ]});
  const edge = model.calls().edges[0];
  assert.equal(edge.occurrences, 2);
  assert.equal(edge.count, 2);
  assert.equal(edge.evidence.length, 2);
  assert.equal(edge.evidence[1].line, 12);
});

test('scoped calls expose a cross-project resolved target as context', () => {
  const model = createModel({defaultProject: 'v003', projects: [{id: 'v003'}, {id: 'v004'}], nodes: [
    {id: 'root', kind: 'repository', parent: null},
    {id: 'a', kind: 'function', name: 'a', parent: 'root', path: 'a.py', projectId: 'v003'},
    {id: 'b', kind: 'function', name: 'b', parent: 'root', path: 'b.py', projectId: 'v004'},
  ], edges: [{source: 'a', target: 'b', kind: 'calls'}]});
  const graph = model.calls('a');
  assert.ok(graph.nodes.some(n => n.id === 'b' && n.context === true));
  assert.ok(graph.edges.some(e => e.source === 'a' && e.target === 'b'));
});

test('module scoped calls retain same-project incoming and outgoing neighbours', () => {
  const model = createModel({defaultProject: 'p1', projects: [{id: 'p1'}, {id: 'p2'}], nodes: [
    {id: 'root', kind: 'repository', parent: null},
    {id: 'a', kind: 'function', name: 'a', parent: 'root', path: 'A.py', projectId: 'p1'},
    {id: 'b', kind: 'function', name: 'b', parent: 'root', path: 'B.py', projectId: 'p1'},
    {id: 'h', kind: 'function', name: 'h', parent: 'root', path: 'B.py', projectId: 'p1'},
    {id: 'test_a', kind: 'function', name: 'test_a', parent: 'root', path: 'A_test.py', projectId: 'p1', isTest: true},
  ], edges: [
    {source: 'a', target: 'b', kind: 'calls'}, {source: 'h', target: 'a', kind: 'calls'}, {source: 'test_a', target: 'a', kind: 'calls'},
  ]}, {module: 'A.py'});
  const graph = model.calls('a');
  assert.ok(graph.nodes.some(n => n.id === 'b'));
  assert.ok(graph.nodes.some(n => n.id === 'h'));
  assert.equal(graph.nodes.some(n => n.id === 'test_a'), false);
  assert.ok(graph.edges.every(e => graph.nodes.some(n => n.id === e.source) && graph.nodes.some(n => n.id === e.target)));
});

test('module scoped calls retain cross-project incoming and outgoing context endpoints', () => {
  const model = createModel({defaultProject: 'p1', projects: [{id: 'p1'}, {id: 'p2'}], nodes: [
    {id: 'root', kind: 'repository', parent: null},
    {id: 'a', kind: 'function', name: 'a', parent: 'root', path: 'A.py', projectId: 'p1'},
    {id: 'out', kind: 'function', name: 'out', parent: 'root', path: 'B.py', projectId: 'p2'},
    {id: 'in', kind: 'function', name: 'in', parent: 'root', path: 'B.py', projectId: 'p2'},
  ], edges: [{source: 'a', target: 'out', kind: 'calls'}, {source: 'in', target: 'a', kind: 'calls'}]}, {module: 'A.py'});
  const graph = model.calls('a');
  assert.ok(graph.nodes.some(n => n.id === 'out' && n.context));
  assert.ok(graph.nodes.some(n => n.id === 'in' && n.context));
  assert.equal(graph.edges.length, 2);
  assert.ok(graph.edges.every(e => graph.nodes.some(n => n.id === e.source) && graph.nodes.some(n => n.id === e.target)));
});
