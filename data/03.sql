CREATE TABLE hrPayroll_Details (
    PayrollID UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),

    EmployeeID VARCHAR(36) COLLATE Thai_CI_AS NOT NULL,

    BaseSalary MONEY NULL 
        CHECK (BaseSalary >= 0),

    TaxRate DECIMAL(5, 2) NULL 
        CHECK (TaxRate BETWEEN 0 AND 100),

    SocialSecurityFund DECIMAL(18, 4) NULL
        CHECK (SocialSecurityFund >= 0),

    OT_Rate FLOAT NULL
        CHECK (OT_Rate >= 0),

    PaymentMethod INT NOT NULL,

    IsTaxExempt BIT DEFAULT 0,  

    PayrollNote NVARCHAR(MAX) COLLATE Thai_CI_AS NULL,

    CONSTRAINT PK_hrPayroll PRIMARY KEY (PayrollID),
-- Foreign Key Constraint
    CONSTRAINT FK_PaymentMethod 
        FOREIGN KEY (PaymentMethod) 
        REFERENCES PaymentMethod_Lookup(PaymentMethodID)
);