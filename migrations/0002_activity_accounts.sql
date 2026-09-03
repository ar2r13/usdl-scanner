CREATE TABLE activity_accounts (
	chain_id INTEGER NOT NULL,
	tx_hash TEXT NOT NULL,
	log_index INTEGER NOT NULL,
	account TEXT NOT NULL,
	PRIMARY KEY (chain_id, tx_hash, log_index, account),
	FOREIGN KEY (chain_id, tx_hash, log_index) REFERENCES activity(chain_id, tx_hash, log_index)
);

CREATE INDEX activity_accounts_lookup ON activity_accounts(chain_id, account, tx_hash, log_index);

