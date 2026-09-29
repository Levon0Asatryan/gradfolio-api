import { describe, expect, it } from 'vitest';
import { parseCommand } from './args.js';

describe('parseCommand', () => {
  it.each([
    [['up'], { command: 'up' }],
    [['up', '--to', '0001_baseline'], { command: 'up', to: '0001_baseline' }],
    [['down'], { command: 'down', all: false }],
    [['down', '--all'], { command: 'down', all: true }],
    [['down', '--to', '0001_baseline'], { command: 'down', all: false, to: '0001_baseline' }],
  ])('%j', (argv, expected) => {
    expect(parseCommand(argv)).toEqual(expected);
  });

  it.each([
    [[], /unknown command ""/],
    [['sideways'], /unknown command "sideways"/],
    [['up', 'extra'], /unexpected argument/],
    [['up', '--all'], /--all is for down/],
    [['down', '--all', '--to', 'x'], /not both/],
    [['up', '--nope'], /--nope/],
  ])('refuses %j', (argv, error) => {
    expect(() => parseCommand(argv)).toThrow(error);
  });
});
