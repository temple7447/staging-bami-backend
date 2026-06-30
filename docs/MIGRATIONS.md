# Database Migrations (Alembic)

The backend now uses **Alembic** for schema changes — ending the old
`create_all`-only approach that silently left columns/types out of sync
(the recurring "column does not exist" / "operator does not exist" bugs).

All commands run from `fastapi_app/` using the venv.

## The workflow — whenever you change a model
```bash
cd fastapi_app
# 1. edit your model (add a column, change a type, etc.)
# 2. autogenerate a migration (diffs models vs the live DB)
venv/bin/alembic revision --autogenerate -m "add X to Y"
# 3. REVIEW the generated file in alembic/versions/ (always!)
#    - VARCHAR -> numeric casts need: postgresql_using='col::double precision'
#    - drop_column / data-loss ops: confirm intentional
# 4. apply it
venv/bin/alembic upgrade head
```

## Handy commands
```bash
venv/bin/alembic current          # what revision the DB is at
venv/bin/alembic history          # all revisions
venv/bin/alembic check            # "No new upgrade operations" = DB matches models
venv/bin/alembic downgrade -1     # roll back one revision
```

## How it's wired
- `alembic/env.py` — **async** (asyncpg), loads `Base.metadata` by importing every
  `models/*` module, and reads `DATABASE_URL` from `core.config.settings`
  (no DB creds in `alembic.ini`).
- `compare_type=True` so column TYPE changes are detected (this is what caught the
  legacy `candidates` VARCHAR→Float drift).

## Baseline
- `d1b04de86621` — empty baseline (adopted the existing DB state).
- `0ec0003bdb60` — fixed legacy drift (candidates numeric types, dropped deprecated
  `otp_*` columns, widened `tenant_telegram_sessions.state`).
- `alembic check` is clean → DB == models.

## Note on create_all
`Base.metadata.create_all` still runs on startup and **bootstraps missing tables**
(fresh deploy / new model). That's fine and complementary:
- **New table** → create_all makes it.
- **New column / type change on an existing table** → use Alembic (create_all can't).

> Rule of thumb: any change to an *existing* table goes through Alembic.
