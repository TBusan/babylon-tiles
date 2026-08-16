/**
 * @description: IndexedDB 持久化资源缓存
 * @author: Babylon-Tile Team
 *
 * 对齐 three-tile indexDBCache，但**不 patch 任何全局 Cache**：
 * lib 的 TextureCache 管理 GPU 纹理（不可序列化到 IndexedDB），本插件是
 * 独立的浏览器持久化缓存层，用于缓存可序列化资源（ArrayBuffer / Blob /
 * 图片 dataURL 等），由调用方按需 cacheSet/cacheGet。
 */

const DB_NAME = 'babylon_tile_cache';
const STORE_NAME = 'files';

let db: IDBDatabase | null = null;
let enabled = false;

/**
 * 开启 IndexedDB 缓存
 * @returns db 实例
 */
export async function IndexDBCacheEable(): Promise<IDBDatabase> {
	enabled = true;
	if (db) return db;
	db = await initDB();
	return db;
}

/**
 * 是否已开启 IndexedDB 缓存
 */
export function isIndexDBCacheEnabled(): boolean {
	return enabled;
}

/**
 * 写入缓存（HTMLImageElement 会先转为 dataURL 存储）
 * @param key - 缓存键
 * @param file - 可序列化数据或图片
 */
export async function cacheSet(key: string, file: unknown): Promise<void> {
	if (!enabled || db === null) return;

	let data: unknown = file;
	if (file instanceof HTMLImageElement) {
		const canvas = document.createElement('canvas');
		canvas.width = file.naturalWidth;
		canvas.height = file.naturalHeight;
		const ctx = canvas.getContext('2d');
		ctx?.drawImage(file, 0, 0);
		data = {
			__type: 'HTMLImageElement',
			dataURL: canvas.toDataURL(),
		};
	}

	const store = await getStore('readwrite');
	return new Promise<void>((resolve, reject) => {
		const request = store.put({ key, file: data });
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
	});
}

/**
 * 读取缓存
 * 注：与 three-tile 不同，这里是**异步**的（IndexedDB 本身是异步 API，
 * three-tile 的同步 Cache.get 在读取完成前必然返回 undefined）。
 * @param key - 缓存键
 * @returns 缓存数据；未命中返回 undefined
 */
export async function cacheGet(key: string): Promise<unknown> {
	if (!enabled || db === null) return undefined;

	const store = await getStore('readonly');
	return new Promise<unknown>((resolve, reject) => {
		const request = store.get(key);
		request.onsuccess = () => {
			const result = request.result;
			let data: unknown = result?.file;
			if (data && (data as { __type?: string }).__type === 'HTMLImageElement') {
				const img = new Image();
				img.src = (data as { dataURL: string }).dataURL;
				data = img;
			}
			resolve(data);
		};
		request.onerror = () => reject(request.error);
	});
}

/**
 * 移除缓存
 * @param key - 缓存键
 */
export async function cacheRemove(key: string): Promise<void> {
	if (!enabled || db === null) return;

	const store = await getStore('readwrite');
	return new Promise<void>((resolve, reject) => {
		const request = store.delete(key);
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
	});
}

/**
 * 清空缓存
 */
export async function cacheClear(): Promise<void> {
	if (!enabled || db === null) return;

	const store = await getStore('readwrite');
	return new Promise<void>((resolve, reject) => {
		const request = store.clear();
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
	});
}

/**
 * 初始化数据库
 */
function initDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 1);

		request.onupgradeneeded = (event) => {
			const database = (event.target as IDBOpenDBRequest).result;
			if (!database.objectStoreNames.contains(STORE_NAME)) {
				database.createObjectStore(STORE_NAME, { keyPath: 'key' });
			}
		};

		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

/**
 * 获取 object store（未开启时抛错）
 */
async function getStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
	if (!enabled || db === null) {
		throw new Error('IndexDBCache not enabled, call IndexDBCacheEable() first!');
	}
	return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}
