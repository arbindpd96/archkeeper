---
'archkeeper': minor
---

Add the install engine that `init` and `update` will run: a pure planner; merge-safe blocks, json, owned and create-only strategies that never overwrite a user edit; path safety for every write and delete; and a transactional apply with lockfile v1, compressed base blobs, private backups and rollback. `schema/lock.schema.json` describes the lock.
