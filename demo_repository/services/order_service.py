"""Use cases for creating and retrieving orders."""

from models.order import Order
from repositories.order_repository import OrderRepository
from services.payment_service import PaymentService
from utils.validators import validate_order_input


class OrderService:
    """Coordinate validation, payment, and order persistence."""

    def __init__(self, repository: OrderRepository, payment_service: PaymentService) -> None:
        """Initialize the service with its collaborating components."""
        self.repository = repository
        self.payment_service = payment_service

    def create_order(
        self,
        customer_email: str,
        product_name: str,
        quantity: int,
        unit_price: int,
    ) -> Order:
        """Validate and create a paid order in the repository."""
        validate_order_input(customer_email, product_name, quantity, unit_price)
        order = Order(
            customer_email=customer_email,
            product_name=product_name,
            quantity=quantity,
            unit_price=unit_price,
        )
        order.mark_paid(self.payment_service.charge(order.total_amount))
        return self.repository.save(order)

    def find_order(self, order_id: str) -> Order | None:
        """Return an order by ID, or ``None`` when it is not stored."""
        return self.repository.find_by_id(order_id)
