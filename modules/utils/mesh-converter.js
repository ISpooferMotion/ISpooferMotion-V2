// modules/utils/mesh-converter.js
// Converts Roblox mesh data to Wavefront .obj
// Handles: raw text v1.xx, raw binary v2.xx, RBXM containers (with embedded mesh)

// ── LZ4 block decompressor (no framing) ───────────────────────────────────────
// Roblox RBXM chunks use LZ4 block compression.
function lz4Decompress(input, uncompressedSize) {
  const output = Buffer.allocUnsafe(uncompressedSize);
  let ip = 0;
  let op = 0;

  while (ip < input.length) {
    const token = input[ip++];

    // Literal run length
    let litLen = token >>> 4;
    if (litLen === 15) {
      let b;
      do { b = input[ip++]; litLen += b; } while (b === 255);
    }
    input.copy(output, op, ip, ip + litLen);
    ip += litLen;
    op += litLen;

    if (ip >= input.length) break; // last sequence — no match data

    // Match offset (uint16 LE)
    const offset = input[ip] | (input[ip + 1] << 8);
    ip += 2;

    // Match length
    let matchLen = (token & 0x0F) + 4;
    if ((token & 0x0F) === 15) {
      let b;
      do { b = input[ip++]; matchLen += b; } while (b === 255);
    }

    // Copy match bytes (may overlap — copy byte-by-byte intentionally)
    const matchStart = op - offset;
    for (let i = 0; i < matchLen; i++) {
      output[op++] = output[matchStart + i];
    }
  }

  return output.subarray(0, op);
}

// ── RBXM chunk parser ──────────────────────────────────────────────────────────
// Roblox binary format header: 8-byte magic + 6-byte sig + uint16 ver +
// uint32 classCount + uint32 instanceCount + 8 reserved = 32 bytes total.
// Each chunk: 4-byte name, uint32 compressedLen, uint32 uncompressedLen,
//             uint32 reserved, then compressedLen (or uncompressedLen) bytes.
const RBXM_MAGIC = '<roblox!';
const RBXM_HEADER_SIZE = 32;
const CHUNK_HEADER_SIZE = 16;

function extractMeshFromRbxm(buffer) {
  if (buffer.toString('ascii', 0, 8) !== RBXM_MAGIC) {
    throw new Error('Not an RBXM file');
  }

  let pos = RBXM_HEADER_SIZE;

  while (pos + CHUNK_HEADER_SIZE <= buffer.length) {
    const chunkType      = buffer.toString('ascii', pos, pos + 4);
    const compressedLen  = buffer.readUInt32LE(pos + 4);
    const uncompressedLen = buffer.readUInt32LE(pos + 8);
    pos += CHUNK_HEADER_SIZE;

    if (chunkType === 'END\0' || uncompressedLen === 0) break;

    const dataLen = compressedLen > 0 ? compressedLen : uncompressedLen;
    const chunkBytes = buffer.subarray(pos, pos + dataLen);
    pos += dataLen;

    let decompressed;
    try {
      decompressed = compressedLen > 0
        ? lz4Decompress(chunkBytes, uncompressedLen)
        : chunkBytes;
    } catch {
      continue; // skip corrupt/unreadable chunk
    }

    const meshOffset = findMeshVersionHeader(decompressed);
    if (meshOffset >= 0) {
      return decompressed.subarray(meshOffset);
    }
  }

  throw new Error('No mesh geometry found inside RBXM');
}

// Scans a buffer for the "version X.XX\n" header that starts raw Roblox mesh data.
function findMeshVersionHeader(buf) {
  const end = buf.length - 10;
  for (let i = 0; i < end; i++) {
    if (buf[i]   === 0x76 && // v
        buf[i+1] === 0x65 && // e
        buf[i+2] === 0x72 && // r
        buf[i+3] === 0x73 && // s
        buf[i+4] === 0x69 && // i
        buf[i+5] === 0x6F && // o
        buf[i+6] === 0x6E && // n
        buf[i+7] === 0x20 && // space
        buf[i+8] >= 0x31 && buf[i+8] <= 0x35 && // major digit 1-5
        buf[i+9] === 0x2E) { // dot
      return i;
    }
  }
  return -1;
}

