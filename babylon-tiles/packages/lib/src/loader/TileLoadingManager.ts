/**
 * @description: Tile Loading Manager
 * @author: Babylon Tiles
 * @date: 2025-10-21
 */

/**
 * Tile loading manager
 * Manages the loading queue and concurrent loading threads
 */
export class TileLoadingManager {
  private _loading = 0;
  private _loaded = 0;
  private _total = 0;

  /** Get number of items currently loading */
  public get loading(): number {
    return this._loading;
  }

  /** Get number of items loaded */
  public get loaded(): number {
    return this._loaded;
  }

  /** Get total number of items */
  public get total(): number {
    return this._total;
  }

  /** Callback when an item starts loading */
  public onStart?: (url: string, loaded: number, total: number) => void;

  /** Callback when an item finishes loading */
  public onLoad?: () => void;

  /** Callback during loading progress */
  public onProgress?: (url: string, loaded: number, total: number) => void;

  /** Callback on loading error */
  public onError?: (url: string) => void;

  /**
   * Add item to loading queue
   */
  public itemStart(url: string): void {
    this._total++;
    this._loading++;
    this.onStart?.(url, this._loaded, this._total);
  }

  /**
   * Mark item as loaded
   */
  public itemEnd(url: string): void {
    this._loading--;
    this._loaded++;
    this.onProgress?.(url, this._loaded, this._total);

    if (this._loading === 0) {
      this.onLoad?.();
    }
  }

  /**
   * Mark item as error
   */
  public itemError(url: string): void {
    this._loading--;
    this.onError?.(url);

    if (this._loading === 0) {
      this.onLoad?.();
    }
  }

  /**
   * Reset manager
   */
  public reset(): void {
    this._loading = 0;
    this._loaded = 0;
    this._total = 0;
  }
}

