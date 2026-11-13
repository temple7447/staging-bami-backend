"""add monthly support (retainer) fields to contracts

Revision ID: b7e3c1f9a254
Revises: a9d4e2c7b613
Create Date: 2026-11-14 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7e3c1f9a254'
down_revision: Union[str, Sequence[str], None] = 'a9d4e2c7b613'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if 'contracts' not in sa.inspect(bind).get_table_names():
        return  # create_all will build it with the columns already present
    existing = {c['name'] for c in sa.inspect(bind).get_columns('contracts')}
    with op.batch_alter_table('contracts') as batch_op:
        if 'kind' not in existing:
            # every contract so far is a fixed-price project
            batch_op.add_column(sa.Column('kind', sa.String(length=20), nullable=False, server_default='project'))
        if 'monthly_amount' not in existing:
            batch_op.add_column(sa.Column('monthly_amount', sa.Float(), nullable=True))
        if 'billing_day' not in existing:
            batch_op.add_column(sa.Column('billing_day', sa.Integer(), nullable=True))
        if 'start_date' not in existing:
            batch_op.add_column(sa.Column('start_date', sa.DateTime(), nullable=True))
        if 'end_date' not in existing:
            batch_op.add_column(sa.Column('end_date', sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('contracts') as batch_op:
        batch_op.drop_column('end_date')
        batch_op.drop_column('start_date')
        batch_op.drop_column('billing_day')
        batch_op.drop_column('monthly_amount')
        batch_op.drop_column('kind')
