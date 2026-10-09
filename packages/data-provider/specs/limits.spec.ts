import { countMessageCharacters, exceedsMessageLength } from '../src/limits';

describe('countMessageCharacters', () => {
  it('counts code points, not UTF-16 units', () => {
    expect(countMessageCharacters('hello')).toBe(5);
    expect(countMessageCharacters('👋🏽')).toBe(2);
    expect('👋🏽'.length).toBe(4);
    expect(countMessageCharacters('')).toBe(0);
  });
});

describe('exceedsMessageLength', () => {
  it('allows any length without a limit', () => {
    expect(exceedsMessageLength('x'.repeat(100_000), undefined)).toBe(false);
  });

  it('allows a message exactly at the limit and rejects one past it', () => {
    expect(exceedsMessageLength('x'.repeat(10), 10)).toBe(false);
    expect(exceedsMessageLength('x'.repeat(11), 10)).toBe(true);
  });

  it('measures emoji as one character each', () => {
    const emoji = '😀'.repeat(10);
    expect(emoji.length).toBe(20);
    expect(exceedsMessageLength(emoji, 10)).toBe(false);
    expect(exceedsMessageLength(emoji, 9)).toBe(true);
  });
});
