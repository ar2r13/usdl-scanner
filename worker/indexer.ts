import { decodeEventLog, getAddress, type Abi, type Address, type Hex, type Log } from 'viem'
import { mintAbi, redemptionAbi, supplyAbi, tokenAbi, whitelistAbi } from './abi.ts'
import { protocolConfig } from './config.ts'
import { activityProjection, redemptionProjection, type IndexedEvent } from './project.ts'
import { rpcClient } from './rpc.ts'
import { snapshotProtocol } from './snapshot.ts'

interface SyncRow {
	next_block: number
}

export interface SyncResult {
	status: 'complete' | 'progress' | 'locked'
	indexedBlock?: number
	targetBlock?: number
	events?: number
}

export async function syncProtocol (env: Env): Promise<SyncResult> {
	const config = protocolConfig(env)
	const now = Math.floor(Date.now() / 1000)
	await env.DB.prepare('INSERT OR IGNORE INTO sync_state (chain_id, next_block) VALUES (?1, ?2)')
		.bind(config.chainId, Number(config.deploymentBlock)).run()
	const lock = await env.DB.prepare('UPDATE sync_state SET locked_until = ?1 WHERE chain_id = ?2 AND locked_until < ?3')
		.bind(now + 55, config.chainId, now).run()
	if (!lock.meta.changes) return { status: 'locked' }

	try {
		const client = rpcClient(env)
		const target = await client.getBlock({ blockTag: config.confirmationTag })
		if (target.number < config.deploymentBlock) {
			await env.DB.prepare('UPDATE sync_state SET locked_until = 0, last_error = NULL WHERE chain_id = ?1').bind(config.chainId).run()
			return { status: 'progress', indexedBlock: Number(config.deploymentBlock - 1n), targetBlock: Number(target.number), events: 0 }
		}
		let state = await env.DB.prepare('SELECT next_block FROM sync_state WHERE chain_id = ?1').bind(config.chainId).first<SyncRow>()
		if (!state) throw new Error('Indexer cursor is missing')
		let nextBlock = BigInt(state.next_block)
		let eventCount = 0

		for (let range = 0; range < config.maxRangesPerRun && nextBlock <= target.number; range++) {
			const toBlock = nextBlock + config.logBlockRange - 1n > target.number ? target.number : nextBlock + config.logBlockRange - 1n
			const indexed = await indexRange(env, nextBlock, toBlock)
			eventCount += indexed.eventCount
			nextBlock = toBlock + 1n
			await env.DB.prepare(`
				UPDATE sync_state
				SET next_block = ?1, indexed_block = ?2, indexed_block_hash = ?3, indexed_at = ?4, last_error = NULL
				WHERE chain_id = ?5
			`).bind(Number(nextBlock), Number(toBlock), indexed.blockHash, now, config.chainId).run()
		}

		const indexedBlock = Number(nextBlock - 1n)
		if (nextBlock > target.number) await snapshotProtocol(env, target.number)
		await env.DB.prepare('UPDATE sync_state SET locked_until = 0 WHERE chain_id = ?1').bind(config.chainId).run()

		return {
			status: nextBlock > target.number ? 'complete' : 'progress',
			indexedBlock,
			targetBlock: Number(target.number),
			events: eventCount
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		await env.DB.prepare('UPDATE sync_state SET locked_until = 0, last_error = ?1 WHERE chain_id = ?2')
			.bind(message.slice(0, 1000), config.chainId).run()
		throw error
	}
}

async function indexRange (env: Env, fromBlock: bigint, toBlock: bigint) {
	const config = protocolConfig(env)
	const client = rpcClient(env)
	const addresses = [config.token, config.supply, config.mint, config.redemption, config.whitelist]
	const logs = await client.getLogs({ address: addresses, fromBlock, toBlock })
	const blockNumbers = [...new Set([...logs.map(log => log.blockNumber), toBlock])]
	const blocks = await Promise.all(blockNumbers.map(blockNumber => client.getBlock({ blockNumber })))
	const timestamps = new Map(blocks.map(block => [block.number, Number(block.timestamp)]))
	const hashes = new Map(blocks.map(block => [block.number, block.hash]))
	const events = logs.flatMap(log => {
		const event = decodeLog(log, config)
		return event ? [{ ...event, timestamp: timestamps.get(event.blockNumber) || 0 }] : []
	})

	await runBatches(env.DB, blocks.map(block => env.DB.prepare(`
		INSERT INTO blocks (chain_id, number, hash, timestamp) VALUES (?1, ?2, ?3, ?4)
		ON CONFLICT(chain_id, number) DO UPDATE SET hash = excluded.hash, timestamp = excluded.timestamp
	`).bind(config.chainId, Number(block.number), block.hash, Number(block.timestamp))))

	const transactionCounts = new Map<string, { blockNumber: bigint, transactionIndex: number, count: number }>()
	for (const event of events) {
		const existing = transactionCounts.get(event.txHash)
		transactionCounts.set(event.txHash, {
			blockNumber: event.blockNumber,
			transactionIndex: event.transactionIndex,
			count: (existing?.count || 0) + 1
		})
	}
	await runBatches(env.DB, [...transactionCounts.entries()].map(([hash, value]) => env.DB.prepare(`
		INSERT INTO transactions (chain_id, hash, block_number, transaction_index, event_count) VALUES (?1, ?2, ?3, ?4, ?5)
		ON CONFLICT(chain_id, hash) DO UPDATE SET event_count = excluded.event_count
	`).bind(config.chainId, hash, Number(value.blockNumber), value.transactionIndex, value.count)))

	const rawStatement = env.DB.prepare(`
		INSERT OR IGNORE INTO raw_events
		(chain_id, tx_hash, log_index, block_number, transaction_index, contract_address, event_name, args_json)
		VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
	`)
	const activityStatement = env.DB.prepare(`
		INSERT OR IGNORE INTO activity
		(chain_id, tx_hash, log_index, block_number, timestamp, kind, title, detail, amount, account, request_id)
		VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
	`)
	const accountStatement = env.DB.prepare(`
		INSERT OR IGNORE INTO activity_accounts (chain_id, tx_hash, log_index, account) VALUES (?1, ?2, ?3, ?4)
	`)
	const statements: D1PreparedStatement[] = []
	for (const event of events) {
		statements.push(rawStatement.bind(
			config.chainId,
			event.txHash,
			event.logIndex,
			Number(event.blockNumber),
			event.transactionIndex,
			event.contractAddress,
			event.name,
			JSON.stringify(event.args, bigintReplacer)
		))
		const activity = activityProjection(event)
		if (activity) statements.push(activityStatement.bind(
			config.chainId,
			event.txHash,
			event.logIndex,
			Number(event.blockNumber),
			event.timestamp,
			activity.kind,
			activity.title,
			activity.detail,
			activity.amount,
			activity.account,
			activity.requestId
		))
		if (activity) statements.push(...activity.accounts.map(account => accountStatement.bind(config.chainId, event.txHash, event.logIndex, account)))
		const redemption = redemptionProjection(event)
		if (redemption) statements.push(redemptionStatement(env.DB, config.chainId, event, redemption))
	}
	await runBatches(env.DB, statements)

	const indexedHash = hashes.get(toBlock)
	if (!indexedHash) throw new Error(`Missing block hash for ${toBlock}`)

	return { eventCount: events.length, blockHash: indexedHash }
}

function decodeLog (log: Log, config: ReturnType<typeof protocolConfig>): Omit<IndexedEvent, 'timestamp'> | undefined {
	if (!log.transactionHash || log.blockNumber === null || log.logIndex === null || log.transactionIndex === null) return
	const source = getAddress(log.address)
	const sources: [Address, Abi][] = [
		[config.token, tokenAbi],
		[config.supply, supplyAbi],
		[config.mint, mintAbi],
		[config.redemption, redemptionAbi],
		[config.whitelist, whitelistAbi]
	]
	const abi = sources.find(([address]) => address === source)?.[1]
	if (!abi) return

	try {
		const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics, strict: false })

		return {
			name: String(decoded.eventName),
			args: decoded.args as unknown as Record<string, unknown>,
			txHash: log.transactionHash as Hex,
			logIndex: log.logIndex,
			blockNumber: log.blockNumber,
			transactionIndex: log.transactionIndex,
			contractAddress: source
		}
	} catch {
		return
	}
}

