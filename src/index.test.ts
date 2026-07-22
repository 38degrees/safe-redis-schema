import { createClient, RedisClientType } from "redis";
import {
  RedisStore,
  defineObj,
  defineHashOf,
  defineCounter,
  defineHashOfCounters
} from "./index";
import * as Safe from "safe-portals";

const redisUrl = process.env["REDIS_URL"] || 'redis://127.0.0.1:6379';

// A raw v6 client for the tests that exercise the "pass an existing client"
// constructor path. Not auto-connected — RedisStore connects it lazily on
// first use, matching how consumers wire it up.
const rawClient = (): RedisClientType => {
  const client = createClient({ url: redisUrl }) as RedisClientType;
  // Without an error listener node-redis rethrows connection errors as
  // uncaught exceptions; keep the suite quiet if redis blips.
  client.on("error", () => {});
  return client;
};

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

    await kv.close();
  });

  test("set with expiry", async () => {
    const kv = new RedisStore(redisUrl);
    const ns = kv.namespacedBy('redis-schema:test:');

    // Expiry is applied (EX option) and the value round-trips before it lapses.
    expect(await ns.set("expiring", 42, 60)).toEqual(true);
    expect(await ns.get("expiring")).toEqual(42);
    // TTL is set (positive, at most the requested window).
    const ttl = await ns.getRawConnection().ttl("redis-schema:test:expiring");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);

    await ns.del("expiring");
    await kv.close();
  });

  test("defineObj", async () => {
    const kv = new RedisStore(redisUrl);
    const ns = kv.namespacedBy('redis-schema:test:');

    const k1 = defineObj(ns, 'k1', Safe.array(Safe.bool));

    await k1.del();
    await expect(k1.get()).rejects.toBeInstanceOf(Safe.ValidationError);
    await k1.set([true,true,false]);
    expect (await k1.get()).toEqual([true, true, false]);

    await kv.close();
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

    await kv.close();
  });

  test("defineHashOf", async () => {
    const redis = rawClient();
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

    redis.destroy();
  });

  test("defineHashOfCounters", async () => {
    const redis = rawClient();
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

    redis.destroy();
  });

  test("Schema non-overwrite enforcement", async () => {
    const redis = rawClient();
    const kv = new RedisStore(redis);
    const ns = kv.namespacedBy('redis-schema:test:');

    defineCounter(ns, "foo:bar");
    expect(() => defineCounter(ns, "foo:bar")).toThrowError();

    const ns2 = ns.namespacedBy('foo:');
    expect(() => defineCounter(ns2, "bar")).toThrowError();

    // This suite never issues a command, so the lazily-connected client may
    // never have opened; close()/destroy() both tolerate that here.
    await kv.close();
    if (redis.isOpen) redis.destroy();
  });
});
