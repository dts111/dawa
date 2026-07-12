from django.contrib import messages
from django.db import transaction
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from .cart import Cart
from .forms import CheckoutForm
from .models import Order, OrderItem, Product


def home(request):
    featured = Product.objects.filter(is_active=True).select_related('category')[:4]
    return render(request, 'store/home.html', {'featured': featured})


def catalog(request):
    products = Product.objects.filter(is_active=True).select_related('category')
    cart = Cart(request)
    return render(request, 'store/catalog.html', {'products': products, 'cart': cart})


def product_detail(request, pk):
    product = get_object_or_404(Product, pk=pk, is_active=True)
    return render(request, 'store/product_detail.html', {'product': product})


@require_POST
def cart_add(request, pk):
    product = get_object_or_404(Product, pk=pk, is_active=True)
    if not product.in_stock:
        messages.error(request, f'Sorry, "{product.name}" is out of stock.')
        return redirect('store:product_detail', pk=pk)
    try:
        quantity = max(1, int(request.POST.get('quantity', 1)))
    except (TypeError, ValueError):
        quantity = 1
    Cart(request).add(product, quantity)
    messages.success(request, f'Added "{product.name}" to your cart.')
    next_url = request.POST.get('next', '')
    if next_url and next_url.startswith('/'):
        return redirect(next_url)
    return redirect('store:cart')


@require_POST
def cart_update(request, pk):
    product = get_object_or_404(Product, pk=pk)
    cart = Cart(request)
    try:
        quantity = int(request.POST.get('quantity', 1))
    except (TypeError, ValueError):
        quantity = 1
    if quantity <= 0:
        cart.remove(product)
    else:
        cart.add(product, quantity, replace=True)
    next_url = request.POST.get('next', '')
    if next_url and next_url.startswith('/'):
        return redirect(next_url)
    return redirect('store:cart')


@require_POST
def cart_remove(request, pk):
    product = get_object_or_404(Product, pk=pk)
    Cart(request).remove(product)
    next_url = request.POST.get('next', '')
    if next_url and next_url.startswith('/'):
        return redirect(next_url)
    return redirect('store:cart')


def cart_view(request):
    return render(request, 'store/cart.html', {'cart': Cart(request)})


def checkout(request):
    cart = Cart(request)
    if cart.is_empty():
        messages.info(request, 'Your cart is empty.')
        return redirect('store:catalog')

    if request.method == 'POST':
        form = CheckoutForm(request.POST)
        if form.is_valid():
            with transaction.atomic():
                order = form.save()
                for line in cart:
                    product = line['product']
                    OrderItem.objects.create(
                        order=order,
                        product=product,
                        quantity=line['quantity'],
                        price_at_order_time=product.price,
                    )
                    product.stock_quantity = max(
                        0, product.stock_quantity - line['quantity'])
                    product.save(update_fields=['stock_quantity'])
            cart.clear()
            return redirect('store:order_confirmation', pk=order.pk)
    else:
        form = CheckoutForm()

    return render(request, 'store/checkout.html', {'cart': cart, 'form': form})


def order_confirmation(request, pk):
    order = get_object_or_404(Order, pk=pk)
    return render(request, 'store/order_confirmation.html', {'order': order})


def about(request):
    return render(request, 'store/about.html')


def contact(request):
    return render(request, 'store/contact.html')
