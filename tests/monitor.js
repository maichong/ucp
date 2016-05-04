/**
 * @copyright Maichong Software Ltd. 2016 http://maichong.it
 * @date 2016-04-14
 * @author Liang <liang@maichong.it>
 */

'use strict';


const Speed = require('./speed');

const bytes = require('bytes');

const table = require('table');

module.exports = function monitor(stream) {
  let connection = stream.connection;
  let start = Date.now();
  let streamRead = new Speed();
  let streamWrite = new Speed();
  let connRead = new Speed();
  let connWrite = new Speed();

  function count() {
    streamRead.set(stream.bytesRead);
    streamWrite.set(stream.bytesWritten);
    connRead.set(connection.bytesRead);
    connWrite.set(connection.bytesWritten);
  }

  stream.on('data', count);

  let countTimer = setInterval(count, 200);

  let debugTimer = setInterval(function () {
    let data = [];
    console.log('\n%ss', parseInt((Date.now() - start) / 1000));
    data.push([
      'Stream In',
      streamRead.current(),
      streamRead.all(),
      bytes(stream.bytesRead),
      'Stream Out',
      streamWrite.current(),
      streamWrite.all(),
      bytes(stream.bytesWritten)
    ]);
    data.push([
      'Conn.. In',
      connRead.current(),
      connRead.all(),
      bytes(connection.bytesRead),
      'Conn.. Out',
      connWrite.current(),
      connWrite.all(),
      bytes(connection.bytesWritten)
    ]);
    data.push([
      '',
      parseInt(streamRead.current(false) / connRead.current(false) * 100) + '%',
      parseInt(streamRead.all(false) / connRead.all(false) * 100) + '%',
      parseInt(stream.bytesRead / connection.bytesRead * 100) + '%',
      '',
      parseInt(streamWrite.current(false) / connWrite.current(false) * 100) + '%',
      parseInt(streamWrite.all(false) / connWrite.all(false) * 100) + '%',
      parseInt(stream.bytesWritten / connection.bytesWritten * 100) + '%',
    ]);
    data.push([
      'SRTT', parseInt(connection.srtt),
      'RTO', parseInt(connection.rto),
      //'Alive', Date.now() - connection.lastAlive,
      'Write Queue', stream._writeQueue.length,
      'SRTT', parseInt(stream.srtt)
    ]);
    data.push([
      'Rec Queue', stream.receivedLength,
      'Sent Queue', stream.sentLength,
      'Resent', stream.resentPacketCount,
      stream.resentPacketCountAuto, stream.resentPacketCountConfirm
    ]);
    console.log(table.default(data));
    //console.log('confirmedMaxSegmentId', stream.confirmedMaxSegmentId, 'receivedMaxSegmentId', stream.receivedMaxSegmentId);
    //console.log('resentPacketCount', stream.resentPacketCount);
  }, 1000);

  stream.on('close', ()=> {
    clearInterval(debugTimer);
    clearInterval(countTimer);
  });
};
