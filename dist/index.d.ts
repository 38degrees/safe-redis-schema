import { RedisClientType } from "redis";
import * as Safe from "safe-portals";
/**
 * A node-redis client type that doesn't pin the RESP protocol version. The bare
 * `RedisClientType` alias defaults to RESP3; a client created with `{ RESP: 2 }`
 * (needed to talk to a Redis server < 6) has a different, invariant type and
 * would not be assignable to it. Widening the generics keeps both RESP2 and
 * RESP3 clients assignable while preserving the standard command signatures.
 */
export type AnyRedisClient = RedisClientType<any, any, any, any, any>;
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
export declare function defineObj<T>(store: Store, key: string, type: Safe.Type<T>): {
    get: () => Promise<T>;
    set: (val: T, expirySeconds?: number) => Promise<boolean>;
    del: () => Promise<void>;
};
export declare function defineHashOf<T>(store: Store, key: string, type: Safe.Type<T>): {
    hget: (hkey: string) => Promise<T>;
    hset: (hkey: string, val: T) => Promise<void>;
    hdel: (hkey: string) => Promise<void>;
    del: () => Promise<void>;
};
export declare function defineHashOfCounters(store: Store, key: string): {
    get: (hkey: string) => Promise<number>;
    incrby: (hkey: string, val: number) => Promise<number>;
    zero: (hkey: string) => Promise<void>;
    del: () => Promise<void>;
};
export declare function defineCounter(store: Store, key: string): {
    get: () => Promise<number>;
    incrby: (val: number) => Promise<number>;
    zero: () => Promise<void>;
};
export interface Store {
    /**
     * promise-wrapped raw redis
     */
    get(key: string): Promise<any>;
    set(key: string, value: any, expirySeconds?: number): Promise<boolean>;
    del(key: string): Promise<void>;
    incrby(key: string, val: number): Promise<number>;
    hget(key: string, hash: string): Promise<any>;
    hset(key: string, hash: string, value: string): Promise<void>;
    hdel(key: string, hash: string): Promise<void>;
    hincrby(key: string, hash: string, val: number): Promise<number>;
    getRawConnection(): AnyRedisClient;
    namespacedBy(namespacePrefix: string): StoreNamespace;
    getPrefix(): string;
    markKeyAsUsed(key: string): void;
    isUsed(key: string): boolean;
}
export declare class StoreNamespace implements Store {
    prefix: string;
    store: Store;
    constructor(store: Store, prefix: string);
    getRawConnection(): AnyRedisClient;
    get(key: string): Promise<any>;
    set(key: string, value: any, expirySeconds?: number): Promise<boolean>;
    del(key: string): Promise<void>;
    incrby(key: string, val: number): Promise<number>;
    hget(key: string, hash: string): Promise<any>;
    hset(key: string, hash: string, value: string): Promise<void>;
    hdel(key: string, hash: string): Promise<void>;
    hincrby(key: string, hash: string, val: number): Promise<number>;
    namespacedBy(namespacePrefix: string): StoreNamespace;
    getPrefix(): string;
    markKeyAsUsed(key: string): void;
    isUsed(key: string): boolean;
}
export declare class RedisStore implements Store {
    db: AnyRedisClient;
    schemata: Set<string>;
    /**
     * Cached in-flight connect, so concurrent first commands share one
     * `connect()` (node-redis throws if `connect()` is called on an
     * already-connecting client).
     */
    private connecting;
    constructor(client_or_connection_string: AnyRedisClient | string);
    /**
     * Ensure the underlying client is connected. Idempotent and safe to call
     * concurrently — v6 clients do not auto-connect and throw if `connect()` runs
     * twice, so the in-flight promise is cached and an already-open client is a
     * no-op. Every command below awaits this first, so callers never have to
     * connect explicitly; a caller that wants the connection established up front
     * (e.g. before handing `getRawConnection()` to another library) can await it
     * directly.
     */
    connect(): Promise<void>;
    /**
     * Synchronously tear down the socket. v6 renamed v3's `end(true)` to
     * `destroy()`; both drop the connection immediately without waiting for a
     * server reply, which is what jest teardown relies on to avoid a leaked open
     * handle. Guarded on `isOpen` because `destroy()` throws on a client that
     * never connected.
     */
    close(): void;
    markKeyAsUsed(key: string): void;
    isUsed(key: string): boolean;
    getRawConnection(): AnyRedisClient;
    getPrefix(): string;
    namespacedBy(namespacePrefix: string): StoreNamespace;
    incrby(key: string, val: number): Promise<number>;
    hget(key: string, hash: string): Promise<any>;
    hset(key: string, hash: string, val: string): Promise<void>;
    hdel(key: string, hash: string): Promise<void>;
    /**
     * increment field in a hash by val
     */
    hincrby(key: string, hash: string, val: number): Promise<number>;
    get(key: string): Promise<any>;
    set(key: string, value: any, expirySeconds?: number): Promise<boolean>;
    del(key: string): Promise<void>;
}
