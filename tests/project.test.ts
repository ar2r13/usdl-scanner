import { describe, expect, it } from 'vitest'
import { zeroAddress } from 'viem'
import { activityProjection, redemptionProjection, type IndexedEvent } from '../worker/project.ts'

const base: IndexedEvent = {
	name: 'Minted',
	args: {},
	txHash: `0x${'1'.repeat(64)}`,
	logIndex: 1,
	blockNumber: 10n,
	transactionIndex: 0,
	contractAddress: `0x${'2'.repeat(40)}`,
	timestamp: 1_700_000_000
}

describe('activity projections', () => {
	it('projects controller mints', () => {
		const agent = `0x${'4'.repeat(40)}`
		const recipient = `0x${'3'.repeat(40)}`
		const result = activityProjection({ ...base, args: { agent, recipient, amount: 25_000_000n } })

		expect(result).toMatchObject({ kind: 'mint', amount: '25000000', accounts: [agent, recipient] })
	})

	it('does not duplicate mint and burn Transfer events', () => {
		const mintedTransfer = activityProjection({ ...base, name: 'Transfer', args: { from: zeroAddress, to: `0x${'3'.repeat(40)}`, value: 1n } })
		const burnedTransfer = activityProjection({ ...base, name: 'Transfer', args: { from: `0x${'3'.repeat(40)}`, to: zeroAddress, value: 1n } })

		expect(mintedTransfer).toBeUndefined()
		expect(burnedTransfer).toBeUndefined()
	})

	it('indexes both transfer participants', () => {
		const from = `0x${'3'.repeat(40)}`
		const to = `0x${'4'.repeat(40)}`
		const result = activityProjection({ ...base, name: 'Transfer', args: { from, to, value: 1n } })

		expect(result?.accounts).toEqual([from.toLowerCase(), to.toLowerCase()])
	})

	it('labels payout registration as an administrator assertion', () => {
		const result = activityProjection({ ...base, name: 'RedemptionPaid', args: { requestId: 7n, destinationChainId: 1n } })

		expect(result?.detail).toContain('Administrator assertion')
	})

	it('indexes whitelist account and operator', () => {
		const account = `0x${'3'.repeat(40)}`
		const operator = `0x${'4'.repeat(40)}`
		const result = activityProjection({ ...base, name: 'WhitelistStatusChanged', args: { account, operator, whitelisted: true } })

		expect(result?.accounts).toEqual([account, operator])
	})
})

describe('redemption projections', () => {
	it('creates a complete redemption projection', () => {
		const result = redemptionProjection({
			...base,
			name: 'RedemptionCreated',
			args: {
				requestId: 4n,
				user: `0x${'3'.repeat(40)}`,
				amount: 50_000_000n,
				destinationChainId: 8453n,
				payoutToken: `0x${'4'.repeat(40)}`,
				payoutAddress: `0x${'5'.repeat(40)}`,
				paymentDeadline: 1_800_000_000n
			}
		})

		expect(result).toMatchObject({ action: 'create', requestId: 4, amount: '50000000', destinationChainId: '8453' })
	})
})
