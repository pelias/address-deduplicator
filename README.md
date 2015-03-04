# address deduplicator
A stream that performs address deduplication using the robust
[OpenVenues deduplicator](https://github.com/openvenues/address_deduper); note that it must be separately installed and
running.

## API
`pelias-address-deduplicator` exports a single function:
`createDeduplicateStream( requestBatchSize, maxLiveRequests, serverUrl )`, which accepts three optional arguments:

  * `requestBatchSize` (default: `10000`): The number of addresses to buffer into a
    batch before sending it to the deduplicator. The higher the number, the
    less time and energy collectively spent in making requests, but the
    bigger the memory consumption buildup.
  * `maxLiveRequests` (default: `4`): Since the deduper is implemented as a
    standalone server and processes data more slowly than the importer feeds
    it, the stream needs to rate-limit itself. `maxLiveRequests` indicates
    the maximum number of unresolved concurrent requests at any time; when
    that number is hit, the stream will pause reading until the number of
    concurrent requests falls below it.
  * `serverUrl` (default: `'http://localhost:5000'`): The HTTP base URL of the address deduplicator server.

and returns a `Transform` stream, which accepts un-deduplicated addresses and filters out the duplicates; note that
it'll likely be the slowest part of your data pipeline because of all the involved heavy lifting. The addresses
themselves are expected to be [pelias/model](https://github.com/pelias/model) `Document` objects.
