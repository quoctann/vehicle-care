-- name: ListPartTypes :many
SELECT id, code, name_vi, display_order, active, seed_version
FROM part_types
ORDER BY display_order;
