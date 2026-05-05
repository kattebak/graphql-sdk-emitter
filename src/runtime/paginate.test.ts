import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collect, paginate, paginatePages } from "./paginate.js";

interface Node {
	id: string;
}

describe("paginate", () => {
	it("walks endCursor / hasNextPage until exhausted", async () => {
		const pages: Array<{ args: { after?: string | null }; result: unknown }> = [
			{
				args: {},
				result: {
					things: {
						edges: [{ node: { id: "1" } }, { node: { id: "2" } }],
						pageInfo: { endCursor: "c1", hasNextPage: true },
					},
				},
			},
			{
				args: { after: "c1" },
				result: {
					things: {
						edges: [{ node: { id: "3" } }],
						pageInfo: { endCursor: "c2", hasNextPage: true },
					},
				},
			},
			{
				args: { after: "c2" },
				result: {
					things: {
						edges: [{ node: { id: "4" } }],
						pageInfo: { endCursor: "c3", hasNextPage: false },
					},
				},
			},
		];
		let i = 0;
		const op = async (args: {
			query?: string;
			after?: string | null;
			first?: number | null;
		}) => {
			const expected = pages[i];
			assert.ok(expected);
			assert.equal(args.after ?? undefined, expected.args.after ?? undefined);
			i += 1;
			return expected.result;
		};
		const all = await collect<{ query?: string }, unknown, Node>(op, {
			query: "x",
		});
		assert.deepEqual(
			all.map((n) => n.id),
			["1", "2", "3", "4"],
		);
		assert.equal(i, 3);
	});

	it("respects pageSize as `first`", async () => {
		const seenFirst: Array<number | null | undefined> = [];
		const op = async (args: { first?: number | null }) => {
			seenFirst.push(args.first);
			return {
				stuff: { edges: [], pageInfo: { hasNextPage: false } },
			};
		};
		await collect(op, {}, { pageSize: 25 });
		assert.deepEqual(seenFirst, [25]);
	});

	it("supports nodes-style connections", async () => {
		const op = async () => ({
			stuff: {
				nodes: [{ id: "a" }, { id: "b" }],
				pageInfo: { hasNextPage: false },
			},
		});
		const all = await collect<unknown, unknown, Node>(op, {});
		assert.deepEqual(
			all.map((n) => n.id),
			["a", "b"],
		);
	});

	it("respects maxPages", async () => {
		let calls = 0;
		const op = async () => {
			calls += 1;
			return {
				things: {
					edges: [{ node: { id: String(calls) } }],
					pageInfo: { endCursor: `c${calls}`, hasNextPage: true },
				},
			};
		};
		const all = await collect(op, {}, { maxPages: 2 });
		assert.equal(all.length, 2);
		assert.equal(calls, 2);
	});

	it("yields each page from the async iterator", async () => {
		let calls = 0;
		const op = async () => {
			calls += 1;
			return {
				things: {
					edges: [{ node: { id: String(calls) } }],
					pageInfo: {
						endCursor: `c${calls}`,
						hasNextPage: calls < 3,
					},
				},
			};
		};
		const seenPages: number[] = [];
		for await (const page of paginate<unknown, unknown, Node>(op, {})) {
			seenPages.push(page.length);
		}
		assert.deepEqual(seenPages, [1, 1, 1]);
	});

	it("stops if endCursor does not advance", async () => {
		let calls = 0;
		const op = async () => {
			calls += 1;
			return {
				things: {
					edges: [{ node: { id: "x" } }],
					pageInfo: { endCursor: "stuck", hasNextPage: true },
				},
			};
		};
		await collect(op, {});
		assert.equal(calls, 2);
	});

	it("uses connectionPath when provided", async () => {
		const op = async () => ({
			data: {
				wrapper: {
					results: {
						edges: [{ node: { id: "deep" } }],
						pageInfo: { hasNextPage: false },
					},
				},
			},
		});
		const all = await collect<unknown, unknown, Node>(
			op,
			{},
			{
				connectionPath: ["data", "wrapper", "results"],
			},
		);
		assert.deepEqual(
			all.map((n) => n.id),
			["deep"],
		);
	});
});

describe("paginatePages", () => {
	it("yields the full result per page and walks until exhausted", async () => {
		const pages = [
			{
				things: {
					edges: [{ node: { id: "1" } }, { node: { id: "2" } }],
					totalCount: 4,
					pageInfo: { endCursor: "c1", hasNextPage: true },
				},
			},
			{
				things: {
					edges: [{ node: { id: "3" } }, { node: { id: "4" } }],
					totalCount: 4,
					pageInfo: { endCursor: "c2", hasNextPage: false },
				},
			},
		];
		let i = 0;
		const op = async (_args: {
			after?: string | null;
			first?: number | null;
		}) => {
			const r = pages[i];
			assert.ok(r);
			i += 1;
			return r;
		};
		const collected: number[] = [];
		for await (const page of paginatePages(op, {})) {
			collected.push(page.things.edges.length);
		}
		assert.deepEqual(collected, [2, 2]);
		assert.equal(i, 2);
	});

	it("respects maxPages", async () => {
		let i = 0;
		const op = async (_args: {
			after?: string | null;
			first?: number | null;
		}) => {
			i += 1;
			return {
				things: {
					edges: [{ node: { id: String(i) } }],
					pageInfo: { endCursor: `c${i}`, hasNextPage: true },
				},
			};
		};
		const seen: string[] = [];
		for await (const page of paginatePages(op, {}, { maxPages: 2 })) {
			seen.push(page.things.edges[0]?.node.id ?? "");
		}
		assert.deepEqual(seen, ["1", "2"]);
	});
});
