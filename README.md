# MaidFlow

A JavaScript GitHub Action that invokes a
[MaidCafe](https://github.com/Solsynth/MaidCafe) action on a managed host
through the cloud relay and waits for the result.

The action enqueues a webhook request on the MaidCafe cloud
(`POST /api/daemons/:id/webhook-requests`), then polls the request until the
daemon has picked it up and reported the result. The daemon polls the relay
once a minute, so a run takes up to one minute plus the action's own runtime
before the result is known. The job fails when the request never completes,
the daemon rejects it, or the action exits non-zero; the relay result (stdout,
error) is printed to the run log.

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

## Inputs

| Input | Required | Default | Meaning |
| --- | --- | --- | --- |
| `daemon_id` | yes | — | MaidCafe daemon (host) id |
| `action` | yes | — | Action name configured on the daemon |
| `token` | yes | — | MaidCafe API credential token (`mk_...`) or Solarpass token |
| `body` | no | `{}` | JSON body piped to the action on stdin |
| `api` | no | `https://mk.solsynth.dev` | MaidCafe cloud base URL |
| `timeout_minutes` | no | `10` | Max wait for the daemon to finish |

## Outputs

| Output | Meaning |
| --- | --- |
| `result_code` | HTTP status the daemon reported: `200` success, `502` non-zero exit, `504` timeout, `401`/`404`/`413`/`429` rejected |
| `result_body` | Base64 of the action's stdout |

## Example usage

```yaml
jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - name: Run backup on the managed host
        id: backup
        uses: Solsynth/MaidFlow@v1
        with:
          daemon_id: d0f2f0c2-...
          action: backup
          body: '{"job":"incremental"}'
          token: ${{ secrets.MAIDCAFE_TOKEN }}
          timeout_minutes: 15

      - name: Print the result
        run: echo "exit ${{ steps.backup.outputs.result_code }}"
```

Pin to a full commit SHA in production (`uses: Solsynth/MaidFlow@<sha>`).
