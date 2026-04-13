class LRUCache {
    max: number;
    ttl: number;
    map: Map<string, { value: any; expires: number | null }>;
    onEvict?: (key: string, value: any) => void;

    constructor({ max = 100, ttl = 6 * 3600 * 1000 } = {}) {
        this.max = max;
        this.ttl = ttl;
        this.map = new Map();
    }

    _now() { return Date.now(); }

    get(key: string) {
        if (!this.map.has(key)) return undefined;
        const entry = this.map.get(key)!;
        if (entry.expires && entry.expires < this._now()) {
            this.map.delete(key);
            return undefined;
        }
        // Promote (LRU)
        this.map.delete(key);
        this.map.set(key, entry);
        return entry.value;
    }

    set(key: string, value: any) {
        if (this.map.has(key)) this.map.delete(key);
        this.map.set(key, { value, expires: this.ttl ? this._now() + this.ttl : null });
        // Evict LRU
        if (this.map.size > this.max) {
            const oldestKey = this.map.keys().next().value;
            const oldestEntry = this.map.get(oldestKey)!;
            this.map.delete(oldestKey);
            this.onEvict?.(oldestKey, oldestEntry.value);
        }
    }

    delete(key: string) {
        this.map.delete(key);
    }

    has(key: string) {
        return this.get(key) !== undefined;
    }

    keys() {
        return Array.from(this.map.keys());
    }

    clear() {
        this.map.clear();
    }

    /**
     * Returns the raw map size, including TTL-expired entries not yet lazy-evicted.
     * Use as an upper-bound estimate of live entries, not an exact count.
     */
    getSize(): number {
        return this.map.size;
    }

    evictLeastRecentlyUsed(n: number): number {
        if (n <= 0) return 0;
        // Map maintains insertion order; LRU entries are at the front.
        // Promote-on-get moves accessed entries to the end, so front = oldest.
        // Snapshot keys to avoid mutating the map while iterating.
        const keys = Array.from(this.map.keys());
        let evicted = 0;
        for (const key of keys) {
            if (evicted >= n) break;
            const entry = this.map.get(key)!;
            this.map.delete(key);
            this.onEvict?.(key, entry.value);
            evicted++;
        }
        return evicted;
    }
}

export default LRUCache;
