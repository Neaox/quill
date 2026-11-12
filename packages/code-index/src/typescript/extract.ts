import { readFileSync } from 'node:fs'
import { dirname, posix } from 'node:path'

import {
  API,
  SymbolFlags,
  type Checker,
  type NodeHandle,
  type Project,
  type Symbol as CompilerSymbol,
} from 'typescript/unstable/sync'
import { SyntaxKind, type Node, type SourceFile } from 'typescript/unstable/ast'
import {
  isArrowFunction,
  isBinaryExpression,
  isClassDeclaration,
  isExportDeclaration,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isImportDeclaration,
  isInterfaceDeclaration,
  isNamedExports,
  isStringLiteral,
  isTypeAliasDeclaration,
  isVariableStatement,
} from 'typescript/unstable/ast/is'

import { digest } from '../cache.ts'
import type {
  CodeSymbolV1,
  DocTag,
  SourceParameter,
  SymbolKind,
  SymbolUsage,
  SymbolVisibility,
} from '../artifact.ts'
import type { ScopePackage } from './scope.ts'
import type { ExtractedFile } from './types.ts'

export interface Session {
  readonly api: API
  readonly project: Project
  readonly checker: Checker
  readonly root: string
  readonly scope: readonly ScopePackage[]
  /** The compiler's path for each scanned file, back to the repository path. */
  readonly repoPathByCompilerPath: ReadonlyMap<string, string>
}

/** The compiler lower-cases paths on Windows, and normalises separators; find the file either way. */
function sourceFileOf(project: Project, root: string, file: string): SourceFile | undefined {
  const target = `${root}/${file}`.replaceAll('\\', '/').toLowerCase()
  const name = project.program
    .getSourceFileNames()
    .find((candidate) => candidate.replaceAll('\\', '/').toLowerCase() === target)
  return name === undefined ? undefined : project.program.getSourceFile(name)
}

export function loadScope(root: string, dirs: readonly string[]): ScopePackage[] {
  return dirs.map((dir) => {
    const manifest = parseManifest(readFileSync(`${root}/${dir}/package.json`, 'utf8'))
    const specifiers = new Map<string, string>()
    for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
      const file =
        typeof target === 'string' ? target : (target.node ?? target.types ?? target.default)
      if (!file) continue
      specifiers.set(posix.join(manifest.name, subpath), posix.join(dir, file))
    }
    return { dir, name: manifest.name, entryFiles: new Set(specifiers.values()), specifiers }
  })
}

export function openSession(
  root: string,
  scope: ScopePackage[],
  files: string[],
  projectPath = `${root}/tsconfig.json`,
): Session {
  const api = new API({ cwd: root })
  const snapshot = api.updateSnapshot({ openProjects: [projectPath] })
  const project = snapshot.getProject(projectPath) ?? snapshot.getProjects()[0]
  if (!project) throw new Error(`${projectPath} opened no project`)
  const repoPathByCompilerPath = new Map<string, string>()
  for (const file of files) {
    const source = sourceFileOf(project, root, file)
    if (source) repoPathByCompilerPath.set(source.path, file)
  }
  return { api, project, checker: project.checker, root, scope, repoPathByCompilerPath }
}

export function closeSession(session: Session): void {
  session.api.close()
}

export function packageOf(scope: readonly ScopePackage[], file: string): ScopePackage | undefined {
  return scope.find((p) => file.startsWith(`${p.dir}/src/`))
}

export function extractFile(session: Session, file: string, blob: string): ExtractedFile {
  const source = sourceFileOf(session.project, session.root, file)
  if (!source)
    return { blob, symbols: [], usages: [], imports: [], reexports: [], signature: digest('') }
  const pkg = packageOf(session.scope, file)
  const symbols = pkg ? extractSymbols(session, source, file, pkg) : []
  const signature = digest(
    symbols.map((s) => `${s.moniker}|${s.kind}|${s.visibility}|${s.signature}`).join('\n'),
  )
  return {
    blob,
    symbols,
    usages: extractUsages(session, source),
    imports: resolveImports(session, source, file, false),
    reexports: resolveImports(session, source, file, true),
    signature,
  }
}

