"""add contracts table

Revision ID: a9d4e2c7b613
Revises: f7c2a91d3b58
Create Date: 2026-11-14 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a9d4e2c7b613'
down_revision: Union[str, Sequence[str], None] = 'f7c2a91d3b58'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # The backend also creates missing tables at startup (create_all), so the
    # table may already exist if the code was deployed first.
    if 'contracts' in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        'contracts',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('client_name', sa.String(length=255), nullable=True),
        sa.Column('developer_id', sa.String(length=36), nullable=True),
        sa.Column('total_amount', sa.Float(), nullable=False),
        sa.Column('currency', sa.String(length=3), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('instalments', sa.JSON(), nullable=False),
        sa.Column('payments', sa.JSON(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('created_by', sa.String(length=36), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_contracts_developer_id'), 'contracts', ['developer_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_contracts_developer_id'), table_name='contracts')
    op.drop_table('contracts')
