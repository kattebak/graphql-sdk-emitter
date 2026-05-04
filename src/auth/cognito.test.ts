import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CognitoBearerAuth } from "./cognito.js";

describe("CognitoBearerAuth", () => {
	it("adds Authorization header with Bearer scheme", async () => {
		const auth = new CognitoBearerAuth({ token: "jwt-abc" });
		let captured: Headers | undefined;
		const wrapped = auth.wrap(async (_input, init) => {
			captured = new Headers(init?.headers);
			return new Response("{}");
		});
		await wrapped("https://example.com");
		assert.equal(captured?.get("authorization"), "Bearer jwt-abc");
	});

	it("supports a token provider function", async () => {
		let calls = 0;
		const auth = new CognitoBearerAuth({
			token: () => {
				calls += 1;
				return `tok-${calls}`;
			},
		});
		let captured: Headers | undefined;
		const wrapped = auth.wrap(async (_input, init) => {
			captured = new Headers(init?.headers);
			return new Response("{}");
		});
		await wrapped("https://example.com");
		await wrapped("https://example.com");
		assert.equal(calls, 2);
		assert.equal(captured?.get("authorization"), "Bearer tok-2");
	});

	it("supports custom scheme", async () => {
		const auth = new CognitoBearerAuth({ token: "abc", scheme: "JWT" });
		let captured: Headers | undefined;
		const wrapped = auth.wrap(async (_input, init) => {
			captured = new Headers(init?.headers);
			return new Response("{}");
		});
		await wrapped("https://example.com");
		assert.equal(captured?.get("authorization"), "JWT abc");
	});
});
