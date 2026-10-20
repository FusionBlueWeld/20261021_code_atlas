"""Validation helpers for order input."""


def validate_order_input(
    customer_email: str,
    product_name: str,
    quantity: int,
    unit_price: int,
) -> None:
    """Raise ``ValueError`` when order fields do not meet basic rules."""
    if "@" not in customer_email:
        raise ValueError("customer email must contain @")
    if not product_name.strip():
        raise ValueError("product name must not be empty")
    if quantity < 1:
        raise ValueError("quantity must be at least 1")
    if unit_price < 1:
        raise ValueError("unit price must be at least 1")
