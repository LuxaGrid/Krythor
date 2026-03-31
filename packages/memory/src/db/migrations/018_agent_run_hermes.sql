-- Migration 018: Hermes Engine fields on agent_runs
-- Adds JSON blob columns for plan, execution trace, and verification result
-- produced by the Hermes reasoning loop (v0.7.0).

ALTER TABLE agent_runs ADD COLUMN plan_json                TEXT;
ALTER TABLE agent_runs ADD COLUMN trace_json               TEXT;
ALTER TABLE agent_runs ADD COLUMN verification_result_json TEXT;
