"""add delay_notice_sent_at to withdrawals

Revision ID: d2f6a1b8c405
Revises: c4a8f2d6e139
Create Date: 2026-11-22 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd2f6a1b8c405'
down_revision: Union[str, Sequence[str], None] = 'c4a8f2d6e139'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if 'withdrawals' not in sa.inspect(bind).get_table_names():
        return  # create_all will build it with the column already present
    if 'delay_notice_sent_at' in {c['name'] for c in sa.inspect(bind).get_columns('withdrawals')}:
        return
    with op.batch_alter_table('withdrawals') as batch_op:
        batch_op.add_column(sa.Column('delay_notice_sent_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('withdrawals') as batch_op:
        batch_op.drop_column('delay_notice_sent_at')
