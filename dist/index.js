"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisStore = exports.StoreNamespace = void 0;
exports.defineObj = defineObj;
exports.defineHashOf = defineHashOf;
exports.defineHashOfCounters = defineHashOfCounters;
exports.defineCounter = defineCounter;
const redis_1 = require("redis");
/**
 * safe-redis-schema
 *
 * Type-safe, validated data schemas layered over Redis. Schema definitions
 * (`defineObj`, `defineHashOf`, `defineCounter`, `defineHashOfCounters`) pair a
 * Redis key with a `safe-portals` serializer so reads and writes are validated
 * at the boundary rather than trusted blindly.
 *
 * This is the v2 line, built against the promise-native node-redis v6 client.
 * The v1 line wrapped node-redis v3's callback API in hand-rolled promises;
 * against a promise-native client those wrappers collapse into thin `await`
 * passthroughs. The public contracts are unchanged from v1:
 *
 * - `Store.get` JSON-decodes the stored value and resolves `undefined` (never
 *   `null`) for a missing key.
 * - `Store.set` JSON-encodes the value and resolves `true`.
 * - `Store.hget` resolves the raw stored string (or `null` when absent) — JSON
 *   decoding for hashes happens one layer up, in `defineHashOf`.
 * - counters resolve plain numbers.
 *
 * The one deliberate change from v1: node-redis v6 clients do not auto-connect,
 * so `RedisStore` connects lazily on first use (and exposes an explicit
 * `connect()`), and `del` now returns a `Promise` so callers can await the
 * round-trip instead of it being fire-and-forget.
 */
function defineObj(store, key, type) {
    store.markKeyAsUsed(key);
    return {
        get: async () => {
            return store.get(key).then(v => type.read(v));
        },
        set: async (val, expirySeconds) => {
            return store.set(key, type.write(val), expirySeconds);
        },
        del: async () => {
            return store.del(key);
        }
    };
}
function defineHashOf(store, key, type) {
    store.markKeyAsUsed(key);
    return {
        hget: async (hkey) => {
            return store.hget(key, hkey).then(v => type.read(JSON.parse(v)));
        },
        hset: async (hkey, val) => {
            return store.hset(key, hkey, JSON.stringify(type.write(val)));
        },
        hdel: async (hkey) => {
            return store.hdel(key, hkey);
        },
        del: async () => {
            return store.del(key);
        }
    };
}
function defineHashOfCounters(store, key) {
    store.markKeyAsUsed(key);
    return {
        get: async (hkey) => {
            return store.hget(key, hkey).then(v => parseInt(v) || 0);
        },
        incrby: async (hkey, val) => {
            return store.hincrby(key, hkey, val);
        },
        zero: async (hkey) => {
            return store.hdel(key, hkey);
        },
        del: async () => {
            return store.del(key);
        }
    };
}
function defineCounter(store, key) {
    store.markKeyAsUsed(key);
    return {
        incrby: async (val) => {
            return store.incrby(key, val);
        },
        get: async () => {
            return store.get(key).then(v => parseInt(v) || 0);
        },
        zero: async () => {
            return store.del(key);
        }
    };
}
class StoreNamespace {
    constructor(store, prefix) {
        this.store = store;
        this.prefix = prefix;
    }
    getRawConnection() {
        return this.store.getRawConnection();
    }
    get(key) { return this.store.get(this.prefix + key); }
    set(key, value, expirySeconds) {
        return this.store.set(this.prefix + key, value, expirySeconds);
    }
    del(key) {
        return this.store.del(this.prefix + key);
    }
    // atomically increment a counter, and return the new value. if the key
    // does not exist then this operation will set the counter to `val`
    incrby(key, val) {
        return this.store.incrby(this.prefix + key, val);
    }
    hget(key, hash) {
        return this.store.hget(this.prefix + key, hash);
    }
    hset(key, hash, value) {
        return this.store.hset(this.prefix + key, hash, value);
    }
    hdel(key, hash) {
        return this.store.hdel(this.prefix + key, hash);
    }
    hincrby(key, hash, val) {
        return this.store.hincrby(this.prefix + key, hash, val);
    }
    namespacedBy(namespacePrefix) {
        return new StoreNamespace(this.store, this.prefix + namespacePrefix);
    }
    getPrefix() {
        return this.prefix;
    }
    markKeyAsUsed(key) {
        this.store.markKeyAsUsed(this.prefix + key);
    }
    isUsed(key) {
        return this.store.isUsed(this.prefix + key);
    }
}
exports.StoreNamespace = StoreNamespace;
class RedisStore {
    constructor(client_or_connection_string) {
        if (typeof client_or_connection_string === "string") {
            this.db = (0, redis_1.createClient)({ url: client_or_connection_string });
        }
        else {
            this.db = client_or_connection_string;
        }
        this.schemata = new Set([]);
    }
    /**
     * Ensure the underlying client is connected. Idempotent and safe to call
     * concurrently — v6 clients do not auto-connect and throw if `connect()` runs
     * twice, so the in-flight promise is cached and an already-open client is a
     * no-op. Every command below awaits this first, so callers never have to
     * connect explicitly; a caller that wants the connection established up front
     * (e.g. before handing `getRawConnection()` to another library) can await it
     * directly.
     */
    async connect() {
        if (this.db.isOpen)
            return;
        if (!this.connecting)
            this.connecting = this.db.connect();
        await this.connecting;
    }
    /**
     * Synchronously tear down the socket. v6 renamed v3's `end(true)` to
     * `destroy()`; both drop the connection immediately without waiting for a
     * server reply, which is what jest teardown relies on to avoid a leaked open
     * handle. Guarded on `isOpen` because `destroy()` throws on a client that
     * never connected.
     */
    close() {
        if (this.db.isOpen)
            this.db.destroy();
    }
    markKeyAsUsed(key) {
        if (this.schemata.has(key)) {
            throw new Error(`Schema key already used: ${key}`);
        }
        else {
            this.schemata.add(key);
        }
    }
    isUsed(key) {
        return this.schemata.has(key);
    }
    getRawConnection() {
        return this.db;
    }
    getPrefix() {
        return '';
    }
    namespacedBy(namespacePrefix) {
        return new StoreNamespace(this, namespacePrefix);
    }
    async incrby(key, val) {
        await this.connect();
        return this.db.incrBy(key, val);
    }
    async hget(key, hash) {
        await this.connect();
        // Normalise the v6 "field absent" reply to null: v1 (node-redis v3)
        // resolved null here, and defineHashOf feeds this straight into
        // JSON.parse — JSON.parse(null) yields null, JSON.parse(undefined) throws.
        return (await this.db.hGet(key, hash)) ?? null;
    }
    async hset(key, hash, val) {
        await this.connect();
        await this.db.hSet(key, hash, val);
    }
    async hdel(key, hash) {
        await this.connect();
        await this.db.hDel(key, hash);
    }
    /**
     * increment field in a hash by val
     */
    async hincrby(key, hash, val) {
        await this.connect();
        return this.db.hIncrBy(key, hash, val);
    }
    async get(key) {
        await this.connect();
        const value = await this.db.get(key);
        return value ? JSON.parse(value) : undefined;
    }
    async set(key, value, expirySeconds) {
        await this.connect();
        if (expirySeconds === undefined) {
            await this.db.set(key, JSON.stringify(value));
        }
        else {
            await this.db.set(key, JSON.stringify(value), { EX: expirySeconds });
        }
        return true;
    }
    async del(key) {
        await this.connect();
        await this.db.del(key);
    }
}
exports.RedisStore = RedisStore;
