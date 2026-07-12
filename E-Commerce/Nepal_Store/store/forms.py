from django import forms

from .models import Order


class CheckoutForm(forms.ModelForm):
    class Meta:
        model = Order
        fields = ['customer_name', 'phone', 'address_landmark', 'notes']
        labels = {
            'customer_name': 'Full name',
            'phone': 'Phone number',
            'address_landmark': 'Delivery address / landmark',
            'notes': 'Order notes (optional)',
        }
        help_texts = {
            'address_landmark': "Include a nearby landmark - we'll call to "
                                'confirm the exact location.',
            'phone': "We'll call this number to confirm your order.",
        }
        widgets = {
            'customer_name': forms.TextInput(attrs={'placeholder': 'Your full name'}),
            'phone': forms.TextInput(attrs={
                'placeholder': 'e.g. 98XXXXXXXX', 'inputmode': 'tel',
            }),
            'address_landmark': forms.Textarea(attrs={
                'rows': 3,
                'placeholder': 'e.g. Boudha, near Hyatt gate, blue house '
                               'opposite the pharmacy',
            }),
            'notes': forms.Textarea(attrs={
                'rows': 2, 'placeholder': 'Anything we should know?',
            }),
        }
