import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FormulaEvalError, evaluateDerived, evaluateExpression } from '../formula-eval.js';
import {
  defaultFormulaSpec,
  normalizeFormulaSpec,
  patchFormulaSpec,
  validateDerivedKeys,
} from '../formula-spec.js';

describe('formula-eval', () => {
  it('evaluates arithmetic ops and precedence', () => {
    assert.equal(evaluateExpression('2 + 3 * 4', {}), 14);
    assert.equal(evaluateExpression('(2 + 3) * 4', {}), 20);
    assert.equal(evaluateExpression('10 / 2 - 1', {}), 4);
    assert.equal(evaluateExpression('2 ^ 3', {}), 8);
    assert.equal(evaluateExpression('-home_ops + 1', { home_ops: 0.2 }), 0.8);
  });

  it('evaluates clamp/min/max/abs', () => {
    assert.equal(evaluateExpression('clamp(1.5, 0.5, 1.2)', {}), 1.2);
    assert.equal(evaluateExpression('min(3, 1, 2)', {}), 1);
    assert.equal(evaluateExpression('max(3, 1, 2)', {}), 3);
    assert.equal(evaluateExpression('abs(-4)', {}), 4);
  });

  it('resolves registry variables', () => {
    assert.equal(evaluateExpression('base_lambda_home * 1.1', { base_lambda_home: 0.5 }), 0.55);
  });

  it('rejects unknown variables and bad funcs', () => {
    assert.throws(
      () => evaluateExpression('foo + 1', {}),
      (e: unknown) => e instanceof FormulaEvalError,
    );
    assert.throws(
      () => evaluateExpression('sin(1)', {}),
      (e: unknown) => e instanceof FormulaEvalError,
    );
  });

  it('evaluates derived chain', () => {
    const env = evaluateDerived({ a: '1 + 1', b: 'a * 3' }, { base_lambda_home: 1 });
    assert.equal(env.a, 2);
    assert.equal(env.b, 6);
  });
});

describe('formula-spec', () => {
  it('validates derived keys', () => {
    assert.equal(validateDerivedKeys({ good_1: '1' }), null);
    assert.match(validateDerivedKeys({ 'bad-key': '1' }) ?? '', /Invalid/);
  });

  it('normalizes and clamps parameters', () => {
    const spec = normalizeFormulaSpec({
      parameters: { overround: 9, prob_cap: 0.1, value_threshold_pct: -5 },
      lambda_home_mult: '1.05',
    });
    assert.equal(spec.parameters.overround, 1.2);
    assert.equal(spec.parameters.prob_cap, 0.5);
    assert.equal(spec.parameters.value_threshold_pct, 0);
    assert.equal(spec.lambda_home_mult, '1.05');
  });

  it('has no ai_blend field (AI never hides itself as a lambda multiplier)', () => {
    const spec = defaultFormulaSpec();
    assert.equal((spec as unknown as Record<string, unknown>).ai_blend, undefined);
  });

  it('patches without dropping base fields', () => {
    const patched = patchFormulaSpec(defaultFormulaSpec(), {
      parameters: { value_threshold_pct: 40 },
      derived: { edge: '1.02' },
      version: 'custom-test',
    });
    assert.equal(patched.parameters.value_threshold_pct, 40);
    assert.equal(patched.parameters.overround, 1.05);
    assert.equal(patched.derived.edge, '1.02');
    assert.equal(patched.version, 'custom-test');
    assert.equal(patched.base, 'v42');
  });
});
