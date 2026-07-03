"""rent-increase default to no increase (cycle server_default 0)

Revision ID: 0057ec83a17b
Revises: ca28c3ddaf06
Create Date: 2026-07-03 12:44:26.221711

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0057ec83a17b'
down_revision: Union[str, Sequence[str], None] = 'ca28c3ddaf06'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Rent increases are now opt-in: the column default becomes 0 (no increase).

    Hand-written because env.py doesn't compare server defaults, so autogenerate
    can't see this change. Existing rows are left untouched — this only affects
    estates inserted without an explicit policy from now on.
    """
    op.alter_column("estates", "rent_increase_cycle_years", server_default="0")


def downgrade() -> None:
    op.alter_column("estates", "rent_increase_cycle_years", server_default="2")
