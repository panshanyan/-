async function unzip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf), out = [];
  let e = u8.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('zip 格式無法辨識');
  let p = dv.getUint32(e + 16, true); const cnt = dv.getUint16(e + 10, true);
  for (let i = 0; i < cnt; i++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
    if (name.endsWith('/') || name.startsWith('__MACOSX')) continue;
    const ds = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true), data = u8.subarray(ds, ds + csize);
    let raw;
    if (method === 0) raw = data;
    else if (method === 8) raw = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    else continue;
    out.push({ name: name.split('/').pop(), u8: raw });
  }
  return out;
}

