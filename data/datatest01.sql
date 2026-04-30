-- =========================
-- ORGANIZATION STRUCTURE
-- =========================

CREATE TABLE companies (
    company_id INT PRIMARY KEY,
    company_name VARCHAR(255) NOT NULL,
    tax_id VARCHAR(50) UNIQUE,
    created_at TIMESTAMP
);

CREATE TABLE departments (
    department_id INT PRIMARY KEY,
    company_id INT,
    parent_department_id INT,
    department_name VARCHAR(255),
    FOREIGN KEY (company_id) REFERENCES companies(company_id),
    FOREIGN KEY (parent_department_id) REFERENCES departments(department_id)
);

CREATE TABLE employees (
    employee_id INT PRIMARY KEY,
    department_id INT,
    manager_id INT,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    email VARCHAR(100) UNIQUE,
    salary DECIMAL(12,2),
    hire_date DATE,
    FOREIGN KEY (department_id) REFERENCES departments(department_id),
    FOREIGN KEY (manager_id) REFERENCES employees(employee_id)
);

-- =========================
-- AUTH SYSTEM
-- =========================

CREATE TABLE roles (
    role_id INT PRIMARY KEY,
    role_name VARCHAR(100) UNIQUE
);

CREATE TABLE permissions (
    permission_id INT PRIMARY KEY,
    permission_name VARCHAR(100)
);

CREATE TABLE role_permissions (
    role_id INT,
    permission_id INT,
    PRIMARY KEY (role_id, permission_id),
    FOREIGN KEY (role_id) REFERENCES roles(role_id),
    FOREIGN KEY (permission_id) REFERENCES permissions(permission_id)
);

CREATE TABLE employee_roles (
    employee_id INT,
    role_id INT,
    assigned_at TIMESTAMP,
    PRIMARY KEY (employee_id, role_id),
    FOREIGN KEY (employee_id) REFERENCES employees(employee_id),
    FOREIGN KEY (role_id) REFERENCES roles(role_id)
);

-- =========================
-- PRODUCT SYSTEM
-- =========================

CREATE TABLE categories (
    category_id INT PRIMARY KEY,
    parent_id INT,
    category_name VARCHAR(255),
    FOREIGN KEY (parent_id) REFERENCES categories(category_id)
);

CREATE TABLE brands (
    brand_id INT PRIMARY KEY,
    brand_name VARCHAR(100)
);

CREATE TABLE products (
    product_id INT PRIMARY KEY,
    sku VARCHAR(100) UNIQUE,
    product_name VARCHAR(255),
    category_id INT,
    brand_id INT,
    cost DECIMAL(10,2),
    price DECIMAL(10,2),
    created_at TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(category_id),
    FOREIGN KEY (brand_id) REFERENCES brands(brand_id)
);

CREATE TABLE product_variants (
    variant_id INT PRIMARY KEY,
    product_id INT,
    variant_name VARCHAR(100),
    additional_price DECIMAL(10,2),
    FOREIGN KEY (product_id) REFERENCES products(product_id)
);

-- =========================
-- INVENTORY
-- =========================

CREATE TABLE warehouses (
    warehouse_id INT PRIMARY KEY,
    warehouse_name VARCHAR(255)
);

CREATE TABLE inventory (
    product_id INT,
    warehouse_id INT,
    quantity INT,
    PRIMARY KEY (product_id, warehouse_id),
    FOREIGN KEY (product_id) REFERENCES products(product_id),
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(warehouse_id)
);

CREATE TABLE inventory_logs (
    log_id INT PRIMARY KEY,
    product_id INT,
    warehouse_id INT,
    change_qty INT,
    reason VARCHAR(255),
    created_at TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(product_id),
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(warehouse_id)
);

-- =========================
-- CUSTOMER
-- =========================

CREATE TABLE customers (
    customer_id INT PRIMARY KEY,
    email VARCHAR(100) UNIQUE,
    full_name VARCHAR(255),
    created_at TIMESTAMP
);

