from sqlalchemy.orm import DeclarativeBase
import uuid


def gen_uuid() -> str:
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    pass


# Exact money storage: numeric(12,2) in Postgres. asdecimal=False keeps
# Python-side values as floats so existing arithmetic keeps working.
from sqlalchemy import Numeric  # noqa: E402

Money = Numeric(12, 2, asdecimal=False)
