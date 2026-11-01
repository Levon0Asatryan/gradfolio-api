#!/usr/bin/env node
// Prints, to the terminal only, what a LinkedIn data-export ZIP holds, without any value:
//   - for the five files Gradfolio reads (exact top-level names): the entry name and its
//     first line (cut at 300 characters), which is the header row;
//   - for every other entry: only a count per extension (entry names can hold contact names).
// If a first line does not look like a header (empty, has a digit, or was cut), it says so
// and prints nothing of it: paste the header line yourself.
//
//   node scripts/linkedin-export-headers.mjs <path-to-export.zip>
//
// Needs the `unzip` command. Reads nothing else; writes nothing.
import { execFileSync } from 'node:child_process';

const READ = ['Positions.csv', 'Education.csv', 'Skills.csv', 'Certifications.csv', 'Profile.csv'];
const zip = process.argv[2];
if (!zip) {
  console.error('usage: node scripts/linkedin-export-headers.mjs <export.zip>');
  process.exit(2);
}

const names = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8', maxBuffer: 16_000_000 })
  .split('\n')
  .filter(Boolean);

const histogram = new Map();
for (const name of names) {
  if (READ.includes(name)) continue;
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  const ext = m ? `.${m[1].toLowerCase()}` : '(none)';
  histogram.set(ext, (histogram.get(ext) ?? 0) + 1);
}

console.log(`entries: ${names.length}`);
for (const file of READ) {
  if (!names.includes(file)) {
    console.log(`${file}: not in the archive`);
    continue;
  }
  const out = execFileSync('unzip', ['-p', zip, file], {
    encoding: 'utf8',
    maxBuffer: 64_000_000,
  });
  const first = out.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  const looksLikeHeader = first !== '' && !/\d/.test(first) && first.length <= 300;
  console.log(
    looksLikeHeader
      ? `${file}: ${first}`
      : `${file}: first line is not a header (preamble?) -- paste the header line by hand`,
  );
}
for (const [ext, n] of [...histogram].sort()) console.log(`other ${ext}: ${n}`);
