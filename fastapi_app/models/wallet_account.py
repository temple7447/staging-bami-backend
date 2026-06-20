from sqlalchemy import String, Boolean, DateTime, JSON, Float
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime


class WalletAccount(Base):
    __tablename__ = "wallet_accounts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    estate: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    currency: Mapped[str] = mapped_column(String(10), default="NGN")

    growth_engine_marketing_balance: Mapped[float] = mapped_column(Float, default=0.0)
    growth_engine_operations_balance: Mapped[float] = mapped_column(Float, default=0.0)
    growth_engine_savings_balance: Mapped[float] = mapped_column(Float, default=0.0)

    fulfillment_engine_marketing_balance: Mapped[float] = mapped_column(Float, default=0.0)
    fulfillment_engine_operations_balance: Mapped[float] = mapped_column(Float, default=0.0)
    fulfillment_engine_savings_balance: Mapped[float] = mapped_column(Float, default=0.0)

    innovation_engine_marketing_balance: Mapped[float] = mapped_column(Float, default=0.0)
    innovation_engine_operations_balance: Mapped[float] = mapped_column(Float, default=0.0)
    innovation_engine_savings_balance: Mapped[float] = mapped_column(Float, default=0.0)

    total_received: Mapped[float] = mapped_column(Float, default=0.0)
    total_disbursed: Mapped[float] = mapped_column(Float, default=0.0)
    distribution_log: Mapped[list] = mapped_column(JSON, default=list)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    @property
    def total_balance(self) -> float:
        return sum([
            self.growth_engine_marketing_balance, self.growth_engine_operations_balance, self.growth_engine_savings_balance,
            self.fulfillment_engine_marketing_balance, self.fulfillment_engine_operations_balance, self.fulfillment_engine_savings_balance,
            self.innovation_engine_marketing_balance, self.innovation_engine_operations_balance, self.innovation_engine_savings_balance,
        ])

    @property
    def total_marketing(self) -> float:
        return (self.growth_engine_marketing_balance + self.fulfillment_engine_marketing_balance + self.innovation_engine_marketing_balance)

    @property
    def total_operations(self) -> float:
        return (self.growth_engine_operations_balance + self.fulfillment_engine_operations_balance + self.innovation_engine_operations_balance)

    @property
    def total_savings(self) -> float:
        return (self.growth_engine_savings_balance + self.fulfillment_engine_savings_balance + self.innovation_engine_savings_balance)

    def distribute_amount(self, amount: float, payment_id: str = "", payment_type: str = "payment") -> dict:
        g = amount * 0.50
        f = amount * 0.30
        i = amount * 0.20

        self.growth_engine_marketing_balance       += g * 0.50
        self.growth_engine_operations_balance      += g * 0.30
        self.growth_engine_savings_balance         += g * 0.20

        self.fulfillment_engine_marketing_balance  += f * 0.50
        self.fulfillment_engine_operations_balance += f * 0.30
        self.fulfillment_engine_savings_balance    += f * 0.20

        self.innovation_engine_marketing_balance   += i * 0.50
        self.innovation_engine_operations_balance  += i * 0.30
        self.innovation_engine_savings_balance     += i * 0.20

        self.total_received += amount
        self.updated_at = datetime.utcnow()

        breakdown = {
            "growthEngine":      {"marketing": g*0.50, "operations": g*0.30, "savings": g*0.20, "total": g},
            "fulfillmentEngine": {"marketing": f*0.50, "operations": f*0.30, "savings": f*0.20, "total": f},
            "innovationEngine":  {"marketing": i*0.50, "operations": i*0.30, "savings": i*0.20, "total": i},
            "total": amount,
        }
        log = self.distribution_log or []
        log.append({"payment_id": str(payment_id), "payment_type": payment_type, "amount": amount, "breakdown": breakdown, "at": datetime.utcnow().isoformat()})
        self.distribution_log = log
        return breakdown
