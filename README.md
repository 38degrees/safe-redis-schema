# Safe Redis Schemas

## Type-safe and validated data schemas for Redis and Typescript

See [./src/index.test.ts](./src/index.test.ts) for full example usage of all
data types.

### v2 — node-redis v6

Version 2 is built against the promise-native [node-redis](https://github.com/redis/node-redis)
v6 client (v1 targeted the callback-based v3 client). The schema API and its
contracts are unchanged, with two things to know about connection lifecycle:

- **Lazy connect.** node-redis v6 clients do not auto-connect. `RedisStore`
  connects lazily on the first command, so in most cases you don't need to do
  anything. If you hand the raw client to another library (via
  `getRawConnection()`) before issuing any command, call `await store.connect()`
  first to make sure the socket is open. `connect()` is idempotent.
- **`RESP` protocol.** node-redis v6 defaults to RESP3, which requires a Redis
  **server** ≥ 6. Against an older server, construct the client with `{ RESP: 2 }`
  and pass it to `new RedisStore(client)`.

`close()` tears the socket down synchronously (v6's `destroy()`), which is what
test teardown relies on to avoid a leaked open handle.

You can define a redis data schema, exporting particular definitions:

```TSX
import { RedisStore, defineObj, defineCounter, defineHashOf, defineHashOfCounters } from 'safe-redis-schema';
import * as Safe from 'safe-portals';

const redisUrl = process.env["REDIS_URL"] || 'redis://127.0.0.1:6379';
const store = new RedisStore(redisUrl);

/**
 * You can access redis directly using store.getRawConnection,
 * or use the Promise-wrapped API of RedisStore itself.
 *
 * However, the real purpose of this library is to define a safe, validated
 * schema for your redis data model.
 *
 * Here we define an example schema.
 */

/* Using a namespace prefix can make redis key naming more hygenic.
 * This mechanism prohibits re-use of keys for different data types.
 */

const ns = store.namespacedBy('myExample:');

export const pageHitCount = defineHashOfCounters(ns, 'pageHits');
/*
 * Prohibited key reuse means that the following would all throw errors,
 * because the key has already been used in a schema definition:
 *
 * defineObj(ns, 'pageHits', Safe.str);
 * defineObj(store, 'myExample:pageHits', Safe.str);
 */

export const people = defineHashOf(
  ns,
  'people',
  Safe.obj({
    name: Safe.str,
    age: Safe.int
  })
);
```

Then your data schema can be used elsewhere by:

```TSX
import { pageHitCount, people } from './my_redis_schema';

async function foo() {
    let count = await pageHitCount.incrby('/some/page/url', 1);
    console.log(`count is now ${count}`);

    count = await pageHitCount.get('/some/page/url');
    console.log(`count is still ${count}`);

    await pageHitCount.zero('/some/page/url');

    await people.hset('123', { name: 'Jane', age: 34 });
    console.debug(await people.hget('123'));
}
```

The types are all built- and run-time validated, so you can't insert the wrong
thing into the `people` schema, retrieve unexpected types from `people`, or get
anything other than a number out of a counter.
