// Polyfill for node:assert — Cloudflare Workers compatible
function assert(val, msg) {
  if (!val) throw new Error(msg || 'Assertion failed');
}
assert.ok = assert;
assert.strictEqual = (a, b, msg) => { if (a !== b) throw new Error(msg || `${a} !== ${b}`); };
assert.notStrictEqual = (a, b, msg) => { if (a === b) throw new Error(msg || `${a} === ${b}`); };
assert.deepStrictEqual = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(msg || 'Deep equal failed'); };
assert.notDeepStrictEqual = (a, b, msg) => { if (JSON.stringify(a) === JSON.stringify(b)) throw new Error(msg || 'Deep equal should differ'); };
assert.fail = (msg) => { throw new Error(msg || 'Assertion failed'); };
assert.throws = (fn, msg) => { try { fn(); throw new Error(msg || 'Expected to throw'); } catch(e) { if (e.message === (msg || 'Expected to throw')) throw e; } };
assert.doesNotThrow = (fn) => { fn(); };
assert.equal = (a, b, msg) => { if (a != b) throw new Error(msg || `${a} != ${b}`); };
assert.notEqual = (a, b, msg) => { if (a == b) throw new Error(msg || `${a} == ${b}`); };

export default assert;
export const { ok, strictEqual, notStrictEqual, deepStrictEqual, notDeepStrictEqual, fail, throws, doesNotThrow, equal, notEqual } = assert;
