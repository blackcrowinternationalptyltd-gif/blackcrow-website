// Build-time polyfill for node:assert — inlined into Cloudflare Worker bundle
function assert(val, msg) {
  if (!val) throw new Error(msg || 'Assertion failed');
}
assert.ok = assert;
assert.strictEqual = (a, b, msg) => { if (a !== b) throw new Error(msg || `${a} !== ${b}`); };
assert.notStrictEqual = (a, b, msg) => { if (a === b) throw new Error(msg || `${a} === ${b}`); };
assert.deepStrictEqual = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(msg || 'Deep equal failed'); };
assert.notDeepStrictEqual = (a, b, msg) => { if (JSON.stringify(a) === JSON.stringify(b)) throw new Error(msg || 'Values should not be equal'); };
assert.fail = (msg) => { throw new Error(msg || 'Assertion failed'); };
assert.throws = (fn) => { try { fn(); } catch(e) { return; } throw new Error('Expected to throw'); };
assert.doesNotThrow = (fn) => { fn(); };
assert.equal = (a, b, msg) => { if (a != b) throw new Error(msg || `${a} != ${b}`); };
assert.notEqual = (a, b, msg) => { if (a == b) throw new Error(msg || `${a} == ${b}`); };
assert.ifError = (val) => { if (val) throw val; };

export default assert;
export const { ok, strictEqual, notStrictEqual, deepStrictEqual, notDeepStrictEqual, fail, throws, doesNotThrow, equal, notEqual, ifError } = assert;
