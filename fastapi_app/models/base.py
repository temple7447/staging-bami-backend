from sqlalchemy.orm import DeclarativeBase
import uuid


def gen_uuid() -> str:
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    pass