/** McCabe: one, plus each branch point. A nested function counts on its own, as `oxlint`'s `complexity` does. */
export function complexity(body: Node): number {
  let count = 1
  const visit = (node: Node): void => {
    if (BRANCHES.has(node.kind)) count += 1
    else if (isBinaryExpression(node) && LOGICAL.has(node.operatorToken.kind)) count += 1
    node.forEachChild((child) => {
      if (!NESTED_FUNCTIONS.has(child.kind)) visit(child)
    })
  }
  visit(body)
  return count
}

function resolveImports(
  session: Session,
  source: SourceFile,
  file: string,
  reexportsOnly: boolean,
): string[] {
  const resolved = new Set<string>()
  for (const statement of source.statements) {
    if (!isImportDeclaration(statement) && !isExportDeclaration(statement)) continue
    if (reexportsOnly && !isExportDeclaration(statement)) continue
    const specifier = statement.moduleSpecifier
    if (!specifier || !isStringLiteral(specifier)) continue
    const text = specifier.text
    if (text.startsWith('.')) resolved.add(posix.join(dirname(file), text))
    else
      for (const pkg of session.scope) {
        const target = pkg.specifiers.get(text)
        if (target) resolved.add(target)
      }
  }
  return [...resolved].toSorted()
}

// ---- symbols ----------------------------------------------------------------------------------

type FunctionLike = Node & {
  parameters: readonly (Node & {
    name: Node
    type?: Node
    questionToken?: Node
    dotDotDotToken?: Node
  })[]
  body?: Node
}

interface Declared {
  name: string
  kind: SymbolKind
  node: Node
  nameNode: Node
  exported: boolean
  /** The function the parameters and return type are read from, when there is one. */
  fn: FunctionLike | undefined
  /** The last declaration of an overloaded function, so the record's range covers every signature. */
  end?: Node
  /** The implementation of an overloaded function, so complexity is read from its body. */
  body?: Node
}

/** The artifact's stable id for a declaration in a package. */
function monikerOf(packageName: string, file: string, name: string): string {
  return `typescript:${packageName}:${file}#${name}`
}

