"""add terms, category and acceptance to contracts

Revision ID: c4a8f2d6e139
Revises: b7e3c1f9a254
Create Date: 2026-11-14 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4a8f2d6e139'
down_revision: Union[str, Sequence[str], None] = 'b7e3c1f9a254'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if 'contracts' not in sa.inspect(bind).get_table_names():
        return  # create_all will build it with the columns already present
    existing = {c['name'] for c in sa.inspect(bind).get_columns('contracts')}
    with op.batch_alter_table('contracts') as batch_op:
        if 'category' not in existing:
            batch_op.add_column(sa.Column('category', sa.String(length=30), nullable=True))
        if 'terms' not in existing:
            batch_op.add_column(sa.Column('terms', sa.Text(), nullable=True))
        if 'acceptance' not in existing:
            batch_op.add_column(sa.Column('acceptance', sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('contracts') as batch_op:
        batch_op.drop_column('acceptance')
        batch_op.drop_column('terms')
        batch_op.drop_column('category')
