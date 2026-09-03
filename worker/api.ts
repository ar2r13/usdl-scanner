import { configurationError, protocolConfig } from './config.ts'

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

async function activity (url: URL, env: Env, forcedAddress?: string) {
	const config = protocolConfig(env)
	const limit = clamp(Number(url.searchParams.get('limit') || 50), 1, 100)
	const kind = url.searchParams.get('kind')
	const account = (forcedAddress || url.searchParams.get('address'))?.toLowerCase()
	const cursor = parseCursor(url.searchParams.get('cursor'))
	const conditions = ['chain_id = ?']
	const values: (string | number)[] = [config.chainId]
	if (kind) { conditions.push('kind = ?'); values.push(kind) }
	if (account) {
		conditions.push('EXISTS (SELECT 1 FROM activity_accounts aa WHERE aa.chain_id = activity.chain_id AND aa.tx_hash = activity.tx_hash AND aa.log_index = activity.log_index AND aa.account = ?)')
		values.push(account)
	}
	if (cursor) {
		conditions.push('(block_number < ? OR (block_number = ? AND log_index < ?))')
		values.push(cursor.block, cursor.block, cursor.log)
	}
	const result = await env.DB.prepare(`
		SELECT tx_hash, log_index, block_number, timestamp, kind, title, detail, amount, account, request_id
		FROM activity WHERE ${conditions.join(' AND ')}
		ORDER BY block_number DESC, log_index DESC LIMIT ?
	`).bind(...values, limit + 1).all()
	const rows = result.results.slice(0, limit)
	const last = rows.at(-1) as { block_number: number, log_index: number } | undefined

	return response({ data: rows, nextCursor: result.results.length > limit && last ? `${last.block_number}:${last.log_index}` : null })
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
	return activity(url, env, address)
}

async function redemptions (url: URL, env: Env) {
	const config = protocolConfig(env)
	const limit = clamp(Number(url.searchParams.get('limit') || 50), 1, 100)
	const status = url.searchParams.get('status')
	const user = url.searchParams.get('user')?.toLowerCase()
	const conditions = ['chain_id = ?']
	const values: (string | number)[] = [config.chainId]
	if (status) { conditions.push('status = ?'); values.push(status) }
	if (user) { conditions.push('user_address = ?'); values.push(user) }
	const result = await env.DB.prepare(`SELECT * FROM redemptions WHERE ${conditions.join(' AND ')} ORDER BY updated_block DESC LIMIT ?`).bind(...values, limit).all()

	return response({ data: result.results })
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

function parseCursor (value: string | null) {
	if (!value || !/^\d+:\d+$/.test(value)) return
	const [block, log] = value.split(':').map(Number)

	return { block, log }
}

function clamp (value: number, min: number, max: number) {
	return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : min
}
