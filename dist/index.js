"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisStore = exports.StoreNamespace = exports.defineCounter = exports.defineHashOfCounters = exports.defineHashOf = exports.defineObj = void 0;
const Redis = require("redis");
function defineObj(store, key, type) {
    store.markKeyAsUsed(key);
    return {
        get: () => __awaiter(this, void 0, void 0, function* () {
            return store.get(key).then(v => type.read(v));
        }),
        set: (val) => __awaiter(this, void 0, void 0, function* () {
            return store.set(key, type.write(val));
        }),
        del: () => __awaiter(this, void 0, void 0, function* () {
            return store.del(key);
        })
    };
}
exports.defineObj = defineObj;
function defineHashOf(store, key, type) {
    store.markKeyAsUsed(key);
    return {
        hget: (hkey) => __awaiter(this, void 0, void 0, function* () {
            return store.hget(key, hkey).then(v => type.read(JSON.parse(v)));
        }),
        hset: (hkey, val) => __awaiter(this, void 0, void 0, function* () {
            return store.hset(key, hkey, JSON.stringify(type.write(val)));
        }),
        hdel: (hkey) => __awaiter(this, void 0, void 0, function* () {
            return store.hdel(key, hkey);
        }),
        del: () => __awaiter(this, void 0, void 0, function* () {
            return store.del(key);
        })
    };
}
exports.defineHashOf = defineHashOf;
function defineHashOfCounters(store, key) {
    store.markKeyAsUsed(key);
    return {
        get: (hkey) => __awaiter(this, void 0, void 0, function* () {
            return store.hget(key, hkey).then(v => parseInt(v) || 0);
        }),
        incrby: (hkey, val) => __awaiter(this, void 0, void 0, function* () {
            return store.hincrby(key, hkey, val);
        }),
        zero: (hkey) => __awaiter(this, void 0, void 0, function* () {
            return store.hdel(key, hkey);
        }),
        del: () => __awaiter(this, void 0, void 0, function* () {
            return store.del(key);
        })
    };
}
exports.defineHashOfCounters = defineHashOfCounters;
function defineCounter(store, key) {
    store.markKeyAsUsed(key);
    return {
        incrby: (val) => __awaiter(this, void 0, void 0, function* () {
            return store.incrby(key, val);
        }),
        get: () => __awaiter(this, void 0, void 0, function* () {
            return store.get(key).then(v => parseInt(v) || 0);
        }),
        zero: () => __awaiter(this, void 0, void 0, function* () {
            return store.del(key);
        })
    };
}
exports.defineCounter = defineCounter;
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
        this.store.del(this.prefix + key);
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
        if (client_or_connection_string instanceof Redis.RedisClient) {
            this.db = client_or_connection_string;
        }
        else {
            this.db = Redis.createClient(client_or_connection_string);
        }
        this.schemata = new Set([]);
    }
    close() {
        this.db.end(true);
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
    incrby(key, val) {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve, reject) => {
                this.db.incrby(key, val, (error, value) => {
                    if (error)
                        reject(error);
                    else
                        resolve(value);
                });
            });
        });
    }
    hget(key, hash) {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve, reject) => {
                this.db.hget(key, hash, (error, value) => {
                    if (error)
                        reject(error);
                    else
                        resolve(value);
                });
            });
        });
    }
    hset(key, hash, val) {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve, reject) => {
                this.db.hset(key, hash, val, (error) => {
                    if (error)
                        reject(error);
                    else
                        resolve();
                });
            });
        });
    }
    hdel(key, hash) {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve, reject) => {
                this.db.hdel(key, hash, (error) => {
                    if (error)
                        reject(error);
                    else
                        resolve();
                });
            });
        });
    }
    /**
     * increment field in a hash by val
     */
    hincrby(key, hash, val) {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve, reject) => {
                this.db.hincrby(key, hash, val, (error, value) => {
                    if (error)
                        reject(error);
                    else
                        resolve(value);
                });
            });
        });
    }
    get(key) {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve, reject) => {
                this.db.get(key, (error, value) => {
                    if (error) {
                        throw error;
                    }
                    resolve(value ? JSON.parse(value) : undefined);
                });
            });
        });
    }
    set(key, value, expirySeconds) {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve, reject) => {
                const handler = (error, value) => {
                    if (error) {
                        throw error;
                    }
                    resolve(true);
                };
                if (expirySeconds === undefined) {
                    this.db.set(key, JSON.stringify(value), handler);
                }
                else {
                    this.db.setex(key, expirySeconds, JSON.stringify(value), handler);
                }
            });
        });
    }
    del(key) {
        this.db.del(key);
    }
}
exports.RedisStore = RedisStore;
