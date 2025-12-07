/**
 * Enhanced Caching Middleware using node-cache
 * Production-ready, high-performance caching
 * No external services, no API keys required
 */

const NodeCache = require('node-cache');

// Create cache instance with configuration
const cache = new NodeCache({
    stdTTL: 300, // Default TTL: 5 minutes
    checkperiod: 60, // Check for expired keys every 60 seconds
    useClones: false, // Better performance (don't clone objects)
    deleteOnExpire: true, // Auto-delete expired keys
    maxKeys: 1000 // Maximum number of keys (prevent memory overflow)
});

// Log cache events
cache.on('set', (key, value) => {
    console.log(`📦 Cache SET: ${key}`);
});

cache.on('expired', (key, value) => {
    console.log(`⏰ Cache EXPIRED: ${key}`);
});

cache.on('flush', () => {
    console.log(`🗑️  Cache FLUSHED`);
});

/**
 * Cache middleware for Express routes
 * @param {number} duration - Cache duration in seconds (default: 300)
 */
const cacheMiddleware = (duration = 300) => {
    return (req, res, next) => {
        // Only cache GET requests
        if (req.method !== 'GET') {
            return next();
        }

        // Create cache key from URL and user ID (for user-specific caching)
        const userId = req.user?.id || 'anonymous';
        const key = `${req.originalUrl}:${userId}`;

        // Check cache
        const cached = cache.get(key);
        if (cached) {
            console.log(`✅ Cache HIT: ${key}`);
            return res.json(cached);
        }

        console.log(`❌ Cache MISS: ${key}`);

        // Store original res.json
        const originalJson = res.json.bind(res);

        // Override res.json to cache the response
        res.json = (data) => {
            // Only cache successful responses
            if (res.statusCode === 200) {
                cache.set(key, data, duration);
            }
            return originalJson(data);
        };

        next();
    };
};

/**
 * Invalidate cache by pattern (supports wildcards)
 * @param {string} pattern - Pattern to match (e.g., '/api/estates*')
 */
const invalidateCache = (pattern) => {
    const keys = cache.keys();
    let deleted = 0;

    // Convert pattern to regex
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));

    keys.forEach(key => {
        if (regex.test(key)) {
            cache.del(key);
            deleted++;
        }
    });

    if (deleted > 0) {
        console.log(`🗑️  Invalidated ${deleted} cache entries matching: ${pattern}`);
    }

    return deleted;
};

/**
 * Clear all cache
 */
const clearCache = () => {
    cache.flushAll();
    console.log('🗑️  All cache cleared');
    return true;
};

/**
 * Get cache statistics
 */
const getCacheStats = () => {
    return {
        keys: cache.keys().length,
        hits: cache.getStats().hits,
        misses: cache.getStats().misses,
        ksize: cache.getStats().ksize,
        vsize: cache.getStats().vsize
    };
};

/**
 * Manually set cache value
 */
const setCache = (key, value, ttl = 300) => {
    return cache.set(key, value, ttl);
};

/**
 * Manually get cache value
 */
const getCache = (key) => {
    return cache.get(key);
};

/**
 * Delete specific cache key
 */
const deleteCache = (key) => {
    return cache.del(key);
};

module.exports = {
    cache: cacheMiddleware,
    invalidateCache,
    clearCache,
    getCacheStats,
    setCache,
    getCache,
    deleteCache,
    cacheInstance: cache // Export instance for advanced usage
};
