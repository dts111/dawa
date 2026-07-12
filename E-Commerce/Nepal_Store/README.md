# Nepal Store - MVP

Single-seller e-commerce site for Nepal. Cash on Delivery only, guest checkout,
session-based cart, landmark-based delivery addresses.

## Run locally

    pip install -r requirements.txt
    python manage.py migrate
    python manage.py runserver

Then open http://127.0.0.1:8000

## Admin

http://127.0.0.1:8000/admin

- Username: admin
- Password: admin123  (change this: python manage.py changepassword admin)

Manage products (photo upload, price, stock, active flag) and orders
(status editable inline: pending / confirmed / delivered).

## What's included

- 6 sample products with placeholder photos (replace via admin)
- Session cart: add / update quantity / remove, stock-clamped
- Checkout: name, phone, free-text landmark address, optional notes
- Order confirmation page with order number and COD note
- Stock decrements automatically when an order is placed
- Prices formatted as "Rs. 1,250" via the `npr` template filter

## Later (structured for easy swap)

- Photos: swap `STORAGES['default']` in config/settings.py to
  django-storages S3 backend for Cloudflare R2 - no code changes needed
- Database: change `DATABASES` to Postgres
- Payments (eSewa/Khalti) and delivery APIs (Pathao/NCM) per the brief
