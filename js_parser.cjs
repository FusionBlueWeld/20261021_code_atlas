// Syntax-only parsing: repository modules are never loaded or executed.
const ts = require('typescript');
function parse(path, content) {
    const sf = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
    const symbols = [], imports = [], calls = [], shadows = {};
    const fileId = 'file:' + path;
    const str = n => n ? n.getText(sf) : '';
    const line = n => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    function visit(node, parent = fileId, classId = null) {
        let kind, name;
        if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
            kind = 'class';
            name = str(node.name) || 'default';
        }
        else if (ts.isInterfaceDeclaration(node)) {
            kind = 'interface';
            name = str(node.name);
        }
        else if (ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) {
            kind = 'type';
            name = str(node.name);
        }
        else if (ts.isFunctionDeclaration(node)) {
            kind = 'function';
            name = str(node.name) || 'default';
        }
        else if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)) {
            kind = 'method';
            name = str(node.name);
        }
        else if (ts.isConstructorDeclaration(node)) {
            kind = 'method';
            name = 'constructor';
        }
        else if ((ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
            kind = ts.isPropertyDeclaration(node) ? 'method' : 'function';
            name = str(node.name);
        }
        if (kind) {
            const fn = node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) ? node.initializer : node;
            const id = `${path}:${line(node)}:${node.getStart(sf)}:${name}`;
            const params = (fn.parameters || []).map(p => ({ name: str(p.name), type: str(p.type), default: str(p.initializer), mode: p.dotDotDotToken ? 'variadic' : p.questionToken ? 'optional' : 'positional' }));
            shadows[id] = params.flatMap(p => p.name.match(/[A-Za-z_$][\w$]*/g) || []);
            const returnType = str(fn.type);
            const bases = (node.heritageClauses || []).flatMap(h => h.types.map(t => str(t.expression)));
            const docNode = ts.isVariableDeclaration(node) ? node.parent.parent : node;
            const docs = docNode.jsDoc || [];
            const doc = docs.map(d => typeof d.comment === 'string' ? d.comment : (d.comment || []).map(c => c.text || '').join('')).join('\n');
            const docRange = docs.length ? { docLine: line(docs[0]), docEndLine: sf.getLineAndCharacterOfPosition(docs[docs.length - 1].end).line + 1 } : {};
            symbols.push({
                id, name, kind, parent, path, line: line(node), endLine: sf.getLineAndCharacterOfPosition(node.end).line + 1,
                params, returnType, bases, doc, classId, exportDefault: Boolean(node.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)),
                ...docRange,
                signature: name + (['class', 'interface', 'type'].includes(kind) ? (bases.length ? ' : ' + bases.join(', ') : '') : '(' + params.map(p => p.name + (p.type ? ': ' + p.type : '') + (p.default ? ' = ' + p.default : '')).join(', ') + ')' + (returnType ? ' → ' + returnType : ''))
            });
            ts.forEachChild(fn, child => visit(child, id, kind === 'class' ? id : classId));
            return;
        }
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
            (shadows[parent] ||= []).push(node.name.text);
        }
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            const module = node.moduleSpecifier.text, clause = node.importClause;
            const add = (name, alias) => imports.push({
                module, name, alias, line: line(node), scope: parent
            });
            if (clause?.name)
                add('default', str(clause.name));
            if (clause?.namedBindings) {
                if (ts.isNamespaceImport(clause.namedBindings))
                    add('*', str(clause.namedBindings.name));
                else
                    clause.namedBindings.elements.forEach(e => add(str(e.propertyName || e.name), str(e.name)));
            }
            if (!clause)
                add('*', module);
        }
        if (ts.isCallExpression(node) || ts.isNewExpression(node))
            calls.push({ source: parent, name: str(node.expression), line: line(node), classId });
        ts.forEachChild(node, child => visit(child, parent, classId));
    }
    visit(sf);
    const warnings = sf.parseDiagnostics.map(d => `${path}: L${sf.getLineAndCharacterOfPosition(d.start || 0).line + 1} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
    return {
        symbols, imports, calls, doc: '', warnings, shadows
    };
}
module.exports = { parse };
if (require.main === module) {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => input += chunk);
    process.stdin.on('end', () => {
        const files = {}, warnings = [];
        for (const item of JSON.parse(input)) {
            files[item.path] = parse(item.path, item.content);
            warnings.push(...files[item.path].warnings);
        }
        process.stdout.write(JSON.stringify({ files, warnings }));
    });
}
