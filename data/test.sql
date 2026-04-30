-- =========================
-- CORE
-- =========================
CREATE TABLE t01_users (id INT PRIMARY KEY, name VARCHAR(100));
CREATE TABLE t02_roles (id INT PRIMARY KEY, name VARCHAR(100));
CREATE TABLE t03_user_roles (
    id INT PRIMARY KEY,
    user_id INT,
    role_id INT,
    FOREIGN KEY (user_id) REFERENCES t01_users(id),
    FOREIGN KEY (role_id) REFERENCES t02_roles(id)
);

-- =========================
-- ORG
-- =========================
CREATE TABLE t04_companies (id INT PRIMARY KEY, name VARCHAR(100));
CREATE TABLE t05_departments (
    id INT PRIMARY KEY,
    company_id INT,
    FOREIGN KEY (company_id) REFERENCES t04_companies(id)
);
CREATE TABLE t06_employees (
    id INT PRIMARY KEY,
    department_id INT,
    manager_id INT,
    FOREIGN KEY (department_id) REFERENCES t05_departments(id),
    FOREIGN KEY (manager_id) REFERENCES t06_employees(id)
);

-- =========================
-- PRODUCT
-- =========================
CREATE TABLE t07_categories (
    id INT PRIMARY KEY,
    parent_id INT,
    FOREIGN KEY (parent_id) REFERENCES t07_categories(id)
);
CREATE TABLE t08_brands (id INT PRIMARY KEY, name VARCHAR(100));
CREATE TABLE t09_products (
    id INT PRIMARY KEY,
    category_id INT,
    brand_id INT,
    FOREIGN KEY (category_id) REFERENCES t07_categories(id),
    FOREIGN KEY (brand_id) REFERENCES t08_brands(id)
);
CREATE TABLE t10_variants (
    id INT PRIMARY KEY,
    product_id INT,
    FOREIGN KEY (product_id) REFERENCES t09_products(id)
);

-- =========================
-- INVENTORY
-- =========================
CREATE TABLE t11_warehouses (id INT PRIMARY KEY, name VARCHAR(100));
CREATE TABLE t12_inventory (
    product_id INT,
    warehouse_id INT,
    PRIMARY KEY (product_id, warehouse_id),
    FOREIGN KEY (product_id) REFERENCES t09_products(id),
    FOREIGN KEY (warehouse_id) REFERENCES t11_warehouses(id)
);
CREATE TABLE t13_inventory_logs (
    id INT PRIMARY KEY,
    product_id INT,
    warehouse_id INT,
    FOREIGN KEY (product_id) REFERENCES t09_products(id),
    FOREIGN KEY (warehouse_id) REFERENCES t11_warehouses(id)
);

-- =========================
-- CUSTOMER
-- =========================
CREATE TABLE t14_customers (id INT PRIMARY KEY, name VARCHAR(100));
CREATE TABLE t15_addresses (
    id INT PRIMARY KEY,
    customer_id INT,
    FOREIGN KEY (customer_id) REFERENCES t14_customers(id)
);

-- =========================
-- ORDER
-- =========================
CREATE TABLE t16_orders (
    id INT PRIMARY KEY,
    customer_id INT,
    employee_id INT,
    FOREIGN KEY (customer_id) REFERENCES t14_customers(id),
    FOREIGN KEY (employee_id) REFERENCES t06_employees(id)
);
CREATE TABLE t17_order_items (
    order_id INT,
    product_id INT,
    PRIMARY KEY (order_id, product_id),
    FOREIGN KEY (order_id) REFERENCES t16_orders(id),
    FOREIGN KEY (product_id) REFERENCES t09_products(id)
);
CREATE TABLE t18_order_item_variants (
    order_id INT,
    product_id INT,
    variant_id INT,
    PRIMARY KEY (order_id, product_id, variant_id),
    FOREIGN KEY (order_id, product_id) REFERENCES t17_order_items(order_id, product_id),
    FOREIGN KEY (variant_id) REFERENCES t10_variants(id)
);

