/**
 * @copyright Maichong Software Ltd. 2016 http://maichong.it
 * @date 2016-04-10
 * @author Liang <liang@maichong.it>
 */

'use strict';

process.title = 'utp_client';

const utp = require('../index');

const Speed = require('./speed');

let buffer = new Buffer(1024 * 1024);
buffer.fill('t');

let count = 256;

utp.connect({
  port: process.env.UCP_PORT || 30000,
  host: process.env.UCP_HOST,
  password: '123456',
  autoClose: false
}, function (stream) {
  console.log('on connect', stream.id);
  let start = Date.now();
  let streamRead = new Speed();
  let streamWrite = new Speed();
  let connRead = new Speed();
  let connWrite = new Speed();
  let connection = stream.connection;
  stream.on('data', data => {
    console.log(stream.remoteAddress + ':' + stream.remotePort, data.toString());
    //stream.close();
    streamRead.set(stream.bytesRead);
    streamWrite.set(stream.bytesWritten);
    connRead.set(connection.bytesRead);
    connWrite.set(connection.bytesWritten);
  });
  function send() {
    stream.write(buffer);
    count--;
    if (count > 0) {
      setTimeout(send, 5);
    }
  }

  send();

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
