# Oracle Always Free ADB — Undo Management Operating Procedure

## Background

Oracle Always Free ADB hard-caps the UNDO tablespace at **100 MB** and blocks all
administrative escape hatches (`ALTER SYSTEM SET UNDO_RETENTION`, tablespace resize,
autoextend). Breaching this ceiling causes ORA-01552, which blocks all DML until undo
is recycled — and in the worst case, SELECT queries also fail with ORA-65114.

UNDO is **not permanent**. Oracle recycles committed undo blocks once:

1. The transaction has committed, and
2. The `UNDO_RETENTION` window has elapsed (so in-flight read-consistent queries can
   finish).

The ceiling is **peak concurrent active undo**, not total undo ever generated. A fresh
ADB instance with disciplined transaction management can operate indefinitely within
the 100 MB limit.

## Kill Condition

Large or infrequent commits. A bulk ingest that opens a transaction across tens of
thousands of rows forces Oracle to hold all undo simultaneously. This is what
previously pushed MAINBASE over the ceiling.

## Operating Rules

### Writes

- **Commit every 500–2 000 rows.** This keeps peak active undo well below 100 MB for
  typical row sizes and allows Oracle to recycle blocks between batches.
- **Use `TRUNCATE` instead of `DELETE` for bulk removals.** `TRUNCATE` is DDL; it
  generates no undo and resets the high-water mark.
- **Avoid `UPDATE` on large sets in a single transaction.** Break updates into batches
  with intermediate commits, same as inserts.
- **No long-running open transactions.** Any connection that holds an open transaction
  (e.g. a crashed ingest process) keeps its undo blocks pinned. Always commit or roll
  back before closing a connection.

### Reads

- Pure `SELECT` workloads generate near-zero undo. Read-only usage is safe
  indefinitely with no special precautions.

### Recreating the ADB Instance

If the instance becomes unrecoverable (ORA-01552 + DML fully blocked):

1. **Attempt a read-only dump first** while SELECT still works — thick-mode client,
   no DML, export to local file.
2. Delete the ADB in the OCI console. The Always Free slot is returned to the tenancy
   immediately (up to 2 Always Free ADBs per tenancy are permitted).
3. Create a new ADB in the same region. Use the same display name and DB name to
   simplify wallet/config updates.
4. Re-ingest using the batch-commit rules above.

### Profiling Before a Large Ingest

Before committing to a full corpus load, run a sample batch and check undo consumption:

```sql
SELECT tablespace_name, used_space * 8192 / 1024 / 1024 AS used_mb,
       tablespace_size * 8192 / 1024 / 1024 AS total_mb
FROM v$undo_space;
```

If `used_mb` climbs above ~60 MB during the sample, reduce batch size before the full
run.

## Reference

- ORA-01552: cannot use rollback segment for non-system tablespace — undo tablespace
  full.
- ORA-65114: space usage in container is too high — container-level space enforcement
  triggered by full undo.
- Thick-mode client required for ADB wallet connections (`init_oracle_client` with
  `lib_dir` and `config_dir`). Thin mode requires `ewallet.pem` passphrase. See
  project memory for wallet path details.
