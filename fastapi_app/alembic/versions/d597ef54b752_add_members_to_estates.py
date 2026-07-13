"""add members to estates

Revision ID: d597ef54b752
Revises: a1f7c2e93b40
Create Date: 2026-07-13 19:55:29.554362

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd597ef54b752'
down_revision: Union[str, Sequence[str], None] = 'a1f7c2e93b40'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add estates.members (per-property team). Idempotent + server_default so it
    applies cleanly on populated tables and on DBs that already have the column."""
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("estates")}
    if "members" not in existing:
        op.add_column(
            "estates",
            sa.Column("members", sa.JSON(), nullable=False, server_default="[]"),
        )


def downgrade() -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("estates")}
    if "members" in existing:
        op.drop_column("estates", "members")
