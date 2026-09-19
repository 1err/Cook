"""Conservative cumulative reservations, including unconfirmed/unused uploads."""
import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base


class UploadBudgetModel(Base):
    __tablename__ = "upload_budgets"
    scope: Mapped[str] = mapped_column(sa.String(100), primary_key=True)
    object_count: Mapped[int] = mapped_column(sa.BigInteger, nullable=False)
    byte_count: Mapped[int] = mapped_column(sa.BigInteger, nullable=False)
    __table_args__ = (sa.CheckConstraint(
        "object_count >= 0 AND byte_count >= 0", name="ck_upload_budget_nonnegative"),)
