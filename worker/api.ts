import { configurationError, protocolConfig } from './config.ts'

const columns = 'tx_hash, log_index, block_number, timestamp, kind, title, detail, amount, account, request_id'
const participates = 'EXISTS (SELECT 1 FROM activity_accounts aa WHERE aa.chain_id = activity.chain_id AND aa.tx_hash = activity.tx_hash AND aa.log_index = activity.log_index AND aa.account = ?)'
const counterparty = `(
	SELECT aa.account FROM activity_accounts aa
	WHERE aa.chain_id = activity.chain_id AND aa.tx_hash = activity.tx_hash AND aa.log_index = activity.log_index AND aa.account <> ?
	ORDER BY aa.account LIMIT 1
) AS counterparty`

const jsonHeaders = {
	'content-type': 'application/json; charset=utf-8',
	'cache-control': 'public, max-age=5, s-maxage=15',
	'access-control-allow-origin': '*'
}

export async function api (request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url)
	if (request.method !== 'GET') return response({ error: 'Method not allowed' }, 405)

	try {
		if (url.pathname === '/api/v1/overview') return overview(env)
		if (url.pathname === '/api/v1/search') return search(url, env)
		if (url.pathname === '/api/v1/activity') return activity(url, env)
		if (url.pathname === '/api/v1/redemptions') return redemptions(url, env)
		if (url.pathname === '/api/v1/indexer/status') return status(env)
		const transaction = url.pathname.match(/^\/api\/v1\/transactions\/(0x[0-9a-fA-F]{64})$/)
		if (transaction) return transactionDetails(transaction[1], env)
		const address = url.pathname.match(/^\/api\/v1\/addresses\/(0x[0-9a-fA-F]{40})$/)
		if (address) return addressDetails(address[1], url, env)
		const redemption = url.pathname.match(/^\/api\/v1\/redemptions\/(\d+)$/)
		if (redemption) return redemptionDetails(Number(redemption[1]), env)

		return response({ error: 'Not found' }, 404)
	} catch (error) {
		console.error(JSON.stringify({ scope: 'api', path: url.pathname, error: error instanceof Error ? error.message : String(error) }))
		return response({ error: 'Internal server error' }, 500)
	}
}

async function overview (env: Env) {
	const error = configurationError(env)
	if (error) return response({ configured: false, error })
	const config = protocolConfig(env)
	const [state, sync] = await env.DB.batch([
		env.DB.prepare('SELECT key, value, updated_block FROM protocol_state WHERE chain_id = ?1').bind(config.chainId),
		env.DB.prepare("SELECT next_block, indexed_block, indexed_at, CASE WHEN last_error IS NULL THEN NULL ELSE 'Indexer sync failed' END AS last_error FROM sync_state WHERE chain_id = ?1").bind(config.chainId)
	])
	const values = Object.fromEntries((state.results as { key: string, value: string }[]).map(row => [row.key, row.value]))

	return response({
		configured: true,
		chain: { id: config.chainId, name: config.chainName, explorerUrl: config.explorerUrl },
		protocol: values,
		indexer: sync.results[0] || null
	})
}

async function activity (url: URL, env: Env) {
	return response(await activityPage(url, env))
}

async function activityPage (url: URL, env: Env, forcedAddress?: string) {
	const config = protocolConfig(env)
	const limit = clamp(Number(url.searchParams.get('limit') || 50), 1, 100)
	const page = clamp(Number(url.searchParams.get('page') || 1), 1, Number.MAX_SAFE_INTEGER)
	const kind = url.searchParams.get('kind')
	const account = (forcedAddress || url.searchParams.get('address'))?.toLowerCase()
	const conditions = ['chain_id = ?']
	const values: (string | number)[] = [config.chainId]
	if (kind) {
		const kinds = kind === 'swap' ? ['mint', 'redemption'] : kind === 'redemption' ? ['redemption', 'payout', 'dispute', 'refund'] : [kind]
		conditions.push(`kind IN (${kinds.map(() => '?').join(', ')})`)
		values.push(...kinds)
	}
	if (account) {
		conditions.push(`(account = ? OR ${participates})`)
		values.push(account, account)
	}
	/* Rows read for one account carry the other party of the event, so the
	   address screen names a counterparty instead of parsing it out of `detail`.
	   Its parameter sits in the select list, ahead of every filter value. */
	const [result, count] = await env.DB.batch([
		env.DB.prepare(`
			SELECT ${columns}${account ? `, ${counterparty}` : ''}
			FROM activity WHERE ${conditions.join(' AND ')}
			ORDER BY block_number DESC, log_index DESC LIMIT ? OFFSET ?
		`).bind(...(account ? [account] : []), ...values, limit, (page - 1) * limit),
		env.DB.prepare(`SELECT COUNT(*) AS total FROM activity WHERE ${conditions.join(' AND ')}`).bind(...values)
	])
	const total = Number((count.results[0] as { total?: number } | undefined)?.total || 0)

	return { data: result.results, page, pageSize: limit, total, totalPages: Math.ceil(total / limit) }
}

