"""Session-based cart. Stored as {product_id: quantity} in the session."""
from decimal import Decimal

from django.conf import settings

from .models import Product


class Cart:
    def __init__(self, request):
        self.session = request.session
        cart = self.session.get(settings.CART_SESSION_KEY)
        if cart is None:
            cart = self.session[settings.CART_SESSION_KEY] = {}
        self.cart = cart

    def _save(self):
        self.session.modified = True

    def add(self, product, quantity=1, replace=False):
        pid = str(product.pk)
        new_qty = quantity if replace else self.cart.get(pid, 0) + quantity
        # Never allow more than available stock
        self.cart[pid] = max(1, min(new_qty, product.stock_quantity))
        self._save()

    def remove(self, product):
        self.cart.pop(str(product.pk), None)
        self._save()

    def clear(self):
        self.session[settings.CART_SESSION_KEY] = {}
        self.cart = self.session[settings.CART_SESSION_KEY]
        self._save()

    def __len__(self):
        return sum(self.cart.values())

    def __iter__(self):
        """Yield cart lines with live product data."""
        products = Product.objects.filter(pk__in=self.cart.keys(), is_active=True)
        for product in products:
            quantity = self.cart[str(product.pk)]
            yield {
                'product': product,
                'quantity': quantity,
                'subtotal': product.price * quantity,
            }

    @property
    def total(self):
        return sum((line['subtotal'] for line in self), Decimal('0'))

    def is_empty(self):
        return len(self.cart) == 0