-- =========================
-- PAYMENT
-- =========================
CREATE TABLE t19_invoices (
    id INT PRIMARY KEY,
    order_id INT,
    FOREIGN KEY (order_id) REFERENCES t16_orders(id)
);
CREATE TABLE t20_payments (
    id INT PRIMARY KEY,
    invoice_id INT,
    FOREIGN KEY (invoice_id) REFERENCES t19_invoices(id)
);

-- =========================
-- SHIPPING
-- =========================
CREATE TABLE t21_shipments (
    id INT PRIMARY KEY,
    order_id INT,
    FOREIGN KEY (order_id) REFERENCES t16_orders(id)
);
CREATE TABLE t22_shipment_items (
    shipment_id INT,
    product_id INT,
    PRIMARY KEY (shipment_id, product_id),
    FOREIGN KEY (shipment_id) REFERENCES t21_shipments(id),
    FOREIGN KEY (product_id) REFERENCES t09_products(id)
);

-- =========================
-- PROMOTION
-- =========================
CREATE TABLE t23_promotions (id INT PRIMARY KEY, name VARCHAR(100));
CREATE TABLE t24_product_promotions (
    product_id INT,
    promo_id INT,
    PRIMARY KEY (product_id, promo_id),
    FOREIGN KEY (product_id) REFERENCES t09_products(id),
    FOREIGN KEY (promo_id) REFERENCES t23_promotions(id)
);

-- =========================
-- TAGGING
-- =========================
CREATE TABLE t25_tags (id INT PRIMARY KEY, name VARCHAR(100));
CREATE TABLE t26_product_tags (
    product_id INT,
    tag_id INT,
    PRIMARY KEY (product_id, tag_id),
    FOREIGN KEY (product_id) REFERENCES t09_products(id),
    FOREIGN KEY (tag_id) REFERENCES t25_tags(id)
);

-- =========================
-- LOGGING
-- =========================
CREATE TABLE t27_logs (id INT PRIMARY KEY, action VARCHAR(100));
CREATE TABLE t28_audit_logs (id INT PRIMARY KEY, table_name VARCHAR(100));

-- =========================
-- EXTRA TABLES (เพิ่ม volume)
-- =========================
CREATE TABLE t29_extra1 (id INT PRIMARY KEY, ref INT);
CREATE TABLE t30_extra2 (id INT PRIMARY KEY, ref INT);
CREATE TABLE t31_extra3 (id INT PRIMARY KEY, ref INT);
CREATE TABLE t32_extra4 (id INT PRIMARY KEY, ref INT);
CREATE TABLE t33_extra5 (id INT PRIMARY KEY, ref INT);
CREATE TABLE t34_extra6 (id INT PRIMARY KEY, ref INT);
CREATE TABLE t35_extra7 (id INT PRIMARY KEY, ref INT);
CREATE TABLE t36_extra8 (id INT PRIMARY KEY, ref INT);
CREATE TABLE t37_extra9 (id INT PRIMARY KEY, ref INT);
CREATE TABLE t38_extra10 (id INT PRIMARY KEY, ref INT);
CREATE TABLE t39_extra11 (id INT PRIMARY KEY, ref INT);
CREATE TABLE t40_extra12 (id INT PRIMARY KEY, ref INT);
CREATE TABLE t41_extra13 (id INT PRIMARY KEY, ref INT);
CREATE TABLE t42_extra14 (id INT PRIMARY KEY, ref INT);
CREATE TABLE t43_extra15 (id INT PRIMARY KEY, ref INT);
CREATE TABLE t44_extra16 (id INT PRIMARY KEY, ref INT);
CREATE TABLE t45_extra17 (id INT PRIMARY KEY, ref INT);
CREATE TABLE t46_extra18 (id INT PRIMARY KEY, ref INT);
CREATE TABLE t47_extra19 (id INT PRIMARY KEY, ref INT);
CREATE TABLE t48_extra20 (id INT PRIMARY KEY, ref INT);
CREATE TABLE t49_extra21 (id INT PRIMARY KEY, ref INT);
CREATE TABLE t50_extra22 (id INT PRIMARY KEY, ref INT);