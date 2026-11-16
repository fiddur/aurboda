# Open Food Facts (barcode lookup)

Look up a branded product by its barcode and get it as a food item. Products come from [Open Food Facts](https://world.openfoodfacts.org/) (OFF), the open, crowd-sourced database of food products, and are fetched **once** into the central shared food library (`shared_food_items`, see [Livsmedelsverket → Where the data lives](./livsmedelsverket.md#where-the-data-lives)). Every user of the instance reuses the cached row afterwards, and it shows up in normal food search like any shared item.

The barcode is typed, pasted, or read with the camera (see [Scanning](#scanning)).

## What is fetched, and when

Nothing is imported in bulk. A lookup goes:

1. The barcode is reduced to its digits (spaces and hyphens dropped) and must be 8 to 14 of them (EAN-8, UPC-A, EAN-13, GTIN-14). Anything else is rejected with 400 before any request is made.
2. It is normalised the way OFF looks codes up: leading zeros are dropped and the code is padded back to 8 or 13 digits. So a 12-digit UPC-A (`049000028911`) and its EAN-13 form (`0049000028911`) are the same product and the same row. The normalised code is the row's `source_id`.
3. `shared_food_items` is checked for `source = 'openfoodfacts'`, `source_id = <barcode>`. A row fetched less than **90 days** ago is returned as it is.
4. Otherwise (no row, or one older than 90 days) the product is fetched from OFF, mapped and upserted, and `last_fetched_at` is set to now.
5. If OFF cannot be reached (or answers with something unexpected) and an older row exists, that row is returned: stale data is better than none. Without a cached row the lookup fails with 502. A barcode OFF does not know gives 404 (`No product with this barcode at Open Food Facts`).

There is no periodic refresh job: a row is only refreshed when someone looks the barcode up again after 90 days.

The request is

```
GET https://world.openfoodfacts.org/api/v3/product/<barcode>.json?fields=product_name,brands,serving_quantity,serving_quantity_unit,nutrition_data_per,nutriments
```

made through the backend's guarded outbound HTTP (`safeFetchGet`: public addresses only, no redirects, size cap) with a 10 s timeout. It sends `User-Agent: Aurboda/<version> (https://github.com/fiddur/aurboda)`, as OFF asks of API clients, and nothing about the user: no user name, no account, no IP of the user's device.

## Mapping

The mapping lives in `apps/backend/src/services/imports/openfoodfacts.ts` (`mapOffProductToColumns`).

- **Name**: `product_name`, with the first brand from `brands` appended in parentheses when the name does not already contain it (`Nutella (Ferrero)`). Without a name, the brand; without either, `Product <barcode>`.
- **Basis**: nutrients are stored per 100 g, as OFF gives them, so `default_quantity` / `default_unit` are `100` / `g`. A product OFF reports per 100 ml (`nutrition_data_per: 100ml`) is stored per `100` / `ml`.
- **Serving**: when OFF gives a `serving_quantity` in the same unit as the basis, it becomes the row's `default_log_quantity`, so logging the product prefills one serving (e.g. 45 g) while the nutrients stay per 100 g.
- **Energy**: `energy-kcal_100g`; when that is missing, the kJ value (`energy-kj_100g` or `energy_100g`) divided by 4.184.
- **Nutrients**: OFF reports every `_100g` value in grams, so each is converted to the unit our column stores (see `NUTRIENT_FIELDS`): macros, sugars, starch and fats stay in g; cholesterol, caffeine, sodium, vitamin C/E/B1/B2/B3 (`vitamin-pp`)/B5/B6 and the minerals Ca/Cu/Fe/Mg/Mn/P/K/Zn are multiplied by 1,000 (mg); vitamin A/D/K/B12, beta-carotene, folate (`vitamin-b9`, else `folates`), Se, Cr and I by 1,000,000 (µg). Fatty acids OFF carries (omega-3/6, ALA, DHA, EPA, LA, AA, lauric, myristic, palmitic, stearic, oleic, arachidic) are mapped too. Keys we have no column for are skipped. OFF's `alcohol` is in % vol, not grams, and is not mapped.
- **Salt and sodium**: both columns exist. Each is taken from OFF when present; when only one is, the other is derived (salt = sodium × 2.5).

### Quality

What OFF has is stored as it is. When energy or any of protein, carbohydrate or fat is missing, the row is marked `nutrient_data_incomplete = true`. The API returns that flag on the food item, and the food item page shows the same "totals may be understated" note it shows for a recipe with incomplete ingredients. There is no confidence score.

## Attribution and licence

OFF data is published under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/). Wherever an item with `source = 'openfoodfacts'` is shown in the web app (the food item page), it carries "Data from Open Food Facts, licensed ODbL" with links to OFF, the licence and the product's page at `https://world.openfoodfacts.org/product/<barcode>`. The MCP tool's description asks agents to attribute it the same way.

## Admin setup

None. The OFF read API needs no key.

## User setup

None. Type, paste or [scan](#scanning) a barcode:

- on **Food Items** (`/food-items`), in _Look up a barcode_: the product's page opens;
- in a meal's food search: when the search text is a barcode, the list offers _Look up barcode … at Open Food Facts_, and picking it selects the product like a search result.

## Scanning

Where the browser can use a camera, a **Scan** button sits next to _Look up_ on Food Items, and a barcode icon at the right end of a meal's food search. It opens the camera (the back one on a phone) with a framing guide; the first EAN-13, EAN-8, UPC-A or UPC-E code it reads fills the field and runs the same lookup as typing it. Close or Escape stops the camera.

- **Readers.** The browser's own `BarcodeDetector` is used where it exists and reads EAN-13 (Chrome on Android, including the app's WebView, and Chrome on macOS). Elsewhere (for example Firefox, and Chrome on Linux and Windows) a JavaScript decoder, [ZXing](https://github.com/zxing-js/library) (`@zxing/library`), is used. It is part of the app's own bundle, loaded only when a scanner opens on such a browser; nothing is fetched from elsewhere at run time. The code is in `apps/web/src/utils/barcodeReader.ts` and `apps/web/src/components/BarcodeScanner.tsx`.
- **Privacy.** Frames are decoded on the device. No frame, picture or barcode image is stored or sent anywhere: only the decoded digits go to the lookup.
- **Needs HTTPS.** Browsers allow the camera only in a secure context (HTTPS, or `localhost`). Where there is none, or no camera API, no Scan button is shown and the barcode can be typed as before.
- **Permission.** The browser asks for the camera the first time. When it is refused the scanner says so ("The camera is blocked for this site…"), and the barcode can still be typed. In the Android app the camera permission is asked for on first use too, and granted to the server's own pages only (see [android-app.md → Camera](android-app.md#camera-barcode-scanning)).

## Endpoints

- REST: `POST /api/food-items/by-barcode`, body `{ "barcode": "3017624010701" }`, returns the food item detail (`FoodItemDetailResponse`, the same shape as `GET /api/food-items/:id`). 400 malformed barcode, 404 unknown at OFF, 502 OFF unreachable with nothing cached, 503 too many lookups in flight.
- MCP: `find_food_by_barcode` with the same `barcode` field and the same detail as `get_food_item`.

## Limits

- Every unknown barcode costs one request to OFF. The backend caps concurrent OFF requests at 4 per process, and concurrent lookups of the same barcode share one request; past the cap a lookup answers 503 (or the cached row, when one exists) rather than queueing.
- Products sold by volume are stored per 100 ml. Meal logging scales by the food's own unit, so logging such a product in grams does not convert between ml and g.
- A serving given in a different unit from the basis (a drink whose serving is in ml but whose nutrients OFF reports per 100 g) is not used as the default amount.
- Products are not contributed back to OFF, and there is no bulk import.
