const primitive = new Set(['int', 'float', 'string', 'bool', 'list', 'dict']);

/** Infer a conservative Geometry Code value type. Unknown means the caller must preserve source. */
export function inferExpressionType(expr, options = {}) {
  if (!expr) return null;
  const textOf = options.textOf || ((value) => typeof value === 'string' ? value : value?.text || '');
  if (typeof expr === 'string') {
    const s = expr.trim();
    if (/^(true|false|True|False)$/.test(s)) return 'bool';
    if (/^[+-]?\d+$/.test(s)) return 'int';
    if (/^[+-]?(?:\d+\.\d*|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(s)) return 'float';
    if (/^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/.test(s)) return 'string';
    if (s === '[]') return 'list';
    if (s === '{}') return 'dict';
    const call = s.match(/^(int|float|str|len)\s*\(/);
    if (call) return ({ int: 'int', float: 'float', str: 'string', len: 'int' })[call[1]];
    if (/^(?:not\s+|!)/.test(s) || /^(?:.+)\s+(?:and|or)\s+(?:.+)$/.test(s) || /^(?:.+)\s*(?:==|!=|<=|>=|<|>)\s*(?:.+)$/.test(s)) return 'bool';
    const parts = s.split(/\s*(?:\+|-|\*|\/|%|\*\*)\s*/).filter(Boolean);
    if (parts.length > 1) {
      const ts = parts.map((p) => inferExpressionType(p, options));
      if (ts.includes('string')) return ts.every((t) => t === 'string') ? 'string' : null;
      if (ts.every((t) => t === 'int' || t === 'float')) return s.includes('/') || ts.includes('float') ? 'float' : 'int';
    }
    return null;
  }
  const t = expr.type;
  if (t === 'Constant') return primitive.has(expr.value_type) ? expr.value_type : null;
  if (t === 'UnaryNot') return 'bool';
  if (t === 'UnaryOp') return expr.operator === 'not' ? 'bool' : inferExpressionType(expr.operand, options);
  if (t === 'BinOp' || t === 'binary_operator') {
    const op = expr.operator || options.operatorOf?.(expr) || textOf(expr).match(/(?:==|!=|<=|>=|[+\-*/%<>]|\band\b|\bor\b)/)?.[0];
    if (['==', '!=', '<=', '>=', '<', '>', 'and', 'or'].includes(op)) return 'bool';
    const a = inferExpressionType(expr.left, options), b = inferExpressionType(expr.right, options);
    if (op === '+' && (a === 'string' || b === 'string')) return a === 'string' && b === 'string' ? 'string' : null;
    if ((a === 'int' || a === 'float') && (b === 'int' || b === 'float')) return op === '/' || a === 'float' || b === 'float' ? 'float' : 'int';
    return null;
  }
  if (t === 'Call' || t === 'call') {
    const fn = expr.func?.id || expr.function || textOf(expr).match(/^([A-Za-z_]\w*)/)?.[1];
    return ({ int: 'int', float: 'float', str: 'string', len: 'int' })[fn] || null;
  }
  if (t === 'integer' || t === 'int') return 'int';
  if (t === 'float') return 'float';
  if (t === 'string') return 'string';
  if (t === 'true' || t === 'false') return 'bool';
  return null;
}

export const isLiteralExpression = (expr, options = {}) => Boolean(inferExpressionType(expr, options));
