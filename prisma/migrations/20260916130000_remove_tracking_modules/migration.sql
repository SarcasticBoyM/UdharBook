-- Permanently remove data owned exclusively by the retired School Transport
-- and Driver Tracking modules. Child tables are dropped before their parents
-- so no CASCADE can reach shared Shop or User records.
DROP TABLE IF EXISTS "SchoolTripPoint";
DROP TABLE IF EXISTS "SchoolTrackingLink";
DROP TABLE IF EXISTS "SchoolTrip";
DROP TABLE IF EXISTS "SchoolVehicle";
DROP TABLE IF EXISTS "SchoolTransportRoute";

DROP TABLE IF EXISTS "DriverLocationPoint";
DROP TABLE IF EXISTS "DriverTrackingLink";
DROP TABLE IF EXISTS "DriverTrip";

DROP TYPE IF EXISTS "DriverTripStatus";
