"""add currency to subscriptions

Revision ID: f7c2a91d3b58
Revises: e3b1d4a7c9f2
Create Date: 2026-11-14 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f7c2a91d3b58'
down_revision: Union[str, Sequence[str], None] = 'e3b1d4a7c9f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if 'subscriptions' not in sa.inspect(bind).get_table_names():
        return  # create_all will build it with the column already present
    if 'currency' in {c['name'] for c in sa.inspect(bind).get_columns('subscriptions')}:
        return
    # Everything recorded so far was in naira; the server default backfills those rows.
    with op.batch_alter_table('subscriptions') as batch_op:
        batch_op.add_column(sa.Column('currency', sa.String(length=3), nullable=False, server_default='NGN'))


def downgrade() -> None:
    with op.batch_alter_table('subscriptions') as batch_op:
        batch_op.drop_column('currency')
