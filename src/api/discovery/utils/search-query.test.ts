import { describe, expect, it } from 'vitest';
import { escapeLike, FT_STOPWORDS, normalizeText, parseQuery, type Token } from './search-query.js';

const kinds = (q: string): [string, string][] =>
  parseQuery(normalizeText(q)).tokens.map((t: Token) => [t.text, t.kind]);

describe('normalizeText', () => {
  it('applies NFKC, drops control and zero-width characters, collapses whitespace', () => {
    expect(normalizeText('  ＡＩ \t\n  ML​  ')).toBe('AI ML');
    expect(normalizeText('a\u0000b')).toBe('a b');
    expect(normalizeText('')).toBe('');
  });
});

describe('parseQuery: token kinds (plan §1.4, §3.3)', () => {
  it('sends 3+ letters and digits to FULLTEXT, shorter words and punctuation to the fallback', () => {
    expect(kinds('IoT machine 2024')).toEqual([
      ['IoT', 'long'],
      ['machine', 'long'],
      ['2024', 'long'],
    ]);
    expect(kinds('AI ML Go UI')).toEqual([
      ['AI', 'short'],
      ['ML', 'short'],
      ['Go', 'short'],
      ['UI', 'short'],
    ]);
    expect(kinds('C# C++ CI/CD')).toEqual([
      ['C#', 'short'],
      ['C++', 'short'],
      ['CI/CD', 'short'],
    ]);
  });

  it('classifies Armenian and Cyrillic words by characters, not bytes', () => {
    expect(kinds('Արմեն ИИ Фёдор')).toEqual([
      ['Արմեն', 'long'],
      ['ИИ', 'short'],
      ['Фёдор', 'long'],
    ]);
  });

  it('keeps a single character as its own kind, which only an exact term may match', () => {
    expect(kinds('R')).toEqual([['R', 'single']]);
    expect(kinds('C ML')).toEqual([
      ['C', 'single'],
      ['ML', 'short'],
    ]);
  });

  it('drops stopwords when another word remains: "the chat" is "chat"', () => {
    expect(kinds('the chat')).toEqual([['chat', 'long']]);
    expect(kinds('an app')).toEqual([['app', 'long']]);
    expect(kinds('a chat')).toEqual([['chat', 'long']]);
    expect(kinds('THE Chat')).toEqual([['Chat', 'long']]);
  });

  it('keeps stopwords as short words when the query is only stopwords, never as FULLTEXT words', () => {
    expect(kinds('the')).toEqual([['the', 'short']]);
    expect(kinds('how to')).toEqual([
      ['how', 'short'],
      ['to', 'short'],
    ]);
  });

  it('lets the single-character rule win for a lone single-character stopword', () => {
    expect(kinds('a')).toEqual([['a', 'single']]);
    expect(kinds('i')).toEqual([['i', 'single']]);
    // Only stopwords: all are kept, each by its own rule.
    expect(kinds('the a')).toEqual([
      ['the', 'short'],
      ['a', 'single'],
    ]);
  });

  it('never produces a long word that contains an operator character', () => {
    for (const q of ['+(', '"x', '@3', '*', '>', '++machine', '-machine', 'machine*bad', 'a-b']) {
      for (const t of parseQuery(normalizeText(q)).tokens) {
        if (t.kind === 'long') expect(t.text).toMatch(/^[\p{L}\p{N}]+$/u);
      }
    }
  });
});

describe('the stopword list', () => {
  it('has the 35 distinct words InnoDB 8.4.11 ships (the server lists `the` twice)', () => {
    expect(FT_STOPWORDS.size).toBe(35);
    expect(FT_STOPWORDS.has('the')).toBe(true);
    expect(FT_STOPWORDS.has('ai')).toBe(false);
  });
});

describe('escapeLike', () => {
  it('makes %, _ and \\ ordinary text', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});
