# @kattebak/graphql-sdk-emitter

Generate a typed TypeScript SDK from a GraphQL SDL.

- One typed function per operation. No query strings in your application code.
- Pluggable auth providers: SigV4 (AppSync IAM), Cognito bearer, API key. Bring your own.
- Cursor-pagination helpers as async iterators.
- LLM-friendly `manifest.json` describing every operation.
- Optional smart filter-object builder for nested input types.
- Framework-agnostic. No React. No global singletons.

Built on top of `graphql-codegen` (`typescript`, `typescript-operations`, `typescript-graphql-request`) and `graphql-request`.

## Install

```bash
npm install --save-dev @kattebak/graphql-sdk-emitter
npm install graphql graphql-request
```

`graphql` is a peer dependency. `aws4fetch` ships in this package and is only loaded when you import `SigV4Auth`.

## Quick start

Given a `schema.graphql` and a folder of `.graphql` operations:

```bash
npx graphql-sdk-emitter \
	--schema ./schema.graphql \
	--output ./src/generated \
	--operations 'src/operations/*.graphql'
```

This writes:

```
src/generated/
	types.ts        # GraphQL types as TypeScript
	sdk.ts          # getSdk(client) with one method per operation
	filters.ts      # buildXxxFilter helpers (optional, on by default)
	manifest.json   # machine-readable operation index
	index.ts        # re-exports everything
```

In your application:

```typescript
import { GraphQLClient } from "graphql-request";
import { ApiKeyAuth } from "@kattebak/graphql-sdk-emitter";
import { getSdk } from "./generated";

const auth = new ApiKeyAuth({ apiKey: process.env.API_KEY! });
const client = new GraphQLClient(url, { fetch: auth.wrap(fetch) });
const sdk = getSdk(client);

const r = await sdk.SearchBooks({ query: "tolkien", first: 20 });
```

## Programmatic codegen

```typescript
import { generateSdk } from "@kattebak/graphql-sdk-emitter";

await generateSdk({
	schema: "./schema.graphql",
	output: "./src/generated",
	operations: "./src/operations/*.graphql", // optional
	emitFilterBuilder: true,                  // default true
	emitManifest: true,                       // default true
});
```

If you skip `operations`, the emitter still produces `types.ts` and `manifest.json` so you have typed shapes and a discoverable operation index, but no `getSdk()` runtime.

## Auth providers

All three providers implement the same `AuthProvider` interface:

```typescript
interface AuthProvider {
	wrap(fetch: FetchFn): FetchFn;
}
```

You hand the wrapped fetch to `GraphQLClient`. Implement your own provider by writing one method.

### SigV4 (AppSync with IAM)

```typescript
import { SigV4Auth } from "@kattebak/graphql-sdk-emitter";

const auth = new SigV4Auth({
	credentials: { accessKeyId, secretAccessKey, sessionToken },
	region: "us-east-1",
	service: "appsync", // default
});
const client = new GraphQLClient(url, { fetch: auth.wrap(fetch) });
```

`credentials` accepts a `() => Credentials | Promise<Credentials>` provider for refresh.

### Cognito bearer

```typescript
import { CognitoBearerAuth } from "@kattebak/graphql-sdk-emitter";

const auth = new CognitoBearerAuth({
	token: async () => session.getIdToken().getJwtToken(),
});
```

### API key

```typescript
import { ApiKeyAuth } from "@kattebak/graphql-sdk-emitter";

const auth = new ApiKeyAuth({ apiKey: process.env.API_KEY! });
// header defaults to x-api-key; override with headerName.
```

### Custom

```typescript
import type { AuthProvider, FetchFn } from "@kattebak/graphql-sdk-emitter";

class MyAuth implements AuthProvider {
	wrap(fetch: FetchFn): FetchFn {
		return async (input, init) => {
			const headers = new Headers(init?.headers);
			headers.set("x-tenant", "acme");
			return fetch(input, { ...init, headers });
		};
	}
}
```

## Pagination

Two helpers walk Relay-style cursored connections. Pick by what you need per page.

**`paginatePages`** — yields the full operation result per page. Types infer from the operation; no generics required.

```typescript
import { paginatePages } from "@kattebak/graphql-sdk-emitter";

for await (const page of paginatePages(sdk.SearchBooks, { query: "tolkien" }, { pageSize: 50 })) {
	console.log(page.searchBooks.totalCount);
	for (const edge of page.searchBooks.edges) {
		console.log(edge.node.bookId, edge.node.title);
	}
}
```

**`paginate` / `collect`** — yield a flat array of nodes per page, useful when you only need the nodes. Requires explicit `TNode` to type the result.

```typescript
import { paginate, collect } from "@kattebak/graphql-sdk-emitter";

type Book = { bookId: string; title: string };

for await (const nodes of paginate<{ query: string }, unknown, Book>(
	sdk.SearchBooks,
	{ query: "tolkien" },
)) {
	for (const node of nodes) console.log(node.title);
}

const all = await collect<{ query: string }, unknown, Book>(sdk.SearchBooks, { query: "tolkien" });
```

All three auto-detect the connection inside the response (first object with a `pageInfo` field). For deeply nested or ambiguous responses pass `connectionPath: ["data", "wrapper", "results"]`. They stop when `hasNextPage` is false, when `endCursor` does not advance, or when `maxPages` is reached.

## Manifest

The emitter writes a `manifest.json` next to your generated code:

```json
{
	"version": 1,
	"generatedAt": "2026-01-01T00:00:00.000Z",
	"operations": [
		{
			"name": "searchBooks",
			"kind": "query",
			"description": "Search the catalogue by free-text query.",
			"parameters": [
				{ "name": "query", "type": "String", "required": false },
				{ "name": "filter", "type": "BookFilter", "required": false, "description": "Structured filter." }
			],
			"returns": "BookConnection!"
		}
	]
}
```

Descriptions come from SDL `"""..."""` doc comments. Use this as an LLM-friendly entry point or to drive ad-hoc tooling.

## Filter builder

For input types whose name matches `Filter`, `Where`, or `Condition` (or that contain `and`/`or`/`not` combinators), the emitter writes a typed identity helper in `filters.ts`:

```typescript
import { buildBookFilter } from "./generated/filters";

const filter = buildBookFilter({
	or: [
		{ title: { contains: "tolkien" } },
		{ author: { contains: "le guin" } },
	],
});
```

The helper exists to give you autocomplete and type-checking on nested filter shapes without hand-typing the input type.

## React + react-query

This package is framework-agnostic. To pair with `@tanstack/react-query`, write your own thin wrapper:

```typescript
import { useQuery } from "@tanstack/react-query";

export function useSearchBooks(args: SearchBooksQueryVariables) {
	return useQuery({
		queryKey: ["searchBooks", args],
		queryFn: () => sdk.SearchBooks(args),
	});
}
```

## CLI

```
graphql-sdk-emitter --schema <path> --output <dir> [options]

  -s, --schema       Path to GraphQL SDL file (required)
  -o, --output       Output directory (required)
  -d, --operations   Path or glob to .graphql operation documents
      --no-filters   Skip filter builder emission
      --no-manifest  Skip operations manifest emission
  -h, --help         Show help
```

## License

MIT
