"""In-memory persistence for orders."""

from models.order import Order


class OrderRepository:
    """Store orders in a process-local dictionary."""

    def __init__(self) -> None:
        """Initialize an empty order store."""
        self._orders: dict[str, Order] = {}
        self._next_id = 1

    def save(self, order: Order) -> Order:
        """Assign an ID and store the order, then return it."""
        if order.order_id == "pending":
            order.order_id = f"order-{self._next_id}"
            self._next_id += 1
        self._orders[order.order_id] = order
        return order

    def find_by_id(self, order_id: str) -> Order | None:
        """Look up an order by its identifier."""
        return self._orders.get(order_id)
