"""Order domain model."""

from dataclasses import dataclass, field


@dataclass
class Order:
    """Represent one customer's order and its payment status."""

    customer_email: str
    product_name: str
    quantity: int
    unit_price: int
    order_id: str = field(default="pending")
    status: str = field(default="created")
    receipt_id: str | None = field(default=None)

    @property
    def total_amount(self) -> int:
        """Calculate the order total in whole currency units."""
        return self.quantity * self.unit_price

    def mark_paid(self, receipt_id: str) -> None:
        """Store the payment receipt and mark the order as paid."""
        self.receipt_id = receipt_id
        self.status = "paid"