async function search (url: URL, env: Env) {
	const config = protocolConfig(env)
	const query = (url.searchParams.get('q') || '').toLowerCase()
	if (/^0x[0-9a-f]{64}$/.test(query)) {
		const transaction = await env.DB.prepare('SELECT hash FROM transactions WHERE chain_id = ?1 AND hash = ?2').bind(config.chainId, query).first<{ hash: string }>()
		if (!transaction) return response({ error: 'Transaction not found' }, 404)

		return response({ type: 'transaction', value: transaction.hash })
	}
	if (/^0x[0-9a-f]{40}$/.test(query)) {
		const [activity, whitelist] = await env.DB.batch([
			env.DB.prepare(`
				SELECT 1 AS found FROM activity
				WHERE chain_id = ?1 AND (account = ?2 OR EXISTS (
					SELECT 1 FROM activity_accounts aa
					WHERE aa.chain_id = activity.chain_id AND aa.tx_hash = activity.tx_hash AND aa.log_index = activity.log_index AND aa.account = ?2
				)) LIMIT 1
			`).bind(config.chainId, query),
			env.DB.prepare("SELECT 1 AS found FROM activity WHERE chain_id = ?1 AND kind = 'whitelist' AND account = ?2 LIMIT 1").bind(config.chainId, query)
		])
		if (!activity.results.length) return response({ error: 'Address not found' }, 404)

		return response({ type: 'address', value: query, whitelist: Boolean(whitelist.results.length) })
	}

	return response({ error: 'Enter a complete transaction hash or address' }, 400)
}

async function transactionDetails (hash: string, env: Env) {
	const config = protocolConfig(env)
	const [transaction, events, activity] = await env.DB.batch([
		env.DB.prepare(`SELECT t.*, b.timestamp, b.hash AS block_hash FROM transactions t JOIN blocks b ON b.chain_id = t.chain_id AND b.number = t.block_number WHERE t.chain_id = ?1 AND t.hash = ?2`).bind(config.chainId, hash.toLowerCase()),
		env.DB.prepare('SELECT log_index, contract_address, event_name, args_json FROM raw_events WHERE chain_id = ?1 AND tx_hash = ?2 ORDER BY log_index').bind(config.chainId, hash.toLowerCase()),
		env.DB.prepare('SELECT * FROM activity WHERE chain_id = ?1 AND tx_hash = ?2 ORDER BY log_index').bind(config.chainId, hash.toLowerCase())
	])
	if (!transaction.results[0]) return response({ error: 'Transaction not found' }, 404)

	return response({ transaction: transaction.results[0], events: events.results, activity: activity.results })
}

async function addressDetails (address: string, url: URL, env: Env) {
	const account = address.toLowerCase()
	const [page, summary] = await Promise.all([activityPage(url, env, account), addressSummary(account, env)])

	return response({ ...page, summary })
}

/* The account-level facts the address screen states above its activity: the
   standing whitelist decision, the indexed lifespan, and the token movements
   that actually touched the account. Redemption, refund and burn rows restate
   an amount their own transfer row already carries, so only transfers and
   mints are summed. Sums come back as text, like every other amount. */
