-- هاتف المشتري (شخص من خارج المركز) عند بيع منتج
ALTER TABLE product_sales ADD COLUMN IF NOT EXISTS buyer_phone TEXT;
