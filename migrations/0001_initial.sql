PRAGMA foreign_keys = ON;

CREATE TABLE sync_state (
	chain_id INTEGER PRIMARY KEY,
	next_block INTEGER NOT NULL,
	indexed_block INTEGER,
	indexed_block_hash TEXT,
	indexed_at INTEGER,
	locked_until INTEGER NOT NULL DEFAULT 0,
	last_error TEXT
);

CREATE TABLE blocks (
	chain_id INTEGER NOT NULL,
	number INTEGER NOT NULL,
	hash TEXT NOT NULL,
	timestamp INTEGER NOT NULL,
	PRIMARY KEY (chain_id, number)
);

CREATE TABLE transactions (
	chain_id INTEGER NOT NULL,
	hash TEXT NOT NULL,
	block_number INTEGER NOT NULL,
	transaction_index INTEGER NOT NULL,
	event_count INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (chain_id, hash),
	FOREIGN KEY (chain_id, block_number) REFERENCES blocks(chain_id, number)
);

CREATE TABLE raw_events (
	chain_id INTEGER NOT NULL,
	tx_hash TEXT NOT NULL,
	log_index INTEGER NOT NULL,
	block_number INTEGER NOT NULL,
	transaction_index INTEGER NOT NULL,
	contract_address TEXT NOT NULL,
	event_name TEXT NOT NULL,
	args_json TEXT NOT NULL,
	PRIMARY KEY (chain_id, tx_hash, log_index),
	FOREIGN KEY (chain_id, tx_hash) REFERENCES transactions(chain_id, hash)
);

CREATE TABLE activity (
	chain_id INTEGER NOT NULL,
	tx_hash TEXT NOT NULL,
	log_index INTEGER NOT NULL,
	block_number INTEGER NOT NULL,
	timestamp INTEGER NOT NULL,
	kind TEXT NOT NULL,
	title TEXT NOT NULL,
	detail TEXT NOT NULL,
	amount TEXT,
	account TEXT,
	request_id INTEGER,
	PRIMARY KEY (chain_id, tx_hash, log_index)
);

CREATE TABLE redemptions (
	chain_id INTEGER NOT NULL,
	request_id INTEGER NOT NULL,
	user_address TEXT NOT NULL,
	amount TEXT NOT NULL,
	destination_chain_id TEXT NOT NULL,
	payout_token TEXT NOT NULL,
	payout_address TEXT NOT NULL,
	payout_tx_hash TEXT,
	payment_deadline INTEGER NOT NULL,
	dispute_deadline INTEGER,
	status TEXT NOT NULL,
	created_tx_hash TEXT NOT NULL,
	updated_tx_hash TEXT NOT NULL,
	updated_block INTEGER NOT NULL,
	PRIMARY KEY (chain_id, request_id)
);

CREATE TABLE protocol_state (
	chain_id INTEGER NOT NULL,
	key TEXT NOT NULL,
	value TEXT NOT NULL,
	updated_block INTEGER NOT NULL,
	PRIMARY KEY (chain_id, key)
);

CREATE INDEX activity_order ON activity(chain_id, block_number DESC, log_index DESC);
CREATE INDEX activity_kind_order ON activity(chain_id, kind, block_number DESC, log_index DESC);
CREATE INDEX activity_account_order ON activity(chain_id, account, block_number DESC, log_index DESC);
CREATE INDEX activity_request ON activity(chain_id, request_id, block_number, log_index);
CREATE INDEX redemptions_status_order ON redemptions(chain_id, status, updated_block DESC);
CREATE INDEX redemptions_user_order ON redemptions(chain_id, user_address, updated_block DESC);
CREATE INDEX raw_events_block ON raw_events(chain_id, block_number);

