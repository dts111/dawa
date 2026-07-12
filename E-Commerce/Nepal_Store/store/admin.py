from django.contrib import admin
from django.utils.html import format_html

from .models import Category, Order, OrderItem, Product


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ['name']


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ['photo_thumb', 'name', 'price', 'stock_quantity',
                    'category', 'is_active']
    list_display_links = ['photo_thumb', 'name']
    list_editable = ['price', 'stock_quantity', 'is_active']
    list_filter = ['is_active', 'category']
    search_fields = ['name', 'description']
    fieldsets = [
        (None, {'fields': ['name', 'category', 'is_active']}),
        ('Pricing & Stock', {'fields': ['price', 'stock_quantity']}),
        ('Photo', {'fields': ['photo']}),
        ('Description', {'fields': ['description']}),
        ('Product Details', {'fields': ['use_occasions', 'size_info', 'pack_info', 'origin'],
                             'description': 'Optional extra info shown on the product page.'}),
    ]

    @admin.display(description='photo')
    def photo_thumb(self, obj):
        if obj.photo:
            return format_html(
                '<img src="{}" style="height:40px;border-radius:4px;">',
                obj.photo.url,
            )
        return '-'


class OrderItemInline(admin.TabularInline):
    model = OrderItem
    extra = 0
    readonly_fields = ['price_at_order_time', 'subtotal']

    @admin.display(description='subtotal (NPR)')
    def subtotal(self, obj):
        if obj.pk and obj.price_at_order_time is not None:
            return obj.subtotal
        return '-'


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ['id', 'customer_name', 'phone', 'status',
                    'order_total', 'created_at']
    list_editable = ['status']
    list_filter = ['status', 'created_at']
    search_fields = ['customer_name', 'phone']
    inlines = [OrderItemInline]
    readonly_fields = ['created_at']

    @admin.display(description='total (NPR)')
    def order_total(self, obj):
        return obj.total
