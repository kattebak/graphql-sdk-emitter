import { AwsClient } from "aws4fetch";
import type { AuthProvider, FetchFn } from "./types.js";

export interface SigV4Credentials {
	accessKeyId: string;
	secretAccessKey: string;
	sessionToken?: string;
}

export type CredentialsProvider = () =>
	| SigV4Credentials
	| Promise<SigV4Credentials>;

export interface SigV4AuthOptions {
	credentials: SigV4Credentials | CredentialsProvider;
	region: string;
	service?: string;
}

export class SigV4Auth implements AuthProvider {
	private readonly credentials: SigV4Credentials | CredentialsProvider;
	private readonly region: string;
	private readonly service: string;

	constructor(options: SigV4AuthOptions) {
		this.credentials = options.credentials;
		this.region = options.region;
		this.service = options.service ?? "appsync";
	}

	private async getCredentials(): Promise<SigV4Credentials> {
		return typeof this.credentials === "function"
			? await this.credentials()
			: this.credentials;
	}

	wrap(_fetch: FetchFn): FetchFn {
		return async (input, init) => {
			const creds = await this.getCredentials();
			const aws = new AwsClient({
				accessKeyId: creds.accessKeyId,
				secretAccessKey: creds.secretAccessKey,
				sessionToken: creds.sessionToken,
				region: this.region,
				service: this.service,
			});
			const url =
				typeof input === "string" || input instanceof URL
					? input.toString()
					: input.url;
			const request = new Request(url, init);
			const signed = await aws.sign(request);
			return _fetch(signed.url, {
				method: signed.method,
				headers: signed.headers,
				body: init?.body,
			});
		};
	}
}
