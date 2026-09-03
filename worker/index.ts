import { api } from './api.ts'
import { configurationError } from './config.ts'
import { syncProtocol } from './indexer.ts'

export default {
	async fetch (request, env) {
		return api(request, env)
	},

	async scheduled (_controller, env) {
		const error = configurationError(env)
		if (error) {
			console.warn(JSON.stringify({ scope: 'indexer', status: 'skipped', reason: error }))
			return
		}
		const result = await syncProtocol(env)
		console.log(JSON.stringify({ scope: 'indexer', ...result }))
	}
} satisfies ExportedHandler<Env>