interface PackageManifest {
  readonly name: string
  readonly exports?: Readonly<
    Record<
      string,
      string | { readonly types?: string; readonly node?: string; readonly default?: string }
    >
  >
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseManifest(text: string): PackageManifest {
  const value: unknown = JSON.parse(text)
  if (!isRecord(value) || typeof value['name'] !== 'string') {
    throw new Error('a scoped package.json needs a string name')
  }
  const rawExports = value['exports']
  if (rawExports !== undefined && !isRecord(rawExports)) {
    throw new Error('a scoped package.json exports must be an object')
  }
  const exports: Record<string, string | { types?: string; node?: string; default?: string }> = {}
  for (const [key, target] of Object.entries(rawExports ?? {})) {
    if (typeof target === 'string') {
      exports[key] = target
      continue
    }
    if (!isRecord(target)) throw new Error(`export ${key} must be a string or an object`)
    const entry: { types?: string; node?: string; default?: string } = {}
    if (typeof target['types'] === 'string') entry.types = target['types']
    if (typeof target['node'] === 'string') entry.node = target['node']
    if (typeof target['default'] === 'string') entry.default = target['default']
    exports[key] = entry
  }
  return { name: value['name'], exports }
}

function hasExportModifier(node: Node): boolean {
  const modifiers = (node as Node & { modifiers?: readonly Node[] }).modifiers
  return modifiers?.some((m) => m.kind === SyntaxKind.ExportKeyword) ?? false
}

/** Names exported by a later `export { a, b }` in this file. */
function namedExports(source: SourceFile): Set<string> {
  const names = new Set<string>()
  for (const statement of source.statements) {
    if (!isExportDeclaration(statement) || statement.moduleSpecifier || !statement.exportClause)
      continue
    if (!isNamedExports(statement.exportClause)) continue
    for (const element of statement.exportClause.elements)
      names.add((element.propertyName ?? element.name).getText())
  }
  return names
}

function declarations(source: SourceFile): Declared[] {
  const later = namedExports(source)
  const found: Declared[] = []
  for (const statement of source.statements) {
    if (isFunctionDeclaration(statement) && statement.name) {
      const exported = hasExportModifier(statement) || later.has(statement.name.text)
      found.push({
        name: statement.name.text,
        kind: 'function',
        node: statement,
        nameNode: statement.name,
        exported,
        fn: statement,
      })
    } else if (isClassDeclaration(statement) && statement.name) {
      const exported = hasExportModifier(statement) || later.has(statement.name.text)
      found.push({
        name: statement.name.text,
        kind: 'class',
        node: statement,
        nameNode: statement.name,
        exported,
        fn: undefined,
      })
    } else if (isTypeAliasDeclaration(statement) || isInterfaceDeclaration(statement)) {
      const exported = hasExportModifier(statement) || later.has(statement.name.text)
      found.push({
        name: statement.name.text,
        kind: isInterfaceDeclaration(statement) ? 'interface' : 'type',
        node: statement,
        nameNode: statement.name,
        exported,
        fn: undefined,
      })
    } else if (isVariableStatement(statement)) {
      const exported = hasExportModifier(statement)
      for (const declaration of statement.declarationList.declarations) {
        if (!isIdentifier(declaration.name)) continue
        const init = declaration.initializer
        const isFn = init !== undefined && (isArrowFunction(init) || isFunctionExpression(init))
        found.push({
          name: declaration.name.text,
          kind: isFn ? 'function' : 'const',
          node: statement,
          nameNode: declaration.name,
          exported: exported || later.has(declaration.name.text),
          fn: isFn ? init : undefined,
        })
      }
    }
  }
  return collapseOverloads(found)
}

/**
 * A function's overload signatures are separate declarations of one symbol. Keep one record: the
 * first declaration supplies the description, parameters and return type; the implementation supplies
 * the body complexity is read from; the line range spans the whole set.
 */
function collapseOverloads(declared: Declared[]): Declared[] {
  const functions = new Map<string, Declared>()
  const collapsed: Declared[] = []
  for (const entry of declared) {
    if (entry.kind !== 'function' || entry.fn === undefined) {
      collapsed.push(entry)
      continue
    }
    const existing = functions.get(entry.name)
    if (!existing) {
      functions.set(entry.name, entry)
      collapsed.push(entry)
      continue
    }
    existing.end = entry.node
    if (entry.fn.body) existing.body = entry.fn.body
  }
  return collapsed
}

function extractSymbols(
  session: Session,
  source: SourceFile,
  file: string,
  pkg: ScopePackage,
): CodeSymbolV1[] {
  const { checker } = session
  return declarations(source).map((declared) => {
    const symbol = checker.getSymbolAtLocation(declared.nameNode)
    const tags = symbol ? toTags(checker.getJsDocTagsOfSymbol(symbol)) : []
    const description = symbol ? checker.getDocumentationCommentOfSymbol(symbol).trim() : ''
    const type = symbol ? typeText(checker, symbol, declared) : ''
    const start = declared.node.getStart(source)
    const end = declared.end ?? declared.node
    const body = declared.body ?? declared.fn?.body
    return {
      moniker: monikerOf(pkg.name, file, declared.name),
      name: declared.name,
      kind: declared.kind,
      package: pkg.dir,
      module: file.slice(pkg.dir.length + '/src/'.length).replace(/\.ts$/, ''),
      file,
      visibility: visibilityOf(declared.exported, tags),
      entryFile: pkg.entryFiles.has(file),
      signature:
        declared.kind === 'type' || declared.kind === 'interface' || declared.kind === 'class'
          ? `${declared.kind} ${declared.name}${typeParametersOf(declared.node)}`
          : `${declared.name}: ${type}`,
      ...(declared.kind === 'type' || declared.kind === 'interface' || declared.kind === 'class'
        ? { definition: declared.node.getText() }
        : {}),
      ...(declared.kind === 'const' ? constantDefinition(declared.node) : {}),
      ...(declared.kind === 'const' ? literalValue(declared.node, declared.nameNode) : {}),
      params: declared.fn ? paramsOf(checker, declared.fn) : [],
      returnType: declared.fn
        ? returnTypeOf(checker, declared.fn, type)
        : declared.kind === 'const'
          ? type
          : '',
      description,
      tags,
      keywords: listTag(tags, 'keywords'),
      concepts: listTag(tags, 'concept'),
      startLine: source.getLineAndCharacterOfPosition(start).line + 1,
      endLine: source.getLineAndCharacterOfPosition(end.getEnd()).line + 1,
      complexity: body ? complexity(body) : null,
    }
  })
}

/** ` <T, U>` when a type, interface or class declares type parameters. */
function typeParametersOf(node: Node): string {
  const parameters = (node as Node & { typeParameters?: readonly Node[] }).typeParameters
  return parameters === undefined || parameters.length === 0
    ? ''
    : `<${parameters.map((parameter) => parameter.getText()).join(', ')}>`
}

/** A const's declaration text, capped so one enormous schema value cannot bloat every snapshot. */
function constantDefinition(node: Node): { definition?: string } {
  const text = node.getText()
  return text.length <= 8_000 ? { definition: text } : {}
}

/** A literal constant's value, so the report can show `= "value"` rather than only a type. */
function literalValue(node: Node, nameNode: Node): { value?: string } {
  const statement = node as Node & {
    declarationList?: { declarations?: readonly (Node & { initializer?: Node })[] }
  }
  const declaration = statement.declarationList?.declarations?.find(
    (candidate) => (candidate as Node & { name?: Node }).name === nameNode,
  )
  const initializer = declaration?.initializer
  if (!initializer) return {}
  if (
    initializer.kind === SyntaxKind.StringLiteral ||
    initializer.kind === SyntaxKind.NumericLiteral ||
    initializer.kind === SyntaxKind.TrueKeyword ||
    initializer.kind === SyntaxKind.FalseKeyword ||
    initializer.kind === SyntaxKind.NullKeyword
  ) {
    return { value: initializer.getText() }
  }
  return {}
}

function typeText(checker: Checker, symbol: CompilerSymbol, declared: Declared): string {
  const type =
    declared.kind === 'type'
      ? checker.getDeclaredTypeOfSymbol(symbol)
      : checker.getTypeOfSymbol(symbol)
  return type ? checker.typeToString(type, declared.node) : ''
}

function paramsOf(checker: Checker, fn: FunctionLike): SourceParameter[] {
  return fn.parameters.map((parameter) => {
    const type = checker.getTypeAtLocation(parameter.name)
    return {
      name: parameter.name.getText(),
      type: type ? checker.typeToString(type, parameter) : (parameter.type?.getText() ?? 'unknown'),
      optional: parameter.questionToken !== undefined || parameter.dotDotDotToken !== undefined,
    }
  })
}

function returnTypeOf(checker: Checker, fn: FunctionLike, fallback: string): string {
  const signature = checker.getSignatureFromDeclaration(fn)
  const type = signature ? checker.getReturnTypeOfSignature(signature) : undefined
  return type ? checker.typeToString(type, fn) : fallback
}

function toTags(raw: readonly { name: string; text?: string | undefined }[]): DocTag[] {
  return raw.map((tag) => ({ name: tag.name, text: tag.text ?? '' }))
}

function listTag(tags: DocTag[], name: string): string[] {
  return tags
    .filter((tag) => tag.name === name)
    .flatMap((tag) => tag.text.split(','))
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

function visibilityOf(exported: boolean, tags: readonly DocTag[]): SymbolVisibility {
  if (!exported) return 'local'
  if (tags.some((t) => t.name === 'internal')) return 'internal'
  if (tags.some((t) => t.name === 'package')) return 'package'
  return 'exported'
}

const BRANCHES: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.IfStatement,
  SyntaxKind.ForStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
  SyntaxKind.CaseClause,
  SyntaxKind.CatchClause,
  SyntaxKind.ConditionalExpression,
])
const LOGICAL: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.AmpersandAmpersandToken,
  SyntaxKind.BarBarToken,
  SyntaxKind.QuestionQuestionToken,
])
const NESTED_FUNCTIONS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.FunctionExpression,
  SyntaxKind.ArrowFunction,
  SyntaxKind.MethodDeclaration,
  SyntaxKind.ClassDeclaration,
  SyntaxKind.ClassExpression,
])

