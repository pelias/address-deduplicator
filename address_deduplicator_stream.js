/**
 * @file Exports a stream that deduplicates Document objects, discarding
 *    duplicates and pushing non-duplicates further downstream.
 */

'use strict';

var request = require( 'request' );
var through = require( 'through2' );
var url = require( 'url' );
var logger = require( 'pelias-logger' ).get( 'address-deduplicator' );

function getTimeMs(){
  return new Date().getTime();
}

/**
 * Return an address deduplication filter.
 *
 * @param {int} [requestBatchSize=10000] The number of addresses to buffer into a
 *    batch before sending it to the deduplicator. The higher the number, the
 *    less time and energy collectively spent in making requests, but the
 *    bigger the memory consumption buildup.
 * @param {int} [maxLiveRequests=4] Since the deduper is implemented as a
 *    standalone server and processes data more slowly than the importer feeds
 *    it, the stream needs to rate-limit itself. `maxLiveRequests` indicates
 *    the maximum number of unresolved concurrent requests at any time; when
 *    that number is hit, the stream will pause reading until the number of
 *    concurrent requests falls below it.
 * @param {string} [serverUrl='http://localhost:5000'] The HTTP base url of
 *    the address deduplicator server.
 * @return {transform Stream} Removes duplicate addresses from a stream of
 *    Document objects (the first such address, though, is let through).
 */
function createDeduplicateStream(
  requestBatchSize, maxLiveRequests, serverUrl
){
  /* jshint validthis: true */

  var addresses = [];
  requestBatchSize = requestBatchSize || 10000;

  // Used to close this stream after the input stream dries up and the last
  // live `sendBatch()` request returns.
  var streamEnded = false;
  var liveRequests = 0;

  // Used to rate-limit the requests the stream sends to the deduper.
  var streamPaused = false;
  maxLiveRequests = maxLiveRequests || 4;

  // Number of duplicate addresses detected.
  serverUrl = url.resolve(
    serverUrl || 'http://localhost:5000', 'addresses/dedupe?batch=1'
  );

  // Configure periodic statistics logging.
  var stats = {
    total: 0,
    duplicates: 0,
    uniques: 0,
    timeSpentPaused: 0
  };

  var pauseTime;

  var intervalId = setInterval( function (  ){
    logger.verbose( stats );
  }, 1e4);

  /**
   * @param {array of Document} batch The batch to send to the deduplicator,
   *    which indicates which objects are duplicates.
   * @param {transform Stream} downstream The pipeline to push non-duplicates
   *    into.
   */
  function sendBatch( batch, downstream ){
    var postData = {
      json: {
        addresses: batch.map( remapDocument )
      }
    };

    function responseCallback( err, httpResponse, body ){
      liveRequests--;
      if( err || body.addresses === undefined ){
        console.error(
          'Error: %s\nHTTP Response: %s\nBody: %s\n', err, httpResponse, body
        );
      }
      else {
        for( var ind = 0; ind < body.addresses.length; ind++ ){
          var addressResp = body.addresses[ ind ];
          if( addressResp.dupe ){
            stats.duplicates++;
          }
          else {
            stats.uniques++;
            batch[ ind ].setId( addressResp.guid );
            downstream.push( batch[ ind ] );
          }
        }
      }

      if( liveRequests === 0 && streamEnded ){
        clearInterval( intervalId );
        logger.info( 'Closing the deduplicator stream.' );
        downstream.push( null );
      }

      if( liveRequests < maxLiveRequests && streamPaused ){
        stats.timeSpentPaused += getTimeMs() - pauseTime;
        streamPaused = false;
        downstream.emit( 'resumeStream' );
      }
    }
    request.post( serverUrl, postData, responseCallback );
    liveRequests++;

    if( liveRequests >= maxLiveRequests ){
      pauseTime = getTimeMs();
      streamPaused = true;
    }
  }

  /**
   * Store up to `requestBatchSize` incoming addresses in the `addresses`
   * array, then send them to the de-duplicator via `sendBatch()`.
   *
   * @param {Document} address An address coming down the pipeline.
   */
  function bufferBatch( address, enc, next ){
    addresses.push( address );
    stats.total++;
    if( addresses.length === requestBatchSize || streamEnded ){
      sendBatch( addresses, this );
      addresses = [];
    }

    if( streamPaused ){
      this.once( 'resumeStream', next );
    }
    else {
      next();
    }
  }

  /**
   * Indicates that the last `Address` object has passed through the pipeline,
   * so that `bufferBatch()` can close it after the last `sendBatch()` request
   * has returned.
   */
  function signalStreamEnd(){
    streamEnded = true;
    sendBatch( addresses, this );
  }

  return through.obj( bufferBatch, signalStreamEnd );
}

/**
 * Remap a Document object to the schema required by the address deduplicator.
 *
 * @param {doc} A document ready to be sent to the deduplicator.
 * @return {object} `doc` mapped to the format required by the deduplicator.
 */
function remapDocument( doc ){
  var centroid = doc.getCentroid();
  return {
    house_name: null,
    house_number: null,
    street: doc.getName( 'default' ),
    locality: doc.getAdmin( 'admin2' ),
    region: doc.getAdmin( 'admin1' ),
    postal_code: null,
    country: doc.getAdmin( 'admin0' ),
    latitude: centroid.lat,
    longitude: centroid.lon
  };
}

module.exports = createDeduplicateStream;