CREATE TABLE customer_addresses (
    address_id INT PRIMARY KEY,
    customer_id INT,
    address TEXT,
    city VARCHAR(100),
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
);

-- =========================
-- ORDERS (COMPLEX)
-- =========================

CREATE TABLE orders (
    order_id INT PRIMARY KEY,
    customer_id INT,
    employee_id INT,
    order_status VARCHAR(50),
    created_at TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id),
    FOREIGN KEY (employee_id) REFERENCES employees(employee_id)
);

CREATE TABLE order_items (
    order_id INT,
    product_id INT,
    quantity INT,
    price DECIMAL(10,2),
    PRIMARY KEY (order_id, product_id),
    FOREIGN KEY (order_id) REFERENCES orders(order_id),
    FOREIGN KEY (product_id) REFERENCES products(product_id)
);

CREATE TABLE order_item_variants (
    order_id INT,
    product_id INT,
    variant_id INT,
    PRIMARY KEY (order_id, product_id, variant_id),
    FOREIGN KEY (order_id, product_id) REFERENCES order_items(order_id, product_id),
    FOREIGN KEY (variant_id) REFERENCES product_variants(variant_id)
);

-- =========================
-- PAYMENTS & BILLING
-- =========================

CREATE TABLE invoices (
    invoice_id INT PRIMARY KEY,
    order_id INT,
    invoice_number VARCHAR(100),
    total DECIMAL(12,2),
    FOREIGN KEY (order_id) REFERENCES orders(order_id)
);

CREATE TABLE payments (
    payment_id INT PRIMARY KEY,
    invoice_id INT,
    payment_method VARCHAR(50),
    amount DECIMAL(12,2),
    paid_at TIMESTAMP,
    FOREIGN KEY (invoice_id) REFERENCES invoices(invoice_id)
);

-- =========================
-- SHIPPING
-- =========================

CREATE TABLE shipments (
    shipment_id INT PRIMARY KEY,
    order_id INT,
    tracking_number VARCHAR(100),
    carrier VARCHAR(100),
    FOREIGN KEY (order_id) REFERENCES orders(order_id)
);

CREATE TABLE shipment_items (
    shipment_id INT,
    product_id INT,
    quantity INT,
    PRIMARY KEY (shipment_id, product_id),
    FOREIGN KEY (shipment_id) REFERENCES shipments(shipment_id),
    FOREIGN KEY (product_id) REFERENCES products(product_id)
);

-- =========================
-- PROMOTIONS (MANY-TO-MANY)
-- =========================

CREATE TABLE promotions (
    promo_id INT PRIMARY KEY,
    promo_name VARCHAR(255),
    discount DECIMAL(5,2)
);

CREATE TABLE product_promotions (
    product_id INT,
    promo_id INT,
    PRIMARY KEY (product_id, promo_id),
    FOREIGN KEY (product_id) REFERENCES products(product_id),
    FOREIGN KEY (promo_id) REFERENCES promotions(promo_id)
);

-- =========================
-- TAGGING SYSTEM
-- =========================

CREATE TABLE tags (
    tag_id INT PRIMARY KEY,
    tag_name VARCHAR(100)
);

CREATE TABLE product_tags (
    product_id INT,
    tag_id INT,
    PRIMARY KEY (product_id, tag_id),
    FOREIGN KEY (product_id) REFERENCES products(product_id),
    FOREIGN KEY (tag_id) REFERENCES tags(tag_id)
);

-- =========================
-- AUDIT + SOFT DELETE
-- =========================

CREATE TABLE audit_logs (
    audit_id INT PRIMARY KEY,
    table_name VARCHAR(100),
    record_id INT,
    action VARCHAR(50),
    old_value TEXT,
    new_value TEXT,
    changed_at TIMESTAMP
);

CREATE TABLE soft_delete_logs (
    id INT PRIMARY KEY,
    table_name VARCHAR(100),
    record_id INT,
    deleted_at TIMESTAMP
);