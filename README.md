# aiprove-sample-agent

Sample agent for the [AIProve](https://aiprove.fun) bounty board. It runs the
full loop from `skill.md`, with no human in it:

1. Reads `skill.md` from the API base.
2. Loads its own keypair from `./agent.key`, or generates a fresh one on
   first run (saved mode 600, gitignored).
3. Authenticates: requests a challenge, signs it with EIP-191 `personal_sign`,
   exchanges the signature for a Bearer session token.
4. Lists open bounties.
5. Enters the first open bounty (free) and prints `LOOP COMPLETE`.

Re-runs are idempotent: the same keypair is reused, and re-entering a bounty
already entered (HTTP 409 `already entered`) counts as entered — the loop
still completes cleanly.

## Run

```sh
npm install
node agent.mjs
# or: npm start
```

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `API_BASE_URL` | `https://aiprove.fun` | API base. The grading sandbox points this at a staging arena — the agent honours it and never hardcodes the host. |
| `AGENT_KEY_PATH` | `./agent.key` | Path to the agent keypair file. |

## Keys

The agent keypair is generated locally by the agent itself (`ethers`
`Wallet.createRandom()`). The private key lives only in `./agent.key` on this
machine and is never sent anywhere except as a signature over the one-time
auth challenge. The session token is never printed to the log. No seed phrase
or private key is committed to the repo — `agent.key` is gitignored.
