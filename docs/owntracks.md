# OwnTracks Integration

[OwnTracks](https://owntracks.org/) is an open-source location tracking app for iOS and Android. Aurboda can receive location data from OwnTracks in HTTP mode.

## Endpoint

```
POST /ownTracks
```

The endpoint accepts OwnTracks JSON payloads and stores location data and waypoints (geofences).

**Note:** In the default deployment, the backend is served at `/api`, so the full URL is `/api/ownTracks`.

## Authentication

The endpoint uses HTTP Basic Authentication with your existing Aurboda credentials (the same username and password used for the web interface / PostgreSQL database).

## OwnTracks App Configuration

### iOS / Android Settings

1. Open OwnTracks app
2. Go to Settings (tap the `(i)` button)
3. Set **Mode** to **HTTP**
4. Configure the following:

| Setting  | Value                               |
| -------- | ----------------------------------- |
| URL      | `https://aurboda.net/api/ownTracks` |
| Username | Your Aurboda username               |
| Password | Your Aurboda password               |

**Note:** No trailing slash is needed on the URL.

### Self-hosted

If self-hosting, adjust the URL based on your deployment. The backend endpoint is `/ownTracks`, but may be behind a prefix like `/api` depending on your reverse proxy configuration.

## Supported Message Types

### Location (`_type: "location"`)

Location updates are stored with:

- Coordinates (latitude, longitude)
- Timestamp
- Accuracy
- Altitude
- Velocity
- Regions (geofences the device is currently in)

### Waypoint (`_type: "waypoint"`)

Waypoints/geofences are stored as places with:

- Name (description)
- Coordinates
- Radius
- External ID for updates

### Status (`_type: "status"`)

Status messages are accepted but not stored (informational only).

### Other Types

Other message types (transitions, etc.) are accepted with a `200 OK` response but not processed.

## Response

Successful requests return:

```
[]
```

This empty JSON array response is expected by OwnTracks and indicates success.

## Error Responses

| Status | Description                    |
| ------ | ------------------------------ |
| 401    | Missing or invalid credentials |
| 500    | Server error                   |

## Security

- Always use HTTPS in production
- The endpoint validates credentials before processing any data
- Failed authentication attempts are logged

## Troubleshooting

### "Unauthorized" error

- Verify your username and password are correct
- Ensure you're using the same credentials as for the web interface
- Check that HTTP Basic Auth is being sent (not Bearer token)

### No data appearing

- Verify the URL doesn't have typos
- Check that the app is set to HTTP mode (not MQTT)
- Ensure the app has location permissions
- Check server logs for errors

## Example Request

```bash
curl -X POST https://aurboda.net/api/ownTracks \
  -u "username:password" \
  -H "Content-Type: application/json" \
  -d '{
    "_type": "location",
    "lat": 59.3293,
    "lon": 18.0686,
    "tst": 1705936800,
    "acc": 10,
    "alt": 100,
    "vel": 5
  }'
```
