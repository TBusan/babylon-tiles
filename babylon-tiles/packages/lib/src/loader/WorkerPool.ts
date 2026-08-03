/**
 * @description: Web Worker 池化管理器
 * 复用 Worker 实例避免频繁创建/销毁的开销
 * 支持任务队列、Transferable 零拷贝传输、优雅关闭
 */

/** 池化任务描述 */
interface PoolTask {
	/** 发送给 Worker 的数据 */
	data: any;
	/** Transferable 对象列表（零拷贝传输） */
	transfer?: Transferable[];
	/** 成功回调 */
	resolve: (result: any) => void;
	/** 失败回调 */
	reject: (error: any) => void;
}

/**
 * Worker 池
 * 管理固定数量的 Worker 实例，自动分配任务到空闲 Worker
 *
 * 使用示例：
 * ```ts
 * const pool = new WorkerPool(workerCode, 4);
 * const result = await pool.execute(imageData, [imageData.buffer]);
 * pool.dispose();
 * ```
 */
export class WorkerPool {
	/** 池大小 */
	private readonly _poolSize: number;

	/** Worker 实例数组 */
	private readonly _workers: Worker[] = [];

	/** 空闲 Worker 队列 */
	private readonly _idleWorkers: Worker[] = [];

	/** 等待执行的任务队列 */
	private readonly _taskQueue: PoolTask[] = [];

	/** Worker → 当前任务映射 */
	private readonly _activeTasks: Map<Worker, PoolTask> = new Map();

	/** Worker Blob URL（用于释放） */
	private readonly _blobUrl: string;

	/** 是否已销毁 */
	private _disposed = false;

	/** 已完成任务计数 */
	private _completedCount = 0;

	/**
	 * @param workerCode Worker 内联代码字符串
	 * @param poolSize 池大小（默认 4，建议不超过 CPU 核心数）
	 */
	constructor(workerCode: string, poolSize: number = 4) {
		this._poolSize = Math.max(1, Math.min(poolSize, 16));
		this._blobUrl = URL.createObjectURL(
			new Blob([workerCode], { type: 'application/javascript' })
		);

		// 预创建所有 Worker
		for (let i = 0; i < this._poolSize; i++) {
			const worker = new Worker(this._blobUrl);
			this._workers.push(worker);
			this._idleWorkers.push(worker);
		}
	}

	/**
	 * 获取当前空闲 Worker 数量
	 */
	public get idleCount(): number {
		return this._idleWorkers.length;
	}

	/**
	 * 获取等待队列中的任务数量
	 */
	public get pendingCount(): number {
		return this._taskQueue.length;
	}

	/**
	 * 获取已完成任务总数
	 */
	public get completedCount(): number {
		return this._completedCount;
	}

	/**
	 * 提交任务到 Worker 池
	 * 如果有空闲 Worker 立即执行，否则加入队列等待
	 *
	 * @param data 发送给 Worker 的数据
	 * @param transfer Transferable 对象（可选，零拷贝传输）
	 * @returns Promise 任务结果
	 */
	public execute(data: any, transfer?: Transferable[]): Promise<any> {
		if (this._disposed) {
			return Promise.reject(new Error('WorkerPool has been disposed'));
		}

		return new Promise((resolve, reject) => {
			const task: PoolTask = { data, transfer, resolve, reject };

			if (this._idleWorkers.length > 0) {
				this._runTask(task);
			} else {
				this._taskQueue.push(task);
			}
		});
	}

	/**
	 * 在空闲 Worker 上执行任务
	 */
	private _runTask(task: PoolTask): void {
		const worker = this._idleWorkers.pop()!;
		this._activeTasks.set(worker, task);

		// 设置一次性消息处理
		const onMessage = (e: MessageEvent) => {
			cleanup();
			this._completedCount++;
			task.resolve(e.data);
			this._returnWorker(worker);
		};

		const onError = (e: ErrorEvent) => {
			cleanup();
			task.reject(e);
			this._returnWorker(worker);
		};

		const cleanup = () => {
			worker.removeEventListener('message', onMessage);
			worker.removeEventListener('error', onError);
			this._activeTasks.delete(worker);
		};

		worker.addEventListener('message', onMessage);
		worker.addEventListener('error', onError);

		// 发送数据（支持 Transferable 零拷贝）
		if (task.transfer && task.transfer.length > 0) {
			worker.postMessage(task.data, task.transfer);
		} else {
			worker.postMessage(task.data);
		}
	}

