/**
 * In-Memory Cache Middleware
 * Simple, fast caching without external dependencies
 * No Redis, no API keys required
 */

class MemoryCache {
    constructor() {
        this.cache = new Map();
        this.timers = new Map();
    }

    /**
     * Get value from cache
     */
    get(key) {
        const item = this.cache.get(key);
        if (!item) return null;

        // Check if expired
        if (item.expiresAt && Date.now() > item.expiresAt) {
            this.delete(key);
            return null;
        }

        return item.value;
    }

    /**
     * Set value in cache with TTL (time to live in seconds)
     */
    set(key, value, ttl = 300) {
        const expiresAt = ttl ? Date.now() + (ttl * 1000) : null;

        this.cache.set(key, {
            value,
            expiresAt,
            createdAt: Date.now()
        });

        // Auto-cleanup after TTL
        if (ttl) {
            if (this.timers.has(key)) {
                clearTimeout(this.timers.get(key));
            }

            const timer = setTimeout(() => {
                this.delete(key);
            }, ttl * 1000);

            this.timers.set(key, timer);
        }

        return true;
    }

    /**
     * Delete specific key
     */
    delete(key) {
        if (this.timers.has(key)) {
            clearTimeout(this.timers.get(key));
            this.timers.delete(key);
        }
        return this.cache.delete(key);
    }

    /**
     * Delete keys matching pattern
     */
    deletePattern(pattern) {
        const regex = new RegExp(pattern);
        let deleted = 0;

        for (const key of this.cache.keys()) {
            if (regex.test(key)) {
                this.delete(key);
                deleted++;
            }
        }

        return deleted;
    }

    /**
     * Clear all cache
     */
    clear() {
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
        this.cache.clear();
    }

    /**
     * Get cache stats
     */
    getStats() {
        return {
            size: this.cache.size,
            keys: Array.from(this.cache.keys())
        };
    }
}

// Create singleton instance
const memoryCache = new MemoryCache();

/**
 * Cache middleware for Express routes
 * @param {number} duration - Cache duration in seconds (default: 300 = 5 minutes)
 */
const cache = (duration = 300) => {
    return (req, res, next) => {
        // Only cache GET requests
        if (req.method !== 'GET') {
            return next();
        }

        // Create cache key from URL and query params
        const key = `cache:${req.originalUrl}`;

        // Check cache
        const cached = memoryCache.get(key);
        if (cached) {
            console.log(`✅ Cache HIT: ${key}`);
            return res.json(cached);
        }

        console.log(`❌ Cache MISS: ${key}`);

        // Store original res.json
        const originalJson = res.json.bind(res);

        // Override res.json to cache the response
        res.json = (data) => {
            memoryCache.set(key, data, duration);
            return originalJson(data);
        };

        next();
    };
};

/**
 * Invalidate cache by pattern
 */
const invalidateCache = (pattern) => {
    return memoryCache.deletePattern(pattern);
};

/**
 * Clear all cache
 */
const clearCache = () => {
    return memoryCache.clear();
};

/**
 * Get cache stats
 */
const getCacheStats = () => {
    return memoryCache.getStats();
};

module.exports = {
    cache,
    invalidateCache,
    clearCache,
    getCacheStats,
    memoryCache
};