async function addressSummary (account: string, env: Env) {
	const config = protocolConfig(env)
	const [totals, whitelist] = await env.DB.batch([
		env.DB.prepare(`
			SELECT
				MIN(timestamp) AS first_seen,
				MAX(timestamp) AS last_seen,
				COUNT(*) AS events,
				CAST(SUM(CASE WHEN kind = 'transfer' AND account <> ? THEN CAST(amount AS INTEGER) WHEN kind = 'mint' AND account = ? THEN CAST(amount AS INTEGER) ELSE 0 END) AS TEXT) AS received,
				CAST(SUM(CASE WHEN kind = 'transfer' AND account = ? THEN CAST(amount AS INTEGER) ELSE 0 END) AS TEXT) AS sent
			FROM activity WHERE chain_id = ? AND (account = ? OR ${participates})
		`).bind(account, account, account, config.chainId, account, account),
		env.DB.prepare(`
			SELECT activity.timestamp, json_extract(raw_events.args_json, '$.whitelisted') AS whitelisted
			FROM activity
			JOIN raw_events ON raw_events.chain_id = activity.chain_id AND raw_events.tx_hash = activity.tx_hash AND raw_events.log_index = activity.log_index
			WHERE activity.chain_id = ?1 AND activity.kind = 'whitelist' AND activity.account = ?2
			ORDER BY activity.block_number DESC, activity.log_index DESC LIMIT 1
		`).bind(config.chainId, account)
	])
	const row = totals.results[0] as { first_seen: number | null, last_seen: number | null, events: number, received: string | null, sent: string | null } | undefined
	const listing = whitelist.results[0] as { timestamp: number, whitelisted: number } | undefined

	return {
		first_seen: row?.first_seen ?? null,
		last_seen: row?.last_seen ?? null,
		events: row?.events || 0,
		received: row?.received || '0',
		sent: row?.sent || '0',
		whitelisted: listing ? Boolean(listing.whitelisted) : null,
		whitelisted_at: listing?.timestamp ?? null
	}
}

async function redemptions (url: URL, env: Env) {
	const config = protocolConfig(env)
	const limit = clamp(Number(url.searchParams.get('limit') || 50), 1, 100)
	const page = clamp(Number(url.searchParams.get('page') || 1), 1, Number.MAX_SAFE_INTEGER)
	const status = url.searchParams.get('status')
	const user = url.searchParams.get('user')?.toLowerCase()
	const conditions = ['chain_id = ?']
	const values: (string | number)[] = [config.chainId]
	if (status) { conditions.push('status = ?'); values.push(status) }
	if (user) { conditions.push('user_address = ?'); values.push(user) }
	const [result, count] = await env.DB.batch([
		env.DB.prepare(`SELECT * FROM redemptions WHERE ${conditions.join(' AND ')} ORDER BY updated_block DESC LIMIT ? OFFSET ?`).bind(...values, limit, (page - 1) * limit),
		env.DB.prepare(`SELECT COUNT(*) AS total FROM redemptions WHERE ${conditions.join(' AND ')}`).bind(...values)
	])
	const total = Number((count.results[0] as { total?: number } | undefined)?.total || 0)

	return response({ data: result.results, page, pageSize: limit, total, totalPages: Math.ceil(total / limit) })
}

async function redemptionDetails (requestId: number, env: Env) {
	const config = protocolConfig(env)
	const [redemption, history] = await env.DB.batch([
		env.DB.prepare('SELECT * FROM redemptions WHERE chain_id = ?1 AND request_id = ?2').bind(config.chainId, requestId),
		env.DB.prepare('SELECT * FROM activity WHERE chain_id = ?1 AND request_id = ?2 ORDER BY block_number, log_index').bind(config.chainId, requestId)
	])
	if (!redemption.results[0]) return response({ error: 'Redemption not found' }, 404)

	return response({ redemption: redemption.results[0], history: history.results })
}

async function status (env: Env) {
	const error = configurationError(env)
	if (error) return response({ configured: false, error })
	const config = protocolConfig(env)
	const row = await env.DB.prepare("SELECT chain_id, next_block, indexed_block, indexed_block_hash, indexed_at, locked_until, CASE WHEN last_error IS NULL THEN NULL ELSE 'Indexer sync failed' END AS last_error FROM sync_state WHERE chain_id = ?1").bind(config.chainId).first()

	return response({ configured: true, chainId: config.chainId, ...row })
}

function response (body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: jsonHeaders })
}

function clamp (value: number, min: number, max: number) {
	return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : min
}