	/**
	 * Worker 完成任务后归还到空闲池
	 * 如果队列中有等待任务，立即分配
	 */
	private _returnWorker(worker: Worker): void {
		if (this._disposed) return;

		if (this._taskQueue.length > 0) {
			const nextTask = this._taskQueue.shift()!;
			this._activeTasks.set(worker, nextTask);

			// 直接执行下一个任务（不经过 _runTask 以避免重复 pop）
			const onMessage = (e: MessageEvent) => {
				worker.removeEventListener('message', onMessage);
				worker.removeEventListener('error', onError);
				this._activeTasks.delete(worker);
				this._completedCount++;
				nextTask.resolve(e.data);
				this._returnWorker(worker);
			};

			const onError = (e: ErrorEvent) => {
				worker.removeEventListener('message', onMessage);
				worker.removeEventListener('error', onError);
				this._activeTasks.delete(worker);
				nextTask.reject(e);
				this._returnWorker(worker);
			};

			worker.addEventListener('message', onMessage);
			worker.addEventListener('error', onError);

			if (nextTask.transfer && nextTask.transfer.length > 0) {
				worker.postMessage(nextTask.data, nextTask.transfer);
			} else {
				worker.postMessage(nextTask.data);
			}
		} else {
			this._idleWorkers.push(worker);
		}
	}

	/**
	 * 销毁 Worker 池
	 * 终止所有 Worker，拒绝队列中的等待任务，释放 Blob URL
	 */
	public dispose(): void {
		if (this._disposed) return;
		this._disposed = true;

		// 拒绝所有等待中的任务
		for (const task of this._taskQueue) {
			task.reject(new Error('WorkerPool disposed while task was pending'));
		}
		this._taskQueue.length = 0;

		// 终止所有 Worker
		for (const worker of this._workers) {
			worker.terminate();
		}
		this._workers.length = 0;
		this._idleWorkers.length = 0;
		this._activeTasks.clear();

		// 释放 Blob URL
		URL.revokeObjectURL(this._blobUrl);
	}
}

/**
 * 地形解析专用 Worker 池（单例）
 * 内联 Terrain-RGB 解析代码，避免额外文件依赖
 */
export class TerrainWorkerPool {
	private static _instance: WorkerPool | null = null;

	/** 内联 Worker 代码：解析 Terrain-RGB 图像数据为高程数组 */
	private static readonly _workerCode = `
		self.onmessage = function(e) {
			const imgData = e.data;
			const pixelCount = imgData.length >>> 2;
			const p = Math.floor(Math.sqrt(pixelCount));

			if (p * p !== pixelCount) {
				const dem = new Float32Array(pixelCount);
				for (let i = 0; i < pixelCount; i++) {
					const index = i * 4;
					const a = imgData[index + 3];
					if (a === 0) {
						dem[i] = 0;
					} else {
						dem[i] = -10000 + (((imgData[index] << 16) | (imgData[index + 1] << 8) | imgData[index + 2]) * 0.1);
					}
				}
				self.postMessage(dem, [dem.buffer]);
				return;
			}

			// 与 TerrainRGBParser.parse 一致：p×p 上采样为 (p+1)×(p+1)，复制南/东缘，
			// 使网格为 2^n+1（Martini 兼容）且相邻瓦片边缘高度一致。
			const dem = new Float32Array((p + 1) * (p + 1));
			for (let i = 0; i < pixelCount; i++) {
				const r = Math.floor(i / p);
				const c = i - r * p;
				const index = i * 4;
				const a = imgData[index + 3];
				dem[r * (p + 1) + c] = (a === 0)
					? 0
					: -10000 + (((imgData[index] << 16) | (imgData[index + 1] << 8) | imgData[index + 2]) * 0.1);
			}
			for (let c = 0; c < p; c++) dem[p * (p + 1) + c] = dem[(p - 1) * (p + 1) + c];
			for (let r = 0; r < p; r++) dem[r * (p + 1) + p] = dem[r * (p + 1) + (p - 1)];
			dem[p * (p + 1) + p] = dem[(p - 1) * (p + 1) + (p - 1)];
			self.postMessage(dem, [dem.buffer]);
		};
	`;

	/**
	 * 获取全局地形解析 Worker 池实例
	 * @param poolSize 池大小（首次调用时生效，默认 4）
	 */
	public static getInstance(poolSize: number = 4): WorkerPool {
		if (!TerrainWorkerPool._instance) {
			TerrainWorkerPool._instance = new WorkerPool(
				TerrainWorkerPool._workerCode,
				poolSize
			);
		}
		return TerrainWorkerPool._instance;
	}

	/**
	 * 在 Worker 中解析 Terrain-RGB 图像数据
	 * @param imgData RGBA 像素数据
	 * @returns 高程数组 Float32Array
	 */
	public static async parse(imgData: Uint8ClampedArray): Promise<Float32Array> {
		const pool = TerrainWorkerPool.getInstance();
		// 复制数据（因为 Transferable 会转移所有权）
		const buffer = imgData.buffer.slice(0);
		return pool.execute(new Uint8ClampedArray(buffer), [buffer]);
	}

	/**
	 * 销毁全局实例
	 */
	public static dispose(): void {
		if (TerrainWorkerPool._instance) {
			TerrainWorkerPool._instance.dispose();
			TerrainWorkerPool._instance = null;
		}
	}
}