// ── Public entry point ─────────────────────────────────────────────────────────
function convertMeshToObj(buffer) {
  const headerStr = buffer.toString('ascii', 0, 8);

  // RBXM container — decompress chunks and extract embedded mesh data
  if (headerStr === RBXM_MAGIC) {
    const meshData = extractMeshFromRbxm(buffer);
    return convertMeshToObj(meshData); // recurse with the raw mesh bytes
  }

  const versionLine = buffer.toString('ascii', 0, 20);
  const versionMatch = versionLine.match(/^version (\d+)\.(\d+)\r?\n/);
  if (!versionMatch) throw new Error('Unrecognised mesh format (no version header)');

  const major = parseInt(versionMatch[1], 10);
  if (major === 1) return parseMeshV1(buffer);
  if (major === 2) return parseMeshV2(buffer);
  throw new Error(`Unsupported mesh version ${versionMatch[1]}.${versionMatch[2]}`);
}

// ── V1 text format ─────────────────────────────────────────────────────────────
function parseMeshV1(buffer) {
  const text = buffer.toString('utf8');
  const lines = text.split(/\r?\n/);

  const numFaces = parseInt(lines[1].trim(), 10);
  if (!Number.isFinite(numFaces) || numFaces <= 0) throw new Error('Invalid face count in v1 mesh');

  const dataLine = lines[2] || '';
  const groups = [];
  const re = /\[([^\]]+)\]/g;
  let m;
  while ((m = re.exec(dataLine)) !== null) {
    groups.push(m[1].split(',').map(parseFloat));
  }

  const positions = [], normals = [], uvs = [], faces = [];

  for (let f = 0; f < numFaces; f++) {
    const faceVerts = [];
    for (let v = 0; v < 3; v++) {
      const base = (f * 3 + v) * 3;
      positions.push(groups[base]);
      normals.push(groups[base + 1]);
      uvs.push(groups[base + 2]);
      faceVerts.push(positions.length); // 1-indexed
    }
    faces.push(faceVerts);
  }

  return buildObj(positions, normals, uvs, faces, false);
}

// ── V2 binary format ───────────────────────────────────────────────────────────
function parseMeshV2(buffer) {
  const headerEnd = buffer.indexOf(0x0A) + 1;

  const sizeof_header = buffer.readUInt16LE(headerEnd);
  const sizeof_vertex = buffer.readUInt8(headerEnd + 2);
  const sizeof_face   = buffer.readUInt8(headerEnd + 3);
  const num_verts     = buffer.readUInt32LE(headerEnd + 4);
  const num_faces     = buffer.readUInt32LE(headerEnd + 8);

  if (num_verts === 0 || num_faces === 0) throw new Error('Mesh has no geometry');

  let offset = headerEnd + sizeof_header;

  const positions = [], normals = [], uvs = [];

  for (let i = 0; i < num_verts; i++) {
    const o = offset + i * sizeof_vertex;
    positions.push([buffer.readFloatLE(o),      buffer.readFloatLE(o + 4),  buffer.readFloatLE(o + 8)]);
    normals.push(  [buffer.readFloatLE(o + 12), buffer.readFloatLE(o + 16), buffer.readFloatLE(o + 20)]);
    uvs.push(      [buffer.readFloatLE(o + 24), buffer.readFloatLE(o + 28)]);
  }

  offset += num_verts * sizeof_vertex;

  const faces = [];
  const useUint16 = sizeof_face === 6;

  for (let i = 0; i < num_faces; i++) {
    const o = offset + i * sizeof_face;
    if (useUint16) {
      faces.push([buffer.readUInt16LE(o) + 1, buffer.readUInt16LE(o + 2) + 1, buffer.readUInt16LE(o + 4) + 1]);
    } else {
      faces.push([buffer.readUInt32LE(o) + 1, buffer.readUInt32LE(o + 4) + 1, buffer.readUInt32LE(o + 8) + 1]);
    }
  }

  return buildObj(positions, normals, uvs, faces, true);
}

// ── OBJ builder ────────────────────────────────────────────────────────────────
function buildObj(positions, normals, uvs, faces, sharedVertices) {
  const lines = ['# Converted from Roblox mesh by ISpooferMotion'];

  for (const [x, y, z] of positions) lines.push(`v ${x} ${y} ${z}`);
  for (const [u, v] of uvs)           lines.push(`vt ${u} ${1 - v}`); // flip V axis
  for (const [nx, ny, nz] of normals) lines.push(`vn ${nx} ${ny} ${nz}`);

  lines.push('g mesh');

  for (const verts of faces) {
    const [i0, i1, i2] = verts;
    lines.push(`f ${i0}/${i0}/${i0} ${i1}/${i1}/${i1} ${i2}/${i2}/${i2}`);
  }

  return lines.join('\n');
}

module.exports = { convertMeshToObj };
