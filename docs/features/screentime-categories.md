# Screentime Categories

Screentime Categories let you organize your screen time data into a meaningful hierarchy. Instead of seeing a flat list of apps and websites, you define categories like "Work > Programming" or "Media > Social Media" and assign apps to them using regex patterns. Categories are shared across all screen time sources (RescueTime, ActivityWatch Desktop, ActivityWatch Android).

## How Categories Work

Each category has:

- A **hierarchical name** (e.g., "Work > Programming > IDE"). The path determines the parent-child relationship.
- A **regex pattern** that matches against app names and window titles. For example, `GitHub|Stack Overflow|vscode` matches any of those.
- A **productivity score** from -2 (Very Distracting) to +2 (Very Productive). Children inherit their parent's score unless overridden.
- A **color** for display on the Timeline and elsewhere. Also inherited from parent if not set.
- An optional **exclude from screentime** flag that hides matched records from the Timeline and summaries (useful for system processes like window managers).

When a screen time record comes in, it's tested against all category regex patterns. If multiple match, the **deepest** (most specific) category wins. A record matching both "Work" and "Work > Programming" is categorized as "Work > Programming".

Categories with no regex pattern serve as grouping containers -- they organize subcategories but don't match anything directly.

## Managing Categories

The management page at `/screentime-categories` shows your category tree with indented hierarchy. Each category displays its name, regex pattern, color, and score. From here you can:

### Create a category

Choose a parent (or top level), give it a name, set a regex pattern, and optionally pick a color and score. Creating a category with a regex automatically recategorizes all existing screen time records.

### Edit a category

Change the name, regex, color, score, case sensitivity, or the "exclude from screentime" flag. Saving triggers automatic recategorization.

### Delete a category

Removes the category and all its children. Triggers recategorization.

### Load defaults

Pre-built categories compatible with ActivityWatch:
- **Work** (green, Very Productive) -- with subcategories for Programming, Image, Video, Audio, 3D
- **Media** (red, Distracting) -- with Games, Video, Social Media, Music
- **Comms** (cyan, Neutral) -- with IM and Email

Defaults are appended to existing categories, not replacing them.

### Import from ActivityWatch

If you run ActivityWatch locally, enter its URL (default `http://localhost:5600`) to import its category configuration. Categories are converted from ActivityWatch format and inserted. Optionally replace all existing categories.

## Category Detail Page

Clicking a category name opens its detail page showing:

- **Time trend**: An EMA chart showing hours spent in this category over time, with adjustable lookback period.
- **Sub-categories**: Cards for each child category with total time.
- **Matched apps**: Apps currently assigned to this category, with a "Remove" button to unassign.
- **Uncategorized apps**: Apps with no category, with an "Add here" button to quickly assign them. You can match by app name, a keyword from the window title, or a custom term.
- **Icon**: An emoji or image you can assign to the category (shown on the Timeline).

## Where Categories Appear

### Timeline

Screen time blocks on the Timeline are colored by their category color. Excluded categories are filtered out entirely. In horizontal mode, screen time appears as stacked bar charts bucketed by top-level category.

### Correlations

The Correlations page includes a "Productivity Categories" table showing how each category correlates with your HRV and heart rate, including Pearson correlation coefficients.

### Trends

You can create trend charts for any screentime category, tracking hours spent over time with EMA smoothing.

### Detail view

When clicking a screen time record, the detail page shows the resolved category path with links to each level.

## What Data It Needs

Screen time data from at least one source:

| Source | What it provides |
|---|---|
| **RescueTime** | App and website usage with built-in productivity scores. Categories override RescueTime's own scoring. |
| **ActivityWatch Desktop** | Window-level app usage from desktop. Pushed via agent script. |
| **ActivityWatch Android** | App usage from Android phone. |

Categories apply equally to data from all sources.

## Known Limitations

- Category matching is **regex-based**, which is powerful but can be tricky for complex patterns. Most users just need pipe-separated app names (e.g., `Slack|Discord|Teams`).
- Recategorization runs in the background after rule changes. For large datasets, this may take a few seconds.
- The "exclude from screentime" flag filters records from the Timeline and daily summaries, but the data is still stored and accessible via the API.
- Multi-device overlap (e.g., desktop and phone active simultaneously) is handled by capping total time to the bucket duration, but within a single category the overlap isn't deduplicated.
