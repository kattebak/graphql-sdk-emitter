#!/usr/bin/env node
import { main } from "../dist/cli.js";

main()
	.then((code) => process.exit(code))
	.catch((err) => {
		process.stderr.write(
			`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
		);
		process.exit(1);
	});
