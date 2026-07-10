"""add rent_increase columns to estates (heal pre-Alembic drift)

Revision ID: a1f7c2e93b40
Revises: 0cbb111b9f98
Create Date: 2026-07-10 16:20:00.000000

The estates.rent_increase_* columns were added to the model but never had an
ADD COLUMN migration — the no-op baseline assumed they pre-existed and later
revisions (ca28c3ddaf06, 0057ec83a17b) only ALTER them. On a database whose
`estates` table was create_all'd before these columns entered the model they
therefore never arrive, and an INSERT 500s with UndefinedColumnError
("column rent_increase_percent of relation estates does not exist").

This revision adds the columns idempotently (only if missing) so any database
converges on the model, whatever state it is currently in.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1f7c2e93b40'
down_revision: Union[str, Sequence[str], None] = '0cbb111b9f98'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_estate_columns() -> set[str]:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    return {c["name"] for c in insp.get_columns("estates")}


def upgrade() -> None:
    existing = _existing_estate_columns()

    if "rent_increase_percent" not in existing:
        op.add_column(
            "estates",
            sa.Column("rent_increase_percent", sa.Float(), nullable=False,
                      server_default="26.0"),
        )
    if "rent_increase_cycle_years" not in existing:
        op.add_column(
            "estates",
            sa.Column("rent_increase_cycle_years", sa.Integer(), nullable=False,
                      server_default="0"),
        )
    if "rent_increase_start" not in existing:
        op.add_column(
            "estates",
            sa.Column("rent_increase_start", sa.DateTime(), nullable=True),
        )


def downgrade() -> None:
    existing = _existing_estate_columns()
    for col in ("rent_increase_start", "rent_increase_cycle_years",
                "rent_increase_percent"):
        if col in existing:
            op.drop_column("estates", col)
