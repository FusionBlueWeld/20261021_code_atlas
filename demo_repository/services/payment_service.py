"""In-memory payment behavior used by the order service."""


class PaymentService:
    """Accept valid positive charges without contacting an external provider."""

    def charge(self, amount: int) -> str:
        """Return a deterministic receipt ID for a positive amount."""
        if amount <= 0:
            raise ValueError("payment amount must be positive")
        return f"receipt-{amount}"
