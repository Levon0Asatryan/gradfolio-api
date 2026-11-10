import { describe, expect, it } from 'vitest';
import { ResumeBuilder } from './resume-builder.js';

describe('ResumeBuilder', () => {
  it('keeps the header and the sections in the order they were added', () => {
    const data = new ResumeBuilder('Ani', 'Developer')
      .section('Skills', [{ text: 'SQL' }])
      .section('Bio', [{ title: 'About', text: 'Hi' }])
      .build();
    expect(data).toEqual({
      name: 'Ani',
      headline: 'Developer',
      blocks: [
        { title: 'Skills', entries: [{ text: 'SQL' }] },
        { title: 'Bio', entries: [{ title: 'About', text: 'Hi' }] },
      ],
    });
  });

  it('leaves out a section whose entries were all dropped', () => {
    const data = new ResumeBuilder('Ani', '')
      .section('Contact', [{ link: 'javascript:alert(1)' }, { link: null }])
      .section('Projects', [])
      .build();
    expect(data.blocks).toEqual([]);
  });

  it('prints a safe link once, as its normalized URL, and drops an unsafe one', () => {
    const data = new ResumeBuilder('Ani', '')
      .section('Contact', [
        { link: 'https://ani.example' },
        { link: 'https://user:pw@ani.example' },
        { text: 'ani@example.com' },
      ])
      .build();
    expect(data.blocks[0]?.entries).toEqual([
      { text: 'https://ani.example/', url: 'https://ani.example/' },
      { text: 'ani@example.com' },
    ]);
  });

  it('links an entry to its first safe URL candidate', () => {
    const [entry, none] = new ResumeBuilder('Ani', '')
      .section('Projects', [
        { title: 'A', text: '', urls: ['ftp://a.example', null, 'https://repo.example/a'] },
        { title: 'B', text: 'b', urls: [undefined, 'data:text/html,x'] },
      ])
      .build().blocks[0]!.entries;
    expect(entry).toEqual({ title: 'A', text: '', url: 'https://repo.example/a' });
    expect(none?.url).toBeUndefined();
  });

  it('returns a copy, so later sections do not change an earlier build', () => {
    const builder = new ResumeBuilder('Ani', '').section('Bio', [{ text: 'Hi' }]);
    const first = builder.build();
    builder.section('Skills', [{ text: 'SQL' }]);
    expect(first.blocks).toHaveLength(1);
  });
});
