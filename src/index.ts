import { createClient, RedisClientType } from "redis";
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

export function defineObj<T>(
  store: Store,
  key: string,
  type: Safe.Type<T>
): { get: () => Promise<T>,
     set: (val: T, expirySeconds?: number) => Promise<boolean>,
     del: () => Promise<void> }
{
  store.markKeyAsUsed(key);

  return {
    get: async (): Promise<T> => {
      return store.get(key).then(v => type.read(v));
    },
    set: async (val: T, expirySeconds?: number): Promise<boolean> => {
      return store.set(key, type.write(val), expirySeconds);
    },
    del: async (): Promise<void> => {
      return store.del(key);
    }
  }
}

export function defineHashOf<T>(
  store: Store,
  key: string,
  type: Safe.Type<T>
): { hget: (hkey: string) => Promise<T>,
     hset: (hkey: string, val: T) => Promise<void>,
     hdel: (hkey: string) => Promise<void>,
     del: () => Promise<void> }
{
  store.markKeyAsUsed(key);

  return {
    hget: async (hkey: string): Promise<T> => {
      return store.hget(key, hkey).then(v => type.read(JSON.parse(v)));
    },
    hset: async (hkey: string, val: T): Promise<void> => {
      return store.hset(key, hkey, JSON.stringify(type.write(val)));
    },
    hdel: async (hkey: string): Promise<void> => {
      return store.hdel(key, hkey);
    },
    del: async (): Promise<void> => {
      return store.del(key);
    }
  }
}

export function defineHashOfCounters(
  store: Store,
  key: string
): { get: (hkey: string) => Promise<number>,
     incrby: (hkey: string, val: number) => Promise<number>,
     zero: (hkey: string) => Promise<void>
     del: () => Promise<void> }
{
  store.markKeyAsUsed(key);

  return {
    get: async (hkey: string): Promise<number> => {
      return store.hget(key, hkey).then(v => parseInt(v) || 0);
    },
    incrby: async (hkey: string, val: number): Promise<number> => {
      return store.hincrby(key, hkey, val);
    },
    zero: async (hkey: string): Promise<void> => {
      return store.hdel(key, hkey);
    },
    del: async (): Promise<void> => {
      return store.del(key);
    }
  }
}

export function defineCounter(
  store: Store,
  key: string
): { get: () => Promise<number>,
     incrby: (val: number) => Promise<number>,
     zero: () => Promise<void> }
{
  store.markKeyAsUsed(key);

  return {
    incrby: async (val: number): Promise<number> => {
      return store.incrby(key, val);
    },
    get: async (): Promise<number> => {
      return store.get(key).then(v => parseInt(v) || 0);
    },
    zero: async(): Promise<void> => {
      return store.del(key);
    }
  }
}

export interface Store {
  /**
   * promise-wrapped raw redis
   */
  get(key: string): Promise<any>;
  set(key: string, value: any, expirySeconds?: number): Promise<boolean>;
  del(key: string): Promise<void>;
  // atomically increment a counter, and return the new value. if the key
  // does not exist then this operation will set the counter to 1
  incrby(key: string, val: number): Promise<number>;
  hget(key: string, hash: string): Promise<any>;
  hset(key: string, hash: string, value: string): Promise<void>;
  hdel(key: string, hash: string): Promise<void>;
  hincrby(key: string, hash: string, val: number): Promise<number>;

  getRawConnection(): AnyRedisClient;

  /* utils */
  namespacedBy(namespacePrefix: string): StoreNamespace;
  getPrefix(): string;
  markKeyAsUsed(key: string): void;
  isUsed(key: string): boolean;
}

export class StoreNamespace implements Store {
  prefix: string;
  store: Store;

  constructor(store: Store, prefix: string) {
    this.store = store;
    this.prefix = prefix;
  }

  getRawConnection() {
    return this.store.getRawConnection();
  }

