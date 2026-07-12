from django.db import models


class Category(models.Model):
    name = models.CharField(max_length=100, unique=True)

    class Meta:
        verbose_name_plural = 'categories'
        ordering = ['name']

    def __str__(self):
        return self.name


class Product(models.Model):
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    price = models.DecimalField('price (NPR)', max_digits=10, decimal_places=2)
    photo = models.ImageField(upload_to='products/', blank=True)
    stock_quantity = models.PositiveIntegerField(default=0)
    use_occasions = models.CharField(max_length=300, blank=True, help_text='e.g. Weddings, Festivals, Gifting')
    size_info = models.CharField('size / weight', max_length=100, blank=True, help_text='e.g. 250g or 30cm × 180cm')
    pack_info = models.CharField('pack size', max_length=100, blank=True, help_text='e.g. 1 piece or Set of 2')
    origin = models.CharField(max_length=100, blank=True, help_text='e.g. Ilam, Nepal or Patan, Kathmandu')
    category = models.ForeignKey(
        Category, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='products',
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.name

    @property
    def in_stock(self):
        return self.stock_quantity > 0


class Order(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        CONFIRMED = 'confirmed', 'Confirmed'
        DELIVERED = 'delivered', 'Delivered'

    customer_name = models.CharField(max_length=200)
    phone = models.CharField(max_length=20)
    address_landmark = models.TextField(
        help_text='Free-text address with a nearby landmark',
    )
    notes = models.TextField(blank=True)
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.PENDING,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'Order #{self.pk} - {self.customer_name}'

    @property
    def total(self):
        return sum(item.subtotal for item in self.items.all())


class OrderItem(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name='items')
    product = models.ForeignKey(Product, on_delete=models.PROTECT)
    quantity = models.PositiveIntegerField(default=1)
    price_at_order_time = models.DecimalField(max_digits=10, decimal_places=2)

    def __str__(self):
        return f'{self.quantity} x {self.product.name}'

    @property
    def subtotal(self):
        return self.price_at_order_time * self.quantity
