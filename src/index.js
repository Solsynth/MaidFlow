import * as core from "@actions/core";

const POLL_INTERVAL_MS = 5000;
const DEFAULT_API = "https://mk.solsynth.dev";

function base64(value) {
  return Buffer.from(value, "utf8").toString("base64");
}

function request(url, token, options = {}) {
  const headers = { Authorization: `Bearer ${token}`, ...(options.headers || {}) };
  return fetch(url, { ...options, headers });
}

async function run() {
  const daemonId = core.getInput("daemon_id", { required: true });
  const action = core.getInput("action", { required: true });
  const token = core.getInput("token", { required: true });
  const api = (core.getInput("api") || DEFAULT_API).replace(/\/+$/, "");
  const body = core.getInput("body") || "{}";
  const timeoutInput = core.getInput("timeout_minutes") || "10";
  const timeoutMinutes = Number(timeoutInput);
  if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) {
    throw new Error(`timeout_minutes must be a positive number, got "${timeoutInput}"`);
  }

  // 1. Enqueue the invocation on the MaidCafe cloud relay.
  const enqueueUrl = `${api}/api/daemons/${encodeURIComponent(daemonId)}/webhook-requests`;
  const enqueueResponse = await request(enqueueUrl, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: action, body: base64(body) }),
  });
  if (!enqueueResponse.ok) {
    const detail = await enqueueResponse.text();
    throw new Error(`enqueue failed: HTTP ${enqueueResponse.status} ${detail}`);
  }
  const enqueued = await enqueueResponse.json();
  const requestId = enqueued.id;
  core.info(`enqueued request ${requestId} (action=${action}, daemon=${daemonId})`);

  // 2. Poll until the daemon reports a result or the deadline passes.
  const resultUrl = `${api}/api/daemons/${encodeURIComponent(daemonId)}/webhook-requests/${encodeURIComponent(requestId)}`;
  const deadline = Date.now() + timeoutMinutes * 60_000;
  let status = "pending";
  let result = null;
  while (Date.now() < deadline) {
    const response = await request(resultUrl, token);
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`fetch result failed: HTTP ${response.status} ${detail}`);
    }
    result = await response.json();
    status = result.status;
    if (status === "done") break;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  if (status !== "done") {
    throw new Error(
      `action did not complete within ${timeoutMinutes} minute(s) (status=${status}); ` +
        "the daemon polls the relay once a minute"
    );
  }

  // 3. Surface the result; fail on rejection or non-zero exit.
  const resultCode = result.result_code ?? 0;
  const resultError = result.result_error ?? "";
  const resultBody = result.result_body ?? "";

  core.setOutput("result_code", String(resultCode));
  core.setOutput("result_body", resultBody);
  core.info(`status=done result_code=${resultCode}`);
  if (resultError) {
    core.error(`relay error: ${resultError}`);
  }
  if (resultBody) {
    const stdout = Buffer.from(resultBody, "base64").toString("utf8");
    core.info(`stdout:\n${stdout}`);
  }
  if (resultCode !== 200 || resultError) {
    throw new Error(`action failed (result_code=${resultCode}, error=${resultError})`);
  }
}

run().catch((error) => core.setFailed(error.message));