// ---- usages -----------------------------------------------------------------------------------

/** What a top-level declaration can be: not a property or a parameter that happens to share its name. */
const TOP_LEVEL =
  SymbolFlags.Function |
  SymbolFlags.Class |
  SymbolFlags.Interface |
  SymbolFlags.TypeAlias |
  SymbolFlags.BlockScopedVariable |
  SymbolFlags.FunctionScopedVariable

const NOT_A_USE: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.ImportSpecifier,
  SyntaxKind.ExportSpecifier,
  SyntaxKind.ImportClause,
  SyntaxKind.NamespaceImport,
])
const NAMED_DECLARATIONS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.ClassDeclaration,
  SyntaxKind.TypeAliasDeclaration,
  SyntaxKind.InterfaceDeclaration,
  SyntaxKind.VariableDeclaration,
])

function identifiers(source: SourceFile): Node[] {
  const found: Node[] = []
  const visit = (node: Node): void => {
    if (node.kind === SyntaxKind.Identifier && !NOT_A_USE.has(node.parent.kind)) {
      const parent = node.parent as Node & { name?: Node }
      if (!(parent.name === node && NAMED_DECLARATIONS.has(parent.kind))) found.push(node)
    }
    node.forEachChild(visit)
  }
  source.forEachChild(visit)
  return found
}

