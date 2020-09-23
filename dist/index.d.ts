import * as Redis from "redis";
import * as Safe from "safe-portals";
export declare function defineObj<T>(store: Store, key: string, type: Safe.Type<T>): {
    get: () => Promise<T>;
    set: (val: T) => Promise<boolean>;
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
    del(key: string): void;
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
export declare class StoreNamespace implements Store {
    prefix: string;
    store: Store;
    constructor(store: Store, prefix: string);
    get(key: string): Promise<any>;
    set(key: string, value: any, expirySeconds?: number): Promise<boolean>;
    del(key: string): void;
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
    db: Redis.RedisClient;
    schemata: Set<string>;
    constructor(client_or_connection_string: Redis.RedisClient | string);
    close(): void;
    markKeyAsUsed(key: string): void;
    isUsed(key: string): boolean;
    getRawConnection(): Redis.RedisClient;
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
    del(key: string): void;
}
