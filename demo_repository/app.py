"""Entry point for the small in-memory order processing demo."""

from models.order import Order
from repositories.order_repository import OrderRepository
from services.order_service import OrderService
from services.payment_service import PaymentService


def build_order_service() -> OrderService:
    """Create an order service with its in-memory dependencies."""
    repository = OrderRepository()
    payment_service = PaymentService()
    return OrderService(repository, payment_service)


def submit_sample_order(service: OrderService) -> Order:
    """Submit one sample order and return the resulting order."""
    return service.create_order(
        customer_email="customer@example.com",
        product_name="Notebook",
        quantity=2,
        unit_price=1200,
    )


def main() -> None:
    """Run the demo entirely in memory, without network or file I/O."""
    service = build_order_service()
    order = submit_sample_order(service)
    print(f"Order {order.order_id}: {order.status}")


if __name__ == "__main__":
    main()
