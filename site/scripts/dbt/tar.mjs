// Minimal tar reader (ustar / pax, as written by `git archive` and GitHub tarballs). Regular files only.
import zlib from 'node:zlib';

function str(buf, start, len) {
  const s = buf.subarray(start, start + len);
  const z = s.indexOf(0);
  return (z >= 0 ? s.subarray(0, z) : s).toString('utf8');
}

/** [{ name, data: Buffer }] for every regular file of a .tar (or .tar.gz when gzip is true). */
export function readTar(input, { gzip = false } = {}) {
  const buf = gzip ? zlib.gunzipSync(input) : input;
  const out = [];
  let p = 0;
  let paxPath = null;
  let longName = null;
  while (p + 512 <= buf.length) {
    const header = buf.subarray(p, p + 512);
    if (header.every((b) => b === 0)) break;
    let name = str(header, 0, 100);
    const size = parseInt(str(header, 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 48);
    const prefix = str(header, 345, 155);
    if (prefix) name = prefix + '/' + name;
    const data = buf.subarray(p + 512, p + 512 + size);
    p += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') { // pax extended header: "len key=value\n"
      for (const rec of data.toString('utf8').split('\n')) {
        const m = rec.match(/^\d+ path=(.*)$/);
        if (m) paxPath = m[1];
      }
      continue;
    }
    if (type === 'g') continue; // global pax header (git archive writes the commit id here)
    if (type === 'L') { longName = str(data, 0, data.length); continue; }
    if (paxPath) { name = paxPath; paxPath = null; }
    if (longName) { name = longName; longName = null; }
    if (type === '0' || type === '\0' || type === '7') out.push({ name, data: Buffer.from(data) });
  }
  return out;
}
