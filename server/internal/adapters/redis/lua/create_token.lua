-- Atomically supersede any previous one-time token for (kind, accountID)
-- with a new one, keeping the token value -> accountID record and the
-- accountID -> token-hash reverse index in sync in a single round trip.
--
-- KEYS[1] = token_index:<kind>:<accountID>
-- ARGV[1] = kind
-- ARGV[2] = accountID
-- ARGV[3] = new token hash (hex sha256)
-- ARGV[4] = ttl in seconds (must be a positive integer; caller guarantees this)
local oldHash = redis.call('GET', KEYS[1])
if oldHash then
  redis.call('DEL', 'token:' .. ARGV[1] .. ':' .. oldHash)
end
redis.call('SET', 'token:' .. ARGV[1] .. ':' .. ARGV[3], ARGV[2], 'EX', ARGV[4])
redis.call('SET', KEYS[1], ARGV[3], 'EX', ARGV[4])
return 1
