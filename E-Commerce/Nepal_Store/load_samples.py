from store.models import Category, Product

textiles, _ = Category.objects.get_or_create(name='Textiles')
food, _ = Category.objects.get_or_create(name='Food & Wellness')
crafts, _ = Category.objects.get_or_create(name='Crafts')

samples = [
    dict(name='Pashmina Shawl', price=3500, stock_quantity=20, category=textiles,
         photo='products/pashmina-shawl.jpg',
         description='Handwoven fine pashmina from Kathmandu. Warm, lightweight, and beautifully crafted.'),
    dict(name='Dhaka Topi', price=850, stock_quantity=30, category=textiles,
         photo='products/dhaka-topi.jpg',
         description='Traditional Nepali cap woven from Dhaka fabric. A timeless piece of Nepali culture.'),
    dict(name='Ilam Orthodox Tea (250g)', price=1200, stock_quantity=50, category=food,
         photo='products/ilam-orthodox-tea-250g.jpg',
         description='Premium hand-rolled orthodox tea from the hills of Ilam. Rich aroma, smooth taste.'),
    dict(name='Himalayan Pink Salt (1kg)', price=450, stock_quantity=100, category=food,
         photo='products/himalayan-pink-salt-1kg.jpg',
         description='Pure mineral-rich pink salt from the Himalayan region. Great for cooking and wellness.'),
    dict(name='Singing Bowl (Medium)', price=2200, stock_quantity=15, category=crafts,
         photo='products/singing-bowl-medium.jpg',
         description='Handcrafted bronze singing bowl from Patan artisans. Includes wooden striker.'),
    dict(name='Lokta Paper Notebook', price=650, stock_quantity=40, category=crafts,
         photo='products/lokta-paper-notebook.jpg',
         description='Handmade notebook from traditional lokta bark paper. Durable and eco-friendly.'),
]

for data in samples:
    obj, created = Product.objects.get_or_create(name=data['name'], defaults=data)
    print('Created' if created else 'Already exists', '-', obj.name)
