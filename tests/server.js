/**
 * @copyright Maichong Software Ltd. 2016 http://maichong.it
 * @date 2016-04-10
 * @author Liang <liang@maichong.it>
 */

'use strict';

process.title = 'utp_server';

const utp = require('../index');

const Speed = require('./speed');

const bytes = require('bytes');

let server = utp.createServer({
  port: process.env.UCP_PORT || 30000,
  password: '123456'
}, function (stream) {
  console.log('income steam', stream.id);
  let start = Date.now();
  let streamRead = new Speed();
  let streamWrite = new Speed();
  let connRead = new Speed();
  let connWrite = new Speed();
  let connection = stream.connection;
  stream.on('data', data => {
    //console.log(stream.remoteAddress + ':' + stream.remotePort, data.toString());
    //stream.write(data);
    streamRead.set(stream.bytesRead);
    streamWrite.set(stream.bytesWritten);
    connRead.set(connection.bytesRead);
    connWrite.set(connection.bytesWritten);
  });

  let debugTimer = setInterval(function () {
    console.log('\n%ss', parseInt((Date.now() - start) / 1000));
    console.log('Stream In: %s/s , %s/s . Stream Out: %s/s , %s/s .', streamRead.current(), streamRead.all(), streamWrite.current(), streamWrite.all());
    console.log('Conn.. In: %s/s , %s/s . Conn.. Out: %s/s , %s/s .', connRead.current(), connRead.all(), connWrite.current(), connWrite.all());
    console.log('In: %s,%s %s%% Out: %s,%s %s%%',
      bytes(stream.bytesRead),
      bytes(connection.bytesRead),
      parseInt(stream.bytesRead / connection.bytesRead * 100),
      bytes(stream.bytesWritten),
      bytes(connection.bytesWritten),
      parseInt(stream.bytesWritten / connection.bytesWritten * 100)
    );
    console.log('confirmedMaxSegmentId', stream.confirmedMaxSegmentId, 'receivedMaxSegmentId', stream.receivedMaxSegmentId);
  }, 1000);

  stream.on('close', ()=> {
    clearInterval(debugTimer);
  });
});

server.listen();