  get(key: string) { return this.store.get(this.prefix + key); }
  set(key: string, value: any, expirySeconds?: number): Promise<boolean> {
    return this.store.set(this.prefix + key, value, expirySeconds);
  }
  del(key: string): Promise<void> {
    return this.store.del(this.prefix + key);
  }
  // atomically increment a counter, and return the new value. if the key
  // does not exist then this operation will set the counter to `val`
  incrby(key: string, val: number): Promise<number> {
    return this.store.incrby(this.prefix + key, val);
  }
  hget(key: string, hash: string): Promise<any> {
    return this.store.hget(this.prefix + key, hash);
  }
  hset(key: string, hash: string, value: string): Promise<void> {
    return this.store.hset(this.prefix + key, hash, value);
  }
  hdel(key: string, hash: string): Promise<void> {
    return this.store.hdel(this.prefix + key, hash);
  }
  hincrby(key: string, hash: string, val: number): Promise<number> {
    return this.store.hincrby(this.prefix + key, hash, val);
  }
  namespacedBy(namespacePrefix: string): StoreNamespace {
    return new StoreNamespace(this.store, this.prefix + namespacePrefix);
  }
  getPrefix(): string {
    return this.prefix;
  }
  markKeyAsUsed(key: string): void {
    this.store.markKeyAsUsed(this.prefix + key);
  }
  isUsed(key: string): boolean {
    return this.store.isUsed(this.prefix + key);
  }
}

export class RedisStore implements Store {
  db: AnyRedisClient;
  schemata: Set<string>;
  /**
   * Cached in-flight connect, so concurrent first commands share one
   * `connect()` (node-redis throws if `connect()` is called on an
   * already-connecting client).
   */
  private connecting: Promise<unknown> | undefined;

  constructor(client_or_connection_string: AnyRedisClient | string) {
    if (typeof client_or_connection_string === "string") {
      this.db = createClient({ url: client_or_connection_string }) as AnyRedisClient;
      // node-redis clients are EventEmitters that emit 'error' on connection
      // problems; with no listener Node rethrows those as uncaught exceptions.
      // When we own the client (URL path) attach a default listener so a blip
      // doesn't crash the process. Callers who pass their own client are
      // responsible for their own error handling (and typically attach a
      // logger before handing it in).
      this.db.on("error", (error) => {
        console.error("safe-redis-schema: redis client error:", error);
      });
    } else {
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
  async connect(): Promise<void> {
    if (this.db.isOpen) return;
    if (!this.connecting) this.connecting = this.db.connect();
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
    if (this.db.isOpen) this.db.destroy();
  }

  markKeyAsUsed(key: string): void {
    if (this.schemata.has(key)) {
      throw new Error(`Schema key already used: ${key}`);
    } else {
      this.schemata.add(key);
    }
  }

  isUsed(key: string): boolean {
    return this.schemata.has(key);
  }

  getRawConnection() {
    return this.db;
  }

  getPrefix(): string {
    return '';
  }

  namespacedBy(namespacePrefix: string): StoreNamespace {
    return new StoreNamespace(this, namespacePrefix);
  }

  async incrby(key: string, val: number): Promise<number> {
    await this.connect();
    // Coerce: with a RESP-agnostic client type the numeric reply widens to
    // `number | \`${number}\``; Number() normalises both RESP2/RESP3 shapes.
    return Number(await this.db.incrBy(key, val));
  }

  async hget(key: string, hash: string): Promise<any> {
    await this.connect();
    // Normalise the v6 "field absent" reply to null: v1 (node-redis v3)
    // resolved null here, and defineHashOf feeds this straight into
    // JSON.parse — JSON.parse(null) yields null, JSON.parse(undefined) throws.
    return (await this.db.hGet(key, hash)) ?? null;
  }

  async hset(key: string, hash: string, val: string): Promise<void> {
    await this.connect();
    await this.db.hSet(key, hash, val);
  }

  async hdel(key: string, hash: string): Promise<void> {
    await this.connect();
    await this.db.hDel(key, hash);
  }

  /**
   * increment field in a hash by val
   */
  async hincrby(key: string, hash: string, val: number): Promise<number> {
    await this.connect();
    return Number(await this.db.hIncrBy(key, hash, val));
  }

  async get(key: string): Promise<any> {
    await this.connect();
    const value = await this.db.get(key);
    // toString(): the RESP-agnostic client type widens the reply to
    // `string | Buffer`; both stringify to the stored JSON payload.
    return value ? JSON.parse(value.toString()) : undefined;
  }

  async set(key: string, value: any, expirySeconds?: number): Promise<boolean> {
    await this.connect();
    if (expirySeconds === undefined) {
      await this.db.set(key, JSON.stringify(value));
    } else {
      await this.db.set(key, JSON.stringify(value), { EX: expirySeconds });
    }
    return true;
  }

  async del(key: string): Promise<void> {
    await this.connect();
    await this.db.del(key);
  }
}
