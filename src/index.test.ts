import * as Redis from "redis";
import {
  RedisStore,
  defineObj,
  defineHashOf,
  defineCounter,
  defineHashOfCounters
} from "./index";
import * as Safe from "safe-portals";

const redisUrl = process.env["REDIS_URL"] || 'redis://127.0.0.1:6379';

describe("Redis KvStore", () => {
  test("Promise-based redis wrapper", async () => {
    const kv = new RedisStore(redisUrl);
    const ns = kv.namespacedBy('redis-schema:test:');
    const kvTest1 = ns.namespacedBy("one:");
    const kvTest2 = ns.namespacedBy("two:");
    const kvTest3 = kvTest1.namespacedBy("three:");

    expect(kvTest1.getPrefix()).toEqual("redis-schema:test:one:");
    expect(kvTest3.getPrefix()).toEqual("redis-schema:test:one:three:");

    // global namespace protection
    ns.markKeyAsUsed("one:three:blah");
    expect(kv.isUsed("redis-schema:test:one:three:blah")).toBeTruthy();
    expect(ns.isUsed("one:three:blah")).toBeTruthy();
    expect(ns.isUsed("one:three:blorg")).toBeFalsy();
    expect(kvTest1.isUsed("three:blah")).toBeTruthy();
    expect(kvTest3.isUsed("blah")).toBeTruthy();
    expect(kvTest3.isUsed("blorg")).toBeFalsy();
    expect(() => kvTest3.markKeyAsUsed("blah")).toThrowError();
    kvTest3.markKeyAsUsed("blorg");
    expect(kvTest1.isUsed("three:blorg")).toBeTruthy();
    expect(kvTest3.isUsed("blorg")).toBeTruthy();

    await kvTest1.set("myKey", 123);
    expect(await kvTest1.get("myKey")).toEqual(123);
    expect(await kvTest2.get("myKey")).toBeUndefined();
    expect(await kv.get("myKey")).toBeUndefined();

    await kvTest2.del("myKey");
    expect(await kvTest1.get("myKey")).toEqual(123);
    await kvTest1.del("myKey");
    expect(await kvTest1.get("myKey")).toBeUndefined();

    await kv.del("test_counter");
    expect(await kv.incrby("test_counter", 1)).toEqual(1);
    expect(await kv.incrby("test_counter", 1)).toEqual(2);

    await kv.del("test_hash");
    expect(await kv.hincrby("test_hash", "key", 1)).toEqual(1);
    expect(await kv.hincrby("test_hash", "key", 1)).toEqual(2);
    expect(await kv.hget("test_hash", "key")).toEqual("2");

    kv.close();
  });

  test("defineObj", async () => {
    const kv = new RedisStore(redisUrl);
    const ns = kv.namespacedBy('redis-schema:test:');

    const k1 = defineObj(ns, 'k1', Safe.array(Safe.bool));

    await k1.del();
    await expect(k1.get()).rejects.toBeInstanceOf(Safe.ValidationError);
    await k1.set([true,true,false]);
    expect (await k1.get()).toEqual([true, true, false]);

    kv.close();
  });

  test("defineCounter", async () => {
    const kv = new RedisStore(redisUrl);
    const ns = kv.namespacedBy('redis-schema:test:');

    const c = defineCounter(ns, 'mycounter');

    await c.zero();
    expect (await c.get()).toEqual(0);
    expect (await c.incrby(2)).toEqual(2);
    expect (await c.get()).toEqual(2);
    expect (await c.incrby(1)).toEqual(3);
    expect (await c.get()).toEqual(3);
    await c.zero();
    expect (await c.get()).toEqual(0);

    kv.close();
  });

  test("defineHashOf", async () => {
    const redis = Redis.createClient(redisUrl);
    const kv = new RedisStore(redis);
    const ns = kv.namespacedBy('redis-schema:test:');

    const c = defineHashOf(ns, 'mycounter', Safe.optional(Safe.tuple(Safe.int, Safe.str)));

    await c.del();
    expect (await c.hget('foo')).toEqual(undefined);
    await c.hset('foo', [12, "hi"]);
    await c.hset('bar', [23, "bla"]);
    expect (await c.hget('foo')).toEqual([12, "hi"]);
    expect (await c.hget('bar')).toEqual([23, "bla"]);
    await c.hset('foo', [34, "lo"]);
    await c.hdel('bar');
    expect (await c.hget('foo')).toEqual([34, "lo"]);
    expect (await c.hget('bar')).toEqual(undefined);

    redis.end(true);
  });

  test("defineHashOfCounters", async () => {
    const redis = Redis.createClient(redisUrl);
    const kv = new RedisStore(redis);
    const ns = kv.namespacedBy('redis-schema:test:');

    const c = defineHashOfCounters(ns, 'myhashcounters');

    await c.del();
    expect (await c.get('foo')).toEqual(0);
    await c.incrby('foo', 2);
    await c.incrby('bar', 1);
    expect (await c.get('foo')).toEqual(2);
    expect (await c.get('bar')).toEqual(1);
    await c.incrby('foo', 2);
    await c.zero('bar');
    expect (await c.get('foo')).toEqual(4);
    expect (await c.get('bar')).toEqual(0);

    redis.end(true);
  });

  test("Schema non-overwrite enforcement", async () => {
    const redis = Redis.createClient(redisUrl);
    const kv = new RedisStore(redis);
    const ns = kv.namespacedBy('redis-schema:test:');

    defineCounter(ns, "foo:bar");
    expect(() => defineCounter(ns, "foo:bar")).toThrowError();

    const ns2 = ns.namespacedBy('foo:');
    expect(() => defineCounter(ns2, "bar")).toThrowError();

    redis.end(true);
  });
});
