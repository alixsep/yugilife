# Starter inventory assets

This directory is an app-owned onboarding snapshot. The card values and binary sources were promoted
from the Series 10 real-card visual fixtures rather than imported from test-only paths at runtime.
That separation is intentional: changing or removing a visual fixture must not silently change the
collection shipped to new users.

Artwork files retain the fixture WebP bytes. Preview PNGs are 407 pixels wide derivatives of the
canonical 813 × 1185 Chromium visual snapshots, which is sufficient for the inventory carousel
without adding full-resolution PNGs to the application.

Changing this pack affects only pristine inventories created by that application release. The
IndexedDB bootstrap marker is completed atomically with the first seed and is never cleared by card
deletion or an application update. Do not use an empty inventory as permission to apply this pack.
