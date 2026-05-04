import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSchema } from "graphql";
import {
	buildFilterShapes,
	buildManifest,
	describeSchemaTypes,
} from "./manifest.js";

const SDL = /* GraphQL */ `
"""
A counterparty.
"""
type Counterparty {
	id: ID!
	name: String!
}

type PageInfo {
	endCursor: String
	hasNextPage: Boolean!
}

type CounterpartyConnection {
	edges: [Counterparty!]!
	pageInfo: PageInfo!
}

input CounterpartyFilter {
	"""
	Match counterparty name.
	"""
	name: String
	and: [CounterpartyFilter!]
}

type Query {
	"""
	Search counterparties.
	"""
	searchCounterparty(query: String, filter: CounterpartyFilter, first: Int, after: String): CounterpartyConnection!

	"""
	Look up by id.
	"""
	counterparty(id: ID!): Counterparty
}

type Mutation {
	"""
	Create one.
	"""
	createCounterparty(name: String!): Counterparty!
		@deprecated(reason: "use createCounterpartyV2")
}
`;

describe("buildManifest", () => {
	it("emits one entry per query and mutation field, sorted", () => {
		const schema = buildSchema(SDL);
		const manifest = buildManifest(schema);
		assert.equal(manifest.version, 1);
		const names = manifest.operations.map((o) => o.name);
		assert.deepEqual(names, [
			"counterparty",
			"createCounterparty",
			"searchCounterparty",
		]);
	});

	it("captures kind, description, parameters, and return type", () => {
		const schema = buildSchema(SDL);
		const manifest = buildManifest(schema);
		const search = manifest.operations.find(
			(o) => o.name === "searchCounterparty",
		);
		assert.ok(search);
		assert.equal(search?.kind, "query");
		assert.equal(search?.description, "Search counterparties.");
		assert.equal(search?.returns, "CounterpartyConnection!");
		const filterParam = search?.parameters.find((p) => p.name === "filter");
		assert.ok(filterParam);
		assert.equal(filterParam?.type, "CounterpartyFilter");
		assert.equal(filterParam?.required, false);
		const idParam = manifest.operations
			.find((o) => o.name === "counterparty")
			?.parameters.find((p) => p.name === "id");
		assert.equal(idParam?.required, true);
		assert.equal(idParam?.type, "ID!");
	});

	it("captures deprecated reason on mutations", () => {
		const schema = buildSchema(SDL);
		const manifest = buildManifest(schema);
		const create = manifest.operations.find(
			(o) => o.name === "createCounterparty",
		);
		assert.equal(create?.kind, "mutation");
		assert.equal(create?.deprecated, "use createCounterpartyV2");
	});
});

describe("buildFilterShapes", () => {
	it("emits input object types with descriptions", () => {
		const schema = buildSchema(SDL);
		const shapes = buildFilterShapes(schema);
		const filter = shapes.find((s) => s.name === "CounterpartyFilter");
		assert.ok(filter);
		const nameField = filter?.fields.find((f) => f.name === "name");
		assert.equal(nameField?.description, "Match counterparty name.");
		assert.equal(nameField?.type, "String");
	});
});

describe("describeSchemaTypes", () => {
	it("returns kinds and descriptions, skipping introspection types", () => {
		const schema = buildSchema(SDL);
		const types = describeSchemaTypes(schema);
		const cp = types.find((t) => t.name === "Counterparty");
		assert.equal(cp?.kind, "object");
		assert.equal(cp?.description, "A counterparty.");
		assert.ok(!types.some((t) => t.name.startsWith("__")));
	});
});
