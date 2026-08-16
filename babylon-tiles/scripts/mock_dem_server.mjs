// Mock Mapbox Terrain-RGB DEM server for local verification (no token needed).
// Serves /{z}/{x}/{y}.png as 256x256 Terrain-RGB PNGs with a gaussian mountain
// centered at the demo camera target (104E 35N). Uses WEB MERCATOR tile y->lat
// (map runs EPSG:3857 because GDSource.projectionID='3857'), NOT linear lat.
import http from 'node:http';
import zlib from 'node:zlib';

const PORT = 9009;
const CX = 104.0,
	CY = 35.0,
	AMP = 3000,
	SIG = 0.4;

// elevation in meters for a (lon, lat) — gaussian bump
function elev(lon, lat) {
	const d2 = ((lon - CX) * (lon - CX) + (lat - CY) * (lat - CY)) / (2 * SIG * SIG);
	return Math.round(AMP * Math.exp(-d2));
}

// Terrain-RGB encode: height = -10000 + ((R<<16|G<<8|B) * 0.1)
function encodeRGB(h) {
	const v = Math.max(0, Math.min(255 * 65536 + 255 * 256 + 255, Math.round((h + 10000) * 10)));
	return [v >> 16, (v >> 8) & 0xff, v & 0xff];
}

// Minimal PNG encoder (8-bit RGB, filter 0)
function pngEncode(pixels /* Uint8Array w*h*3 */, w, h) {
	const raw = Buffer.alloc(h * (1 + w * 3));
	for (let y = 0; y < h; y++) {
		raw[y * (1 + w * 3)] = 0; // filter: none
		raw.set(pixels.subarray(y * w * 3, (y + 1) * w * 3), y * (1 + w * 3) + 1);
	}
	const idat = zlib.deflateSync(raw);

	const chunk = (type, data) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length, 0);
		const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
		const crc = Buffer.alloc(4);
		let c = 0xffffffff;
		for (const b of td) {
			c ^= b;
			for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
		}
		crc.writeUInt32BE((c ^ 0xffffffff) >>> 0, 0);
		return Buffer.concat([len, td, crc]);
	};

	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	ihdr[10] = 0;
	ihdr[11] = 0;
	ihdr[12] = 0;
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', idat),
		chunk('IEND', Buffer.alloc(0)),
	]);
}

function tilePng(z, x, y) {
	const N = 256;
	const px = new Uint8Array(N * N * 3);
	const n = Math.pow(2, z);
	// Web Mercator tile y -> latitude (map is EPSG:3857)
	const mercN = Math.PI * (1 - (2 * y) / n);
	const mercS = Math.PI * (1 - (2 * (y + 1)) / n);
	const latTop = (180 / Math.PI) * (2 * Math.atan(Math.exp(mercN)) - Math.PI / 2);
	const latBot = (180 / Math.PI) * (2 * Math.atan(Math.exp(mercS)) - Math.PI / 2);
	const tileLon = (x / n) * 360 - 180;
	const lonSpan = 360 / n; // degrees of longitude per tile
	for (let py = 0; py < N; py++) {
		const lat = latTop - ((py + 0.5) / N) * (latTop - latBot);
		for (let pxi = 0; pxi < N; pxi++) {
			const lon = tileLon + ((pxi + 0.5) / N) * lonSpan;
			const [r, g, b] = encodeRGB(elev(lon, lat));
			const o = (py * N + pxi) * 3;
			px[o] = r;
			px[o + 1] = g;
			px[o + 2] = b;
		}
	}
	return pngEncode(px, N, N);
}

const server = http.createServer((req, res) => {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Cache-Control', 'no-store');
	const m = /^\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(req.url || '');
	if (!m) {
		res.writeHead(404);
		res.end('not found');
		return;
	}
	const [, zs, xs, ys] = m.map(Number);
	const z = Math.min(zs, 14); // only serve up to z=14 like real raster-dem
	const buf = tilePng(z, xs, ys);
	res.writeHead(200, { 'Content-Type': 'image/png' });
	res.end(buf);
	console.log(`serve z=${zs} x=${xs} y=${ys} (bytes=${buf.length})`);
});

server.listen(PORT, () => console.log(`Mock DEM server on :${PORT}`));
