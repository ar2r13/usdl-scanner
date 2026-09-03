# USDL Scanner

Cloudflare Worker that indexes USDL events into D1 and exposes the read-only explorer API.

```sh
npm install
npm run types
npx wrangler d1 migrations apply usdl-explorer --local
npm run dev
npm run check
```

Apply migrations with `--remote` before `npm run deploy`. RPC credentials are Worker secrets.
