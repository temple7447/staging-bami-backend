from sqlalchemy import String, Boolean, DateTime, JSON, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, Money, gen_uuid
from datetime import datetime
from utils.time_utils import utcnow


class CarWashStation(Base):
    """A Bami-Wash location. Single row for MVP (one location), modeled as a
    real table — mirrors Estate's owner/members shape — so multi-location
    later is just more rows, not a schema change."""
    __tablename__ = "car_wash_stations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    name: Mapped[str] = mapped_column(String(255))
    slug: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    # [{"user_id": str, "email": str, "role": "staff"|"admin"}] — the owner
    # above is the implicit station admin. See core/authz.py for enforcement.
    members: Mapped[list] = mapped_column(JSON, default=list)
    opens_at: Mapped[str | None] = mapped_column(String(20), nullable=True)
    closes_at: Mapped[str | None] = mapped_column(String(20), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    updated_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class CarWashVehicle(Base):
    __tablename__ = "car_wash_vehicles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    user_id: Mapped[str] = mapped_column(String(36), index=True)
    make: Mapped[str] = mapped_column(String(100))
    model: Mapped[str] = mapped_column(String(100))
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    color: Mapped[str | None] = mapped_column(String(50), nullable=True)
    plate: Mapped[str] = mapped_column(String(20), index=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class CarWashService(Base):
    __tablename__ = "car_wash_services"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    station_id: Mapped[str] = mapped_column(String(36), index=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    base_price: Mapped[float] = mapped_column(Money, default=0.0)
    duration_min: Mapped[int] = mapped_column(Integer, default=30)
    kind: Mapped[str] = mapped_column(String(20), default="queue")  # queue | slot
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class CarWashAddon(Base):
    __tablename__ = "car_wash_addons"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    station_id: Mapped[str] = mapped_column(String(36), index=True)
    # None = applies to any service at this station.
    service_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    price: Mapped[float] = mapped_column(Money, default=0.0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class CarWashOrder(Base):
    """status: scheduled -> queued -> in_wash -> drying -> ready -> completed,
    or terminal `cancelled`. `scheduled` (not in the original product sketch)
    keeps a slot booked days ahead off the staff live-queue screen until the
    customer actually checks in — `queued_at` is stamped on scheduled->queued
    (or set immediately for a queue-type booking with no scheduled_at)."""
    __tablename__ = "car_wash_orders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    ref: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    station_id: Mapped[str] = mapped_column(String(36), index=True)
    user_id: Mapped[str] = mapped_column(String(36), index=True)
    vehicle_id: Mapped[str] = mapped_column(String(36), index=True)
    service_id: Mapped[str] = mapped_column(String(36), index=True)
    status: Mapped[str] = mapped_column(String(20), default="queued")
    total: Mapped[float] = mapped_column(Money, default=0.0)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    queued_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    slot_start: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    staff_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    cancelled_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class CarWashOrderItem(Base):
    __tablename__ = "car_wash_order_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    order_id: Mapped[str] = mapped_column(String(36), index=True)
    addon_id: Mapped[str] = mapped_column(String(36), index=True)
    # Denormalized snapshot — addon prices can change later, order history shouldn't.
    name: Mapped[str] = mapped_column(String(255))
    price: Mapped[float] = mapped_column(Money, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class CarWashStatusEvent(Base):
    """Append-only order timeline."""
    __tablename__ = "car_wash_status_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    order_id: Mapped[str] = mapped_column(String(36), index=True)
    status: Mapped[str] = mapped_column(String(20))
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    actor_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class CarWashQrPayment(Base):
    """The debit core. `nonce` is the signed JWT's `jti` claim — issuing a new
    QR for an order voids any prior `issued` row for it."""
    __tablename__ = "car_wash_qr_payments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    order_id: Mapped[str] = mapped_column(String(36), index=True)
    nonce: Mapped[str] = mapped_column(String(64), index=True, unique=True)
    amount: Mapped[float] = mapped_column(Money, default=0.0)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    status: Mapped[str] = mapped_column(String(20), default="issued")  # issued|paid|expired|void
    staff_id: Mapped[str] = mapped_column(String(36))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class CarWashSupportTicket(Base):
    __tablename__ = "car_wash_support_tickets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    station_id: Mapped[str] = mapped_column(String(36), index=True)
    user_id: Mapped[str] = mapped_column(String(36), index=True)
    order_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    subject: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="open")  # open|resolved|refunded
    resolution_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    refund_amount: Mapped[float | None] = mapped_column(Money, nullable=True)
    # Guards against double-refund — set once a refund Transaction is created.
    refund_transaction_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    resolved_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
