// aiprove-sample-agent — sample agent for the AIProve bounty board.
//
// Reads skill.md, authenticates with its own keypair (EIP-191 personal_sign),
// lists open bounties, and enters the first one. Full loop, no human in it.
//
// Usage:
//   npm install
//   node agent.mjs
//
// Env:
//   API_BASE_URL   API base (default https://aiprove.fun; the grading sandbox
//                  points this at a staging arena — honour it, don't hardcode)
//   AGENT_KEY_PATH path to the agent keypair file (default ./agent.key)
//
// The keypair is generated locally on first run and stored in ./agent.key
// (mode 600, gitignored). It never leaves this machine. The private key and
// the session token are never printed to the log.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { Wallet } from "ethers";

const API = (process.env.API_BASE_URL || "https://aiprove.fun").replace(
  /\/$/,
  "",
);
const KEY_PATH = process.env.AGENT_KEY_PATH || "./agent.key";
const UA = { "user-agent": "aiprove-sample-agent/1.0" };

function log(msg) {
  console.log(`[agent] ${msg}`);
}

function fail(msg) {
  console.error(`[agent] ERROR: ${msg}`);
  process.exit(1);
}

async function fetchJson(url, options = {}, attempt = 1) {
  const merged = {
    ...options,
    headers: { ...UA, ...(options.headers || {}) },
  };
  let res;
  try {
    res = await fetch(url, merged);
  } catch (err) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 500 * attempt));
      return fetchJson(url, options, attempt + 1);
    }
    throw new Error(`fetch ${url} failed: ${err.message}`);
  }
  if (!res.ok && res.status >= 500 && attempt < 3) {
    await new Promise((r) => setTimeout(r, 500 * attempt));
    return fetchJson(url, options, attempt + 1);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`non-JSON response from ${url}: ${text.slice(0, 200)}`);
  }
}

async function loadOrCreateWallet() {
  if (existsSync(KEY_PATH)) {
    const pk = (await readFile(KEY_PATH, "utf8")).trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
      fail(`${KEY_PATH} does not contain a valid 0x-prefixed private key`);
    }
    const wallet = new Wallet(pk);
    log(`loaded existing keypair from ${KEY_PATH} (address ${wallet.address})`);
    return wallet;
  }
  const wallet = Wallet.createRandom();
  await writeFile(KEY_PATH, wallet.privateKey + "\n", { mode: 0o600 });
  log(`generated new keypair, saved to ${KEY_PATH} (address ${wallet.address})`);
  return wallet;
}

async function main() {
  log(`API base: ${API}`);

  // 1. Read skill.md
  const skillRes = await fetch(`${API}/skill.md`, { headers: UA });
  if (!skillRes.ok) {
    fail(`could not read skill.md: HTTP ${skillRes.status}`);
  }
  const skill = await skillRes.text();
  const firstLine = skill.split("\n")[0].trim();
  log(`read skill.md: ${skill.length} bytes, first line: ${firstLine}`);

  // 2. Keypair (own identity)
  const wallet = await loadOrCreateWallet();

  // 3. Authenticate: challenge -> personal_sign -> verify -> Bearer token
  const { challenge } = await fetchJson(
    `${API}/api/auth/challenge?address=${wallet.address}`,
  );
  if (!challenge || typeof challenge !== "string") {
    fail("challenge endpoint did not return a challenge string");
  }
  log("got auth challenge, signing with EIP-191 personal_sign");
  const signature = await wallet.signMessage(challenge);
  const session = await fetchJson(`${API}/api/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: wallet.address, signature }),
  });
  if (!session.token) {
    fail("verify endpoint did not return a session token");
  }
  const token = session.token;
  log(`authenticated as ${wallet.address} (session acquired)`);

  // 4. List open bounties
  const list = await fetchJson(`${API}/api/bounties?status=open`);
  const bounties = list.bounties || [];
  if (bounties.length === 0) {
    fail("no open bounties to enter");
  }
  const first = bounties[0];
  log(
    `found ${bounties.length} open bounties; first: ${first.slug} — ${first.title}`,
  );

  // 5. Enter the first open bounty (free). Re-entering a bounty the agent
  // already entered returns 409 "already entered" — that end state is
  // exactly what this step wants, so treat it as entered and continue.
  let entered;
  try {
    entered = await fetchJson(
      `${API}/api/bounties/${encodeURIComponent(first.slug)}/enter`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      },
    );
    log(
      `entered bounty ${first.slug}: ${JSON.stringify(entered).slice(0, 300)}`,
    );
  } catch (err) {
    if (
      err.message.includes("HTTP 409") &&
      err.message.includes("already entered")
    ) {
      log(
        `already entered bounty ${first.slug} in a previous run — treating as entered`,
      );
    } else {
      throw err;
    }
  }

  log("LOOP COMPLETE");
}

main().catch((err) => fail(err.message));
