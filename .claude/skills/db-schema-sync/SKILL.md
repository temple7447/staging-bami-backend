---
name: db-schema-sync
description: Generate and apply Alembic migrations for the BamiHost FastAPI backend whenever a SQLAlchemy model in fastapi_app/models/ is added or changed — new columns, type changes, new tables, indexes, or constraint edits. Use this skill EVERY time a model file is edited, even for a "small" one-column addition, because startup create_all never alters existing tables and unmigrated model changes surface as 500 errors (UndefinedColumnError) in production. Also use when the user mentions schema drift, "column does not exist", ALTER TABLE, or database migrations.
---

# DB Schema Sync (Alembic)

## Why this skill exists

`core/database.py` runs `Base.metadata.create_all` on startup. `create_all` only
creates tables that don't exist yet — it never adds columns, changes types, or
touches an existing table. Historically this project managed schema by
create_all + manual `ALTER TABLE`, which caused repeated drift between the
models and the live database (Neon Postgres in production, SQLite locally).

Alembic is now wired up (baseline revision `d1b04de86621`). Every model change
must ship with a migration, or the change silently never reaches the database
and the next request that touches the new column 500s.

## Workflow

All commands run from `fastapi_app/` using the project venv. Alembic's
`env.py` reads `settings.DATABASE_URL` and auto-imports every module in
`models/`, so no manual imports or URL config are needed.

1. **Edit the model** in `fastapi_app/models/`. If it's a brand-new model file,
   nothing else is needed for registration — `env.py` and `main.py` both import
   all model modules automatically.

2. **Autogenerate the migration:**
   ```bash
   cd fastapi_app
   venv/bin/alembic revision --autogenerate -m "add <what> to <table>"
   ```

3. **Read the generated file before applying it.** Autogenerate is a draft,
   not a decision. Check for:
   - **NOT NULL on a populated table**: adding `nullable=False` without a
     `server_default` fails on existing rows. Either add
     `server_default=...` in the op, or add the column nullable, backfill,
     then alter.
   - **Phantom diffs**: autogenerate sometimes emits drops/alters for things
     it merely can't introspect (e.g. legacy manually-ALTERed bits). Delete
     any op that doesn't correspond to a model edit you actually made.
   - **SQLite compatibility**: local dev may run on SQLite, which can't do
     most `ALTER TABLE` forms. Wrap column alters in
     `with op.batch_alter_table("table") as batch_op:` if the migration must
     also run locally.
   - **Enums on Postgres**: new enum values need explicit
     `op.execute("ALTER TYPE ... ADD VALUE ...")`; autogenerate won't emit it.

4. **Apply it:**
   ```bash
   venv/bin/alembic upgrade head
   ```
   This applies against whatever `DATABASE_URL` is configured (default is the
   local SQLite `bamihost.db`; production Neon comes from the environment).

5. **Verify** the column/table actually exists — query
   `information_schema.columns` (Postgres) or `PRAGMA table_info` (SQLite),
   or simply hit the affected endpoint. Don't declare done on a clean
   `upgrade head` alone.

## Deploying the change

The production database is Neon Postgres. Applying there means running
`alembic upgrade head` with the production `DATABASE_URL` exported — the
migration does not run automatically on deploy. Include this step in the
handoff whenever a migration is part of a change, and push to `staging` per
project convention.

## When drift already happened

Symptom: `UndefinedColumnError` / "column does not exist" at runtime while the
model clearly defines the column. Fix it the same way — write a migration for
the missing piece (see `0ec0003bdb60_fix_legacy_schema_drift.py` for a prior
example) rather than a one-off psql ALTER, so local, staging, and production
converge on the same revision history.

Useful commands:
```bash
venv/bin/alembic current    # revision the DB is at
venv/bin/alembic history    # all revisions
venv/bin/alembic heads      # latest revision(s) in code
venv/bin/alembic check      # "No new upgrade operations" == DB matches models
```

Fuller reference (type-change gotchas like `postgresql_using`, history of the
legacy manual ALTERs): `docs/MIGRATIONS.md`.
