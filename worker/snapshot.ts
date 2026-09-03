import { zeroHash } from 'viem'
import { mintAbi, redemptionAbi, supplyAbi, tokenAbi, whitelistAbi } from './abi.ts'
import { protocolConfig } from './config.ts'
import { rpcClient } from './rpc.ts'

export async function snapshotProtocol (env: Env, blockNumber: bigint) {
	const config = protocolConfig(env)
	const client = rpcClient(env)
	const [name, symbol, totalSupply, tokenPaused, supplyCap, pendingOperationId, pendingSupplyCap, pendingActivateAt, mintToday, mintLimits, mintPaused, redemptionToday, redemptionLimits, redemptionCount, redemptionPaused, whitelistPaused] = await Promise.all([
		client.readContract({ address: config.token, abi: tokenAbi, functionName: 'name', blockNumber }),
		client.readContract({ address: config.token, abi: tokenAbi, functionName: 'symbol', blockNumber }),
		client.readContract({ address: config.token, abi: tokenAbi, functionName: 'totalSupply', blockNumber }),
		client.readContract({ address: config.token, abi: tokenAbi, functionName: 'paused', blockNumber }),
		client.readContract({ address: config.supply, abi: supplyAbi, functionName: 'supplyCap', blockNumber }),
		client.readContract({ address: config.supply, abi: supplyAbi, functionName: 'pendingOperationId', blockNumber }),
		client.readContract({ address: config.supply, abi: supplyAbi, functionName: 'pendingSupplyCap', blockNumber }),
		client.readContract({ address: config.supply, abi: supplyAbi, functionName: 'pendingActivateAt', blockNumber }),
		client.readContract({ address: config.mint, abi: mintAbi, functionName: 'globalUsage', blockNumber }),
		client.readContract({ address: config.mint, abi: mintAbi, functionName: 'limits', blockNumber }),
		client.readContract({ address: config.mint, abi: mintAbi, functionName: 'paused', blockNumber }),
		client.readContract({ address: config.redemption, abi: redemptionAbi, functionName: 'globalUsage', blockNumber }),
		client.readContract({ address: config.redemption, abi: redemptionAbi, functionName: 'limits', blockNumber }),
		client.readContract({ address: config.redemption, abi: redemptionAbi, functionName: 'nextRequestId', blockNumber }),
		client.readContract({ address: config.redemption, abi: redemptionAbi, functionName: 'paused', blockNumber }),
		client.readContract({ address: config.whitelist, abi: whitelistAbi, functionName: 'paused', blockNumber })
	])
	const values = {
		name,
		symbol,
		totalSupply: totalSupply.toString(),
		supplyCap: supplyCap.toString(),
		mintToday: mintToday.toString(),
		mintDailyLimit: mintLimits[3].toString(),
		redemptionToday: redemptionToday.toString(),
		redemptionDailyLimit: redemptionLimits[3].toString(),
		redemptionCount: redemptionCount.toString(),
		pendingSupplyCap: pendingOperationId === zeroHash ? '' : pendingSupplyCap.toString(),
		pendingSupplyAt: pendingOperationId === zeroHash ? '' : pendingActivateAt.toString(),
		paused: String(tokenPaused || mintPaused || redemptionPaused || whitelistPaused)
	}
	const statement = env.DB.prepare(`
		INSERT INTO protocol_state (chain_id, key, value, updated_block) VALUES (?1, ?2, ?3, ?4)
		ON CONFLICT(chain_id, key) DO UPDATE SET value = excluded.value, updated_block = excluded.updated_block
	`)
	await env.DB.batch(Object.entries(values).map(([key, value]) => statement.bind(config.chainId, key, value, Number(blockNumber))))
}