function redemptionStatement (db: D1Database, chainId: number, event: IndexedEvent, redemption: NonNullable<ReturnType<typeof redemptionProjection>>) {
	if (redemption.action === 'create') {
		return db.prepare(`
			INSERT OR IGNORE INTO redemptions
			(chain_id, request_id, user_address, amount, destination_chain_id, payout_token, payout_address, payment_deadline, status, created_tx_hash, updated_tx_hash, updated_block)
			VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'active', ?9, ?9, ?10)
		`).bind(chainId, redemption.requestId, redemption.user?.toLowerCase(), redemption.amount, redemption.destinationChainId, redemption.payoutToken?.toLowerCase(), redemption.payoutAddress?.toLowerCase(), redemption.paymentDeadline, event.txHash, Number(event.blockNumber))
	}
	const status = redemption.action === 'paid' ? 'paid' : redemption.action
	return db.prepare(`
		UPDATE redemptions
		SET status = ?1,
			payout_tx_hash = COALESCE(?2, payout_tx_hash),
			dispute_deadline = COALESCE(?3, dispute_deadline),
			updated_tx_hash = ?4,
			updated_block = ?5
		WHERE chain_id = ?6 AND request_id = ?7 AND updated_block <= ?5
	`).bind(status, redemption.payoutTxHash || null, redemption.disputeDeadline || null, event.txHash, Number(event.blockNumber), chainId, redemption.requestId)
}

async function runBatches (db: D1Database, statements: D1PreparedStatement[]) {
	for (let index = 0; index < statements.length; index += 150) {
		await db.batch(statements.slice(index, index + 150))
	}
}

function bigintReplacer (_key: string, value: unknown) {
	return typeof value === 'bigint' ? value.toString() : value
}
