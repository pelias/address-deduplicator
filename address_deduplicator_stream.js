'use strict';

var request = require( 'request' );
var through = require( 'through2' );

function createDeduplicateStream( requestBatchSize, maxLiveRequests ){
  var addresses = [];
  var requestBatchSize = requestBatchSize || 50;

  // Used to close this stream after the input stream dries up and the last
  // live `sendBatch()` request returns.
  var streamEnded = false;
  var liveRequests = 0;

  // Used to rate-limit the requests the stream sends to the deduper.
  var streamPaused = false;
  var maxLiveRequests = maxLiveRequests || 100;

  // Number of duplicate addresses detected.
  var duplicateNum = 0;

  function sendBatch( batch, downstream ){
    var endpoint = 'http://localhost:5000/addresses/dedupe?batch=1';

    var postData = {
      json: {
        addresses: batch.map( remapDocument )
      }
    };

    function responseCallback( err, httpResponse, body ){
      liveRequests--;
      if( err || body.addresses === undefined ){
        console.error(
          "Error: %s\nHTTP Response: %s\nBody: %s\n", err, httpResponse, body
        );
        return;
      }

      for( var ind = 0; ind < body.addresses.length; ind++ ){
        var addressResp = body.addresses[ ind ];
        if( addressResp.dupe ){
          duplicateNum++;
        }
        else {
          batch[ ind ].setId( addressResp.guid );
          downstream.push( batch[ ind ] );
        }
      }

      if( liveRequests == 0 && streamEnded ){
        downstream.push( null );
      }

      if( liveRequests < maxLiveRequests && streamPaused ){
        streamPaused = false;
        downstream.emit( 'resumeStream' );
      }
    };
    request.post( endpoint, postData, responseCallback );
    liveRequests++;

    if( liveRequests >= maxLiveRequests ){
      streamPaused = true;
    }
  }

  function bufferBatch( address, enc, next ){
    addresses.push( address );
    if( addresses.length == requestBatchSize || streamEnded ){
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

  function signalStreamEnd(  ){
    streamEnded = true;
  }

  return through.obj( bufferBatch, signalStreamEnd );
};

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
