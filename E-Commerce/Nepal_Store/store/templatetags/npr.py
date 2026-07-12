from decimal import Decimal

from django import template

register = template.Library()


@register.filter
def npr(value):
    """Format a price as 'Rs. 1,250' (drop trailing .00, keep other decimals)."""
    if value is None:
        return ''
    amount = Decimal(value)
    if amount == amount.to_integral_value():
        return f'Rs. {amount:,.0f}'
    return f'Rs. {amount:,.2f}'
