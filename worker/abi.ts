import { parseAbi } from 'viem'

export const tokenAbi = parseAbi([
	'function name() view returns (string)',
	'function symbol() view returns (string)',
	'function totalSupply() view returns (uint256)',
	'function paused() view returns (bool)',
	'event Transfer(address indexed from, address indexed to, uint256 value)'
])

export const supplyAbi = parseAbi([
	'function supplyCap() view returns (uint256)',
	'function pendingOperationId() view returns (bytes32)',
	'function pendingSupplyCap() view returns (uint256)',
	'function pendingActivateAt() view returns (uint64)',
	'event SupplyCapUpdateScheduled(bytes32 indexed operationId, uint256 oldCap, uint256 newCap, uint64 activateAt)',
	'event SupplyCapUpdateCancelled(bytes32 indexed operationId)',
	'event SupplyCapUpdated(bytes32 indexed operationId, uint256 oldCap, uint256 newCap)'
])

export const mintAbi = parseAbi([
	'function globalUsage() view returns (uint256)',
	'function paused() view returns (bool)',
	'function limits() view returns (uint256 minAmount, uint256 maxAmount, uint256 recipientDaily, uint256 globalDaily)',
	'event Minted(address indexed agent, address indexed recipient, uint256 amount, uint64 indexed dayId)'
])

export const redemptionAbi = parseAbi([
	'function nextRequestId() view returns (uint256)',
	'function globalUsage() view returns (uint256)',
	'function paused() view returns (bool)',
	'function limits() view returns (uint256 minAmount, uint256 maxAmount, uint256 userDaily, uint256 globalDaily)',
	'event RedemptionCreated(uint256 indexed requestId, address indexed user, uint256 amount, uint256 indexed destinationChainId, address payoutToken, address payoutAddress, uint64 paymentDeadline)',
	'event RedemptionPaid(uint256 indexed requestId, uint256 indexed destinationChainId, bytes32 indexed payoutTxHash, uint64 disputeDeadline)',
	'event RedemptionDisputed(uint256 indexed requestId, address indexed user)',
	'event RedemptionBurned(uint256 indexed requestId, address indexed operator, uint256 amount)',
	'event RedemptionRefunded(uint256 indexed requestId, address indexed operator, address indexed user, uint256 amount)'
])

export const whitelistAbi = parseAbi([
	'function paused() view returns (bool)',
	'event WhitelistStatusChanged(address indexed account, bool whitelisted, address indexed operator)'
])

