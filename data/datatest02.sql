-- =========================
-- USERS
-- =========================
CREATE TABLE users (
    user_id INT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    phone VARCHAR(20),
    status VARCHAR(20) DEFAULT 'ACTIVE',
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP,
    deleted_at TIMESTAMP
);

-- =========================
-- ROLES & PERMISSIONS
-- =========================
CREATE TABLE roles (
    role_id INT PRIMARY KEY,
    role_name VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE permissions (
    permission_id INT PRIMARY KEY,
    permission_name VARCHAR(100),
    module VARCHAR(50),
    created_at TIMESTAMP
);

CREATE TABLE user_roles (
    id INT PRIMARY KEY,
    user_id INT NOT NULL,
    role_id INT NOT NULL,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (role_id) REFERENCES roles(role_id)
);

-- =========================
-- CUSTOMER
-- =========================
CREATE TABLE customers (
    customer_id INT PRIMARY KEY,
    customer_code VARCHAR(50) UNIQUE,
    full_name VARCHAR(150),
    email VARCHAR(100),
    phone VARCHAR(20),
    date_of_birth DATE,
    gender VARCHAR(10),
    status VARCHAR(20) DEFAULT 'ACTIVE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP
);

CREATE TABLE customer_addresses (
    address_id INT PRIMARY KEY,
    customer_id INT,
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    city VARCHAR(100),
    province VARCHAR(100),
    postal_code VARCHAR(20),
    country VARCHAR(50),
    is_default BOOLEAN,
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
);

-- =========================
-- PRODUCT
-- =========================
CREATE TABLE categories (
    category_id INT PRIMARY KEY,
    category_name VARCHAR(100),
    parent_id INT,
    created_at TIMESTAMP
);

CREATE TABLE suppliers (
    supplier_id INT PRIMARY KEY,
    supplier_name VARCHAR(150),
    contact_name VARCHAR(100),
    phone VARCHAR(20),
    email VARCHAR(100),
    address TEXT,
    created_at TIMESTAMP
);

CREATE TABLE products (
    product_id INT PRIMARY KEY,
    sku VARCHAR(50) UNIQUE,
    product_name VARCHAR(150),
    description TEXT,
    category_id INT,
    supplier_id INT,
    cost_price DECIMAL(10,2),
    selling_price DECIMAL(10,2),
    status VARCHAR(20),
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(category_id),
    FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id)
);

-- =========================
-- INVENTORY
-- =========================
CREATE TABLE warehouses (
    warehouse_id INT PRIMARY KEY,
    warehouse_name VARCHAR(100),
    location VARCHAR(255),
    created_at TIMESTAMP
);

CREATE TABLE inventory (
    inventory_id INT PRIMARY KEY,
    product_id INT,
    warehouse_id INT,
    stock_qty INT,
    reserved_qty INT,
    reorder_level INT,
    last_updated TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(product_id),
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(warehouse_id)
);

-- =========================
-- ORDERS
-- =========================
CREATE TABLE orders (
    order_id INT PRIMARY KEY,
    order_number VARCHAR(50) UNIQUE,
    customer_id INT,
    order_status VARCHAR(50),
    order_date TIMESTAMP,
    total_amount DECIMAL(12,2),
    discount_amount DECIMAL(12,2),
    net_amount DECIMAL(12,2),
    created_at TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
);

CREATE TABLE order_items (
    order_item_id INT PRIMARY KEY,
    order_id INT,
    product_id INT,
    quantity INT,
    unit_price DECIMAL(10,2),
    discount DECIMAL(10,2),
    total_price DECIMAL(12,2),
    FOREIGN KEY (order_id) REFERENCES orders(order_id),
    FOREIGN KEY (product_id) REFERENCES products(product_id)
);

-- =========================
-- PAYMENTS
-- =========================
CREATE TABLE payments (
    payment_id INT PRIMARY KEY,
    order_id INT,
    payment_method VARCHAR(50),
    payment_status VARCHAR(50),
    transaction_ref VARCHAR(100),
    paid_amount DECIMAL(12,2),
    paid_at TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(order_id)
);

-- =========================
-- SHIPPING
-- =========================
CREATE TABLE shipments (
    shipment_id INT PRIMARY KEY,
    order_id INT,
    tracking_number VARCHAR(100),
    carrier VARCHAR(100),
    shipping_status VARCHAR(50),
    shipped_at TIMESTAMP,
    delivered_at TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(order_id)
);

-- =========================
-- LOG & AUDIT
-- =========================
CREATE TABLE audit_logs (
    audit_id INT PRIMARY KEY,
    table_name VARCHAR(100),
    record_id INT,
    action VARCHAR(50),
    changed_by INT,
    changed_at TIMESTAMP,
    old_value TEXT,
    new_value TEXT
);