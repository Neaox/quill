/**
 * quill/no-independent-await-in-loop
 *
 * Replaces the core `no-await-in-loop`, which cannot tell a pagination
 * cursor from an N+1. This rule flags a `for`, `for...of` or `for...in`
 * loop only when its awaits look independent of each other, so a warning
 * almost always means "collect the work and `Promise.all` it, or batch the
 * query" (AGENTS rule 13).
 *
 * It stays silent (prefers false negatives) when an iteration can depend on
 * the previous one:
 *   - `for await`, `while` and `do...while` loops (polling, queues, paging);
 *   - an await in the loop condition;
 *   - a `break`, `return` or `throw` in the loop (walk-until, early exit);
 *   - a variable declared outside the loop that the loop writes and also
 *     reads elsewhere (cursor, `previous`, retry counter, a queried set,
 *     `+=`); `results.push(await x)` alone is NOT a dependency;
 *   - the only awaits are on stateful handles (`tx`, `client`, `reader`,
 *     `stream`, ...), `.next()/.read()/.write()/.send()` style calls,
 *     sleep/delay calls, or `Promise.all(...)` chunks (already bounded).
 *
 * Known limits: stateful handles are recognised by name, and nested
 * functions are not inspected. Where it still fires on genuinely sequential
 * work, say why:
 *   // oxlint-disable-next-line quill/no-independent-await-in-loop -- <dependency>
 */

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
])
const BREAKABLE_TYPES = new Set([
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
  'SwitchStatement',
])
const SKIP_KEYS = new Set(['parent', 'loc', 'range', 'start', 'end', 'type'])
const MUTATING_METHODS = new Set([
  'push',
  'unshift',
  'add',
  'set',
  'delete',
  'splice',
  'pop',
  'shift',
  'clear',
  'sort',
  'append',
])
const STATEFUL_ROOTS =
  /^(tx|trx|txn|transaction|client|conn|connection|reader|writer|stream|socket|sock|cursor|iter|iterator|session|handle|child|proc|process|stdin|stdout)$/i
const STATEFUL_METHODS = new Set(['next', 'read', 'write', 'send', 'end', 'commit', 'rollback'])
const SLEEP_NAMES = /^(sleep|delay|wait|waitFor|setTimeout|backoff)$/i
const PROMISE_COMBINATORS = new Set(['all', 'allSettled', 'race', 'any'])

function childNodes(node) {
  const children = []
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue
    const value = node[key]
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== null && typeof item === 'object' && typeof item.type === 'string') {
          children.push([item, key])
        }
      }
    } else if (value !== null && typeof value === 'object' && typeof value.type === 'string') {
      children.push([value, key])
    }
  }
  return children
}

function unwrap(node) {
  let current = node
  while (
    current &&
    (current.type === 'ChainExpression' ||
      current.type === 'TSNonNullExpression' ||
      current.type === 'TSAsExpression' ||
      current.type === 'ParenthesizedExpression' ||
      current.type === 'AwaitExpression')
  ) {
    current = current.expression ?? current.argument
  }
  return current
}

/** The identifier at the root of `a.b(c).d`, if there is one. */
function rootIdentifier(node) {
  let current = unwrap(node)
  while (current) {
    if (current.type === 'Identifier') return current
    if (current.type === 'MemberExpression') current = unwrap(current.object)
    else if (current.type === 'CallExpression') current = unwrap(current.callee)
    else return undefined
  }
  return undefined
}

function patternTargets(pattern, out) {
  if (!pattern) return out
  switch (pattern.type) {
    case 'Identifier':
      out.push(pattern)
      break
    case 'ObjectPattern':
      for (const property of pattern.properties) {
        patternTargets(property.type === 'RestElement' ? property.argument : property.value, out)
      }
      break
    case 'ArrayPattern':
      for (const element of pattern.elements) patternTargets(element, out)
      break
    case 'AssignmentPattern':
      patternTargets(pattern.left, out)
      break
    case 'RestElement':
      patternTargets(pattern.argument, out)
      break
    default:
      break
  }
  return out
}

function isExemptAwait(awaitNode) {
  const argument = unwrap(awaitNode.argument)
  if (!argument || argument.type !== 'CallExpression') return false
  const callee = unwrap(argument.callee)
  if (callee.type === 'Identifier') return SLEEP_NAMES.test(callee.name)
  if (callee.type !== 'MemberExpression' || callee.computed) return false
  const method = callee.property.name
  const object = unwrap(callee.object)
  if (object.type === 'Identifier' && object.name === 'Promise') {
    return PROMISE_COMBINATORS.has(method)
  }
  if (STATEFUL_METHODS.has(method) || SLEEP_NAMES.test(method)) return true
  const root = rootIdentifier(callee)
  return root !== undefined && STATEFUL_ROOTS.test(root.name)
}

function bump(map, name) {
  map.set(name, (map.get(name) ?? 0) + 1)
}

