from bson import ObjectId
from pydantic_core import core_schema


def _objectid_schema(cls, source, handler):
    return core_schema.no_info_plain_validator_function(
        lambda v: ObjectId(v) if not isinstance(v, ObjectId) else v,
        serialization=core_schema.to_string_ser_schema(),
    )


ObjectId.__get_pydantic_core_schema__ = classmethod(_objectid_schema)
