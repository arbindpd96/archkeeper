import { expect, it } from 'vitest';
import { greet } from './greet.js';

it('greets by name', () => {
  expect(greet('Ada')).toBe('Hello, Ada!');
});
