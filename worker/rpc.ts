import { createPublicClient, http, type PublicClient } from 'viem'
import { protocolConfig } from './config.ts'

export function rpcClient (env: Env): PublicClient {
	const config = protocolConfig(env)

	return createPublicClient({
		chain: {
			id: config.chainId,
			name: config.chainName,
			nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
			rpcUrls: { default: { http: [env.RPC_URL] } }
		},
		transport: http(env.RPC_URL, {
			fetchOptions: {
				headers: { Authorization: `Basic ${btoa(`:${env.RPC_SECRET}`)}` }
			},
			retryCount: 3,
			timeout: 20_000
		})
	})
}
