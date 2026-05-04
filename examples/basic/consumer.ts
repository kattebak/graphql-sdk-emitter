// Example consumer wiring. Run `node bin/graphql-sdk-emitter.js -s examples/basic/schema.graphql -o examples/basic/generated -d 'examples/basic/operations/*.graphql'`
// then run this with tsx.
import { GraphQLClient } from "graphql-request";
import { ApiKeyAuth, paginate } from "../../src/index.js";
// @ts-expect-error generated module is created at build-time.
import { getSdk } from "./generated/sdk.js";

const url = process.env.GRAPHQL_URL ?? "https://example.com/graphql";
const apiKey = process.env.GRAPHQL_API_KEY ?? "test-key";

const auth = new ApiKeyAuth({ apiKey });
const client = new GraphQLClient(url, { fetch: auth.wrap(fetch) });
const sdk = getSdk(client);

async function main(): Promise<void> {
	const first = await sdk.SearchCounterparty({ query: "evolve", first: 20 });
	process.stdout.write(`${JSON.stringify(first, null, 2)}\n`);

	for await (const page of paginate(
		(args: {
			query?: string | null;
			first?: number | null;
			after?: string | null;
		}) => sdk.SearchCounterparty(args),
		{ query: "evolve" },
		{ pageSize: 50 },
	)) {
		process.stdout.write(`page of ${page.length} nodes\n`);
	}
}

main().catch((err) => {
	process.stderr.write(`${err}\n`);
	process.exit(1);
});
