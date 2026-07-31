/** Safe arithmetic expression evaluator for dynamic FormulaSpec fields (derived / lambda_*_mult). */

export class FormulaEvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormulaEvalError';
  }
}

type Tok =
  | { t: 'num'; v: number }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }
  | { t: 'lp' }
  | { t: 'rp' }
  | { t: 'comma' };

function tokenize(expr: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const s = expr.trim();
  while (i < s.length) {
    const c = s[i]!;
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[0-9.]/.test(s[j]!)) j += 1;
      const num = Number(s.slice(i, j));
      if (!Number.isFinite(num)) throw new FormulaEvalError(`Bad number near ${i}`);
      out.push({ t: 'num', v: num });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j]!)) j += 1;
      out.push({ t: 'id', v: s.slice(i, j) });
      i = j;
      continue;
    }
    if ('+-*/^'.includes(c)) {
      out.push({ t: 'op', v: c });
      i += 1;
      continue;
    }
    if (c === '(') {
      out.push({ t: 'lp' });
      i += 1;
      continue;
    }
    if (c === ')') {
      out.push({ t: 'rp' });
      i += 1;
      continue;
    }
    if (c === ',') {
      out.push({ t: 'comma' });
      i += 1;
      continue;
    }
    throw new FormulaEvalError(`Unsupported character: ${c}`);
  }
  return out;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

const FUNCS: Record<string, (...args: number[]) => number> = {
  min: (...a) => Math.min(...a),
  max: (...a) => Math.max(...a),
  abs: (a) => Math.abs(a),
  clamp: (v, lo, hi) => clamp(v, lo, hi),
};

class Parser {
  private i = 0;
  constructor(
    private readonly toks: Tok[],
    private readonly env: Record<string, number>,
  ) {}

  parse(): number {
    const v = this.parseExpr();
    if (this.i < this.toks.length) {
      throw new FormulaEvalError('Unexpected trailing tokens');
    }
    return v;
  }

  private peek(): Tok | undefined {
    return this.toks[this.i];
  }

  private consume(): Tok {
    const t = this.toks[this.i++];
    if (!t) throw new FormulaEvalError('Unexpected end');
    return t;
  }

  private parseExpr(): number {
    let left = this.parseTerm();
    while (this.peek()?.t === 'op' && (this.peek() as { v: string }).v && '+-'.includes((this.peek() as { v: string }).v)) {
      const op = (this.consume() as { v: string }).v;
      const right = this.parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  private parseTerm(): number {
    let left = this.parsePower();
    while (this.peek()?.t === 'op' && '*/'.includes((this.peek() as { v: string }).v)) {
      const op = (this.consume() as { v: string }).v;
      const right = this.parsePower();
      left = op === '*' ? left * right : left / right;
    }
    return left;
  }

  private parsePower(): number {
    const base = this.parseUnary();
    if (this.peek()?.t === 'op' && (this.peek() as { v: string }).v === '^') {
      this.consume();
      const exp = this.parseUnary();
      return base ** exp;
    }
    return base;
  }

  private parseUnary(): number {
    if (this.peek()?.t === 'op' && '+-'.includes((this.peek() as { v: string }).v)) {
      const op = (this.consume() as { v: string }).v;
      const v = this.parseUnary();
      return op === '-' ? -v : v;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    const t = this.peek();
    if (!t) throw new FormulaEvalError('Unexpected end');
    if (t.t === 'num') {
      this.consume();
      return t.v;
    }
    if (t.t === 'id') {
      this.consume();
      if (this.peek()?.t === 'lp') {
        this.consume();
        const args: number[] = [];
        if (this.peek()?.t !== 'rp') {
          args.push(this.parseExpr());
          while (this.peek()?.t === 'comma') {
            this.consume();
            args.push(this.parseExpr());
          }
        }
        if (this.peek()?.t !== 'rp') throw new FormulaEvalError('Expected )');
        this.consume();
        const fn = FUNCS[t.v];
        if (!fn) throw new FormulaEvalError(`Function not allowed: ${t.v}`);
        return fn(...args);
      }
      if (!(t.v in this.env)) {
        throw new FormulaEvalError(`Unknown variable: ${t.v}`);
      }
      return this.env[t.v]!;
    }
    if (t.t === 'lp') {
      this.consume();
      const v = this.parseExpr();
      if (this.peek()?.t !== 'rp') throw new FormulaEvalError('Expected )');
      this.consume();
      return v;
    }
    throw new FormulaEvalError('Unsupported syntax');
  }
}

export function evaluateExpression(
  expr: string,
  env: Record<string, number>,
): number {
  const text = (expr || '').trim();
  if (!text) throw new FormulaEvalError('Empty expression');
  if (text.length > 500) throw new FormulaEvalError('Expression too long');
  const toks = tokenize(text);
  return new Parser(toks, env).parse();
}

export function evaluateDerived(
  derived: Record<string, string>,
  env: Record<string, number>,
): Record<string, number> {
  const result = { ...env };
  const pending = { ...derived };
  let guard = 0;
  while (Object.keys(pending).length && guard < Object.keys(derived).length + 5) {
    guard += 1;
    let progressed = false;
    for (const [name, expr] of Object.entries(pending)) {
      try {
        result[name] = evaluateExpression(expr, result);
        delete pending[name];
        progressed = true;
      } catch (e) {
        if (!(e instanceof FormulaEvalError) || !String(e.message).includes('Unknown variable')) {
          throw e;
        }
      }
    }
    if (!progressed && Object.keys(pending).length) {
      throw new FormulaEvalError(
        `Could not resolve derived variables: ${Object.keys(pending).sort().join(', ')}`,
      );
    }
  }
  return result;
}
