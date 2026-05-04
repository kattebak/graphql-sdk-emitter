import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SigV4Auth } from "./sigv4.js";

describe("SigV4Auth", () => {
	it("adds AWS SigV4 authorization headers", async () => {
		const auth = new SigV4Auth({
			credentials: {
				accessKeyId: "AKIAIOSFODNN7EXAMPLE",
				secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
			},
			region: "us-east-1",
			service: "appsync",
		});
		let captured: Headers | undefined;
		let capturedUrl: string | undefined;
		const wrapped = auth.wrap(async (input, init) => {
			capturedUrl = typeof input === "string" ? input : input.toString();
			captured = new Headers(init?.headers);
			return new Response("{}");
		});
		await wrapped("https://abc.appsync-api.us-east-1.amazonaws.com/graphql", {
			method: "POST",
			body: JSON.stringify({ query: "{ __typename }" }),
			headers: { "content-type": "application/json" },
		});
		assert.ok(captured);
		const authHeader = captured?.get("authorization") ?? "";
		assert.ok(
			authHeader.startsWith("AWS4-HMAC-SHA256"),
			`expected AWS4 header, got: ${authHeader}`,
		);
		assert.match(authHeader, /Credential=AKIAIOSFODNN7EXAMPLE/);
		assert.match(authHeader, /SignedHeaders=/);
		assert.match(authHeader, /Signature=[0-9a-f]+/);
		assert.ok(captured?.get("x-amz-date"));
		assert.equal(
			capturedUrl,
			"https://abc.appsync-api.us-east-1.amazonaws.com/graphql",
		);
	});

	it("includes session token when provided", async () => {
		const auth = new SigV4Auth({
			credentials: {
				accessKeyId: "AKIAIOSFODNN7EXAMPLE",
				secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
				sessionToken: "session-tok",
			},
			region: "us-east-1",
		});
		let captured: Headers | undefined;
		const wrapped = auth.wrap(async (_input, init) => {
			captured = new Headers(init?.headers);
			return new Response("{}");
		});
		await wrapped("https://abc.appsync-api.us-east-1.amazonaws.com/graphql", {
			method: "POST",
			body: "{}",
		});
		assert.equal(captured?.get("x-amz-security-token"), "session-tok");
	});

	it("supports a credentials provider function", async () => {
		let calls = 0;
		const auth = new SigV4Auth({
			credentials: () => {
				calls += 1;
				return {
					accessKeyId: "AKIAIOSFODNN7EXAMPLE",
					secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
				};
			},
			region: "us-east-1",
		});
		const wrapped = auth.wrap(async () => new Response("{}"));
		await wrapped("https://abc.appsync-api.us-east-1.amazonaws.com/graphql", {
			method: "POST",
			body: "{}",
		});
		assert.equal(calls, 1);
	});
});
