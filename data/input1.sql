CREATE TABLE emPosition_reStructure (
	PositionID varchar(36) COLLATE Thai_CI_AS NOT NULL,
	PositionCode nvarchar(50) COLLATE Thai_CI_AS NOT NULL,
	PositionName nvarchar(255) COLLATE Thai_CI_AS NOT NULL,
	PositionNameEng nvarchar(255) COLLATE Thai_CI_AS NULL,
	Remark nvarchar(500) COLLATE Thai_CI_AS NULL,
	ReportTo varchar(36) COLLATE Thai_CI_AS NULL,
	OrgUnitID varchar(36) COLLATE Thai_CI_AS NULL,
	CreatedBy varchar(36) COLLATE Thai_CI_AS NULL,
	CreatedDate datetime NULL,
	ModifiedBy varchar(36) COLLATE Thai_CI_AS NULL,
	ModifiedDate datetime NULL,
	IsDeleted bit NULL,
	IsInactive bit NULL,
	PositionType nvarchar(25) COLLATE Thai_CI_AS NULL,
	SourceDB nvarchar(50) COLLATE Thai_CI_AS NOT NULL
);