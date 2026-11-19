# FTTH Network Designer

Plan fiber-to-the-home networks on a street map, wire every closure, NAP and splitter fiber by fiber, and check each customer's optical power budget before you build.

Inspired by fiber-planner.com

Built with [oss.new](https://oss.new) for [EveryApp](https://github.com/every-app/every-app).

## Features

- Create network projects and share each one with teammates as editor or viewer.
- Draw cable routes and place poles, closures, NAPs, splitter boxes and customers on layers, with lengths, measuring and undo.
- Wire each box's splice diagram in standard fiber colour order, with splitters, customer drops and auto-feeding of NAPs.
- See every customer's loss, received power and margin for the chosen OLT class, with alerts for problems.
- Get cable and equipment totals and export them as CSV, the map as PNG and a printable plan as PDF.

Left out: accounts and sign-in, which your Gateway handles; field-crew mobile workflow; OLT system sync; inventory; KML import; satellite imagery; plans and billing.

## Setup

- Install: `pnpm install`
- Run locally: `pnpm dev`
- Test: `pnpm test` for the unit tests; the release checks in `checks/` run against a packaged build.
- Deploy: `pnpm run deploy`, then open the app from your Gateway.

There are no secrets or settings: the database comes with the install and sign-in comes from the Gateway.

## Limitations

- The street map loads tiles from the OpenStreetMap tile servers in the browser, so the map background needs internet access and follows their usage policy.
- Splitter losses are typical values per ratio, not your vendor's datasheet.
- Undo history lasts for the open page only.
- The PNG export leaves out the map background when the browser refuses to copy the tiles.
