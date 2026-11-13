// cutest-picture-01 entry (Node 22, standard library only). Its picture is entry.jpg beside this file: a cream kitten
// in a strawberry hat hugging a sleepy duckling in a teacup, generated with HeyGen (GPT Image 2.6) and saved as a
// 1024x1024 JPEG (quality 99, no chroma subsampling) to fit the gate's 1 MiB cap. The program checks the file against
// the gate's rules and writes it to /output/entry.png; the gate tells PNG from JPEG by its first bytes, so the name
// stays entry.png. bunny.ts is this repository's earlier, code-drawn picture, kept but no longer written out.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MAX_BYTES = 1048576;
const MAX_SIDE = 1024;

const jpg = readFileSync(new URL('./entry.jpg', import.meta.url));

// A whole JPEG: SOI first, EOI last, and a baseline or progressive frame header within the size limits.
function jpegSize(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8 || b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9) {
    throw new Error('entry.jpg is not a whole JPEG');
  }
  for (let i = 2; i + 9 < b.length; ) {
    if (b[i] !== 0xff) throw new Error(`entry.jpg: bad marker at ${i}`);
    // a marker may be preceded by any number of 0xFF fill bytes
    while (b[i + 1] === 0xff && i + 10 < b.length) i++;
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xc2) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error('entry.jpg has no frame header');
}

const { w, h } = jpegSize(jpg);
if (jpg.length > MAX_BYTES || w > MAX_SIDE || h > MAX_SIDE) {
  throw new Error(`entry.jpg is ${jpg.length} bytes, ${w}x${h}: over the gate's limits`);
}
const out = join(process.env.MAKEFUN_OUTPUT_DIR ?? '/output', 'entry.png');
writeFileSync(out, jpg);
console.log(`wrote ${out}: JPEG ${w}x${h}, ${jpg.length} bytes`);
