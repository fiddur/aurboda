# Custom Activity Types

Aurboda comes with five built-in activity types: **sleep**, **exercise**, **meditation**, **nap**, and **rest**. You can define additional custom types to represent any activity you track -- sauna, driving, yoga, coding, vocal training, etc.

## Creating Custom Types

Custom activity types can be created via the REST API, MCP tools, or deduction rules. Each type has:

| Field              | Description                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `name`             | Snake_case identifier (e.g., `sauna`, `hot_bath`, `yin_yoga`)                                                            |
| `display_name`     | Human-readable name shown on the timeline                                                                                |
| `display_category` | Groups types for timeline toggles: `sleep_rest`, `exercise`, `meditation`, `wellness`, `productivity`, `travel`, `other` |
| `color`            | Hex color for timeline rendering (e.g., `#ef4444`)                                                                       |
| `icon`             | Optional emoji or icon identifier                                                                                        |
| `show_on_timeline` | Whether activities of this type appear on the timeline (default: true)                                                   |

Built-in types cannot be deleted but their display metadata (color, icon, display_name, show_on_timeline) can be updated.

## Display Categories

Display categories control how activity types are grouped in the timeline:

- **sleep_rest** -- Sleep, nap, rest
- **exercise** -- Workouts, running, weightlifting, etc.
- **meditation** -- Meditation, breathwork
- **wellness** -- Sauna, hot bath, massage, etc.
- **productivity** -- Coding, standup computer, meetings, etc.
- **travel** -- Driving, commuting, etc.
- **other** -- Anything else

## API

- `GET /activity-types` -- List all definitions
- `POST /activity-types` -- Create a custom type
- `PATCH /activity-types/:name` -- Update display metadata
- `DELETE /activity-types/:name` -- Delete a custom type (built-ins protected)

MCP tools: `list_activity_types`, `add_activity_type`, `update_activity_type`, `delete_activity_type`.

## Garmin Meditation Recognition

Garmin activities with typeKey `meditation` or `breathwork` are automatically imported as `meditation` activity type instead of generic `exercise`. Previously imported meditation activities can be corrected by changing their activity type via the API or MCP `update_activity` tool.
