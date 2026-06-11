# Mobile remote access

## LAN access

`remote:get-access` returns private IPv4 URLs, pairing URLs, and PNG QR data
URLs. Pairing tokens are stored in URL fragments so they are not included in
HTTP requests. The remote server and phone must be reachable on the same
network.

## Cloudflare Quick Tunnel

Install the official `cloudflared` client, then call
`remote:start-tunnel` with `{ acknowledgeRisk: true }`. An optional absolute
`binaryPath` can identify the executable. The backend runs:

```text
cloudflared tunnel --url http://127.0.0.1:<port>
```

The generated `https://*.trycloudflare.com` URL is returned by
`remote:get-access`, including a pairing QR code. Stopping remote access also
stops the tunnel.

Quick Tunnels are intended for testing and development, have no SLA, and make
the local service reachable from the public Internet. Pairing authentication
remains mandatory. Do not share pairing URLs, and stop the tunnel immediately
after use. Cloudflare currently limits Quick Tunnels to 200 in-flight requests
and does not support Server-Sent Events. If `.cloudflared/config.yaml` exists,
Cloudflare requires it to be renamed temporarily before using a Quick Tunnel.

Official documentation:
https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/
