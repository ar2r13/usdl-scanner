import { getAddress, zeroAddress, type Address, type Hex } from 'viem'

export interface IndexedEvent {
	name: string
	args: Record<string, unknown>
	txHash: Hex
	logIndex: number
	blockNumber: bigint
	transactionIndex: number
	contractAddress: Address
	timestamp: number
}

export interface ActivityProjection {
	kind: string
	title: string
	detail: string
	amount: string | null
	account: string | null
	accounts: string[]
	requestId: number | null
}

export interface RedemptionProjection {
	action: 'create' | 'paid' | 'disputed' | 'burned' | 'refunded'
	requestId: number
	user?: string
	amount?: string
	destinationChainId?: string
	payoutToken?: string
	payoutAddress?: string
	payoutTxHash?: string
	paymentDeadline?: number
	disputeDeadline?: number
}

export function activityProjection (event: IndexedEvent): ActivityProjection | undefined {
	const args = event.args

	switch (event.name) {
		case 'Transfer': {
			const from = getAddress(String(args.from))
			const to = getAddress(String(args.to))
			if (from === zeroAddress || to === zeroAddress) return
			return projection('transfer', 'Transfer', `${from} → ${to}`, args.value, from, null, [from, to])
		}
		case 'Minted':
			return projection('mint', 'Mint', `Issued to ${args.recipient}`, args.amount, args.recipient, null, [args.agent, args.recipient])
		case 'RedemptionCreated':
			return projection('redemption', `Redemption #${args.requestId}`, `Requested by ${args.user}`, args.amount, args.user, args.requestId, [args.user, args.payoutToken, args.payoutAddress])
		case 'RedemptionPaid':
			return projection('payout', `Payout registered · #${args.requestId}`, `Administrator assertion on chain ${args.destinationChainId}`, null, null, args.requestId)
		case 'RedemptionDisputed':
			return projection('dispute', `Dispute opened · #${args.requestId}`, `Opened by ${args.user}`, null, args.user, args.requestId)
		case 'RedemptionBurned':
			return projection('burn', `Burn · redemption #${args.requestId}`, `Finalized by ${args.operator}`, args.amount, args.operator, args.requestId)
		case 'RedemptionRefunded':
			return projection('refund', `Refund · redemption #${args.requestId}`, `Returned to ${args.user}`, args.amount, args.user, args.requestId, [args.operator, args.user])
		case 'SupplyCapUpdateScheduled':
			return projection('supply', 'Supply cap scheduled', `Activates at ${new Date(Number(args.activateAt) * 1000).toISOString()}`, args.newCap)
		case 'SupplyCapUpdated':
			return projection('supply', 'Supply cap updated', 'Reported backing limit changed', args.newCap)
		case 'SupplyCapUpdateCancelled':
			return projection('supply', 'Supply cap update cancelled', String(args.operationId))
		case 'WhitelistStatusChanged':
			return projection('whitelist', args.whitelisted ? 'Address whitelisted' : 'Address removed', String(args.account), null, args.account, null, [args.account, args.operator])
	}
}

export function redemptionProjection (event: IndexedEvent): RedemptionProjection | undefined {
	const args = event.args
	const requestId = Number(args.requestId)

	switch (event.name) {
		case 'RedemptionCreated':
			return {
				action: 'create',
				requestId,
				user: String(args.user),
				amount: String(args.amount),
				destinationChainId: String(args.destinationChainId),
				payoutToken: String(args.payoutToken),
				payoutAddress: String(args.payoutAddress),
				paymentDeadline: Number(args.paymentDeadline)
			}
		case 'RedemptionPaid':
			return { action: 'paid', requestId, payoutTxHash: String(args.payoutTxHash), disputeDeadline: Number(args.disputeDeadline) }
		case 'RedemptionDisputed':
			return { action: 'disputed', requestId }
		case 'RedemptionBurned':
			return { action: 'burned', requestId }
		case 'RedemptionRefunded':
			return { action: 'refunded', requestId }
	}
}

function projection (kind: string, title: string, detail: string, amount: unknown = null, account: unknown = null, requestId: unknown = null, accounts?: unknown[]): ActivityProjection {
	const primary = account === null ? null : String(account).toLowerCase()
	return {
		kind,
		title,
		detail,
		amount: amount === null ? null : String(amount),
		account: primary,
		accounts: (accounts || (account === null ? [] : [account])).map(value => String(value).toLowerCase()),
		requestId: requestId === null ? null : Number(requestId)
	}
}
