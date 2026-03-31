-- Add missing indexes on marketplace_requests for dashboard and filtering queries
CREATE INDEX IF NOT EXISTS idx_marketplace_requests_created_at ON marketplace_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_marketplace_requests_resolved_at ON marketplace_requests(resolved_at);
CREATE INDEX IF NOT EXISTS idx_marketplace_requests_resolved_talent_id ON marketplace_requests(resolved_talent_id);
