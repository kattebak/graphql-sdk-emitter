# @kattebak/typespec-graphql-sdk-emitter

TypeSpec emitter that produces a typed TypeScript SDK for a GraphQL API.

Consumes the GraphQL SDL emitted by [`@kattebak/typespec-opensearch-emitter`](https://github.com/kattebak/typespec-opensearch-emitter) (or any TypeSpec → GraphQL pipeline) and emits an SDK package with:

- One typed function per GraphQL operation (no query strings in consumer code)
- Pluggable auth provider (SigV4 first, Cognito bearer / API key later)
- Cursor-pagination helpers
- LLM-friendly operations manifest
- Optional React adapter (separate sub-package)

Status: **early scaffold**. See the project epic for the implementation plan.

## License

MIT
