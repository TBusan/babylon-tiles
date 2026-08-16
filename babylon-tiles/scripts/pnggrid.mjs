// Sample a grid of points from a PNG, print average color per region.
// Usage: node pnggrid.mjs <file> [rows] [cols]
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

function decodePNG(buf) {
	// parse chunks
	let pos = 8;
	let w = 0,
		h = 0,
		bitDepth,
		colorType,
		idat = [];
	while (pos < buf.length) {
		const len = buf.readUInt32BE(pos);
		const type = buf.toString('ascii', pos + 4, pos + 8);
		const data = buf.subarray(pos + 8, pos + 8 + len);
		if (type === 'IHDR') {
			w = data.readUInt32BE(0);
			h = data.readUInt32BE(4);
			bitDepth = data[8];
			colorType = data[9];
		}
		if (type === 'IDAT') idat.push(data);
		pos += 12 + len;
	}
	const raw = inflateSync(Buffer.concat(idat));
	const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
	const stride = w * bpp;
	const out = Buffer.alloc(h * stride);
	let src = 0;
	const paeth = (a, b, c) => {
		const p = a + b - c,
			pa = Math.abs(p - a),
			pb = Math.abs(p - b),
			pc = Math.abs(p - c);
		return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
	};
	for (let y = 0; y < h; y++) {
		const filter = raw[src++];
		const row = y * stride;
		for (let x = 0; x < stride; x++) {
			const cur = raw[src++];
			const a = x >= bpp ? out[row + x - bpp] : 0;
			const b = y > 0 ? out[row - stride + x] : 0;
			const c = x >= bpp && y > 0 ? out[row - stride + x - bpp] : 0;
			let v;
			switch (filter) {
				case 0:
					v = cur;
					break;
				case 1:
					v = cur + a;
					break;
				case 2:
					v = cur + b;
					break;
				case 3:
					v = cur + Math.floor((a + b) / 2);
					break;
				case 4:
					v = cur + paeth(a, b, c);
					break;
				default:
					v = cur;
			}
			out[row + x] = v & 0xff;
		}
	}
	return { w, h, data: out, bpp };
}

const file = process.argv[2];
const R = parseInt(process.argv[3] || '8', 10);
const C = parseInt(process.argv[4] || '12', 10);
const { w, h, data, bpp } = decodePNG(readFileSync(file));
const cellW = Math.floor(w / C),
	cellH = Math.floor(h / R);
console.log(`${file}: ${w}x${h}`);
for (let r = 0; r < R; r++) {
	let line = '';
	for (let c = 0; c < C; c++) {
		let rr = 0,
			gg = 0,
			bb = 0,
			n = 0;
		const y0 = r * cellH,
			x0 = c * cellW;
		for (let y = y0; y < y0 + cellH && y < h; y += 2) {
			for (let x = x0; x < x0 + cellW && x < w; x += 2) {
				const i = (y * w + x) * bpp;
				rr += data[i];
				gg += data[i + 1];
				bb += data[i + 2];
				n++;
			}
		}
		rr = Math.round(rr / n);
		gg = Math.round(gg / n);
		bb = Math.round(bb / n);
		line += ` ${String(rr).padStart(3)},${String(gg).padStart(3)},${String(bb).padStart(3)} |`;
	}
	console.log(line);
}
