-- المنتجات (مثلًا «المرجع في العربية»): كل بيع يُحتسب مدخولًا في شهر تاريخه
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  price NUMERIC(10, 3) CHECK (price >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE product_sales (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
  child_id INTEGER REFERENCES program_children(id) ON DELETE SET NULL,
  buyer_name TEXT,
  qty INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_price NUMERIC(10, 3) NOT NULL CHECK (unit_price >= 0),
  amount NUMERIC(10, 3) NOT NULL CHECK (amount >= 0),
  sold_on DATE NOT NULL,
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX product_sales_sold_on_idx ON product_sales (sold_on);
CREATE INDEX product_sales_student_idx ON product_sales (student_id);
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_sales ENABLE ROW LEVEL SECURITY;
