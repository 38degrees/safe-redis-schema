import * as Redis from "redis";
import * as Safe from "safe-portals";

export function defineObj<T>(
  store: Store,
  key: string,
  type: Safe.Type<T>
): { get: () => Promise<T>,
     set: (val: T) => Promise<boolean>,
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
  del(key: string): void;
  // atomically increment a counter, and return the new value. if the key
  // does not exist then this operation will set the counter to 1
  incrby(key: string, val: number): Promise<number>;
  hget(key: string, hash: string): Promise<any>;
  hset(key: string, hash: string, value: string): Promise<void>;
  hdel(key: string, hash: string): Promise<void>;
  hincrby(key: string, hash: string, val: number): Promise<number>;

  getRawConnection(): Redis.RedisClient;

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
  del(key: string): void {
    this.store.del(this.prefix + key);
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
  db: Redis.RedisClient;
  schemata: Set<string>;

  constructor(client_or_connection_string: Redis.RedisClient | string) {
    if (client_or_connection_string instanceof Redis.RedisClient) {
      this.db = client_or_connection_string;
    } else {
      this.db = Redis.createClient(client_or_connection_string);
    }
    this.schemata = new Set([]);
  }

  close() {
    this.db.end(true);
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
    return new Promise((resolve, reject) => {
      this.db.incrby(key, val, (error, value) => {
        if (error) reject(error);
        else resolve(value);
      });
    });
  }

  async hget(key: string, hash: string): Promise<any> {
    return new Promise((resolve, reject) => {
      this.db.hget(key, hash, (error, value) => {
        if (error) reject(error);
        else resolve(value);
      });
    });
  }


  async hset(key: string, hash: string, val: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.hset(key, hash, val, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  async hdel(key: string, hash: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.hdel(key, hash, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
  /**
   * increment field in a hash by val
   */
  async hincrby(key: string, hash: string, val: number): Promise<number> {
    return new Promise((resolve, reject) => {
      this.db.hincrby(key, hash, val, (error, value) => {
        if (error) reject(error);
        else resolve(value);
      });
    });
  }

  async get(key: string): Promise<any> {
    return new Promise((resolve, reject) => {
      this.db.get(key, (error, value) => {
        if (error) {
          throw error;
        }
        resolve(value ? JSON.parse(value) : undefined);
      });
    });
  }

  async set(key: string, value: any, expirySeconds?: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const handler = (error: any, value: any) => {
        if (error) {
          throw error;
        }
        resolve(true);
      };
      if (expirySeconds === undefined) {
        this.db.set(key, JSON.stringify(value), handler);
      } else {
        this.db.setex(
          key,
          expirySeconds,
          JSON.stringify(value),
          handler
        );
      }
    });
  }

  del(key: string) {
    this.db.del(key);
  }
}
