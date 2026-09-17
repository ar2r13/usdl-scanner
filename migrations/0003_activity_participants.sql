INSERT OR IGNORE INTO activity_accounts (chain_id, tx_hash, log_index, account)
SELECT activity.chain_id, activity.tx_hash, activity.log_index, activity.account
FROM activity
WHERE activity.account IS NOT NULL;

INSERT OR IGNORE INTO activity_accounts (chain_id, tx_hash, log_index, account)
SELECT raw_events.chain_id, raw_events.tx_hash, raw_events.log_index, lower(CAST(arguments.value AS TEXT))
FROM raw_events
JOIN activity ON activity.chain_id = raw_events.chain_id AND activity.tx_hash = raw_events.tx_hash AND activity.log_index = raw_events.log_index
JOIN json_each(raw_events.args_json) AS arguments
WHERE arguments.key IN ('account', 'operator', 'user', 'recipient', 'agent', 'from', 'to', 'payoutToken', 'payoutAddress')
	AND arguments.type = 'text'
	AND length(arguments.value) = 42
	AND substr(arguments.value, 1, 2) = '0x';
