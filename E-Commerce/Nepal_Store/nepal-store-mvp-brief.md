# Nepal single-seller e-commerce MVP — build brief

## Context
I'm building a single-seller e-commerce site to sell products in Nepal. This is the MVP phase — get something real and usable live before adding payment gateway or delivery API integrations. Cash on Delivery only for now.

## Tech stack
- **Backend + admin**: Django (Python)
- **Database**: SQLite for now (Postgres later if it grows)
- **Photos**: Django `ImageField`, stored locally on disk for now — structure the code so this can swap to Cloudflare R2 (S3-compatible) later without a rewrite
- **Frontend**: Django templates (server-rendered), keep it simple and clean — no separate JS framework needed for MVP
- **Deployment target (later)**: Railway or Render

## What "done" looks like for the MVP
A customer can browse products, add to cart, and place a Cash on Delivery order with a landmark-based address. I can log into Django admin to add/edit products (with photo upload) and see/update order status. No payment gateway, no delivery API — those come in a later phase.

## Pages needed
1. **Home / catalog** — grid of active products (photo, name, price)
2. **Product detail** — photo(s), description, price, stock status, "add to cart"
3. **Cart** — review items, adjust quantities, remove items, see total
4. **Checkout** — name, phone number, address/landmark description (Nepal doesn't have reliable house numbering, so this should be a free-text landmark field, not a structured street-address form), optional order notes
5. **Order confirmation** — order number, summary, "we'll call to confirm delivery"
6. **Django admin** — product CRUD with photo upload; order list with status field (pending / confirmed / delivered) editable inline

## Data model (core)
- **Product**: name, description, price (NPR), photo (ImageField, support multiple photos later), stock_quantity, category, is_active
- **Order**: customer_name, phone, address_landmark, notes, status (pending/confirmed/delivered), created_at
- **OrderItem**: order (FK), product (FK), quantity, price_at_order_time

## Cart behavior
Session-based cart (no user accounts needed for MVP — guest checkout only). Cart persists in the Django session until checkout completes.

## Explicit non-goals for this phase
- No payment gateway integration (eSewa/Khalti come later — fee structure isn't finalized and merchant registration takes time, so don't block the MVP on it)
- No delivery partner API integration (Pathao/NCM come later — self/manual delivery coordination for now)
- No user accounts/login for customers
- No multi-vendor support — single seller only

## Design notes
- Keep the UI simple and mobile-first — most Nepal customers will browse on phones
- Prices in NPR, formatted clearly (e.g. "Rs. 1,250")
- Landmark-based address field should have helper text, e.g. "Include a nearby landmark — we'll call to confirm exact location"

## Current progress
A Django project (`config`) and app (`store`) have already been scaffolded with Django + Pillow installed. Models, admin, views, templates, and the cart/checkout flow still need to be built out.

## What I'd like help with
Build out the full MVP per the scope above: models, migrations, Django admin config, views, URL routing, templates (keep styling clean and minimal — plain CSS is fine, no need for a frontend framework), and the session-based cart/checkout flow. Confirm the app runs locally (`python manage.py runserver`) with sample product data before wrapping up.
