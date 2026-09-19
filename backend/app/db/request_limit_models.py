"""Small reusable request/byte counters; identifiers are HMAC digests."""
import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base


class RequestLimitModel(Base):
    __tablename__ = "request_limit_counters"
    scope: Mapped[str] = mapped_column(sa.String(100), primary_key=True)
    window_seconds: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    window_start: Mapped[int] = mapped_column(sa.BigInteger, nullable=False, index=True)
    amount: Mapped[int] = mapped_column(sa.BigInteger, nullable=False)
    __table_args__ = (sa.CheckConstraint("amount > 0 AND window_seconds > 0", name="ck_request_limit_positive"),)
