import { getAddress, isAddress, type Address } from 'viem'

export interface ProtocolConfig {
	chainId: number
	chainName: string
	explorerUrl: string
	deploymentBlock: bigint
	confirmationTag: 'safe' | 'finalized'
	logBlockRange: bigint
	maxRangesPerRun: number
	token: Address
	supply: Address
	mint: Address
	redemption: Address
	whitelist: Address
}

export function protocolConfig (env: Env): ProtocolConfig {
	return {
		chainId: Number(env.CHAIN_ID),
		chainName: env.CHAIN_NAME,
		explorerUrl: env.EXPLORER_URL,
		deploymentBlock: BigInt(env.DEPLOYMENT_BLOCK),
		confirmationTag: String(env.CONFIRMATION_TAG) === 'safe' ? 'safe' : 'finalized',
		logBlockRange: BigInt(env.LOG_BLOCK_RANGE),
		maxRangesPerRun: Number(env.MAX_RANGES_PER_RUN),
		token: requiredAddress('TOKEN_ADDRESS', env.TOKEN_ADDRESS),
		supply: requiredAddress('SUPPLY_ADDRESS', env.SUPPLY_ADDRESS),
		mint: requiredAddress('MINT_ADDRESS', env.MINT_ADDRESS),
		redemption: requiredAddress('REDEMPTION_ADDRESS', env.REDEMPTION_ADDRESS),
		whitelist: requiredAddress('WHITELIST_ADDRESS', env.WHITELIST_ADDRESS)
	}
}

export function configurationError (env: Env) {
	const values = [env.TOKEN_ADDRESS, env.SUPPLY_ADDRESS, env.MINT_ADDRESS, env.REDEMPTION_ADDRESS, env.WHITELIST_ADDRESS]

	return values.some(value => !isAddress(value)) ? 'USDL proxy addresses are not configured' : undefined
}

function requiredAddress (name: string, value: string): Address {
	if (!isAddress(value)) throw new Error(`${name} is not a valid deployed proxy address`)

	return getAddress(value)
}