function analyse(loop) {
  const locals = new Set()
  const initNames = new Set()
  const written = new Set()
  const refs = new Map()
  const roleRefs = new Map()
  const roleNodes = new Set()
  const awaits = []
  let exits = false
  let awaitInTest = false

  const markWrite = (identifiers) => {
    for (const identifier of identifiers) {
      written.add(identifier.name)
      roleNodes.add(identifier)
    }
  }

  function visit(node, parent, key, ctx) {
    if (FUNCTION_TYPES.has(node.type)) {
      if (node.type === 'FunctionDeclaration' && node.id) locals.add(node.id.name)
      return
    }
    switch (node.type) {
      case 'AwaitExpression':
        if (ctx.inTest) awaitInTest = true
        else if (ctx.loopDepth === 0) awaits.push(node)
        break
      case 'VariableDeclarator':
        for (const id of patternTargets(node.id, [])) {
          if (ctx.initDeclaration) initNames.add(id.name)
          else locals.add(id.name)
        }
        break
      case 'CatchClause':
        for (const id of patternTargets(node.param, [])) locals.add(id.name)
        break
      case 'ClassDeclaration':
        if (node.id) locals.add(node.id.name)
        break
      case 'AssignmentExpression':
        if (node.left.type === 'MemberExpression') {
          const root = rootIdentifier(node.left)
          if (root) markWrite([root])
        } else if (node.operator === '=') {
          markWrite(patternTargets(node.left, []))
        } else {
          for (const id of patternTargets(node.left, [])) written.add(id.name)
        }
        break
      case 'UpdateExpression': {
        const target = unwrap(node.argument)
        if (target.type === 'Identifier') {
          if (!ctx.skipNames?.has(target.name)) written.add(target.name)
        } else {
          const root = rootIdentifier(target)
          if (root) markWrite([root])
        }
        break
      }
      case 'CallExpression': {
        const callee = unwrap(node.callee)
        if (
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          MUTATING_METHODS.has(callee.property.name)
        ) {
          const root = rootIdentifier(callee.object)
          if (root) markWrite([root])
        }
        break
      }
      case 'ReturnStatement':
      case 'ThrowStatement':
        exits = true
        break
      case 'BreakStatement':
        // An unlabeled break inside a nested loop or switch exits only that.
        if (node.label || ctx.breakableDepth === 0) exits = true
        break
      case 'Identifier': {
        const isPropertyName =
          (parent.type === 'MemberExpression' && key === 'property' && !parent.computed) ||
          (parent.type === 'Property' && key === 'key' && !parent.computed && !parent.shorthand) ||
          parent.type === 'LabeledStatement' ||
          parent.type === 'BreakStatement' ||
          parent.type === 'ContinueStatement' ||
          (parent.type === 'VariableDeclarator' && key === 'id')
        if (!isPropertyName && !ctx.skipNames?.has(node.name)) {
          bump(refs, node.name)
          if (roleNodes.has(node)) bump(roleRefs, node.name)
        }
        return
      }
      default:
        break
    }
    let childCtx = ctx
    if (BREAKABLE_TYPES.has(node.type)) {
      childCtx = {
        ...ctx,
        breakableDepth: ctx.breakableDepth + 1,
        loopDepth: node.type === 'SwitchStatement' ? ctx.loopDepth : ctx.loopDepth + 1,
      }
    }
    for (const [child, childKey] of childNodes(node)) visit(child, node, childKey, childCtx)
  }

  const base = { inTest: false, breakableDepth: 0, loopDepth: 0, initDeclaration: false }
  const visitPart = (part, partParent, partKey, overrides) => {
    if (part) visit(part, partParent, partKey, { ...base, ...overrides })
  }

  if (loop.type === 'ForStatement') {
    visitPart(loop.init, loop, 'init', { initDeclaration: true })
    visitPart(loop.test, loop, 'test', { inTest: true })
    visitPart(loop.update, loop, 'update', { skipNames: initNames })
  } else {
    // for...of / for...in: the loop variable is per-iteration.
    const left = loop.left.type === 'VariableDeclaration' ? loop.left.declarations[0].id : loop.left
    for (const id of patternTargets(left, [])) locals.add(id.name)
  }
  visitPart(loop.body, loop, 'body', {})

  if (awaitInTest || exits) return false
  if (awaits.every(isExemptAwait)) return false
  for (const name of written) {
    if (locals.has(name)) continue
    if ((refs.get(name) ?? 0) > (roleRefs.get(name) ?? 0)) return false
  }
  return awaits.length > 0
}

const rule = {
  meta: {
    type: 'suggestion',
    docs: { description: 'flag loops whose awaits are independent and could run concurrently' },
  },
  create(context) {
    const check = (node) => {
      if (node.type === 'ForOfStatement' && node.await) return
      if (!analyse(node)) return
      context.report({
        node,
        message:
          'The awaits in this loop do not depend on each other: collect the work and run it with Promise.all (in chunks if the input is large), or batch the query. If an iteration really needs the previous one, add `// oxlint-disable-next-line quill/no-independent-await-in-loop -- <the dependency>`.',
      })
    }
    return {
      ForStatement: check,
      ForOfStatement: check,
      ForInStatement: check,
    }
  },
}

export default rule