const topLevelCache = new WeakMap<Session, Map<string, boolean>>()

/** Whether a declaration sits at the top of its file, not inside a function that reuses the name of an export. */
function isTopLevel(session: Session, declaration: NodeHandle): boolean {
  const cache = topLevelCache.get(session) ?? new Map<string, boolean>()
  topLevelCache.set(session, cache)
  const key = `${declaration.path}#${declaration.index}`
  const known = cache.get(key)
  if (known !== undefined) return known
  let node = declaration.resolve(session.project)?.parent
  while (
    node &&
    (node.kind === SyntaxKind.VariableDeclarationList || node.kind === SyntaxKind.VariableStatement)
  )
    node = node.parent
  const top = node?.kind === SyntaxKind.SourceFile
  cache.set(key, top)
  return top
}

/** Every use, in this file, of something declared in scope. Found from the using file, so a record never depends on another file's text. */
function extractUsages(session: Session, source: SourceFile): SymbolUsage[] {
  const { checker } = session
  const nodes = identifiers(source)
  const edges: SymbolUsage[] = []
  const chunk = 400
  for (let i = 0; i < nodes.length; i += chunk) {
    const part = nodes.slice(i, i + chunk)
    const symbols = checker.getSymbolAtLocation(part)
    symbols.forEach((symbol, index) => {
      const node = part[index]
      if (!symbol || !node) return
      const target = symbol.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
      if (!(target.flags & TOP_LEVEL)) return
      const declaration = target.declarations[0]
      if (!declaration) return
      const file = session.repoPathByCompilerPath.get(declaration.path)
      if (!file || !packageOf(session.scope, file) || !isTopLevel(session, declaration)) return
      const targetPackage = packageOf(session.scope, file)
      if (!targetPackage) return
      edges.push({
        to: monikerOf(targetPackage.name, file, target.name),
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      })
    })
  }
  return edges
}
