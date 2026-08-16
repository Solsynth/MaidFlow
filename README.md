# MaidFlow

Reusable GitHub Actions workflow that invokes a [MaidCafe](https://github.com/Solsynth/MaidCafe)
action on a managed host through the cloud relay.

The workflow enqueues a webhook request on the MaidCafe cloud
(`POST /api/daemons/:id/webhook-requests`), then polls the request until the
daemon has picked it up and reported the result. The daemon polls the relay
once a minute, so a run takes up to one minute plus the action's own runtime
before the result is known.

Actions carry no secret; authentication is the cloud credential scoped to the
daemon and action names. Use this for CI/CD. Secret-protected webhooks are
meant for humans and other systems — see the MaidCafe
[webhook docs](https://github.com/Solsynth/MaidCafe/blob/main/docs/webhooks.md).

## Setup

1. Create a credential scoped to the target daemon and action:

   ```sh
   curl -X POST https://mk.solsynth.dev/api/credentials \
     -H 'Authorization: Bearer <solar-token>' \
     -H 'Content-Type: application/json' \
     -d '{"label":"ci-backup","host_ids":["<host-id>"],"action_names":["backup"]}'
   ```

   The response contains the plain token (`mk_...`) — returned only once.
   `host_ids` are the daemon's stable host id (the file the daemon stores in
   `/etc/maidcafe/host-id`), so the credential survives re-registrations.

2. Store the token as a repository secret named `MAIDCAFE_TOKEN`. It
   authenticates user routes in place of a Solarpass token, and the daemon
   records its label as `invoked_by` in the audit log.

3. Find the daemon id: `GET /api/daemons?workspace_id=<id>` (or the cloud
   page's host detail).

## Usage from another repository

```yaml
jobs:
  backup:
    uses: Solsynth/MaidFlow/.github/workflows/invoke.yml@main
    with:
      daemon_id: d0f2f0c2-...
      action: backup
      body: '{"job":"incremental"}'
      timeout_minutes: 15
    secrets:
      MAIDCAFE_TOKEN: ${{ secrets.MAIDCAFE_TOKEN }}
```

## Manual dispatch

Use **Actions → Invoke MaidCafe action → Run workflow** and fill in the daemon
id and action name. The body defaults to `{}` and is piped to the action's
stdin; for `script = true` actions a JSON body also fills `{{ NAME }}`
placeholders in the script.

## Inputs

| Input | Required | Default | Meaning |
| --- | --- | --- | --- |
| `daemon_id` | yes | — | MaidCafe daemon (host) id |
| `action` | yes | — | Action name configured on the daemon |
| `body` | no | `{}` | JSON body piped to the action on stdin |
| `api` | no | `https://mk.solsynth.dev` | MaidCafe cloud base URL |
| `timeout_minutes` | no | `10` | Max wait for the daemon to finish |

Secret: `MAIDCAFE_TOKEN` (required) — a MaidCafe API credential token.

## Outputs

| Output | Meaning |
| --- | --- |
| `result_code` | HTTP status the daemon reported: `200` success, `502` non-zero exit, `504` timeout, `401`/`404`/`413`/`429` rejected |
| `result_body` | Base64 of the action's stdout |

The job fails when the request never completes, the daemon rejects it, or the
action exits non-zero. The relay result (stdout, error) is printed to the run
log.
