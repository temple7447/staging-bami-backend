"""add category, provider and payments history to subscriptions

Revision ID: e3b1d4a7c9f2
Revises: 7694b14c8a62
Create Date: 2026-11-12 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e3b1d4a7c9f2'
down_revision: Union[str, Sequence[str], None] = '7694b14c8a62'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # `subscriptions` was created by startup create_all, so on a fresh database
    # it may not exist yet when this runs; create_all will then build it with
    # the new columns already in place.
    bind = op.get_bind()
    if 'subscriptions' not in sa.inspect(bind).get_table_names():
        return
    existing = {c['name'] for c in sa.inspect(bind).get_columns('subscriptions')}
    with op.batch_alter_table('subscriptions') as batch_op:
        if 'category' not in existing:
            batch_op.add_column(sa.Column('category', sa.String(length=50), nullable=True))
        if 'provider' not in existing:
            batch_op.add_column(sa.Column('provider', sa.String(length=255), nullable=True))
        if 'payments' not in existing:
            batch_op.add_column(sa.Column('payments', sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('subscriptions') as batch_op:
        batch_op.drop_column('payments')
        batch_op.drop_column('provider')
        batch_op.drop_column('category')
