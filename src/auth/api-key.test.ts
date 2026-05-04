import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiKeyAuth } from "./api-key.js";

describe("ApiKeyAuth", () => {
	it("adds the default x-api-key header", async () => {
		const auth = new ApiKeyAuth({ apiKey: "secret-key" });
		let captured: Headers | undefined;
		const wrapped = auth.wrap(async (_input, init) => {
			captured = new Headers(init?.headers);
			return new Response("{}");
		});
		await wrapped("https://example.com");
		assert.equal(captured?.get("x-api-key"), "secret-key");
	});

	it("supports a custom header name", async () => {
		const auth = new ApiKeyAuth({ apiKey: "k", headerName: "X-Custom-Key" });
		let captured: Headers | undefined;
		const wrapped = auth.wrap(async (_input, init) => {
			captured = new Headers(init?.headers);
			return new Response("{}");
		});
		await wrapped("https://example.com");
		assert.equal(captured?.get("x-custom-key"), "k");
	});

	it("preserves caller-provided headers", async () => {
		const auth = new ApiKeyAuth({ apiKey: "k" });
		let captured: Headers | undefined;
		const wrapped = auth.wrap(async (_input, init) => {
			captured = new Headers(init?.headers);
			return new Response("{}");
		});
		await wrapped("https://example.com", {
			headers: { "content-type": "application/json" },
		});
		assert.equal(captured?.get("content-type"), "application/json");
		assert.equal(captured?.get("x-api-key"), "k");
	});
});
